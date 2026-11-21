/** Agent tool set: predict | log_checkin | send_alert. Zero deps. */

export function makeToolSet(deps) {
  const { store, mlUrl, patientId } = deps;

  const defs = [
    {
      type: "function",
      function: {
        name: "predict",
        description:
          "Get the ML forecast for this patient right now: glucose at 5/15/30/45/60 min, " +
          "a 24-hour risk envelope, and the recommended pump action. Call this before " +
          "giving any glucose-related advice.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "log_checkin",
        description:
          "Store information the patient told you in conversation: carbs eaten, sleep, " +
          "exercise, stress. These feed directly into the prediction models.",
        parameters: {
          type: "object",
          properties: {
            carbs_g: { type: "number", description: "carbs in the last 3 h (g)" },
            sleep_hours: { type: "number", description: "last night's sleep (h)" },
            exercise_min: { type: "number", description: "exercise last 2 h (min)" },
            exercise_type: { type: "string" },
            intensity: { type: "string", enum: ["none", "light", "moderate", "intense"] },
            stress_1_5: { type: "number", description: "stress 1..5" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_alert",
        description:
          "Push an alert to the patient's app. Use for device faults or risky " +
          "forecasts requiring a decision.",
        parameters: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["info", "warning", "critical"] },
            message: { type: "string" },
            suggested_action: {
              type: "string",
              enum: ["no_op", "alarm_only", "reduce_basal", "suspend", "correction_bolus"],
            },
          },
          required: ["level", "message"],
        },
      },
    },
  ];

  async function execute(name, args) {
    switch (name) {
      case "predict": {
        const window = store.mlWindow(patientId);
        if (!window || window.length === 0) {
          return { error: "no_data",
                   hint: "no device readings ingested yet for this patient" };
        }
        const r = await fetch(`${mlUrl}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_id: patientId, readings: window }),
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          return { error: "no_data", hint: `ml service ${r.status} ${detail}` };
        }
        const f = await r.json();
        store.get(patientId).lastForecast = f;
        return f;
      }
      case "log_checkin": {
        const ci = store.addCheckin(patientId, { ...args });
        return { ok: true, checkin: ci,
                 note: "logged; behavioral features are in the next prediction" };
      }
      case "send_alert": {
        const alert = {
          id: `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          patient_id: patientId,
          level: (args && args.level) || "info",
          message: (args && args.message) || "",
          suggested_action: args && args.suggested_action,
          created_at: new Date().toISOString(),
        };
        store.addAlert(alert);
        return { ok: true, alert };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  }

  return { defs, execute, deps };
}
