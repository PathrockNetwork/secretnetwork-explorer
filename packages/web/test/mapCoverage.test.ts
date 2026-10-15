import { describe, expect, it } from "vitest";
import type { Validator } from "../src/api";
import { mapCoverage } from "../src/mapCoverage";

function validator(address: string, lat: number | null, lon: number | null, country = "US"): Validator {
  return { address, status: "active", location: { lat, lon, city: "Springfield", country_code: country } } as Validator;
}

describe("map coverage", () => {
  it("accounts for every validator without plotting missing or invalid coordinates", () => {
    const validators = [
      validator("origin", 0, 0), validator("edge", -90, 180),
      validator("no-lat", null, 10), validator("no-lon", 10, null),
      validator("nan", NaN, 10), validator("infinite", 10, Infinity),
      validator("bad-lat", 91, 0), validator("bad-lon", 0, -181),
      { address: "unobserved", location: null } as Validator,
    ];
    const { placed, unplaced } = mapCoverage(validators);
    expect(placed.map((v) => v.address)).toEqual(["origin", "edge"]);
    expect(unplaced).toHaveLength(7);
    expect(new Set([...placed, ...unplaced].map((v) => v.address)).size).toBe(validators.length);
  });

  it("retains validators that share coordinates and distinguishes cities in different countries", () => {
    const coverage = mapCoverage([
      validator("a", 40, -80), validator("b", 40, -80), validator("c", -30, 150, "AU"),
    ]);
    expect(coverage.placed).toHaveLength(3);
    expect(coverage.unplaced).toHaveLength(0);
    expect(coverage.countries).toBe(2);
    expect(coverage.cities).toBe(2);
  });
});
