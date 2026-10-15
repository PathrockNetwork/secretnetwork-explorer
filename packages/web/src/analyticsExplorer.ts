import type { Metrics, SeriesPoint } from "./api";

export const ANALYTICS_RANGES = [{ hours: 24, label: "24h" }, { hours: 168, label: "7d" }, { hours: 720, label: "30d" }];
export const THRESHOLDS = { blockTime: 7, p95: 8, signing: 99.5, volume: .9 };
export type ChartPoint = { t: number; value: number | null };
export const bucketMs = (hours: number) => hours * 3_600_000 / (hours <= 24 ? 60 : 120);
export function chartPoints(series: SeriesPoint[], key: "block_time_s" | "signing_rate"): ChartPoint[] {
  return series.map(p => ({ t: Date.parse(p.t), value: p[key] })).filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
}
/** Keep missing readings and missing time buckets visible as gaps. */
export function chartSegments(points: ChartPoint[], step: number) {
  const segments: { t: number; value: number }[][] = [];
  let current: { t: number; value: number }[] = [];
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value)) { current = []; continue; }
    if (!current.length || point.t - current[current.length - 1].t > step * 1.5) { current = []; segments.push(current); }
    current.push({ t: point.t, value: point.value });
  }
  return segments;
}
export function chartDomain(points: ChartPoint[], signing: boolean): [number, number] {
  const values = points.flatMap(p => p.value !== null && Number.isFinite(p.value) ? [p.value] : []);
  return signing ? [Math.max(0, Math.floor(Math.min(99, ...values.map(v => v - .1)) * 10) / 10), 100] : [0, Math.max(10, Math.ceil(Math.max(0, ...values) * 1.1))];
}
export function seriesExtent(points: ChartPoint[]) {
  const values = points.flatMap(p => p.value !== null && Number.isFinite(p.value) ? [p.value] : []);
  return { min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, count: values.length };
}
export type VolumeBucket = { t: number; end: number; n: number; complete: boolean };
export function volumeBuckets(metrics: Metrics, end: number): VolumeBucket[] {
  const unit = metrics.volume.unit === "day" ? 86_400_000 : 3_600_000;
  const start = end - metrics.hours * 3_600_000;
  const observed = metrics.volume.points.map(p => ({ t: Date.parse(p.t), n: p.n })).filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  // Daily date_trunc boundaries follow the database timezone, not necessarily
  // UTC midnight. Preserve supplied timestamps, including DST transitions.
  const anchor = observed[0]?.t ?? 0;
  const tolerance = metrics.volume.unit === "day" ? 2 * 3_600_000 : 0;
  const buckets: VolumeBucket[] = [];
  for (let t = anchor + Math.floor((start - anchor) / unit) * unit; t < end; t += unit) {
    const point = observed.find(p => Math.abs(p.t - t) <= tolerance);
    if (point) t = point.t;
    const next = observed.find(p => p.t > t && Math.abs(p.t - (t + unit)) <= tolerance);
    const bucketEnd = next?.t ?? t + unit;
    buckets.push({ t, end: bucketEnd, n: point?.n ?? 0, complete: t >= start && bucketEnd <= end });
  }
  return buckets;
}
export function expectedVolume(metrics: Metrics) {
  const average = metrics.stats.avg_block_time_s;
  return average !== null && average > 0 ? 3600 * (metrics.volume.unit === "day" ? 24 : 1) / average : null;
}
export type OutlierWindow = { start: number; end: number; kind: "block" | "signing" | "volume"; value: number; buckets: number };
/** These are anomalous aggregate buckets, never claimed to be exact incident durations. */
export function outlierWindows(metrics: Metrics, end: number): OutlierWindow[] {
  const windows: OutlierWindow[] = [], step = bucketMs(metrics.hours);
  for (const kind of ["block", "signing"] as const) {
    let current: OutlierWindow | null = null;
    for (const p of [...metrics.series].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) {
      const value = kind === "block" ? p.block_time_s : p.signing_rate;
      const start = Date.parse(p.t);
      if (value === null || !Number.isFinite(value) || !Number.isFinite(start) || !(kind === "block" ? value > THRESHOLDS.blockTime : value < THRESHOLDS.signing)) { current = null; continue; }
      if (current && Math.abs(start - current.end) < step * .1) {
        current.end = Math.min(end, start + step); current.buckets++;
        current.value = kind === "block" ? Math.max(current.value, value) : Math.min(current.value, value);
      } else { current = { start, end: Math.min(end, start + step), kind, value, buckets: 1 }; windows.push(current); }
    }
  }
  const expected = expectedVolume(metrics), unit = metrics.volume.unit === "day" ? 86_400_000 : 3_600_000;
  const firstRecorded = Math.min(...metrics.volume.points.filter(p => p.n > 0).map(p => Date.parse(p.t)));
  if (expected !== null) for (const bucket of volumeBuckets(metrics, end)) {
    const fullBucketExpected = expected * (bucket.end - bucket.t) / unit;
    if (bucket.complete && bucket.t >= firstRecorded && bucket.n < fullBucketExpected * THRESHOLDS.volume) windows.push({ start: bucket.t, end: bucket.end, kind: "volume", value: bucket.n / fullBucketExpected * 100, buckets: 1 });
  }
  return windows.sort((a, b) => b.start - a.start || a.kind.localeCompare(b.kind));
}
