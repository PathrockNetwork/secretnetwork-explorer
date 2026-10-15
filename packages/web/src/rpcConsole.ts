export type ParamKind = "num" | "str" | "bool" | "numOrLatest";
export type ParamSpec = { key: string; label: string; kind: ParamKind; placeholder?: string; hint?: string };
export type MethodSpec = { group: string; path: string; params: ParamSpec[]; note?: string };

export const RPC_METHODS: MethodSpec[] = [
  { group: "Node", path: "/status", params: [] },
  { group: "Node", path: "/health", params: [] },
  { group: "Node", path: "/net_info", params: [] },
  {
    group: "Node",
    path: "/genesis",
    params: [],
    note: "the full genesis document — the answer is very large",
  },
  { group: "Node", path: "/abci_info", params: [] },
  {
    group: "Blocks",
    path: "/block",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/block_results",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/commit",
    params: [{ key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" }],
  },
  {
    group: "Blocks",
    path: "/blockchain",
    params: [
      { key: "minHeight", label: "min height", kind: "num", placeholder: "1" },
      { key: "maxHeight", label: "max height", kind: "num", placeholder: "10" },
    ],
  },
  {
    group: "Validators",
    path: "/validators",
    params: [
      { key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" },
      { key: "page", label: "page", kind: "num", placeholder: "1" },
      { key: "per_page", label: "per page", kind: "num", placeholder: "30" },
    ],
  },
  {
    group: "Mempool",
    path: "/unconfirmed_txs",
    params: [{ key: "limit", label: "limit", kind: "num", placeholder: "30" }],
  },
  { group: "Mempool", path: "/num_unconfirmed_txs", params: [] },
  {
    group: "Transactions",
    path: "/tx",
    params: [
      { key: "hash", label: "hash", kind: "str", placeholder: "0x…", hint: "transaction hash" },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
    ],
  },
  {
    group: "Transactions",
    path: "/tx_search",
    params: [
      {
        key: "query",
        label: "query",
        kind: "str",
        placeholder: "tx.height=11695926",
        hint: "CometBFT query syntax",
      },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
      { key: "page", label: "page", kind: "num", placeholder: "1" },
      { key: "per_page", label: "per page", kind: "num", placeholder: "30" },
    ],
  },
  { group: "Consensus", path: "/consensus_state", params: [] },
  { group: "Consensus", path: "/dump_consensus_state", params: [] },
  {
    group: "Raw ABCI",
    path: "/abci_query",
    params: [
      { key: "path", label: "path", kind: "str", placeholder: "/cosmos.bank.v1beta1..." },
      { key: "data", label: "data", kind: "str", placeholder: "0x", hint: "hex-encoded request" },
      { key: "height", label: "height", kind: "numOrLatest", placeholder: "latest" },
      { key: "prove", label: "prove", kind: "bool", placeholder: "false" },
    ],
    note: "raw module queries — e.g. /cosmos.staking.v1beta1.Query/Validators with protobuf-encoded data",
  },
];

export const PUBLIC_RPC = "https://rpc.secret.mainnet.secret3.dev";
export const RPC_DESCRIPTIONS: Record<string, string> = {
  "/status": "Get node status and sync information", "/health": "Check the node's health response", "/net_info": "Inspect peers and network connections",
  "/block": "Get a block at a height or the latest block", "/block_results": "Inspect block execution results", "/commit": "Get the signed commit for a block", "/blockchain": "Read block headers across a height range",
  "/validators": "Get the validator set at a block height", "/tx": "Look up a transaction by its hash", "/tx_search": "Search indexed transaction events",
  "/consensus_state": "Inspect the current consensus round", "/dump_consensus_state": "Inspect detailed consensus state", "/abci_query": "Query application state with encoded data",
  "/abci_info": "Get application version and state information", "/genesis": "Read the full genesis document", "/unconfirmed_txs": "Inspect transactions in the mempool", "/num_unconfirmed_txs": "Get the current mempool count",
};
export const POPULAR_METHODS = ["/status", "/health", "/net_info", "/block", "/validators", "/tx_search", "/consensus_state", "/abci_query"];
export const RPC_CATEGORIES: Record<string, string[] | null> = { Popular: null, Blockchain: ["Blocks"], Transactions: ["Transactions"], Validators: ["Validators"], Mempool: ["Mempool"], Network: ["Node"], Consensus: ["Consensus"], ABCI: ["Raw ABCI"], All: [] };
export function methodList(category: string, query: string) {
  const q = query.trim().toLowerCase();
  return RPC_METHODS.filter(method => (q || category === "All" || (category === "Popular" ? POPULAR_METHODS.includes(method.path) : RPC_CATEGORIES[category]?.includes(method.group))) && (!q || `${method.path} ${RPC_DESCRIPTIONS[method.path] ?? ""}`.toLowerCase().includes(q)));
}
export function normalizeEndpoint(raw: string): { url: string; error?: never } | { error: string; url?: never } {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return { error: "Use an HTTP or HTTPS RPC endpoint." };
    if (url.username || url.password) return { error: "Enter an endpoint without embedded credentials." };
    if (url.search || url.hash) return { error: "Enter the RPC base URL without a query string or fragment." };
    return { url: url.toString().replace(/\/+$/, "") };
  } catch { return { error: "Enter a valid RPC endpoint URL." }; }
}
export function parameterObject(method: MethodSpec, values: Record<string, string>): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const p of method.params) {
    const value = (values[p.key] ?? "").trim();
    if (!value || (p.kind === "numOrLatest" && value.toLowerCase() === "latest")) continue;
    result[p.key] = p.kind === "bool" && ["true", "false"].includes(value) ? value === "true" : value;
  }
  return result;
}
export function compileParams(method: MethodSpec, values: Record<string, string>, raw: string | null = null): { params: Record<string, string>; error?: never } | { error: string; params?: never } {
  let input: Record<string, unknown>;
  if (raw !== null) {
    try { const parsed: unknown = JSON.parse(raw); if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return { error: "Raw parameters must be a JSON object." }; input = parsed as Record<string, unknown>; }
    catch { return { error: "Enter valid JSON parameters." }; }
  } else input = parameterObject(method, values);
  for (const key of Object.keys(input)) if (!method.params.some(p => p.key === key)) return { error: `Unknown parameter: ${key}.` };
  const params: Record<string, string> = {};
  for (const p of method.params) {
    const original = input[p.key];
    if (original === undefined || original === "") continue;
    if (original === null || !["string", "number", "boolean"].includes(typeof original)) return { error: `${p.label} must be a scalar value.` };
    const value = String(original).trim();
    if (p.kind === "numOrLatest" && (!value || value.toLowerCase() === "latest")) continue;
    if (p.kind === "num" || p.kind === "numOrLatest") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return { error: `${p.label} must be a non-negative safe integer.` };
      const n = Number(value);
      if ((p.key === "page" || p.key === "per_page" || p.key === "limit") && n < 1) return { error: `${p.label} must be at least 1.` };
      if ((p.key === "per_page" || p.key === "limit") && n > 100) return { error: `${p.label} must be 100 or less.` };
      params[p.key] = value;
    } else if (p.kind === "bool") {
      if (!["true", "false"].includes(value)) return { error: `${p.label} must be true or false.` };
      params[p.key] = value;
    } else {
      if (typeof original !== "string") return { error: `${p.label} must be a string.` };
      params[p.key] = JSON.stringify(value);
    }
  }
  const required = method.path === "/tx" ? "hash" : method.path === "/tx_search" ? "query" : null;
  if (required && !(typeof input[required] === "string" && input[required].trim())) return { error: `${required} is required for ${method.path}.` };
  if (method.path === "/tx" && !/^(0x)?[a-fA-F0-9]{64}$/.test(String(input.hash).trim())) return { error: "Enter a 64-character hexadecimal transaction hash, optionally prefixed with 0x." };
  if (method.path === "/blockchain" && params.minHeight && params.maxHeight && Number(params.minHeight) > Number(params.maxHeight)) return { error: "Min height must not exceed max height." };
  return { params };
}
export function formFromRaw(method: MethodSpec, raw: string): Record<string, string> | null {
  if (compileParams(method, {}, raw).error) return null;
  const object = JSON.parse(raw) as Record<string, string | number | boolean>;
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, String(value)]));
}
