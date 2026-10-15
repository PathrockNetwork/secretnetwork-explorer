import { describe, expect, it } from "vitest";
import type { Metrics } from "../src/api";
import { bucketMs, chartDomain, chartSegments, outlierWindows, volumeBuckets } from "../src/analyticsExplorer";

const end = Date.parse("2026-10-14T12:30:00Z");
const metrics = (extra: Partial<Metrics> = {}): Metrics => ({ hours: 24, stats: { avg_block_time_s: 6, p95_block_time_s: 6, blocks: 14400, signing_rate: 100 }, series: [], volume: { unit: "hour", points: Array.from({ length: 25 }, (_, i) => ({ t: new Date(end - 24 * 3_600_000 - 30 * 60_000 + i * 3_600_000).toISOString(), n: i === 0 || i === 24 ? 300 : 600 })) }, proposer_distribution: [], ...extra });

describe("analytics measurements", () => {
  it("breaks chart lines across nulls and missing time buckets", () => {
    const points = [{ t: 0, value: 6 }, { t: 1000, value: null }, { t: 2000, value: 7 }, { t: 3000, value: 8 }, { t: 6000, value: 9 }];
    expect(chartSegments(points, 1000).map(s => s.map(p => p.value))).toEqual([[6], [7, 8], [9]]);
  });
  it("expands chart axes to retain high block times and low signing rates", () => {
    expect(chartDomain([{ t: 0, value: 42 }], false)[1]).toBeGreaterThan(42);
    expect(chartDomain([{ t: 0, value: 70 }], true)[0]).toBeLessThan(70);
    expect(chartDomain([], false)).toEqual([0, 10]);
    expect(chartDomain([{ t: 0, value: null }], true)).toEqual([99, 100]);
  });
  it("separates partial calendar buckets from complete low-volume windows", () => {
    const m = metrics();
    const buckets = volumeBuckets(m, end);
    expect(buckets).toHaveLength(25);
    expect(buckets.filter(b => !b.complete)).toHaveLength(2);
    expect(outlierWindows(m, end)).toEqual([]);
    m.volume.points.splice(12, 1);
    expect(volumeBuckets(m, end)[12].n).toBe(0);
    expect(outlierWindows(m, end)).toMatchObject([{ kind: "volume", value: 0, buckets: 1 }]);
  });
  it("groups adjacent threshold breaches without bridging missing samples", () => {
    const step = bucketMs(24), start = end - 8 * step;
    const m = metrics({ series: [8, 9, null, 10, 6, 8].map((value, i) => ({ t: new Date(start + i * step).toISOString(), block_time_s: value, signing_rate: i === 4 ? 98 : 100, n: 200 })) });
    const windows = outlierWindows(m, end);
    expect(windows.filter(w => w.kind === "block").map(w => [w.buckets, w.value])).toEqual([[1, 8], [1, 10], [2, 9]]);
    expect(windows.find(w => w.kind === "signing")?.value).toBe(98);
    expect(windows.find(w => w.buckets === 2)?.end).toBe(start + 2 * step);
  });
  it("does not infer low-volume incidents when block timing is unavailable", () => {
    const m = metrics({ stats: { avg_block_time_s: null, p95_block_time_s: null, blocks: 0, signing_rate: null }, volume: { unit: "hour", points: [] } });
    expect(outlierWindows(m, end)).toEqual([]);
    expect(bucketMs(168)).toBe(84 * 60_000);
    expect(bucketMs(720)).toBe(6 * 3_600_000);
  });
  it("preserves non-UTC daily boundaries and does not flag dates before indexed history", () => {
    const m = metrics({ hours: 168, volume: { unit: "day", points: [{ t: "2026-10-12T22:00:00Z", n: 14400 }, { t: "2026-10-13T22:00:00Z", n: 8700 }] } });
    expect(volumeBuckets(m, end).reduce((sum, p) => sum + p.n, 0)).toBe(23100);
    expect(volumeBuckets(m, end).find(p => p.n === 14400)?.t).toBe(Date.parse("2026-10-12T22:00:00Z"));
    expect(outlierWindows(m, end)).toEqual([]);
  });
  it("keeps a shifted daily boundary across daylight-saving changes", () => {
    const m = metrics({ hours: 168, volume: { unit: "day", points: [{ t: "2026-10-23T22:00:00Z", n: 14400 }, { t: "2026-10-24T22:00:00Z", n: 15000 }, { t: "2026-10-25T23:00:00Z", n: 14400 }] } });
    const buckets = volumeBuckets(m, Date.parse("2026-10-26T12:00:00Z"));
    expect(buckets.reduce((sum, p) => sum + p.n, 0)).toBe(43800);
    const shifted = buckets.find(p => p.n === 15000)!;
    expect(shifted.end - shifted.t).toBe(25 * 3_600_000);
  });
});
