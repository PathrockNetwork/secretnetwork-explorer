import type { SeriesPoint } from "./api";

/** Statistics describe observed one-minute averages; gaps are never zeroes. */
export function blockTimeSummary(points: SeriesPoint[]) {
  const values = points.map((p) => p.block_time_s).filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    avg: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null,
    max: values.length ? Math.max(...values) : null,
    latest: values.at(-1) ?? null,
  };
}

export function previousHourChange(current: SeriesPoint[], history: SeriesPoint[], now: number) {
  const cutoff = now - 3_600_000;
  const prior = blockTimeSummary(history.filter((p) => {
    const t = Date.parse(p.t);
    return t >= cutoff - 3_600_000 && t < cutoff;
  }));
  const recent = blockTimeSummary(current.filter((p) => Date.parse(p.t) >= cutoff && Date.parse(p.t) <= now));
  // Require at least 45 observed minutes in each hour for a useful comparison.
  if (recent.count < 45 || prior.count < 45 || recent.avg === null || prior.avg === null) return null;
  return (recent.avg - prior.avg) / prior.avg * 100;
}
