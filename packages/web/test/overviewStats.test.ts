import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../src/api";
import { blockTimeSummary, previousHourChange } from "../src/overviewStats";

const now = Date.parse("2026-10-14T12:00:00Z");
const point = (minute: number, value: number | null): SeriesPoint => ({
  t: new Date(now + minute * 60_000).toISOString(), block_time_s: value, signing_rate: 100, n: 10,
});

describe("overview block-time statistics", () => {
  it("ignores gaps and invalid timings instead of treating them as zero", () => {
    expect(blockTimeSummary([point(-5, 5), point(-4, null), point(-3, 0), point(-2, NaN), point(-1, 7)]))
      .toEqual({ count: 2, min: 5, avg: 6, max: 7, latest: 7 });
    expect(blockTimeSummary([])).toEqual({ count: 0, min: null, avg: null, max: null, latest: null });
  });
  it("compares adjacent hours without including the current hour in the baseline", () => {
    const current = Array.from({ length: 60 }, (_, i) => point(i - 60, 6));
    const previous = Array.from({ length: 60 }, (_, i) => point(i - 120, 8));
    expect(previousHourChange(current, [...previous, ...current, point(-121, 100)], now)).toBe(-25);
  });
  it("withholds a comparison when either hour has insufficient observed minutes", () => {
    const current = Array.from({ length: 60 }, (_, i) => point(i - 60, 6));
    const prior = Array.from({ length: 44 }, (_, i) => point(i - 120, 8));
    expect(previousHourChange(current, prior, now)).toBeNull();
    expect(previousHourChange(current.slice(0, 44), [...prior, point(-61, 8)], now)).toBeNull();
  });
});
