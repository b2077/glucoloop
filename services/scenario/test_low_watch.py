"""Unit tests for the predicted-low watcher (stdlib + pytest, like the simulator)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from low_watch import (  # noqa: E402
    BackendClient,
    WatchConfig,
    Watcher,
    build_protocol_message,
    build_trigger_message,
    count_user_messages,
    detect_predicted_low,
    load_config,
    user_responded,
)


def fc(points, action="suspend"):
    """Forecast shaped like services/ml /predict: medium[0] is the 5-min point."""
    medium = [{"minutes": m, "point": p} for m, p in zip((5, 15, 30, 45, 60), points)]
    return {"short": {"minutes": 5, "point": points[0]}, "medium": medium,
            "long": [], "action": {"class": action, "probs": {action: 0.9}},
            "model_version": "test"}


# ---- detect_predicted_low ---------------------------------------------------

def test_detect_triggers_when_falling_below_threshold():
    det = detect_predicted_low(fc([95, 85, 72, 66, 68]), threshold_mgdl=70, current_mgdl=96)
    assert det is not None
    assert det["min_point"] == 66 and det["min_minutes"] == 45
    assert det["threshold_mgdl"] == 70


def test_detect_triggers_on_mid_horizon_dip_even_if_it_recovers():
    det = detect_predicted_low(fc([100, 90, 68, 85, 110]), 70, current_mgdl=105)
    assert det is not None and det["min_minutes"] == 30


def test_detect_ignores_when_staying_above_threshold():
    assert detect_predicted_low(fc([120, 115, 110, 105, 100]), 70, current_mgdl=121) is None
    assert detect_predicted_low(fc([72, 74, 76, 78, 80]), 70, current_mgdl=71) is None


def test_detect_triggers_when_short_point_already_below_threshold():
    det = detect_predicted_low(fc([68, 70, 72, 74, 76]), 70, current_mgdl=75)
    assert det is not None and det["min_point"] == 68


def test_detect_triggers_on_actual_low_even_if_forecast_flat():
    det = detect_predicted_low(fc([80, 81, 82, 83, 84]), 70, current_mgdl=65)
    assert det is not None


def test_detect_respects_horizon():
    # low only at t+60 but horizon=30 -> ignored
    assert detect_predicted_low(fc([100, 95, 90, 85, 65]), 70, horizon_min=30) is None
    det = detect_predicted_low(fc([100, 95, 90, 85, 65]), 70, horizon_min=60)
    assert det is not None and det["min_minutes"] == 60


def test_detect_empty_forecast():
    assert detect_predicted_low({}, 70) is None


# ---- messages ---------------------------------------------------------------

def test_trigger_message_mentions_threshold_min_and_window():
    det = detect_predicted_low(fc([95, 85, 72, 66, 68]), 70, current_mgdl=96)
    msg = build_trigger_message(det, 30)
    assert msg.startswith("[SYSTEM EVENT")
    assert "70" in msg and "t+45" in msg and "30 minutes" in msg and "acknowledge" in msg


def test_protocol_message_mentions_no_response():
    det = detect_predicted_low(fc([95, 85, 72, 66, 68]), 70, current_mgdl=96)
    msg = build_protocol_message(det, 30)
    assert "no response" in msg and "protocol" in msg


# ---- chat history -----------------------------------------------------------

def test_user_responded_and_baseline():
    hist = [{"role": "user", "content": "[SYSTEM EVENT ...]"}, {"role": "assistant", "content": "warn"}]
    assert count_user_messages(hist) == 1
    assert user_responded(hist, 1) is False
    hist.append({"role": "assistant", "content": "..."})
    assert user_responded(hist, 1) is False
    hist.append({"role": "user", "content": "yes I see it"})
    assert user_responded(hist, 1) is True
    assert user_responded([], 0) is False


# ---- config -----------------------------------------------------------------

def test_load_config_merges_json(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"threshold_mgdl": 80, "response_window_min": 10,
                             "unknown_key": 1}))
    cfg = load_config(p)
    assert cfg.threshold_mgdl == 80 and cfg.response_window_min == 10
    assert not hasattr(cfg, "unknown_key")
    assert cfg.patient_id == "demo-001"  # default kept


def test_default_config_file_is_valid():
    cfg = load_config(Path(__file__).resolve().parent / "config.low_watch.json")
    assert cfg.threshold_mgdl == 70 and cfg.response_window_min == 30
    assert any(s["step"] == "agent_escalation" for s in cfg.protocol)


# ---- watcher state machine (fake backend) -----------------------------------

class FakeClient:
    """Scripted backend: one (forecast, state) entry consumed per check_once;
    get_state/post_chat within the same cycle see the same mutable state."""

    def __init__(self, script):
        self.script = list(script)
        self.chats = []
        self.state_now = None

    def get_forecast(self, pid):
        f, s = self.script.pop(0)
        self.state_now = s
        return f

    def get_state(self, pid):
        return self.state_now

    def post_chat(self, pid, message):
        self.chats.append(message)
        self.state_now.setdefault("chat_history", []).append({"role": "user", "content": message})
        self.state_now["chat_history"].append({"role": "assistant", "content": "agent reply"})
        return {"reply": "agent reply", "toolCalls": ["predict", "send_alert"]}


def state_with(t, glucose, chat=None):
    return {"latest": {"t": t, "cgm": {"glucose_mgdl": glucose}},
            "chat_history": chat if chat is not None else []}


def make_watcher(script, **cfg_kw):
    cfg = WatchConfig(confirm_polls=2, response_window_min=30, poll_interval_s=0,
                      response_window_mode="sim", **cfg_kw)
    client = FakeClient(script)
    w = Watcher(cfg, client, events_log=None, sleep=lambda s: None, monotonic=lambda: 1000.0)
    return w, client


def test_full_trigger_then_user_ack():
    low = fc([95, 85, 72, 66, 68])
    ok = fc([120, 115, 110, 105, 100])
    acked_chat = [{"role": "user", "content": "[SYSTEM EVENT ...]"},
                  {"role": "assistant", "content": "warn"},
                  {"role": "user", "content": "ok, I ate sugar"}]
    script = [
        (low, state_with(120, 96)),   # poll 1: below threshold, consecutive=1
        (low, state_with(125, 90)),   # poll 2: consecutive=2 -> fire (chat posted, baseline=1)
        (low, state_with(130, 88, chat=acked_chat)),  # user replied -> acknowledged
        (ok, state_with(200, 110)),
    ]
    w, client = make_watcher(script)
    for _ in range(4):
        w.check_once()
    assert len(client.chats) == 1 and client.chats[0].startswith("[SYSTEM EVENT")
    assert w.state == "idle" and w.trigger is None  # acknowledged -> reset


def test_timeout_runs_protocol():
    low = fc([95, 85, 72, 66, 68])
    script = [
        (low, state_with(120, 96)),   # poll 1
        (low, state_with(125, 90)),   # poll 2 -> fire at sim t=125
        (low, state_with(140, 85)),   # waiting, elapsed 15 < 30
        (low, state_with(160, 80)),   # elapsed 35 >= 30 -> protocol
        (low, state_with(160, 80)),   # after protocol: suppressed (160 < 125+... see below)
    ]
    w, client = make_watcher(script)
    for _ in range(5):
        w.check_once()
    assert len(client.chats) == 2
    assert "no response" in client.chats[1]
    assert w.state == "idle"
    assert w.suppress_until_sim == 160 + 30  # one more window of suppression


def test_no_trigger_when_forecast_stays_high():
    ok = fc([120, 115, 110, 105, 100])
    script = [(ok, state_with(100 + 5 * i, 120)) for i in range(4)]
    w, client = make_watcher(script)
    for _ in range(4):
        w.check_once()
    assert client.chats == [] and w.state == "idle" and w.consecutive == 0


def test_confirm_polls_required():
    low = fc([95, 85, 72, 66, 68])
    ok = fc([120, 115, 110, 105, 100])
    script = [(low, state_with(120, 96)), (ok, state_with(125, 110)),
              (low, state_with(130, 90)), (ok, state_with(135, 110))]
    w, client = make_watcher(script)
    for _ in range(4):
        w.check_once()
    assert client.chats == []  # never 2 consecutive -> never fired


def test_backend_client_paths():
    c = BackendClient("http://localhost:8100/")
    assert c.base == "http://localhost:8100"
