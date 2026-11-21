/**
 * GlucoLoop patient app (Expo / React Native, zero chart libs).
 * Tabs: Dashboard | Ella (chat) | Insights (24 h envelope).
 * Data: polls the backend (default http://localhost:8100, set API_URL below or
 * use `EXPO_PUBLIC_API_URL` when starting expo).
 * Uses the FE-issue-#5 endpoints: /tir, /readings, /recommendations, profile.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView, View, Text, TextInput, Pressable, FlatList,
  StyleSheet, ScrollView, ActivityIndicator, Animated, Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";

const API = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8100";
const PATIENT = "demo-001";
const POLL_MS = 2000; // patient data + proactive recommendations (both via /state)

// Trio light-mode chrome: iOS system backgrounds, with insulin blue for
// controls. Glucose dots and the reading use Trio's static scheme from
// DynamicGlucoseColor.swift — HSB saturation 0.6, brightness 0.9:
// red at or below 70 mg/dL, green in range, orange at or above 180.
const C = {
  ink: "#1C1C1E",
  muted: "#8E8E93",
  faint: "#AEAEB2",
  line: "#E5E5EA",
  page: "#F2F2F7",
  card: "#FFFFFF",
  surface: "#F2F2F7",
  white: "#FFFFFF",
  accent: "#007AFF",
  low: "#E65C5C",
  inRange: "#5CE65C",
  high: "#F5A623",
  lowTint: "rgba(230, 92, 92, 0.12)",
  inRangeTint: "rgba(92, 230, 92, 0.14)",
  highTint: "rgba(245, 166, 35, 0.15)",
  infoTint: "#F2F2F7",
  band: "rgba(92, 230, 92, 0.12)",
};

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
const Card = ({ title = null, children, color = C.card, style: styleProp = null }) => (
  <View style={[s.card, { backgroundColor: color }, styleProp]}>
    {title ? <Text style={s.cardTitle}>{title}</Text> : null}
    {children}
  </View>
);

// ------------------------------------------------------------- units (mmol/L)
// Everything on screen is displayed in mmol/L; the backend speaks mg/dL.
const MGDL_PER_MMOL = 18.0;
const mmol = (mgdl) => (mgdl == null ? null : +(mgdl / MGDL_PER_MMOL).toFixed(1));
// Display form: always exactly 1 decimal, as text (e.g. "5.0" not "5").
const mmol1 = (mgdl) => (mgdl == null ? "--" : (mgdl / MGDL_PER_MMOL).toFixed(1));
// Rewrite any "N mg/dL" occurrences in backend-authored text to mmol/L.
const mmolText = (str) => String(str ?? "").replace(
  /(\d+(?:\.\d+)?)\s*mg\/dL/g,
  (_, n) => `${(Number(n) / MGDL_PER_MMOL).toFixed(1)} mmol/L`
);
// Trio display thresholds (Settings → Features → User Interface). 70 / 180 mg/dL.
const TRIO_LOW = 70;
const TRIO_HIGH = 180;
const TRIO_CONE = "rgba(0, 122, 255, 0.5)"; // Color.blue.opacity(0.5)
const TRIO_NOW = "#AEAEB2"; // systemGray2
const TRIO_GRID = "#C7C7CC"; // systemGray3
const TRIO_IOB = "#1E49FF"; // DarkerBlue

const glucoseTone = (mgdl) => {
  if (mgdl == null) return C.ink;
  return mgdl <= TRIO_LOW ? C.low : mgdl >= TRIO_HIGH ? C.high : C.inRange;
};

const trendArrow = (deltaMgdl) => {
  if (deltaMgdl == null) return "";
  if (deltaMgdl >= 15) return "↑";
  if (deltaMgdl >= 5) return "↗";
  if (deltaMgdl <= -15) return "↓";
  if (deltaMgdl <= -5) return "↘";
  return "→";
};

const formatDelta = (deltaMgdl) => {
  if (deltaMgdl == null) return null;
  const v = +(deltaMgdl / MGDL_PER_MMOL).toFixed(1);
  if (v === 0) return "0.0";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
};

// Y scale matches Trio's updateGlucoseChartYAxis: floor under the low
// threshold, ceiling at 200 mg/dL until readings (or a capped forecast) climb.
function trioYDomain(glucoseVals, extraVals) {
  const g = (glucoseVals || []).filter((v) => v != null && Number.isFinite(v));
  if (!g.length) return { min: 39, max: 200 };
  const minG = Math.min(...g);
  const maxG = Math.max(...g);
  const extras = (extraVals || []).filter((v) => v != null && Number.isFinite(v));
  const maxExtra = extras.length ? Math.max(...extras) : maxG;
  const minExtra = extras.length ? Math.min(...extras) : minG;
  const maxOverall = Math.max(maxG, Math.min(maxExtra, maxG + 50));
  const minOverall = Math.min(minG, minExtra);
  let maxY = 200;
  if (maxOverall > 200 && maxOverall <= 225) maxY = 250;
  else if (maxOverall > 225 && maxOverall <= 275) maxY = 300;
  else if (maxOverall > 275 && maxOverall <= 325) maxY = 350;
  else if (maxOverall > 325) maxY = 400;
  const minY = Math.min(minOverall, TRIO_LOW - 20);
  return { min: minY, max: Math.max(maxY, minY + 10) };
}

function hDashes(key, top, color, left, width, dash, gap) {
  const out = [];
  for (let x = 0; x < width; x += dash + gap) {
    out.push(
      <View key={`${key}-${x}`} pointerEvents="none" style={{
        position: "absolute", left: left + x, top, height: 1,
        width: Math.min(dash, width - x), backgroundColor: color,
      }} />
    );
  }
  return out;
}

function vDashes(key, left, top, height, color) {
  const out = [];
  for (let y = 0; y < height; y += 6) {
    out.push(
      <View key={`${key}-${y}`} pointerEvents="none" style={{
        position: "absolute", left, top: top + y, width: 2, height: 3, backgroundColor: color,
      }} />
    );
  }
  return out;
}

// Trio main glucose pane: colored CGM dots (no connecting line), dashed
// threshold rules, green target, gray "now" marker, and the blue forecast cone.
function TrioGlucoseChart({
  values, forecast = null, band = null, iob = null, targetMgdl = 100, stepMin = 5, height = 210,
}) {
  const [w, setW] = useState(0);
  const nums = values || [];
  const known = nums.filter((v) => v != null);
  if (!known.length) return <Text style={s.dim}>waiting for CGM…</Text>;

  const fut = (forecast || [])
    .filter((p) => p && Number.isFinite(p.minutes) && p.minutes > 0 && p.point != null)
    .slice()
    .sort((a, b) => a.minutes - b.minutes);
  const histSpan = Math.max(stepMin, (nums.length - 1) * stepMin);
  const futureSpan = fut.length ? fut[fut.length - 1].minutes : 0;
  const totalMin = histSpan + futureSpan;
  const lastMg = [...nums].reverse().find((v) => v != null);

  const bandHorizon = band && band.horizonMin > 0 ? band.horizonMin : 0;
  const coneAt = (minute, point) => {
    if (!band || !bandHorizon) return { lo: point - 1, hi: point + 1 };
    const t = Math.min(1, Math.max(0, minute / bandHorizon));
    const lo = point + (band.min_q10 - point) * t;
    const hi = point + (band.max_q90 - point) * t;
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  };
  const coneSamples = fut.length && lastMg != null
    ? [{ minutes: 0, point: lastMg }, ...fut]
    : [];
  const extras = [];
  for (const s of coneSamples) {
    const b = coneAt(s.minutes, s.point);
    extras.push(b.lo, b.hi, s.point);
  }

  const domain = trioYDomain(known, extras);
  const showIob = (iob || []).filter((v) => typeof v === "number").length >= 2;
  const iobMax = showIob ? Math.max(1, ...(iob || []).filter((v) => typeof v === "number")) : 1;
  const padL = 6;
  const padR = 38;
  const padT = 8;
  const labelH = 18;
  const iobH = showIob ? 26 : 0;
  const plotH = Math.max(40, height - padT - labelH - iobH);
  const plotW = Math.max(1, w - padL - padR);
  const y = (mg) => padT + (1 - (mg - domain.min) / (domain.max - domain.min || 1)) * plotH;
  const xAt = (minuteFromStart) => padL + (minuteFromStart / totalMin) * plotW;
  const nowX = xAt(histSpan);

  const stride = totalMin <= 360 ? 60 : totalMin <= 720 ? 120 : 240;
  const marks = [];
  for (let rel = -Math.floor(histSpan / stride) * stride; rel <= futureSpan + 0.1; rel += stride) marks.push(rel);
  if (futureSpan > 0 && !marks.some((m) => Math.abs(xAt(histSpan + m) - xAt(histSpan + futureSpan)) < 28)) {
    marks.push(futureSpan);
  }

  const yTicks = [];
  const span = domain.max - domain.min;
  const step = span > 250 ? 100 : span > 140 ? 50 : 40;
  for (let v = Math.ceil(domain.min / step) * step; v <= domain.max - 4; v += step) yTicks.push(v);

  const coneStrips = [];
  for (let i = 0; i < coneSamples.length - 1; i++) {
    const a = coneSamples[i];
    const b = coneSamples[i + 1];
    const xa = xAt(histSpan + a.minutes);
    const xb = xAt(histSpan + b.minutes);
    const ba = coneAt(a.minutes, a.point);
    const bb = coneAt(b.minutes, b.point);
    const steps = Math.max(1, Math.round((xb - xa) / 3));
    const slice = (xb - xa) / steps;
    for (let s = 0; s < steps; s++) {
      const t = steps === 1 ? 0.5 : s / (steps - 1);
      const lo = ba.lo + (bb.lo - ba.lo) * t;
      const hi = ba.hi + (bb.hi - ba.hi) * t;
      const top = y(Math.max(lo, hi));
      const bot = y(Math.min(lo, hi));
      const h = Math.max(3, bot - top);
      coneStrips.push({
        left: xa + slice * s,
        width: Math.max(slice, 0.8),
        top: top - (h - (bot - top)) / 2,
        height: h,
      });
    }
  }

  const relLabel = (min) => {
    if (Math.abs(min) < 0.5) return "now";
    const sign = min > 0 ? "+" : "-";
    const a = Math.abs(min);
    return a % 60 === 0 ? `${sign}${a / 60}h` : `${sign}${Math.round(a)}m`;
  };

  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height, backgroundColor: "#fff" }}>
        {w > 0 && (
          <>
            {yTicks.map((mg) => (
              <View key={`g${mg}`}>
                {hDashes(`g${mg}`, y(mg), TRIO_GRID, padL, plotW, 2, 3)}
              </View>
            ))}
            {marks.filter((rel) => rel !== 0).map((rel) => (
              <View key={`vx${rel}`}>
                {vDashes(`vx${rel}`, xAt(histSpan + rel), padT, plotH + iobH, TRIO_GRID)}
              </View>
            ))}
            {targetMgdl > domain.min && targetMgdl < domain.max && (
              <View pointerEvents="none" style={{
                position: "absolute", left: padL, width: plotW, top: y(targetMgdl), height: 1,
                backgroundColor: "#34C759",
              }} />
            )}
            {TRIO_HIGH > domain.min && TRIO_HIGH < domain.max && hDashes("hi", y(TRIO_HIGH), C.high, padL, plotW, 5, 5)}
            {TRIO_LOW > domain.min && TRIO_LOW < domain.max && hDashes("lo", y(TRIO_LOW), C.low, padL, plotW, 5, 5)}
            {coneStrips.map((strip, i) => (
              <View key={`c${i}`} pointerEvents="none" style={{
                position: "absolute", left: strip.left, top: strip.top,
                width: strip.width, height: strip.height, backgroundColor: TRIO_CONE,
              }} />
            ))}
            {vDashes("now", nowX - 1, padT, plotH + iobH, TRIO_NOW)}
            {nums.map((mg, i) => mg == null ? null : (
              <View key={`p${i}`} pointerEvents="none" style={{
                position: "absolute",
                left: xAt(i * stepMin) - 2.5,
                top: y(mg) - 2.5,
                width: 5, height: 5, borderRadius: 2.5,
                backgroundColor: glucoseTone(mg),
              }} />
            ))}
            {showIob && (iob || []).map((v, i) => {
              if (typeof v !== "number") return null;
              const top = padT + plotH + 2;
              const baseline = top + iobH - 2;
              const tip = top + (1 - v / iobMax) * (iobH - 4);
              const slot = plotW / Math.max(nums.length, 1);
              return (
                <View key={`iob${i}`} pointerEvents="none" style={{
                  position: "absolute",
                  left: xAt(i * stepMin) - slot / 2,
                  top: tip,
                  width: Math.max(slot, 1.5),
                  height: Math.max(1, baseline - tip),
                  backgroundColor: "rgba(30, 73, 255, 0.22)",
                  borderTopWidth: 1.5,
                  borderTopColor: TRIO_IOB,
                }} />
              );
            })}
            {yTicks.map((mg) => (
              <Text key={`yl${mg}`} style={{
                position: "absolute", right: 0, width: padR - 2,
                top: Math.min(Math.max(0, y(mg) - 7), height - 14),
                fontSize: 11, color: C.ink, textAlign: "right",
              }}>{mmol1(mg)}</Text>
            ))}
            {marks.map((rel) => (
              <Text key={`xl${rel}`} style={{
                position: "absolute",
                left: Math.min(Math.max(0, xAt(histSpan + rel) - 16), w - 36),
                top: padT + plotH + iobH + 2,
                width: 36, textAlign: "center", fontSize: 11, color: C.ink,
              }}>{relLabel(rel)}</Text>
            ))}
          </>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        <LegendDot color={C.inRange} label="glucose" />
        {coneSamples.length > 1 && <LegendDot color="#007AFF" label="forecast" swatch />}
        <LegendDot color={C.low} label={`${mmol1(TRIO_LOW)} low`} dash />
        <LegendDot color={C.high} label={`${mmol1(TRIO_HIGH)} high`} dash />
        <LegendDot color="#34C759" label="target" />
        {showIob && <LegendDot color={TRIO_IOB} label="IOB" />}
      </View>
    </View>
  );
}

function LegendDot({ color, label, dash = false, swatch = false }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{
        width: dash ? 12 : 8, height: dash ? 0 : 8, borderRadius: swatch ? 1 : 4,
        backgroundColor: dash ? "transparent" : color,
        borderTopWidth: dash ? 2 : 0, borderStyle: dash ? "dashed" : "solid", borderColor: color,
        opacity: swatch ? 0.7 : 1,
      }} />
      <Text style={{ fontSize: 11, color: C.muted }}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------- mini bar chart
// Deterministic 24 h synthetic series (5-min cadence) used to render the
// insights pie/calendar mockups. Backend untouched; live endpoints stay live.
function mockSeries(shape, n = 288) {
  const out = [];
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
const MOCK_WEEK = mockSeries((p) => ({ cgm: { glucose_mgdl: p.g }, ts: p.ts }), 7 * 288);

// ------------------------------------------------------------------ screens
const TIR_RANGES = [
  { id: "1h", label: "1 h" },
  { id: "24h", label: "24 h" },
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
            style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: range === r.id ? C.accent : C.surface
            }}>
            <Text style={{ fontWeight: "700", color: range === r.id ? C.white : C.muted }}>{r.label}</Text>
          </Pressable>
        ))}
      </View>
      {pct == null ? (
        <Text style={s.dim}>Not enough readings yet — time in range appears as the stream fills.</Text>
      ) : (
        <>
          <Text style={{ fontSize: 34, fontWeight: "800", color: C.ink }}>{Math.round(pct)}%</Text>
          <View style={{ height: 8, borderRadius: 999, backgroundColor: C.surface, overflow: "hidden", marginTop: 8, flexDirection: "row" }}>
            {/* /tir Result carries percentages (low_pct/high_pct), not counts —
                see TIRResult in packages/contracts/index.ts. */}
            <View style={{ width: `${Math.min(100, tir.in_range / Math.max(1, tir.total) * 100)}%`, backgroundColor: C.inRange }} />
            <View style={{ width: `${Math.min(100, tir.low_pct ?? 0)}%`, backgroundColor: C.low }} />
            <View style={{ width: `${Math.min(100, tir.high_pct ?? 0)}%`, backgroundColor: C.high }} />
          </View>
          <Text style={s.dim}>
            {tir.in_range}/{tir.total} in range · {Math.round(tir.low_pct ?? 0)}% low · {Math.round(tir.high_pct ?? 0)}% high
          </Text>
        </>
      )}
    </Card>
  );
}

// ------------------------------------ insights mockups (from design screenshot)
const PIE_COLORS = { low: C.low, inRange: C.inRange, high: C.high };

/** Pie chart from [{ value, color }] — rotated full-diameter bars, no libs. */
function PieChart({ segments, size = 210 }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const sweep = useRef(new Animated.Value(-90)).current;
  useEffect(() => {
    Animated.timing(sweep, { toValue: 0, duration: 500, useNativeDriver: true }).start();
  }, []);
  const N = 240, thick = 5;
  const cuts = [];
  let acc = 0;
  for (const seg of segments) {
    if (seg.value <= 0) continue;
    acc += seg.value / total;
    cuts.push({ end: acc, color: seg.color, value: seg.value, angle: acc * 360 });
  }
  let idx = 0;
  const colors = [];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    while (idx < cuts.length - 1 && t >= cuts[idx].end - 1e-9) idx += 1;
    colors.push(cuts[idx] ? cuts[idx].color : C.surface);
  }
  // % labels at each slice's mid-angle (only if the slice is big enough)
  let prev = 0;
  const labels = cuts.map((c) => {
    const mid = ((prev + c.end) / 2) * 2 * Math.PI; // rad from 12 o'clock cw
    prev = c.end;
    const r = size * 0.30;
    const pct = Math.round((100 * c.value) / total);
    return pct >= 4 ? {
      pct,
      left: size / 2 + r * Math.sin(mid) - 26,
      top: size / 2 - r * Math.cos(mid) - 11,
    } : null;
  });
  return (
    <View style={{
      width: size, height: size,
      shadowColor: "#071525", shadowOpacity: 0.08, shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 }, elevation: 2,
    }}>
      <Animated.View style={{
        width: size, height: size, borderRadius: size / 2, overflow: "hidden",
        borderWidth: 5, borderColor: C.white, backgroundColor: C.surface,
        transform: [{ rotate: sweep }],
      }}>
        {colors.map((color, i) => (
          <View key={i} pointerEvents="none" style={{
            position: "absolute", width: thick, height: size,
            left: size / 2 - thick / 2, top: 0,
            transform: [{ rotate: `${(i * (360 / N) + 360).toFixed(2)}deg` }],
            backgroundColor: color,
          }} />
        ))}
        {cuts.length > 1 && cuts.slice(0, -1).map((c, i) => (
          <View key={`sep${i}`} style={{
            position: "absolute", width: 1.5, height: size,
            left: size / 2 - 0.75, top: 0,
            transform: [{ rotate: `${c.angle}deg` }],
            backgroundColor: C.white, opacity: 0.9,
          }} />
        ))}
      </Animated.View>
      {labels.map((l, i) => l ? (
        <Text key={`lb${i}`} style={{
          position: "absolute", left: l.left, top: l.top, width: 52, textAlign: "center",
          fontSize: 14, fontWeight: "800", color: C.white,
          textShadowColor: "rgba(0,0,0,0.25)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
        }}>
          {l.pct}%
        </Text>
      ) : null)}
    </View>
  );
}

// Trio's double-tap presets: 6 h, 12 h, 24 h. Each point is one 5-min reading.
const LOOKBACKS = [
  { id: "6h", label: "6H", n: 72 },
  { id: "12h", label: "12H", n: 144 },
  { id: "24h", label: "24H", n: 288 },
];

function forecastBand(forecast) {
  const block = forecast?.long?.[0];
  if (!block || block.window_end_h <= 0) return null;
  return {
    min_q10: block.min_q10,
    max_q90: block.max_q90,
    horizonMin: Math.max(
      1,
      forecast.medium?.length ? forecast.medium[forecast.medium.length - 1].minutes : block.window_end_h * 60,
    ),
  };
}

// Forecast horizons (hours), shared by the horizon chips and sampling.
const PREDICTION_LEVELS = [
  { id: "1h", label: "1 H", hours: 1 },
  { id: "3h", label: "3 H", hours: 3 },
  { id: "6h", label: "6 H", hours: 6 },
];

// Envelope blocks ({window_start_h, window_end_h, min_q10, max_q90}) ->
// sampled points [{minutes, point}]: piecewise-linear over block midpoints
// ((min+max)/2). Sampling step: 5 min up to 1 h, 15 min to 3 h, 30 min beyond.
function envelopePath(blocks, hours) {
  if (!blocks?.length) return [];
  const nodes = blocks.map((b) => ({
    t: (b.window_start_h + b.window_end_h) / 2,
    v: (b.min_q10 + b.max_q90) / 2,
  }));
  const at = (h) => {
    if (h <= nodes[0].t) return nodes[0].v;
    for (let i = 1; i < nodes.length; i++) {
      if (h <= nodes[i].t) {
        const f = (h - nodes[i - 1].t) / (nodes[i].t - nodes[i - 1].t);
        return nodes[i - 1].v + f * (nodes[i].v - nodes[i - 1].v);
      }
    }
    return nodes[nodes.length - 1].v;
  };
  const step = hours <= 1 ? 5 : hours <= 3 ? 15 : 30;
  const out = [];
  for (let m = step; m <= hours * 60; m += step) out.push({ minutes: m, point: at(m / 60) });
  return out;
}

// Band for the forecast cone over a chosen horizon (hours): widest q10–q90
// across the long envelope blocks that fit inside the horizon.
function forecastBandFor(forecast, hours) {
  const blocks = (forecast?.long ?? []).filter((b) => b.window_end_h <= (hours || 0) + 0.01);
  if (!blocks.length || !hours) return null;
  return {
    min_q10: Math.min(...blocks.map((b) => b.min_q10)),
    max_q90: Math.max(...blocks.map((b) => b.max_q90)),
    horizonMin: hours * 60,
  };
}

function RecentGlucoseCard() {
  const [range, setRange] = useState("48H");
  const days = range === "24H" ? 1 : range === "48H" ? 2 : 7;
  const values = MOCK_WEEK.slice(-days * 288).map((r) => r.cgm.glucose_mgdl);
  const low = values.filter((g) => g <= 70).length;
  const high = values.filter((g) => g >= 180).length;
  const inRange = values.length - low - high;
  const segments = [
    { label: "Low", value: low, color: PIE_COLORS.low },
    { label: "In Range", value: inRange, color: PIE_COLORS.inRange },
    { label: "High", value: high, color: PIE_COLORS.high },
  ].filter((s, i, a) => a.findIndex((x) => x.label === s.label) === i);
  return (
    <Card>
      <Text style={{ fontSize: 18, fontWeight: "800", color: C.ink }}>Recent Glucose Data</Text>
      <Text style={s.dim}>Going back from 00:00 today</Text>
      <View style={{ flexDirection: "row", gap: 6, alignSelf: "flex-end", marginVertical: 8 }}>
        {["24H", "48H", "Week"].map((r) => (
          <Pressable key={r} onPress={() => setRange(r)}
            style={{
              paddingHorizontal: 8, paddingBottom: 4,
              borderBottomWidth: 2, borderBottomColor: range === r ? C.accent : "transparent"
            }}>
            <Text style={{ fontWeight: "700", color: range === r ? C.ink : C.faint }}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <PieChart segments={segments} />
        <View style={{ gap: 12, flex: 1 }}>
          {segments.map((seg) => {
            const pct = Math.round(100 * seg.value / (values.length || 1));
            return (
              <View key={seg.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{
                  width: 12, height: 12, borderRadius: 6, backgroundColor: seg.color,
                  shadowColor: seg.color, shadowOpacity: 0.5, shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: C.ink }}>{seg.label}</Text>
                  <Text style={{ fontSize: 11, color: C.faint }}>{seg.value} readings</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "800", color: C.ink }}>{pct}%</Text>
              </View>
            );
          })}
        </View>
      </View>
      <Pressable accessibilityRole="button" style={{ marginTop: 12 }}>
        <Text style={{ fontWeight: "700", color: C.ink }}>Update glucose tresholds ▸</Text>
      </Pressable>
    </Card>
  );
}

function TIRCalendar() {
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthLabel = base.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const firstDow = (base.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  // Deterministic TIR per day (mock) — stable per date.
  const dayTir = (d) => {
    let seed = (base.getFullYear() * 372 + base.getMonth() * 31 + d * 7) % 2147483647;
    seed = (seed * 48271 + 11) % 2147483647;
    return 45 + (seed % 55); // 45–99 %
  };
  const cells = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Pressable accessibilityRole="button" onPress={() => setMonthOffset((m) => m - 1)}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: C.muted }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "800", color: C.ink }}>{monthLabel}</Text>
        <Pressable accessibilityRole="button" onPress={() => setMonthOffset((m) => Math.min(0, m + 1))}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: monthOffset >= 0 ? C.line : C.muted }}>›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", marginBottom: 6 }}>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <View key={d} style={{ width: `${100 / 7}%`, alignItems: "center" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: C.muted }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((d, i) => {
          if (d == null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: 46 }} />;
          const date = new Date(base.getFullYear(), base.getMonth(), d);
          const isFuture = date > now;
          const isToday = date.toDateString() === now.toDateString();
          const tir = dayTir(d);
          return (
            <View key={d} style={{
              width: `${100 / 7}%`, height: 46, alignItems: "center", justifyContent: "center",
              gap: 3, backgroundColor: isToday ? C.accent : "transparent",
              opacity: isFuture ? 0.35 : 1,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: isToday ? C.white : C.ink }}>{d}</Text>
                {!isFuture && <View style={{
                  width: 7, height: 7, borderRadius: 3.5,
                  backgroundColor: tir >= 70 ? PIE_COLORS.inRange : PIE_COLORS.low,
                  marginTop: -6,
                }} />}
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 14, marginTop: 8, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PIE_COLORS.inRange }} />
          <Text style={s.dim}>above 70% TIR</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PIE_COLORS.low }} />
          <Text style={s.dim}>below 70% TIR</Text>
        </View>
      </View>
    </Card>
  );
}

// Proactive recommendations now arrive with the single /state poll (BE adds
// `recommendations` to /state/:patientId) instead of a separate /recommendations call.
function RecommendationsCard({ recs, onOpenElla }: { recs?: Array<Record<string, any>>, onOpenElla?: (seed?: string) => void }) {
  // Trend info first, then device faults, then the rest (stable sort keeps
  // newest-first within each group).
  const weight = (t?: string) => (t === "trend_down" ? 0 : t === "device_fault" ? 1 : 2);
  const list = (recs ?? []).slice(-4).sort((a, b) => weight(a.type) - weight(b.type));
  const levelColor = { critical: C.low, warning: C.high, info: C.ink };
  const levelTint = { critical: C.lowTint, warning: C.highTint, info: C.infoTint };
  return (
    <Card title="Proactive recommendations">
      {list.length === 0
        ? <Text style={s.dim}>Nothing triggered — the engine re-checks every minute against forecast + profile.</Text>
        : list.map((r) => (
          <View key={r.id} style={{
            marginBottom: 8, padding: 10, borderRadius: 10,
            backgroundColor: levelTint[r.level] || C.infoTint
          }}>
            <Text>
              <Text style={{ color: levelColor[r.level] || C.ink, fontWeight: "800" }}>
                [{(r.type || r.level).replace(/_/g, " ").toUpperCase()}]{" "}
              </Text>
              {mmolText(r.message)}
            </Text>
            {r.suggested_action
              ? <Text style={s.dim}>suggested action: {r.suggested_action.replace(/_/g, " ")} · approve on the pump-action card or in chat</Text>
              : null}
          </View>
        ))}
      {list.length > 0 && onOpenElla && (
        <Pressable
          onPress={() => onOpenElla(
            `I got this alert: "${(list[list.length - 1]?.type || "").replace(/_/g, " ").toUpperCase()} — ${mmolText(list[list.length - 1]?.message)}". What should I do?`)}
          style={{ alignSelf: "flex-end", marginTop: 2, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: C.accent }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Ask Ella →</Text>
        </Pressable>
      )}
    </Card>
  );
}

function Dashboard({ onOpenElla }: { onOpenElla?: (seed?: string) => void }) {
  const [state] = usePoll(`/state/${PATIENT}`, POLL_MS);
  const [readings] = usePoll(`/readings/${PATIENT}`, 15000);
  const [range, setRange] = useState("6h");
  const lv = LOOKBACKS.find((l) => l.id === range) || LOOKBACKS[0];
  // Forecast horizon buttons: extend the chart with sampled envelope points.
  const [fRange, setFRange] = useState("1h");
  const fLv = PREDICTION_LEVELS.find((l) => l.id === fRange) || PREDICTION_LEVELS[0];
  const series = (readings?.readings || []).slice(-lv.n);
  const latest = state?.latest;
  const g = latest?.cgm?.glucose_mgdl;
  const status = latest?.pump?.pump_status;
  const quality = latest?.cgm?.cgm_quality;
  const forecast = state?.forecast;
  const known = series.map((r) => r.glucose_mgdl).filter((v) => v != null);
  const prev = known.length >= 2 ? known[known.length - 2] : null;
  const delta = g != null && prev != null ? g - prev : null;
  const in1h = forecast?.medium?.length ? forecast.medium[forecast.medium.length - 1].point : null;
  const deltaText = formatDelta(delta);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <RecommendationsCard recs={state?.recommendations} onOpenElla={onOpenElla} />
      <Card>
        <Text style={{ fontSize: 40, fontWeight: "800", color: glucoseTone(g), letterSpacing: -0.8 }}>
          {g == null ? "– –" : `${mmol1(g)}  ${trendArrow(delta)}`}
        </Text>
        <Text style={s.dim}>
          mmol/L{deltaText ? `   ${deltaText}` : ""}
          {in1h != null ? `   ·   in 1 h ${mmol1(in1h)}` : ""}
        </Text>
        <Text style={s.dim}>CGM {quality ?? "?"} · pump {status ?? "?"}</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 10, marginBottom: 4 }}>
          {LOOKBACKS.map((l) => (
            <Pressable key={l.id} onPress={() => setRange(l.id)}
              style={{
                paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
                backgroundColor: range === l.id ? C.accent : C.surface
              }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: range === l.id ? C.white : C.muted }}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginBottom: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: C.muted }}>Forecast</Text>
          {PREDICTION_LEVELS.map((l) => (
            <Pressable key={l.id} onPress={() => setFRange(l.id)}
              style={{
                paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
                backgroundColor: fRange === l.id ? C.accent : C.surface
              }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: fRange === l.id ? C.white : C.muted }}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        <TrioGlucoseChart
          values={series.map((r) => r.glucose_mgdl)}
          iob={series.map((r) => r.iob)}
          forecast={envelopePath(forecast?.long, fLv.hours)}
          band={forecastBandFor(forecast, fLv.hours)}
          targetMgdl={state?.profile?.target_mgdl ?? 100}
          height={220}
        />
      </Card>
      <TirCard state={state} />
    </ScrollView>
  );
}

const CHAT_GREETING = [{ role: "assistant", content: "Hi! I'm Ella. How are you feeling today?" }];

// Chat history lives in the root component (survives tab switches) and is
// persisted to localStorage when available (survives page reloads on web).
function loadChatHistory() {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = JSON.parse(localStorage.getItem("ella-chat-v3") || "null");
      if (Array.isArray(saved) && saved.length) return saved;
    }
  } catch { /* corrupted storage — fall back to greeting */ }
  return CHAT_GREETING;
}

function saveChatHistory(msgs) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("ella-chat-v3", JSON.stringify(msgs.slice(-50)));
  } catch { /* storage unavailable — in-memory only */ }
}

// ----------------------------------------------------- chat markdown (no deps)
// Renders Ella's replies: **bold**, *italic*, `code`, ### headings, bullet /
// numbered lists, and paragraphs.
const MD_SPLIT = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*`]+?\*)/g;

function mdInline(text: string): Array<string | JSX.Element> {
  return String(text).split(MD_SPLIT).filter(Boolean).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <Text key={i} style={{ fontWeight: "700" }}>{p.slice(2, -2)}</Text>;
    if (p.startsWith("`") && p.endsWith("`")) return <Text key={i} style={{ fontFamily: "Menlo, monospace", fontSize: 12 }}>{p.slice(1, -1)}</Text>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <Text key={i} style={{ fontStyle: "italic" }}>{p.slice(1, -1)}</Text>;
    return p;
  });
}

function MarkdownText({ content }: { content: string }) {
  const out: JSX.Element[] = [];
  const list: Array<{ n?: number, text: string }> = [];
  const flushList = (key: string) => {
    if (!list.length) return;
    out.push(
      <View key={key} style={{ gap: 3 }}>
        {list.map((li, i) => (
          <Text key={i} style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Text style={{ color: C.muted }}>{li.n ? `${li.n}. ` : "•  "}</Text>{mdInline(li.text)}
          </Text>
        ))}
      </View>,
    );
    list.length = 0;
  };
  String(content).split("\n").forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    const heading = line.match(/^\s*(#{1,4})\s+(.*)/);
    if (bullet) list.push({ text: bullet[1] });
    else if (numbered) list.push({ n: Number(numbered[1]), text: numbered[2] });
    else {
      flushList(`l${out.length}`);
      if (heading) {
        out.push(<Text key={idx} style={{ fontWeight: "800", fontSize: 13, marginTop: 2 }}>{mdInline(heading[2])}</Text>);
      } else if (!line.trim()) {
        out.push(<View key={idx}style={{ height: 4 }} />);
      } else {
        out.push(<Text key={idx}>{mdInline(line)}</Text>);
      }
    }
  });
  flushList(`l${out.length}`);
  return <View style={{ gap: 5 }}>{out}</View>;
}

function Chat({ msgs, setMsgs, autoSend }: { msgs: any[], setMsgs: any, autoSend?: { text: string, n: number } | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const lastSentSeed = useRef<number | null>(null);
  // Bumped on delete so an in-flight reply cannot repopulate a cleared chat.
  const sendGen = useRef(0);
  // After delete, ignore server history until a poll comes back empty.
  const skipServerHistory = useRef(false);
  // Persisted "chat was deleted" marker: survives Chat remounts, so server
  // history is ignored until the server confirms it is empty.
  const CLEAR_KEY = "ella-chat-cleared";
  // Pick up proactive messages Ella pushed server-side (low-glucose watch)
  const [state] = usePoll(`/state/${PATIENT}`, 15000);
  useEffect(() => {
    const h = state?.chat_history;
    let cleared = false;
    try { cleared = typeof localStorage !== "undefined" && !!localStorage.getItem(CLEAR_KEY); } catch {}
    if (cleared) {
      if (!h || h.length === 0) {
        try { localStorage.removeItem(CLEAR_KEY); } catch {}
        skipServerHistory.current = false;
      }
      return;
    }
    if (skipServerHistory.current) {
      if (!h || h.length === 0) skipServerHistory.current = false;
      return;
    }
    if (h && h.length) {
      setMsgs((x) => {
        const greetingOnly = x.length === 1 && x[0].content.startsWith("Hi! I'm Ella");
        const base = greetingOnly ? [x[0]] : x;
        // Signature: local assistant replies are stored through mmolText()
        // (mg/dL -> mmol/L), so apply the same conversion to server copies
        // before comparing — otherwise they never match and re-append.
        const sig = (m) => `${m.role}|${(m.role === "assistant" ? mmolText(m.content) : m.content).trim()}`;
        const known = new Set(base.map(sig));
        const fresh = h.filter((y) => !known.has(sig(y)));
        return fresh.length ? [...base, ...fresh] : base;
      });
    }
  }, [state?.chat_history]);

  const deleteChat = useCallback(async () => {
    sendGen.current += 1;
    skipServerHistory.current = true;
    try { localStorage.setItem("ella-chat-cleared", "1"); } catch {}
    setText("");
    setBusy(false);
    setMsgs(CHAT_GREETING.map((m) => ({ ...m })));
    try {
      await fetch(`${API}/chat/${PATIENT}`, { method: "DELETE" });
    } catch { /* local transcript is already cleared */ }
  }, [setMsgs]);

  const confirmDeleteChat = () => {
    // Alert.alert is a no-op on react-native-web — use window.confirm there.
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (window.confirm("Delete chat? This removes the conversation with Ella.")) void deleteChat();
      return;
    }
    Alert.alert(
      "Delete chat?",
      "This removes the conversation with Ella.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => { void deleteChat(); } },
      ],
    );
  };

  const send = useCallback(async (override?: string) => {
    const m = (override ?? text).trim();
    if (!m || busy) return;
    const gen = sendGen.current;
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
      if (sendGen.current !== gen) return;
      setMsgs((x) => [...x, { role: "assistant", content: mmolText(j.reply || j.error) || "?" }]);
    } catch (e) {
      if (sendGen.current !== gen) return;
      setMsgs((x) => [...x, { role: "assistant", content: "Connection problem — is the backend running?" }]);
    }
    if (sendGen.current === gen) setBusy(false);
  }, [text, busy]);

  // Auto-send seeded questions from "Ask Ella" (fires once per seed).
  useEffect(() => {
    if (autoSend && autoSend.n !== lastSentSeed.current && !busy) {
      lastSentSeed.current = autoSend.n;
      send(autoSend.text);
    }
  }, [autoSend, busy, send]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={s.chatToolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete chat"
          onPress={confirmDeleteChat}
          hitSlop={8}
        >
          <Text style={s.deleteChat}>Delete chat</Text>
        </Pressable>
      </View>
      <FlatList
        style={{ padding: 12 }}
        data={msgs}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === "user" ? s.bubbleUser : s.bubbleElla]}>
            {item.proactive ? (
              <Text style={{ fontSize: 10, fontWeight: "700", color: item.level === "critical" ? "#C62828" : "#EF6C00", marginBottom: 2 }}>
                📣 ELLA REACHED OUT{item.level ? ` · ${item.level.toUpperCase()}` : ""}
              </Text>
            ) : null}
            <Text style={item.role === "user" ? { color: "#fff" } : {}}>
              {item.role === "user" ? item.content : <MarkdownText content={item.content} />}
            </Text>
          </View>
        )}
      />
      <View style={{
        flexDirection: "row", padding: 12, gap: 8, backgroundColor: C.white,
        borderTopWidth: 1, borderTopColor: C.line
      }}>
        <TextInput
          style={s.input} value={text} onChangeText={setText}
          placeholder="Tell Ella about meals, sleep, exercise, stress…"
          placeholderTextColor={C.faint}
          onSubmitEditing={() => send()}
        />
        <Pressable style={[s.btn, { backgroundColor: C.accent }]} onPress={() => send()} disabled={busy}>
          {busy ? <ActivityIndicator color={C.white} /> : <Text style={s.btnText}>Send</Text>}
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

  // GET /readings returns flattened points — { t, glucose_mgdl, iob, ... }.
  const series = readings?.readings ?? [];

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, gap: 12 }}>
      <RecentGlucoseCard />
      <TIRCalendar />
      <Card title="Glucose — last 24 hours">
        <TrioGlucoseChart
          values={series.map((r) => r.glucose_mgdl)}
          iob={series.map((r) => r.iob)}
          forecast={forecast?.medium}
          band={forecastBand(forecast)}
          targetMgdl={profile?.target_mgdl ?? 100}
          height={200}
        />
        <Text style={s.dim}>{series.length} readings</Text>
      </Card>
      {profile ? (
        <Card title="Your profile">
          <Text style={s.dim}>
            IC ratio {profile.ic_ratio_g_per_u} g/U · ISF {mmol1(profile.isf_mgdl_per_u)} mmol/L/U ·
            basal {profile.basal_u_hr} U/h · target {mmol1(profile.target_mgdl)} mmol/L
          </Text>
        </Card>
      ) : null}
      <Card title="24-hour risk envelope">
        <Text style={s.dim}>
          Each block shows the predicted 10th percentile of the minimum and 90th
          percentile of the maximum glucose in that 4-hour window.
        </Text>
        {blocks.map((b, i) => (
          <View key={i} style={{
            marginTop: 10, padding: 10, borderRadius: 10,
            backgroundColor: b.risk === "high" ? C.highTint : C.inRangeTint
          }}>
            <Text style={{ fontWeight: "700", color: b.risk === "high" ? C.high : C.ink }}>
              {b.window_start_h}h–{b.window_end_h}h · {b.risk === "high" ? "⚠️ high risk" : "ok"}
            </Text>
            <Text style={s.dim}>low q10: {mmol1(b.min_q10)} mmol/L · high q90: {mmol1(b.max_q90)} mmol/L</Text>
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
  const [chatMsgs, setChatMsgs] = useState(loadChatHistory());
  useEffect(() => { saveChatHistory(chatMsgs); }, [chatMsgs]);
  // "Ask Ella" flow: seed message the Chat tab auto-sends on open.
  const [pendingSeed, setPendingSeed] = useState<{ text: string, n: number } | null>(null);
  const openElla = useCallback((seed?: string) => {
    setTab(1);
    if (seed) setPendingSeed({ text: seed, n: (pendingSeed?.n ?? 0) + 1 });
  }, [pendingSeed]);
  const Comp = TABS[tab].Comp as React.ComponentType<any>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.page }}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: C.ink, letterSpacing: -0.3 }}>GlucoLoop</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 1
          ? <Chat msgs={chatMsgs} setMsgs={setChatMsgs} autoSend={pendingSeed} />
          : <Comp onOpenElla={openElla} />}
      </View>
      <View style={s.tabbar}>
        {TABS.map((t, i) => (
          <Pressable key={t.name} onPress={() => setTab(i)} style={[s.tab, i === tab && s.tabActive]}>
            <Text style={{ color: i === tab ? C.ink : C.muted, fontWeight: i === tab ? "700" : "600" }}>{t.name}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, backgroundColor: C.white,
    borderBottomWidth: 1, borderBottomColor: C.line
  },
  scroll: { flex: 1 },
  card: {
    borderRadius: 16, padding: 16, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.line,
    shadowColor: "#071525", shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 1
  },
  cardTitle: { fontWeight: "700", marginBottom: 8, color: C.ink, letterSpacing: -0.2 },
  dim: { color: C.muted },
  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, justifyContent: "center" },
  btnText: { color: C.white, fontWeight: "700" },
  bubble: {
    maxWidth: "85%", padding: 12, borderRadius: 16, marginBottom: 8,
    alignSelf: "flex-start", backgroundColor: C.white,
    borderWidth: 1, borderColor: C.line
  },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: C.accent, borderColor: C.accent },
  bubbleElla: { alignSelf: "flex-start", backgroundColor: C.surface, borderColor: C.line },
  chatToolbar: {
    flexDirection: "row", justifyContent: "flex-end", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.white,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  deleteChat: { color: C.low, fontWeight: "700", fontSize: 13 },
  input: {
    flex: 1, backgroundColor: C.white, borderRadius: 999, paddingHorizontal: 16,
    paddingVertical: 10, borderWidth: 1, borderColor: C.line, color: C.ink
  },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderColor: C.line, backgroundColor: C.white },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabActive: { borderTopWidth: 2, borderTopColor: C.accent },
});
