import { describe, expect, it } from "vitest";
import type { Validator } from "../src/api";
import { validatorSummary } from "../src/validatorSummary";

const v = (address: string, status: Validator["status"], share: number | null) =>
  ({ address, status, proposer_share_1000: share }) as Validator;

describe("validator set summary", () => {
  it("counts all statuses and ranks only observed proposer shares without changing table order", () => {
    const input = [v("a", "active", 10), v("b", "inactive", null), v("c", "degraded", 40), v("d", "active", 0)];
    const result = validatorSummary(input);
    expect(result.counts).toEqual({ active: 2, degraded: 1, inactive: 1 });
    expect(result.total).toBe(4);
    expect(result.proposers.map((v) => v.address)).toEqual(["c", "a", "d"]);
    expect(input.map((v) => v.address)).toEqual(["a", "b", "c", "d"]);
  });
  it("limits the ranking to five and handles an empty set", () => {
    expect(validatorSummary(Array.from({ length: 8 }, (_, i) => v(String(i), "active", i))).proposers.map((v) => v.address)).toEqual(["7", "6", "5", "4", "3"]);
    expect(validatorSummary([])).toEqual({ counts: { active: 0, degraded: 0, inactive: 0 }, proposers: [], total: 0 });
  });
});
