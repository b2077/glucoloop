# Demo script (6 minutes, fault-tolerant)

All commands from repo root. Start ML, backend, stream (`accel 60`), app.

## Beat 1 — Normal day, three horizons (1.5 min)
Open the Dashboard. Show the glucose bar chart, the 1-hour forecast, and the
24-hour envelope on the Insights tab. Say: "It sees the next 5 minutes, the
next hour, and your whole day — with honest uncertainty bands."

## Beat 2 — Chat check-in feeds the models (1.5 min)
Ella tab. Type:
1. "I just ran 5k, about 30 minutes" → exercise logged. Watch the 1-hour
   forecast and the recommended action shift (Insights tab refresh).
2. "Slept about 6 hours, pretty stressed today - maybe a 4" → sleep + stress
   logged; overnight risk envelope tightens/widens accordingly.
Say: "Every answer she logs becomes a feature in the same feature vector the
models use. No sensor can see stress coming — she can."

## Beat 3 — The ML was right (1 min)
With the stream running, the Dashboard shows the action card changing when
glucose starts dropping after exercise (Approve card appears if class is
reduce_basal/suspend). Approve it. Say: "The 5-minute horizon confirmed the
1-hour forecast. The policy acted before the dip, not after."

## Beat 4 — Fault intelligence (1.5 min)
The streamer injects scripted faults (accel 60 → drift hits ~10 min in:
- CGM **drift** (t=600 sim-min): readings separate from reality. The policy
  switches to `alarm_only`: refuse to dose on bad data.
- Pump **occlusion** (t=1500): insulin delivered collapses while commanded stays
  flat. Ella cross-validates: ask the chat "i feel shaky, how am i doing?" → she
  tells you the sensor/pump readings look unreliable.
Say: "Two failure modes, two different intelligent responses — and she asks the
patient how they feel, because in a fault the human IS a sensor."

## Backup
Record the full run once before the pitch (screen record). If Wi-Fi dies, play
the video. Mock chat mode works with no API key — no network dependency.

## Pitch one-liner
"GlucoLoop fuses CGM, pump and watch data with what you tell it, predicts
glucose on three horizons, and lets an agent recommend — never command — what
the pump should do next, even when the devices lie."
