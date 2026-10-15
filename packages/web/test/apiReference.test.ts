import { describe, expect, it } from "vitest";
import { API_ENDPOINTS, apiCurl, apiPreview, apiRequestPath, filterApiEndpoints } from "../src/apiReference";
const endpoint = (id: string) => API_ENDPOINTS.find(e => e.id === id)!;
describe("API reference requests", () => {
  it("finds routes across categories and separates operator documentation", () => {
    expect(filterApiEndpoints("Overview", "")).toHaveLength(9);
    expect(filterApiEndpoints("Overview", "/api/v1/series").map(e => e.id)).toEqual(["series"]);
    expect(filterApiEndpoints("Operator", "").every(e => e.method === "PATCH")).toBe(true);
    expect(filterApiEndpoints("Network", "").every(e => e.category === "Network")).toBe(true);
  });
  it("builds route parameters and optional query values for actual endpoints", () => {
    expect(apiRequestPath(endpoint("validator"), { address: "ab".repeat(20), window: "1000" }).path).toBe(`/api/v1/validators/${"ab".repeat(20)}?window=1000`);
    expect(apiRequestPath(endpoint("blocks"), {}).path).toBe("/api/v1/blocks?limit=25");
    expect(apiRequestPath(endpoint("blocks"), { limit: "" }).path).toBe("/api/v1/blocks");
    expect(apiRequestPath(endpoint("block-transactions"), { height: "100" }).path).toBe("/api/v1/blocks/100/transactions");
  });
  it("rejects missing or malformed identities and path injection", () => {
    for (const hash of ["", "abc", "0x" + "ab".repeat(32), "../network", "ab".repeat(32) + "?limit=1"]) expect(apiRequestPath(endpoint("transaction"), { hash }).error).toBeTruthy();
    expect(apiRequestPath(endpoint("transaction"), { hash: "ab".repeat(32) }).path).toBe(`/api/v1/transactions/${"ab".repeat(32)}`);
    expect(apiRequestPath(endpoint("validator"), { address: "secretvaloper1foo" }).error).toBeTruthy();
  });
  it("enforces endpoint limits, integer heights, and fixed metric horizons", () => {
    for (const limit of ["0", "101", "2.5", "NaN", "1e2", "-1"]) expect(apiRequestPath(endpoint("blocks"), { limit }).error).toBeTruthy();
    expect(apiRequestPath(endpoint("metrics"), { hours: "168" }).path).toBe("/api/v1/metrics?hours=168");
    expect(apiRequestPath(endpoint("metrics"), { hours: "17" }).error).toBeTruthy();
    expect(apiRequestPath(endpoint("series"), { buckets: "1" }).error).toBeTruthy();
    expect(apiRequestPath(endpoint("block-transactions"), { height: "9007199254740992" }).error).toBeTruthy();
  });
  it("never produces executable requests for operator mutations", () => {
    expect(apiRequestPath(endpoint("label"), {}).error).toBeTruthy();
    expect(apiRequestPath(endpoint("pin"), {}).error).toBeTruthy();
  });
  it("quotes cURL safely and keeps preview limits separate from full JSON", () => {
    expect(apiCurl("https://example.org", "/api/v1/series?minutes=60&buckets=12")).toContain("--url 'https://example.org/api/v1/series?minutes=60&buckets=12'");
    expect(apiCurl("https://example.org", "/a'b")).toContain("/a'\\''b'");
    const body = JSON.stringify({ values: Array.from({ length: 30 }, (_, i) => i) }, null, 2);
    expect(apiPreview(body)).toContain("more lines");
    expect(JSON.parse(body).values).toHaveLength(30);
  });
});
