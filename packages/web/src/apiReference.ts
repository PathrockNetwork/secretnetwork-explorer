/** This catalog describes routes implemented by the explorer, not upstream LCD/RPC routes. */
export type ApiParameter = { name: string; location: "path" | "query"; description: string; default?: string; min?: number; max?: number; choices?: string[]; pattern?: RegExp };
export type ApiEndpoint = { id: string; method: "GET" | "PATCH"; path: string; title: string; description: string; category: string; tags: string[]; overview?: boolean; parameters?: ApiParameter[]; body?: Record<string, unknown> };
const limit: ApiParameter = { name: "limit", location: "query", default: "25", min: 1, max: 100, description: "Maximum records returned (1–100)." };
const address: ApiParameter = { name: "address", location: "path", pattern: /^[a-fA-F0-9]{40}$/, description: "40-character hexadecimal consensus address; not a secretvaloper address." };
export const API_CATEGORIES = ["Overview", "Validators", "Blocks", "Transactions", "Governance", "Network", "Analytics", "Operator"];
export const API_ENDPOINTS: ApiEndpoint[] = [
  { id: "health", method: "GET", path: "/health", title: "API health", description: "Check whether the API process is responding and read its uptime in seconds.", category: "Network", tags: ["health", "service"], overview: true },
  { id: "validators", method: "GET", path: "/api/v1/validators", title: "Validator list", description: "Get validators with identities, signing uptime, missed streaks, proposer share, and staking information.", category: "Validators", tags: ["validators", "staking"], overview: true },
  { id: "validator", method: "GET", path: "/api/v1/validators/:address", title: "Validator details", description: "Inspect a validator and the signing slots behind its uptime history. A null signing slot means it was outside the set.", category: "Validators", tags: ["validators", "signing"], overview: true, parameters: [address, { name: "window", location: "query", default: "500", min: 1, max: 5000, description: "Number of signing slots (1–5,000)." }] },
  { id: "blocks", method: "GET", path: "/api/v1/blocks", title: "Recent blocks", description: "Read the newest indexed blocks, including hashes, proposers, transaction counts, and consensus signatures.", category: "Blocks", tags: ["blocks", "consensus"], overview: true, parameters: [limit] },
  { id: "transaction", method: "GET", path: "/api/v1/transactions/:hash", title: "Transaction details", description: "Look up one transaction by hash. Secret contract inputs and encrypted outputs are reported as sealed data.", category: "Transactions", tags: ["transactions", "sealed"], overview: true, parameters: [{ name: "hash", location: "path", pattern: /^[a-fA-F0-9]{64}$/, description: "64-character hexadecimal transaction hash, without a 0x prefix." }] },
  { id: "governance", method: "GET", path: "/api/v1/governance", title: "Governance proposals", description: "Read the newest 30 proposals, live voting tallies, and governance tally and deposit parameters.", category: "Governance", tags: ["governance", "proposals"], overview: true },
  { id: "network", method: "GET", path: "/api/v1/network", title: "Network overview", description: "Read indexed height, signing rate, average block time, active validators, and lag against the chain head.", category: "Network", tags: ["network", "consensus"], overview: true },
  { id: "directory", method: "GET", path: "/api/v1/rpc-directory", title: "RPC directory", description: "List discovered RPC endpoints with the health and location observations available to this explorer.", category: "Network", tags: ["network", "endpoints"], overview: true },
  { id: "metrics", method: "GET", path: "/api/v1/metrics", title: "Analytics summary", description: "Get block time, signing rate, indexed volume, bucketed history, and proposer distribution for a trailing horizon.", category: "Analytics", tags: ["analytics", "metrics"], overview: true, parameters: [{ name: "hours", location: "query", default: "24", choices: ["24", "168", "720"], description: "Trailing horizon: 24 hours, 7 days, or 30 days." }] },
  { id: "set", method: "GET", path: "/api/v1/validator-set", title: "Validator set", description: "Read current consensus membership and validator additions and removals.", category: "Validators", tags: ["validators", "membership"] },
  { id: "staking", method: "GET", path: "/api/v1/staking", title: "Staking parameters", description: "Get the bonded pool, slashing parameters, derived jail threshold, and upcoming software upgrade.", category: "Validators", tags: ["staking", "slashing"] },
  { id: "block-transactions", method: "GET", path: "/api/v1/blocks/:height/transactions", title: "Transactions in a block", description: "Read transactions at a specific height through the LCD. The response includes a limit of 100.", category: "Blocks", tags: ["blocks", "transactions"], parameters: [{ name: "height", location: "path", min: 1, max: Number.MAX_SAFE_INTEGER, description: "Positive integer block height." }] },
  { id: "pipeline", method: "GET", path: "/api/v1/consensus/pipeline", title: "Consensus pipeline", description: "Read the latest indexed consensus activity, block rounds, signatures, and timing.", category: "Blocks", tags: ["consensus", "pipeline"] },
  { id: "transactions", method: "GET", path: "/api/v1/transactions", title: "Recent transactions", description: "Read recent transactions from the newest indexed blocks through the chain LCD. Encrypted compute messages remain sealed.", category: "Transactions", tags: ["transactions", "recent"], parameters: [limit] },
  { id: "endpoints", method: "GET", path: "/api/v1/endpoints", title: "Indexer endpoint health", description: "Inspect endpoint latency, health, and rotation state. Infrastructure details are redacted on the public API.", category: "Network", tags: ["network", "indexer"] },
  { id: "config", method: "GET", path: "/api/v1/config", title: "Chain configuration", description: "Read chain identity, supported capabilities, indexer settings, and signing windows. Private node URLs are hidden on the public API.", category: "Network", tags: ["network", "configuration"] },
  { id: "series", method: "GET", path: "/api/v1/series", title: "Time series", description: "Read bucketed block time, signing rate, and block counts over a trailing window.", category: "Analytics", tags: ["analytics", "series"], parameters: [{ name: "minutes", location: "query", default: "60", min: 1, max: 1440, description: "Trailing window in minutes (1–1,440)." }, { name: "buckets", location: "query", default: "60", min: 2, max: 240, description: "Number of time buckets (2–240)." }] },
  { id: "market", method: "GET", path: "/api/v1/market", title: "SCRT market data", description: "Get SCRT/USD and its 24-hour change from CoinGecko, cached for one minute.", category: "Analytics", tags: ["market", "SCRT"] },
  { id: "label", method: "PATCH", path: "/api/v1/validators/:address", title: "Local validator identity", description: "Set or clear an operator-local label and watched flag. This mutation is refused on the public API.", category: "Operator", tags: ["operator only", "local labels"], body: { label: "our-mainnet-node", watched: true } },
  { id: "pin", method: "PATCH", path: "/api/v1/endpoints/:id", title: "Pin an indexer endpoint", description: "Pin an endpoint or release it to automatic selection. This mutation is refused on the public API.", category: "Operator", tags: ["operator only", "endpoint rotation"], body: { pinned: true } },
];
export function filterApiEndpoints(category: string, search: string): ApiEndpoint[] {
  const q = search.trim().toLowerCase();
  return API_ENDPOINTS.filter(e => (q ? `${e.method} ${e.path} ${e.title} ${e.description} ${e.tags.join(" ")}`.toLowerCase().includes(q) : category === "Overview" ? e.overview : e.category === category));
}
export function apiRequestPath(endpoint: ApiEndpoint, values: Record<string, string>): { path: string; error?: never } | { error: string; path?: never } {
  if (endpoint.method !== "GET") return { error: "Operator mutations are documentation only." };
  let path = endpoint.path;
  const query = new URLSearchParams();
  for (const p of endpoint.parameters ?? []) {
    const value = (values[p.name] ?? p.default ?? "").trim();
    if (!value && p.location === "query") continue;
    if (!value) return { error: `${p.name} is required.` };
    if (p.pattern && !p.pattern.test(value)) return { error: `${p.name}: ${p.description}` };
    if (p.choices && !p.choices.includes(value)) return { error: `${p.name} must be ${p.choices.join(", ")}.` };
    if (p.min !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < p.min || Number(value) > p.max!)) return { error: `${p.name} must be a whole number between ${p.min.toLocaleString("en-US")} and ${p.max!.toLocaleString("en-US")}.` };
    if (p.location === "path") path = path.replace(`:${p.name}`, encodeURIComponent(value)); else query.set(p.name, value);
  }
  return { path: path + (query.size ? `?${query}` : "") };
}
export function apiCurl(origin: string, path: string): string {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return `curl --request GET \\\n  --url ${quote(origin + path)} \\\n  --header 'Accept: application/json'`;
}
/** Preview only: copying always uses the untouched response. */
export function apiPreview(body: string, maxLines = 7): string {
  const lines = body.split("\n");
  const preview = lines.slice(0, maxLines).map(line => line.length > 240 ? line.slice(0, 240) + "…" : line).join("\n");
  return preview + (lines.length > maxLines ? `\n… ${lines.length - maxLines} more lines` : "");
}
