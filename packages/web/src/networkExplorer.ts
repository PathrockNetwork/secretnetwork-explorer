import type { Endpoint, Validator } from "./api";

export type DirectoryEntry = {
  url: string; source: "configured" | "discovered"; label: string | null;
  healthy: boolean; latency_ms: number | null; last_height: number | null;
  catching_up: boolean | null; earliest_height: number | null;
  first_seen: string | null; last_seen: string | null;
};
export type EndpointFilter = "all" | "configured" | "discovered" | "healthy" | "history" | "saved";
export function matchesEndpoint(entry: DirectoryEntry, filter: EndpointFilter, saved: string[]) {
  return filter === "all" || (filter === "healthy" ? entry.healthy : filter === "history" ? entry.earliest_height !== null && entry.earliest_height > 0 : filter === "saved" ? saved.includes(entry.url) : entry.source === filter);
}
export function filterEndpoints(entries: DirectoryEntry[], query: string, filter: EndpointFilter, saved: string[], sort: string) {
  const q = query.trim().toLowerCase();
  return entries.filter(entry => matchesEndpoint(entry, filter, saved) && (!q || [entry.label, entry.url].some(value => value?.toLowerCase().includes(q))))
    .sort((a, b) => sort === "latency" ? (a.latency_ms ?? Infinity) - (b.latency_ms ?? Infinity) || a.url.localeCompare(b.url) : sort === "height" ? (b.last_height ?? -1) - (a.last_height ?? -1) || a.url.localeCompare(b.url) : Number(b.source === "configured") - Number(a.source === "configured") || Number(b.healthy) - Number(a.healthy) || (a.label ?? a.url).localeCompare(b.label ?? b.url));
}
export function median(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  return known.length ? known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2 : null;
}
export function endpointSummary(entries: DirectoryEntry[]) {
  const heights = entries.filter(e => e.healthy && e.earliest_height !== null && e.earliest_height > 0).map(e => e.earliest_height!);
  return { configured: entries.filter(e => e.source === "configured").length, discovered: entries.filter(e => e.source === "discovered").length, unhealthy: entries.filter(e => !e.healthy).length, median: median(entries.filter(e => e.healthy).map(e => e.latency_ms)), earliest: heights.length ? Math.min(...heights) : null };
}
export function configuredEndpoint(entry: DirectoryEntry, endpoints: Endpoint[]) {
  if (entry.source !== "configured") return null;
  const direct = endpoints.find(e => e.rpc_url === entry.url);
  if (direct) return direct;
  const labels = endpoints.filter(e => entry.label !== null && e.label === entry.label);
  return labels.length === 1 ? labels[0] : null;
}
export type ProbeObservation = { at: number; latency: number | null; healthy: boolean; height: number | null; stamp: string | null };
export function appendObservation(history: ProbeObservation[], observation: ProbeObservation) {
  const recent = history.filter(p => p.at >= observation.at - 3_600_000);
  const previous = recent.at(-1);
  if (previous && previous.latency === observation.latency && previous.healthy === observation.healthy && previous.height === observation.height && previous.stamp === observation.stamp) return recent;
  return [...recent, observation].slice(-360);
}
export function infrastructure(validators: Validator[]) {
  const countries = new Map<string, { name: string; code: string | null; count: number }>();
  const cities = new Map<string, { name: string; country: string | null; code: string | null; count: number }>();
  let located = 0;
  for (const v of validators) {
    const l = v.location;
    if (!l || !(l.country || l.country_code || l.city)) continue;
    located++;
    if (l.country || l.country_code) { const key = l.country_code ?? l.country!; const item = countries.get(key) ?? { name: l.country ?? l.country_code!, code: l.country_code, count: 0 }; item.count++; countries.set(key, item); }
    if (l.city) { const key = JSON.stringify([l.country_code ?? l.country, l.city]); const item = cities.get(key) ?? { name: l.city, country: l.country, code: l.country_code, count: 0 }; item.count++; cities.set(key, item); }
  }
  return { total: validators.length, located, unknown: validators.length - located, unknownCountry: validators.length - [...countries.values()].reduce((sum, c) => sum + c.count, 0), countries: [...countries.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), cities: [...cities.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
}
export function consoleLink(url: string, method: "/status" | "/block" | "/health" = "/status") {
  return `#/rpc/connect?url=${encodeURIComponent(url)}&method=${encodeURIComponent(method)}`;
}
export function rpcConsoleRequest(hash: string): { url: string; method: string } | null {
  if (!hash.startsWith("#/rpc/connect?")) return null;
  const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  const value = params.get("url");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return { url: value, method: ["/status", "/block", "/health"].includes(params.get("method") ?? "") ? params.get("method")! : "/status" };
  } catch { return null; }
}
