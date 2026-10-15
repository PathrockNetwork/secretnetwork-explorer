import { describe, expect, it } from "vitest";
import type { Endpoint, Validator } from "../src/api";
import { appendObservation, configuredEndpoint, consoleLink, endpointSummary, filterEndpoints, infrastructure, median, rpcConsoleRequest, type DirectoryEntry } from "../src/networkExplorer";

const entry = (url: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => ({ url, source: "discovered", label: url, healthy: true, latency_ms: null, last_height: null, catching_up: null, earliest_height: null, first_seen: null, last_seen: null, ...extra });

describe("network directory", () => {
  it("uses only measured healthy endpoints for latency and available history", () => {
    const rows = [entry("one", { source: "configured", latency_ms: 100 }), entry("two", { latency_ms: 200, earliest_height: 1000 }), entry("three", { healthy: false, latency_ms: 1, earliest_height: 1 }), entry("four", { earliest_height: 0 })];
    expect(endpointSummary(rows)).toEqual({ configured: 1, discovered: 3, unhealthy: 1, median: 150, earliest: 1000 });
    expect(median([null, NaN, -1])).toBeNull();
    expect(endpointSummary([]).earliest).toBeNull();
  });
  it("combines filters and searches without treating unknown history as pruned", () => {
    const rows = [entry("https://one.example", { source: "configured", label: "Secret", latency_ms: 300 }), entry("https://two.example", { label: "Archive", earliest_height: 100, latency_ms: 100 })];
    expect(filterEndpoints(rows, "ARCH", "history", [], "default").map(e => e.label)).toEqual(["Archive"]);
    expect(filterEndpoints(rows, "", "saved", [rows[0].url], "default")).toEqual([rows[0]]);
    expect(filterEndpoints(rows, "", "all", [], "latency").map(e => e.label)).toEqual(["Archive", "Secret"]);
    expect(rows.map(e => e.label)).toEqual(["Secret", "Archive"]);
  });
  it("does not guess configured telemetry when labels are ambiguous", () => {
    const row = entry("https://rpc.example", { source: "configured", label: "Secret" });
    const endpoints = [{ label: "Secret", rpc_url: null }, { label: "Secret", rpc_url: null }] as Endpoint[];
    expect(configuredEndpoint(row, endpoints)).toBeNull();
    expect(configuredEndpoint(row, endpoints.slice(0, 1))).toBe(endpoints[0]);
    expect(configuredEndpoint({ ...row, source: "discovered" }, endpoints)).toBeNull();
  });
  it("does not fabricate repeated probe history from identical cached observations", () => {
    const first = { at: 1, latency: 100, healthy: true, height: 5, stamp: null };
    expect(appendObservation([first], { ...first, at: 10 })).toEqual([first]);
    expect(appendObservation([first], { ...first, at: 20, healthy: false })).toHaveLength(2);
    expect(appendObservation([first], { ...first, at: 3_600_002 })).toEqual([{ ...first, at: 3_600_002 }]);
  });
  it("keeps cities in different countries distinct and unknown locations visible", () => {
    const validators = [{ location: { city: "Springfield", country: "USA", country_code: "US" } }, { location: { city: "Springfield", country: "Canada", country_code: "CA" } }, { location: null }] as Validator[];
    const result = infrastructure(validators);
    expect(result.located).toBe(2);
    expect(result.unknown).toBe(1);
    expect(result.unknownCountry).toBe(1);
    expect(result.cities).toHaveLength(2);
  });
  it("hands an endpoint and read-only method to the console without permitting script URLs or credentials", () => {
    expect(rpcConsoleRequest(consoleLink("https://rpc.example/base?x=1", "/block"))).toEqual({ url: "https://rpc.example/base?x=1", method: "/block" });
    expect(rpcConsoleRequest(consoleLink("javascript:alert(1)"))).toBeNull();
    expect(rpcConsoleRequest(consoleLink("https://user:pass@rpc.example"))).toBeNull();
    expect(rpcConsoleRequest("#/rpc/connect?url=https%3A%2F%2Frpc.example&method=%2Fbroadcast_tx_sync")?.method).toBe("/status");
  });
});
