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

// ------------------------------------------------------------- units (mmol/L)
// Everything on screen is displayed in mmol/L; the backend speaks mg/dL.
const MGDL_PER_MMOL = 18.0;
const mmol = (mgdl) => (mgdl == null ? null : +(mgdl / MGDL_PER_MMOL).toFixed(1));
// Rewrite any "N mg/dL" occurrences in backend-authored text to mmol/L.
const mmolText = (str) => String(str ?? "").replace(
  /(\d+(?:\.\d+)?)\s*mg\/dL/g,
  (_, n) => `${+(Number(n) / MGDL_PER_MMOL).toFixed(1)} mmol/L`
);

// ------------------------------------------------------------- line graph
// Last-2h line: green on 4–10 mmol/L, red below, orange above.
// Each segment is colored by the average of its two endpoints. Shows the
// measurement points, the 4/10 mmol/L TIR edges, and shading inside TIR.
// --------------------------------------------------------- shared line chart
// Glucose values (mg/dL in, converted internally) -> line graph with points,
// 4/10 mmol/L TIR edges and shading.
function GlucoseLine({ values, height = 96 }) {
  const [w, setW] = useState(0);
  const pts = (values || []).filter((x) => x != null).map(mmol);
  if (pts.length < 2) return <Text style={s.dim}>waiting for CGM…</Text>;
  const max = Math.max(...pts, 10), min = Math.min(...pts, 4);
  const pad = 6;
  const y = (g) => height - pad - ((g - min) / ((max - min) || 1)) * (height - pad * 2);
  const x = (i) => (i * w) / (pts.length - 1);
  const colorFor = (g) => (g < 4 ? "#C62828" : g > 10 ? "#EF6C00" : "#2E7D32");
  const yLow = y(4), yHigh = y(10);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const x1 = x(i - 1), y1 = y(pts[i - 1]), x2 = x(i), y2 = y(pts[i]);
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({
      left: (x1 + x2) / 2 - len / 2,
      top: (y1 + y2) / 2 - 1.5,
      len, ang: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
      color: colorFor((pts[i - 1] + pts[i]) / 2),
    });
  }
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {/* TIR band (4–10 mmol/L) shading */}
      <View style={{
        position: "absolute", left: 0, right: 0,
        top: yHigh, height: Math.max(0, yLow - yHigh),
        backgroundColor: "rgba(46, 125, 50, 0.10)",
      }} />
      {/* 10 mmol/L upper edge + 4 mmol/L lower edge */}
      <View style={{ position: "absolute", left: 0, right: 0, top: yHigh - 0.5, height: 1, backgroundColor: "#EF6C00", opacity: 0.5 }} />
      <View style={{ position: "absolute", left: 0, right: 0, top: yLow - 0.5, height: 1, backgroundColor: "#C62828", opacity: 0.5 }} />
      <Text style={{ position: "absolute", right: 4, top: yHigh - 16, fontSize: 9, color: "#EF6C00", opacity: 0.8 }}>10</Text>
      <Text style={{ position: "absolute", right: 4, top: yLow + 2, fontSize: 9, color: "#C62828", opacity: 0.8 }}>4</Text>
      {/* line (semi-transparent) */}
      {segs.map((sg, i) => (
        <View key={i} style={{
          position: "absolute", left: sg.left, top: sg.top,
          width: Math.max(sg.len, 2), height: 3, borderRadius: 1.5,
          backgroundColor: sg.color, opacity: 0.55,
          transform: [{ rotate: `${sg.ang}deg` }],
        }} />
      ))}
      {/* measurement points */}
      {pts.map((g, i) => (
        <View key={`p${i}`} style={{
          position: "absolute", left: x(i) - 2.5, top: y(g) - 2.5,
          width: 5, height: 5, borderRadius: 2.5,
          backgroundColor: colorFor(g),
        }} />
      ))}
      {/* dot on the newest point */}
      <View style={{
        position: "absolute", left: x(pts.length - 1) - 4, top: y(pts[pts.length - 1]) - 4,
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colorFor(pts[pts.length - 1]),
      }} />
    </View>
  );
}

// ------------------------------------------------------------- mini bar chart
// Deterministic 24 h synthetic series (5-min cadence) used to render the
// dashboard/insights graphs. Backend untouched; live endpoints stay live.
function mockSeries(shape) {
  const n = 288, out = [];
  for (let i = 0; i < n; i++) {
    const ts = Date.now() - (n - 1 - i) * 5 * 60 * 1000;
    const h = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
    let target = 110;
    if (h < 6) target = 100;
    else if (h < 8) target = 125 + Math.sin((h - 6) / 2 * Math.PI) * 60;
    else if (h < 12) target = 115;
    else if (h < 14) target = 122 + Math.sin((h - 12) / 2 * Math.PI) * 45;
    else if (h < 18) target = 112;
    else if (h < 21) target = 118 + Math.sin((h - 18) / 3 * Math.PI) * 55;
    else target = 105;
    out.push(shape({ g: Math.round(target + Math.sin(i / 9) * 8), ts }));
  }
  return out;
}
const MOCK_HISTORY = mockSeries((p) => ({ cgm: { glucose_mgdl: p.g }, ts: p.ts }));

// ------------------------------------------------------------------ screens
const TIR_RANGES = [
  { id: "1h", label: "1 h", minutes: 60 },
  { id: "24h", label: "24 h", minutes: 1440 },
];

function TirCard({ state }) {
  const [range, setRange] = useState("24h");
  const tir = range === "1h" ? state?.tir_1h : state?.tir_24h;
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
      {pct == null ? (
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

// History wrapper: last 24 readings (2 h) -> GlucoseLine.
function LineGlucose({ history, height = 96 }) {
  const pts = (history || []).map((r) => r.cgm?.glucose_mgdl).filter((x) => x != null).slice(-24);
  return <GlucoseLine values={pts} height={height} />;
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
                {mmolText(r.message)}
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
  // Single /state poll feeds every card: latest, history (last 24 readings
  // = 2 h), cached forecast, and tir_1h/tir_24h.
  const [state] = usePoll(`/state/${PATIENT}`);
  const latest = state?.latest;
  const g = latest?.cgm?.glucose_mgdl;
  const status = latest?.pump?.pump_status;
  const quality = latest?.cgm?.cgm_quality;
  const forecast = state?.forecast;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card title="Glucose" style={{ flex: 1 }}>
          <Text style={{ fontSize: 40, fontWeight: "800" }}>
            {g == null ? "--" : mmol(g)}
          </Text>
          <Text style={s.dim}>mmol/L · CGM {quality ?? "?"} · pump {status ?? "?"}</Text>
        </Card>
        <Card title="Next 60 min" style={{ flex: 1.4 }}>
          {forecast?.medium?.length ? (
            <>
              <GlucoseLine values={[g, ...forecast.medium.map((p) => p.point)]} height={96} />
              <Text style={s.dim}>model {forecast?.model_version ?? "?"}</Text>
            </>
          ) : <Text style={s.dim}>loading forecast…</Text>}
        </Card>
      </View>
      <Card title="Last 2 h">
        <LineGlucose history={state?.history} />
      </Card>
      <TirCard state={state} />
      <RecommendationsCard />
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
      setMsgs((x) => [...x, { role: "assistant", content: mmolText(j.reply || j.error) || "?" }]);
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
  // Mock series for the 24 h graph (frontend only), displayed in mmol/L.
  const all = MOCK_HISTORY.map((r) => r.cgm.glucose_mgdl);
  const mockCount = all.length;
  const pts = [];
  if (all.length > 1) {
    const step = Math.max(1, Math.floor(all.length / 96));
    for (let i = 0; i < all.length; i += step) pts.push(mmol(all[i]));
    if ((all.length - 1) % step !== 0) pts.push(mmol(all[all.length - 1]));
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
                const max = Math.max(...pts, 10), min = Math.min(...pts, 4);
                const h = 120 * (g - min) / (max - min || 1);
                const color = g < 4 ? "#C62828" : g > 10 ? "#EF6C00" : "#2E7D32";
                return <View key={i} style={{ flex: 1, height: Math.max(3, h), backgroundColor: color, borderRadius: 1 }} />;
              })}
            </View>
            <Text style={s.dim}>
              {mockCount} readings (demo) · 5-min cadence · red under 4, orange over 10 mmol/L
            </Text>
          </>
        )}
      </Card>
      {profile ? (
        <Card title="Your profile">
          <Text style={s.dim}>
            IC ratio {profile.ic_ratio_g_per_u} g/U · ISF {mmol(profile.isf_mgdl_per_u)} mmol/L/U ·
            basal {profile.basal_u_hr} U/h · target {mmol(profile.target_mgdl)} mmol/L
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
            <Text style={s.dim}>low q10: {mmol(b.min_q10)} mmol/L · high q90: {mmol(b.max_q90)} mmol/L</Text>
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
