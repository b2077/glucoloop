"""Predicted-low watcher + proactive workflow orchestrator (GlucoLoop scenario).

A zero-dependency (stdlib) Python script that watches the ML glucose
forecast and runs a workflow when the prediction trends down below a
critical threshold:

  1. DETECT  — poll GET /forecast/:patient; when a predicted point within
     the horizon crosses below `threshold_mgdl` while the trajectory is
     still falling (confirmed for `confirm_polls` consecutive polls) →
  2. INFORM  — initiate a conversation with the patient through the LLM
     agent: POST /chat/:patient with a "[SYSTEM EVENT ...]" trigger. Ella
     replies with what is about to happen and asks the patient to
     acknowledge; the exchange lands in /state/:patient `chat_history`,
     so it shows up in the app as an unsolicited assistant message.
  3. WAIT    — give the patient `response_window_min` (default 30) to
     reply. Sim minutes by default (matches the simulator's clock, so a
     demo at --accel 60 experiences "30 minutes" in 30 s); set
     `response_window_mode: "wall"` for real-time minutes.
  4. PROTOCOL— if the patient replies in time → acknowledged, done. If not
     → the LLM agent starts the no-response protocol (second [SYSTEM
     EVENT]) and the watcher executes the steps listed under `protocol` in
     the config file. Steps that are not implemented yet are logged as
     deferred — define them later in config.low_watch.json.

Safety stance (same as the rest of GlucoLoop): the agent recommends, the
patient approves. The watcher never actuates the pump itself.

Usage:
    python low_watch.py                          # uses config.low_watch.json
    python low_watch.py --response-window-min 5  # override the wait window
    python low_watch.py --once                   # single check (debugging)

Config precedence: built-in defaults < config.low_watch.json < CLI flags.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Optional

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config.low_watch.json"


# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class WatchConfig:
    backend_url: str = "http://localhost:8100"
    patient_id: str = "demo-001"
    threshold_mgdl: float = 70.0        # critical low threshold (mg/dL)
    horizon_min: int = 60               # check predicted points up to t+60
    confirm_polls: int = 2              # consecutive below-threshold polls before firing
    poll_interval_s: float = 5.0        # real seconds between forecast checks
    response_window_min: float = 30.0   # time given to the user to respond
    response_window_mode: str = "sim"   # "sim" = reading clock (t), "wall" = real time
    hysteresis_mgdl: float = 5.0        # re-arm once predicted min is above threshold + this
    protocol: list = field(default_factory=list)  # escalation steps, see config file


def load_config(path: Optional[Path] = None) -> WatchConfig:
    cfg = WatchConfig()
    if path and Path(path).exists():
        data = json.loads(Path(path).read_text())
        valid = {f.name for f in fields(WatchConfig)}
        for k, v in data.items():
            if k in valid:
                setattr(cfg, k, v)
    return cfg


# --------------------------------------------------------------------------- #
# Pure detection / message logic (unit-tested)                                #
# --------------------------------------------------------------------------- #
def detect_predicted_low(forecast: dict, threshold_mgdl: float, horizon_min: int = 60,
                         current_mgdl: Optional[float] = None) -> Optional[dict]:
    """Return trigger details if the forecast is trending down below the
    critical threshold, else None.

    Trigger = some predicted point within the horizon is below threshold
    AND the trajectory is still heading down into it (min < first point, or
    the 5-min point is already below threshold, or min < current reading).
    An actual reading already below threshold also triggers immediately.
    """
    medium = [m for m in (forecast.get("medium") or []) if m.get("minutes", 0) <= horizon_min]
    if not medium:
        return None
    short_point = (forecast.get("short") or {}).get("point")
    first = medium[0]["point"]
    minp = min(medium, key=lambda m: m["point"])
    min_point, min_minutes = minp["point"], minp["minutes"]
    below = min_point < threshold_mgdl
    actual_low = current_mgdl is not None and current_mgdl < threshold_mgdl
    falling = (min_point < first) \
        or (short_point is not None and short_point < threshold_mgdl) \
        or (current_mgdl is not None and min_point < current_mgdl)
    if (below and falling) or actual_low:
        return {
            "min_point": min_point, "min_minutes": min_minutes, "first_point": first,
            "short_point": short_point, "current_mgdl": current_mgdl,
            "threshold_mgdl": threshold_mgdl,
            "action": (forecast.get("action") or {}).get("class"),
        }
    return None


def build_trigger_message(det: dict, response_window_min: float) -> str:
    """The [SYSTEM EVENT] message that makes the LLM initiate the conversation."""
    cur = f", current {det['current_mgdl']:.0f} mg/dL" if det.get("current_mgdl") is not None else ""
    return (
        "[SYSTEM EVENT — predicted hypoglycemia] The ML forecast is trending down below the "
        f"critical threshold of {det['threshold_mgdl']:.0f} mg/dL: predicted minimum "
        f"{det['min_point']:.0f} mg/dL at t+{det['min_minutes']} min "
        f"(5-min forecast {det['short_point']:.0f} mg/dL{cur}). Recommended pump action: "
        f"{det.get('action') or 'unknown'}. Inform the patient what is about to happen, tell "
        f"them the pump recommendation, and ask them to reply to acknowledge within "
        f"{response_window_min:.0f} minutes — if they don't, start the no-response protocol."
    )


def build_protocol_message(det: dict, response_window_min: float) -> str:
    """The [SYSTEM EVENT] message that makes the LLM start the no-response protocol."""
    return (
        "[SYSTEM EVENT — no response within the response window] The patient did not reply "
        f"within {response_window_min:.0f} minutes of the predicted-low warning (predicted "
        f"minimum {det['min_point']:.0f} mg/dL at t+{det['min_minutes']} min, critical "
        f"threshold {det['threshold_mgdl']:.0f} mg/dL). Initiate the no-response escalation "
        "protocol now: warn the patient again, raise a critical alert on their dashboard, "
        "and follow the configured protocol steps."
    )


def user_responded(chat_history: list, baseline_user_count: int) -> bool:
    """True if a new user message appeared in chat history after the trigger."""
    if not chat_history:
        return False
    return sum(1 for m in chat_history if m.get("role") == "user") > baseline_user_count


def count_user_messages(chat_history: list) -> int:
    return sum(1 for m in (chat_history or []) if m.get("role") == "user")


# --------------------------------------------------------------------------- #
# Backend client (stdlib urllib)                                              #
# --------------------------------------------------------------------------- #
class BackendClient:
    def __init__(self, base_url: str, timeout: float = 5.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def _get(self, path: str) -> dict:
        with urllib.request.urlopen(self.base + path, timeout=self.timeout) as r:
            return json.loads(r.read().decode())

    def _post(self, path: str, payload: dict) -> dict:
        req = urllib.request.Request(self.base + path, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode())

    def get_forecast(self, patient_id: str) -> dict:
        return self._get(f"/forecast/{urllib.request.quote(patient_id)}")

    def get_state(self, patient_id: str) -> dict:
        return self._get(f"/state/{urllib.request.quote(patient_id)}")

    def post_chat(self, patient_id: str, message: str) -> dict:
        return self._post(f"/chat/{urllib.request.quote(patient_id)}", {"message": message})


# --------------------------------------------------------------------------- #
# Watcher state machine                                                       #
# --------------------------------------------------------------------------- #
class Watcher:
    r"""IDLE --(predicted low confirmed)--> WAITING --(user reply)--> IDLE (acknowledged)
                                                    \--(window elapsed)--> PROTOCOL --> IDLE (suppressed for one window)"""

    def __init__(self, cfg: WatchConfig, client: BackendClient,
                 events_log: Optional[Path] = None,
                 sleep=time.sleep, monotonic=time.monotonic):
        self.cfg = cfg
        self.client = client
        self.events_log = events_log
        self._sleep = sleep
        self._now = monotonic
        self.state = "idle"
        self.consecutive = 0
        self.trigger: Optional[dict] = None
        self.trigger_sim_t: Optional[float] = None
        self.trigger_wall: Optional[float] = None
        self.baseline_user_count = 0
        self.suppress_until_sim: Optional[float] = None

    # ---- events ----
    def log_event(self, kind: str, **data):
        ev = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind, **data}
        print(f"[{ev['ts']}] {kind}: " + json.dumps({k: v for k, v in data.items()}, default=str))
        if self.events_log:
            with open(self.events_log, "a") as f:
                f.write(json.dumps(ev, default=str) + "\n")

    # ---- helpers ----
    def _latest(self, state: dict):
        latest = state.get("latest") or {}
        cgm = latest.get("cgm") or {}
        g = cgm.get("glucose_mgdl")
        return (g if isinstance(g, (int, float)) else None), latest.get("t")

    def _elapsed_window_min(self, sim_t: Optional[float]) -> float:
        """Minutes elapsed since the trigger, in the configured clock."""
        if self.cfg.response_window_mode == "sim" and sim_t is not None and self.trigger_sim_t is not None:
            return sim_t - self.trigger_sim_t
        if self.trigger_wall is not None:
            return (self._now() - self.trigger_wall) / 60.0
        return 0.0

    # ---- one poll cycle ----
    def check_once(self):
        cfg = self.cfg
        pid = cfg.patient_id
        forecast = self.client.get_forecast(pid)
        state = self.client.get_state(pid)
        current, sim_t = self._latest(state)
        chat = state.get("chat_history") or []

        if self.state == "idle":
            det = detect_predicted_low(forecast, cfg.threshold_mgdl, cfg.horizon_min, current)
            suppressed = (self.suppress_until_sim is not None and sim_t is not None
                          and sim_t < self.suppress_until_sim)
            if det is None:
                self.consecutive = 0
            elif suppressed:
                self.log_event("suppressed", sim_t=sim_t, min_point=det["min_point"])
            else:
                self.consecutive += 1
                self.log_event("below_threshold", poll=self.consecutive, **det)
                if self.consecutive >= cfg.confirm_polls:
                    self._fire(det, sim_t, chat)
        else:  # waiting for the patient to respond
            if user_responded(chat, self.baseline_user_count):
                self.log_event("user_responded",
                               window_elapsed_min=round(self._elapsed_window_min(sim_t), 1))
                self._reset()
            elif self._elapsed_window_min(sim_t) >= cfg.response_window_min:
                self._run_protocol(sim_t)
            else:
                self.log_event("waiting", window_elapsed_min=round(self._elapsed_window_min(sim_t), 1),
                               window_min=cfg.response_window_min)

    # ---- transitions ----
    def _fire(self, det: dict, sim_t: Optional[float], chat: list):
        cfg = self.cfg
        msg = build_trigger_message(det, cfg.response_window_min)
        resp = self.client.post_chat(cfg.patient_id, msg)
        # Re-read state so the baseline includes our own trigger message + reply
        after = self.client.get_state(cfg.patient_id)
        self.baseline_user_count = count_user_messages(after.get("chat_history") or [])
        self.trigger = det
        self.trigger_sim_t = sim_t
        self.trigger_wall = self._now()
        self.state = "waiting"
        self.consecutive = 0
        self.log_event("triggered", sim_t=sim_t, **det,
                       agent_reply=resp.get("reply"), tool_calls=resp.get("toolCalls"))

    def _run_protocol(self, sim_t: Optional[float]):
        cfg = self.cfg
        det = self.trigger or {}
        msg = build_protocol_message(det, cfg.response_window_min)
        resp = self.client.post_chat(cfg.patient_id, msg)
        self.log_event("protocol_started", sim_t=sim_t,
                       agent_reply=resp.get("reply"), tool_calls=resp.get("toolCalls"))
        for step in cfg.protocol:
            name = step.get("step", "?")
            if step.get("enabled", True) is False:
                self.log_event("protocol_step_deferred", step=name,
                               reason="disabled in config — define later",
                               description=step.get("description"))
            elif name in ("agent_escalation", "critical_alert"):
                self.log_event("protocol_step_executed", step=name,
                               description=step.get("description"),
                               note="performed by the LLM agent via the [SYSTEM EVENT] chat turn "
                                    "(send_alert tool)")
            else:
                self.log_event("protocol_step_deferred", step=name,
                               reason="no implementation yet — define later in config.low_watch.json",
                               description=step.get("description"))
        # Suppress re-triggering for one more response window while the low persists
        if sim_t is not None:
            self.suppress_until_sim = sim_t + cfg.response_window_min
        self.log_event("protocol_done", suppress_until_sim=self.suppress_until_sim)
        self._reset()

    def _reset(self):
        self.state = "idle"
        self.trigger = None
        self.trigger_sim_t = None
        self.trigger_wall = None
        self.baseline_user_count = 0

    # ---- main loop ----
    def run(self, max_iterations: Optional[int] = None):
        self.log_event("watch_start", patient=self.cfg.patient_id,
                       threshold_mgdl=self.cfg.threshold_mgdl,
                       response_window_min=self.cfg.response_window_min,
                       response_window_mode=self.cfg.response_window_mode)
        i = 0
        while max_iterations is None or i < max_iterations:
            try:
                self.check_once()
            except urllib.error.HTTPError as e:
                self.log_event("http_error", status=e.code, detail=str(e)[:200])
            except Exception as e:
                self.log_event("error", error=str(e)[:200])
            i += 1
            if max_iterations is None or i < max_iterations:
                self._sleep(self.cfg.poll_interval_s)
        self.log_event("watch_stop")


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=str(DEFAULT_CONFIG_PATH),
                    help="path to JSON config (default: config.low_watch.json next to this script)")
    ap.add_argument("--backend", default=None, help="backend base URL, e.g. http://localhost:8100")
    ap.add_argument("--patient", default=None, help="patient id")
    ap.add_argument("--threshold-mgdl", type=float, default=None, help="critical low threshold (mg/dL)")
    ap.add_argument("--horizon-min", type=int, default=None, help="forecast horizon to check (min)")
    ap.add_argument("--confirm-polls", type=int, default=None)
    ap.add_argument("--poll-interval-s", type=float, default=None)
    ap.add_argument("--response-window-min", type=float, default=None,
                    help="minutes the user has to respond before the protocol starts")
    ap.add_argument("--response-window-mode", choices=["sim", "wall"], default=None,
                    help="'sim' = minutes on the reading clock (t), 'wall' = real minutes")
    ap.add_argument("--events-log", default=None, help="JSONL file for workflow events")
    ap.add_argument("--once", action="store_true", help="run a single check and exit")
    ap.add_argument("--max-iterations", type=int, default=None)
    a = ap.parse_args()

    cfg = load_config(Path(a.config) if a.config else None)
    for key, val in (("backend_url", a.backend), ("patient_id", a.patient),
                     ("threshold_mgdl", a.threshold_mgdl), ("horizon_min", a.horizon_min),
                     ("confirm_polls", a.confirm_polls), ("poll_interval_s", a.poll_interval_s),
                     ("response_window_min", a.response_window_min),
                     ("response_window_mode", a.response_window_mode)):
        if val is not None:
            setattr(cfg, key, val)

    events_log = Path(a.events_log) if a.events_log else \
        Path(__file__).resolve().parent / "low_watch_events.jsonl"

    watcher = Watcher(cfg, BackendClient(cfg.backend_url), events_log=events_log)
    watcher.run(max_iterations=1 if a.once else a.max_iterations)


if __name__ == "__main__":
    sys.exit(main())
