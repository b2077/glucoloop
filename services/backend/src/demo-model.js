/** Pure arithmetic for the browser demonstration and its tests.
 * Curves and observations are invented scenarios, not fitted physiology.
 * Only completed synthetic peak observations enter the learning calculation.
 */
export function estimate(initial, observations, prior) {
  if (![initial, prior, ...observations].every(Number.isFinite) || prior <= 0) {
    throw new Error("Learning needs finite observations and a positive prior weight");
  }
  return (prior * initial + observations.reduce((sum, x) => sum + x, 0)) /
    (prior + observations.length);
}

export function curve(delta, config) {
  const { baseline_mgdl: base, step_minutes: step, total_minutes: total,
    event_start_minutes: start, duration_minutes: duration, peak_fraction: peak } = config;
  if (![base, step, total, start, duration, peak, delta].every(Number.isFinite) ||
      step <= 0 || total < 0 || start < 0 || duration <= 0 || peak <= 0 || peak >= 1) {
    throw new Error("Invalid demonstration curve settings");
  }
  const points = [];
  for (let t = 0; t <= total; t += step) {
    const phase = (t - start) / duration;
    const shape = phase <= 0 || phase >= 1 ? 0 :
      phase <= peak ? phase / peak : (1 - phase) / (1 - peak);
    points.push({ t, glucose: base + delta * shape });
  }
  return points;
}

export function summary(points, low, high) {
  if (!points.length || !Number.isFinite(low) || !Number.isFinite(high) || low >= high ||
      !points.every(p => Number.isFinite(p.glucose))) throw new Error("Invalid glucose summary");
  const count = points.length;
  return {
    low: 100 * points.filter(p => p.glucose < low).length / count,
    inRange: 100 * points.filter(p => p.glucose >= low && p.glucose <= high).length / count,
    high: 100 * points.filter(p => p.glucose > high).length / count,
    mean: points.reduce((sum, p) => sum + p.glucose, 0) / count,
  };
}
