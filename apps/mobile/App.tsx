/**
 * GlucoLoop patient app (Expo / React Native, zero chart libs).
 * Tabs: Dashboard | Ella (chat) | Insights (24 h envelope).
 * Data: polls the backend (default http://localhost:8100, set API_URL below or
 * use `EXPO_PUBLIC_API_URL` when starting expo).
 * Uses the FE-issue-#5 endpoints: /tir, /readings, /recommendations, profile.
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView, View, Text, TextInput, Pressable, FlatList,
  StyleSheet, ScrollView, ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";

const API = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8100";
const PATIENT = "demo-001";

// ---------------------------------------------------------------- api hooks
function usePoll(path, ms = 5000) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${API}${path}`);
        const j = await r.json();
        if (alive) { setData(j); setErr(null); }
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => { alive = false; clearInterval(id); };
  }, [path, ms]);
  return [data, err];
}

// ---------------------------------------------------------------- primitives
const Card = ({ title, children, color = "#fff", style }) => (
  <View style={[s.card, { backgroundColor: color }, style]}>
    {title ? <Text style={s.cardTitle}>{title}</Text> : null}
    {children}
  </View>
);

const ACTION_COLORS = {
  no_op: "#2E7D32", alarm_only: "#F9A825", reduce_basal: "#EF6C00",
  suspend: "#C62828", correction_bolus: "#6A1B9A",
};

// ------------------------------------------------------------- mini bar chart
function SparkGlucose({ history }) {
  const pts = (history || []).map((r) => r.cgm?.glucose_mgdl).filter((x) => x != null);
  if (!pts.length) return <Text style={s.dim}>waiting for CGM…</Text>;
  const max = Math.max(...pts, 180), min = Math.min(...pts, 60);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 90, gap: 1 }}>
      {pts.slice(-24).map((g, i) => {
        const h = 90 * (g - min) / (max - min || 1);
        const color = g < 70 ? "#C62828" : g > 180 ? "#EF6C00" : "#1565C0";
        return <View key={i} style={{ flex: 1, height: Math.max(3, h), backgroundColor: color, borderRadius: 2 }} />;
      })}
    </View>
  );
}

function ActionCard({ forecast }) {
  const a = forecast?.action;
  if (!a) return <Card title="Pump action"><Text style={s.dim}>no forecast yet</Text></Card>;
  const color = ACTION_COLORS[a.class] || "#2E7D32";
  return (
    <Card title="Recommended pump action" color="#FFF8E1">
      <Text style={{ fontSize: 22, fontWeight: "700", color }}>{a.class.replace(/_/g, " ")}</Text>
      <Text style={s.dim}>model confidence {(a.probs?.[a.class] ?? 0).toFixed(2)}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Pressable style={[s.btn, { backgroundColor: color }]}
          onPress={() => alert("Action approved (demo mode): " + a.class)}>
          <Text style={s.btnText}>Approve</Text>
        </Pressable>
        <Pressable style={[s.btn, { backgroundColor: "#9E9E9E" }]} onPress={() => {}}>
          <Text style={s.btnText}>Dismiss</Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ screens
const TIR_RANGES = [
  { id: "1h", label: "1 h", minutes: 60 },
  { id: "24h", label: "24 h", minutes: 1440 },
];

function TirCard() {
  const [range, setRange] = useState("24h");
  const [tir, tirErr] = usePoll(`/tir/${PATIENT}?range=${range}`, 15000);
  const pct = tir?.tir_pct;
  return (
    <Card title="Time in range (4–10 mmol/L)">
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
        {TIR_RANGES.map((r) => (
          <Pressable key={r.id} onPress={() => setRange(r.id)}
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
                     backgroundColor: range === r.id ? "#1565C0" : "#E8ECF4" }}>
            <Text style={{ fontWeight: "700", color: range === r.id ? "#fff" : "#666" }}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      {tirErr || pct == null ? (
        <Text style={s.dim}>Not enough readings yet — time in range appears as the stream fills.</Text>
      ) : (
        <>
          <Text style={{ fontSize: 34, fontWeight: "800" }}>{Math.round(pct)}%</Text>
          <View style={{ height: 12, borderRadius: 6, backgroundColor: "#EAEEF3", overflow: "hidden", marginTop: 8, flexDirection: "row" }}>
            <View style={{ width: `${Math.min(100, tir.in_range / Math.max(1, tir.total) * 100)}%`, backgroundColor: "#2E7D32" }} />
            <View style={{ width: `${Math.min(100, tir.low / Math.max(1, tir.total) * 100)}%`, backgroundColor: "#C62828" }} />
            <View style={{ flex: 1, backgroundColor: "#EF6C00" }} />
          </View>
          <Text style={s.dim}>
            {tir.in_range}/{tir.total} in range · {Math.round(tir.low_pct ?? 0)}% low · {Math.round(tir.high_pct ?? 0)}% high
          </Text>
        </>
      )}
    </Card>
  );
}

function RecommendationsCard() {
  const [recs] = usePoll(`/recommendations/${PATIENT}`, 15000);
  const list = (recs?.recommendations ?? []).slice(-4).reverse();
  const levelColor = { critical: "#C62828", warning: "#EF6C00", info: "#1565C0" };
  return (
    <Card title="Proactive recommendations">
      {list.length === 0
        ? <Text style={s.dim}>Nothing triggered — the engine re-checks every minute against forecast + profile.</Text>
        : list.map((r) => (
            <View key={r.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8,
                                      backgroundColor: r.level === "critical" ? "#FDECEA" : r.level === "warning" ? "#FFF3E0" : "#E8F5E9" }}>
              <Text>
                <Text style={{ color: levelColor[r.level] || "#1565C0", fontWeight: "800" }}>
                  [{(r.type || r.level).replace(/_/g, " ").toUpperCase()}]{" "}
                </Text>
                {r.message}
              </Text>
              {r.suggested_action
                ? <Text style={s.dim}>suggested action: {r.suggested_action.replace(/_/g, " ")} · approve on the pump-action card or in chat</Text>
                : null}
            </View>
          ))}
    </Card>
  );
}

function Dashboard() {
  const [state] = usePoll(`/state/${PATIENT}`);
  const [forecast] = usePoll(`/forecast/${PATIENT}`, 10000);
  const latest = state?.latest;
  const g = latest?.cgm?.glucose_mgdl;
  const status = latest?.pump?.pump_status;
  const quality = latest?.cgm?.cgm_quality;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card title="Glucose" style={{ flex: 1 }}>
          <Text style={{ fontSize: 40, fontWeight: "800" }}>
            {g == null ? "--" : g}
          </Text>
          <Text style={s.dim}>mg/dL · CGM {quality ?? "?"} · pump {status ?? "?"}</Text>
        </Card>
        <Card title="Next 60 min" style={{ flex: 1.4 }}>
          {forecast ? (
            <View style={{ flexDirection: "row", alignItems: "flex-end", height: 60, gap: 4 }}>
              {forecast.medium.map((p, i) => (
                <View key={i} style={{ flex: 1 }}>
                  <View style={{ height: Math.max(4, (p.point - 40) / 2), backgroundColor: "#1565C0", borderRadius: 2 }} />
                  <Text style={{ fontSize: 8, textAlign: "center", color: "#666" }}>{p.minutes}m</Text>
                </View>
              ))}
            </View>
          ) : <Text style={s.dim}>loading forecast…</Text>}
        </Card>
      </View>
      <Card title="Last 2 h">
        <SparkGlucose history={state?.history} />
      </Card>
      <TirCard />
      <RecommendationsCard />
      <ActionCard forecast={forecast} />
      <Card title="Alerts">
        {(state?.alerts ?? []).length === 0
          ? <Text style={s.dim}>no alerts</Text>
          : (state.alerts.slice().reverse().map((a, i) => (
              <Text key={i} style={{ marginBottom: 6 }}>
                <Text style={{ color: a.level === "critical" ? "#C62828" : a.level === "warning" ? "#EF6C00" : "#1565C0", fontWeight: "700" }}>
                  [{a.level.toUpperCase()}]{" "}
                </Text>
                {a.message}
              </Text>
            )))}
      </Card>
      <Card title="Latest check-in">
        {state?.checkin
          ? <Text style={s.dim}>{JSON.stringify(state.checkin)}</Text>
          : <Text style={s.dim}>Ella hasn't collected a check-in yet — open the chat tab.</Text>}
      </Card>
    </ScrollView>
  );
}

function Chat() {
  const [msgs, setMsgs] = useState([{ role: "assistant", content: "Hi! I'm Ella. How are you feeling today?" }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = useCallback(async () => {
    const m = text.trim();
    if (!m || busy) return;
    setText("");
    setMsgs((x) => [...x, { role: "user", content: m }]);
    setBusy(true);
    try {
      const r = await fetch(`${API}/chat/${PATIENT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: m }),
      });
      const j = await r.json();
      setMsgs((x) => [...x, { role: "assistant", content: j.reply || j.error || "?" }]);
    } catch (e) {
      setMsgs((x) => [...x, { role: "assistant", content: "Connection problem — is the backend running?" }]);
    }
    setBusy(false);
  }, [text, busy]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        style={{ padding: 12 }}
        data={msgs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === "user" ? s.bubbleUser : s.bubbleElla]}>
            <Text style={item.role === "user" ? { color: "#fff" } : {}}>{item.content}</Text>
          </View>
        )}
      />
      <View style={{ flexDirection: "row", padding: 10, gap: 8 }}>
        <TextInput
          style={s.input} value={text} onChangeText={setText}
          placeholder="Tell Ella about meals, sleep, exercise, stress…"
          onSubmitEditing={send}
        />
        <Pressable style={[s.btn, { backgroundColor: "#1565C0" }]} onPress={send} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Insights() {
  const [forecast] = usePoll(`/forecast/${PATIENT}`, 15000);
  const [readings] = usePoll(`/readings/${PATIENT}`, 30000);
  const [state] = usePoll(`/state/${PATIENT}`, 30000);
  const blocks = forecast?.long ?? [];
  const profile = state?.profile;

  // Downsample the 24 h readings (up to 288) for the chart.
  const all = (readings?.readings ?? []).map((r) => r.cgm?.glucose_mgdl).filter((x) => x != null);
  const pts = [];
  if (all.length > 1) {
    const step = Math.max(1, Math.floor(all.length / 96));
    for (let i = 0; i < all.length; i += step) pts.push(all[i]);
    if ((all.length - 1) % step !== 0) pts.push(all[all.length - 1]);
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <Card title="Glucose — last 24 hours">
        {pts.length < 2 ? (
          <Text style={s.dim}>waiting for readings…</Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "flex-end", height: 120, gap: 1 }}>
              {pts.map((g, i) => {
                const max = Math.max(...pts, 180), min = Math.min(...pts, 60);
                const h = 120 * (g - min) / (max - min || 1);
                const color = g < 72 ? "#C62828" : g > 180 ? "#EF6C00" : "#2E7D32";
                return <View key={i} style={{ flex: 1, height: Math.max(3, h), backgroundColor: color, borderRadius: 1 }} />;
              })}
            </View>
            <Text style={s.dim}>
              {readings.count} readings · 5-min cadence · red under 72, orange over 180 mg/dL
            </Text>
          </>
        )}
      </Card>
      {profile ? (
        <Card title="Your profile">
          <Text style={s.dim}>
            IC ratio {profile.ic_ratio_g_per_u} g/U · ISF {profile.isf_mgdl_per_u} mg/dL/U ·
            basal {profile.basal_u_hr} U/h · target {profile.target_mgdl} mg/dL
          </Text>
        </Card>
      ) : null}
      <Card title="24-hour risk envelope">
        <Text style={s.dim}>
          Each block shows the predicted 10th percentile of the minimum and 90th
          percentile of the maximum glucose in that 4-hour window.
        </Text>
        {blocks.map((b, i) => (
          <View key={i} style={{ marginTop: 10, padding: 10, borderRadius: 8,
                                backgroundColor: b.risk === "high" ? "#FDECEA" : "#E8F5E9" }}>
            <Text style={{ fontWeight: "700" }}>
              {b.window_start_h}h–{b.window_end_h}h · {b.risk === "high" ? "⚠️ high risk" : "ok"}
            </Text>
            <Text style={s.dim}>low q10: {b.min_q10} mg/dL · high q90: {b.max_q90} mg/dL</Text>
          </View>
        ))}
        {!blocks.length && <Text style={s.dim}>waiting for forecast…</Text>}
      </Card>
      <Card title="About your forecast">
        <Text style={s.dim}>
          Forecasts combine your CGM, pump telemetry, and what you tell Ella in chat:
          meals, sleep, exercise and stress all feed the same models that recommend
          pump actions. This is guidance, not medical advice.
        </Text>
      </Card>
    </ScrollView>
  );
}

// --------------------------------------------------------------------- app
const TABS = [
  { name: "Dashboard", Comp: Dashboard },
  { name: "Ella", Comp: Chat },
  { name: "Insights", Comp: Insights },
];

export default function App() {
  const [tab, setTab] = useState(0);
  const Comp = TABS[tab].Comp;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F6FA" }}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#0D2B45" }}>GlucoLoop</Text>
        <Text style={s.dim}>diabetes, three horizons, one assistant</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Comp />
      </View>
      <View style={s.tabbar}>
        {TABS.map((t, i) => (
          <Pressable key={t.name} onPress={() => setTab(i)} style={[s.tab, i === tab && s.tabActive]}>
            <Text style={{ color: i === tab ? "#1565C0" : "#666", fontWeight: "600" }}>{t.name}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { padding: 14, paddingBottom: 6 },
  scroll: { flex: 1 },
  card: { borderRadius: 14, padding: 14, elevation: 1, shadowRadius: 2 },
  cardTitle: { fontWeight: "700", marginBottom: 8, color: "#0D2B45" },
  dim: { color: "#777" },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  bubble: { maxWidth: "85%", padding: 10, borderRadius: 14, marginBottom: 8,
            alignSelf: "flex-start", backgroundColor: "#fff", elevation: 1 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#1565C0" },
  bubbleElla: {},
  input: { flex: 1, backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12,
           borderWidth: 1, borderColor: "#ddd" },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderColor: "#E4E6EF", backgroundColor: "#fff" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#1565C0" },
});
