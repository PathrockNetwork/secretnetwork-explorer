import { describe, expect, it } from "vitest";
import type { Validator } from "../src/api";
import { commissionHistogram, commissionStats, directoryRows, isAtRisk, matchesValidatorFilter, stakingStatusSummary } from "../src/validatorDirectory";

const validator = (address: string, rate: number | null = null, extra: Partial<Validator> = {}): Validator => ({
  address, moniker: address, status: "active", watched: false,
  staking: { commission_rate: rate, bond_status: "BOND_STATUS_BONDED", operator_address: `secretvaloper-${address}`, jailed: false, tombstoned: false, missed_blocks_counter: 0 },
  ...extra,
} as Validator);

describe("validator directory", () => {
  it("searches operator addresses and identities while applying the chain bond filter", () => {
    const a = validator("Alpha", .05, { identity: "KeybaseId" });
    const b = validator("Beta", .1, { staking: null });
    expect(directoryRows([a, b], "  SECRETVALOPER-ALPHA ", "bonded", "name", false, null)).toEqual([a]);
    expect(directoryRows([a, b], "keybaseid", "all", "name", false, null)).toEqual([a]);
    expect(matchesValidatorFilter(b, "bonded", null)).toBe(false);
  });

  it("keeps missing metrics last in either sort direction and preserves zero and input order", () => {
    const input = [validator("unknown"), validator("zero", 0), validator("higher", .1)];
    expect(directoryRows(input, "", "all", "commission", false, null).map(v => v.address)).toEqual(["zero", "higher", "unknown"]);
    expect(directoryRows(input, "", "all", "commission", true, null).map(v => v.address)).toEqual(["higher", "zero", "unknown"]);
    expect(input.map(v => v.address)).toEqual(["unknown", "zero", "higher"]);
  });

  it("flags degraded signing or 80% of the jail threshold, excluding already penalized validators", () => {
    const v = validator("near-threshold");
    v.staking!.missed_blocks_counter = 80;
    expect(isAtRisk(v, 100)).toBe(true);
    expect(isAtRisk(v, 101)).toBe(false);
    expect(isAtRisk(v, null)).toBe(false);
    expect(isAtRisk(v, 0)).toBe(false);
    v.status = "degraded";
    expect(isAtRisk(v, null)).toBe(true);
    v.staking!.jailed = true;
    expect(isAtRisk(v, 100)).toBe(false);
    expect(matchesValidatorFilter(v, "jailed", null)).toBe(true);
    v.staking!.jailed = false;
    v.staking!.tombstoned = true;
    expect(isAtRisk(v, 100)).toBe(false);
    expect(matchesValidatorFilter(v, "tombstoned", null)).toBe(true);
  });
});

describe("commission distribution", () => {
  it("fits the observed commission range and counts boundary rates exactly once", () => {
    const histogram = commissionHistogram([0, .04, .06, .2, NaN, -1]);
    expect(histogram.max).toBe(.2);
    expect(histogram.buckets.map((b) => b.count)).toEqual([1, 0, 1, 1, 0, 0, 0, 0, 0, 1]);
    const full = commissionHistogram([0, .5, 1]);
    expect(full.max).toBe(1);
    expect(full.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
    expect(full.buckets[9].count).toBe(1);
    expect(commissionHistogram([]).buckets.every((b) => b.count === 0)).toBe(true);
  });
  it("includes 0% and 100%, excludes unknown or invalid rates, and computes an even median", () => {
    const stats = commissionStats([0, .1, .2, 1, null, NaN, -1, 1.1].map((rate, i) => validator(String(i), rate)));
    expect(stats.values).toEqual([0, .1, .2, 1]);
    expect(stats.buckets.map(b => b.count)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 1]);
    expect(stats.mean).toBeCloseTo(.325);
    expect(stats.median).toBeCloseTo(.15);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(1);
  });
  it("does not turn absent rates into zero commission", () => {
    const stats = commissionStats([validator("unknown")]);
    expect(stats.values).toEqual([]);
    expect(stats.mean).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.buckets.every(b => b.count === 0)).toBe(true);
  });
});

describe("staking status breakdown", () => {
  it("separates unknown records and counts penalized validators only once", () => {
    const bonded = validator("bonded");
    const jailed = validator("jailed");
    jailed.staking!.jailed = true;
    const tombstoned = validator("tombstoned");
    tombstoned.staking!.jailed = true;
    tombstoned.staking!.tombstoned = true;
    const unbonding = validator("unbonding");
    unbonding.staking!.bond_status = "BOND_STATUS_UNBONDING";
    expect(stakingStatusSummary([bonded, jailed, tombstoned, unbonding, validator("unknown", null, { staking: null })])).toEqual({ bonded: 1, unbonding: 1, unbonded: 0, jailed: 1, tombstoned: 1, unknown: 1 });
  });
});
