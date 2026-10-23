/** Typed client for the Sealed REST API. Shapes mirror packages/api. */

export type Denom = { display: string; base: string; exponent: number };
export type Coin = { denom: string; amount: string };

export type Capabilities = {
  delegations: boolean;
  governance: boolean;
  slashing: boolean;
  poa: boolean;
};

/**
 * Drives which variant every panel renders. `dberror` is synthesised in the
 * client when the API itself is unreachable — the server can hardly report
 * that its own database is down if the request never lands.
 */
export type SystemState = "normal" | "loading" | "empty" | "stopped" | "dberror" | "backfill";

export type Network = {
  chain: {
    slug: string;
    name: string;
    chain_id: string;
    family: string;
    blockscout_url: string | null;
    capabilities: Capabilities;
    bech32_prefix: string | null;
    denom: Denom | null;
  };
  status: Exclude<SystemState, "loading" | "dberror">;
  latest_indexed_height: number | null;
  earliest_indexed_height: number | null;
  blocks_indexed: number;
  blocks_indexed_24h: number;
  last_block_time: string | null;
  avg_block_time_ms: number | null;
  signing_rate_100: number | null;
  /** Share of the set's voting power that committed, trailing 100 blocks. */
  signing_power_online: number | null;
  active_validators: number;
  total_validators: number;
  chain_head_height: number | null;
  indexer_lag_blocks: number | null;
  node_version: string | null;
  head_error: string | null;
  long_window: { target: number; filled: number; complete: boolean };
  vset_bootstrap: boolean;
  active_endpoint: {
    id: number;
    label: string;
    healthy: boolean;
    latency_ms: number | null;
    last_height: number | null;
    pinned: boolean;
  } | null;
  /** Newest 100 blocks, oldest first — backs the per-block signing strip. */
  recent_signing: { height: number; signed: number | null; total: number | null }[];
  last_set_change: { height: number; time: string; type: string } | null;
  updated_at: string;
};

export type ValidatorStatus = "active" | "degraded" | "inactive";

export type Validator = {
  rank: number;
  address: string;
  moniker: string | null;
  /** Keybase identity from the chain's validator description, if any. */
  identity: string | null;
  /** The operator's Keybase avatar, or null — rendered as an identicon. */
  avatar_url: string | null;
  /** Operator-assigned local identity; never overwritten by ingestion. */
  label: string | null;
  /** Marks validators this operator cares about. */
  watched: boolean;
  pub_key: string | null;
  voting_power: number | null;
  is_active: boolean;
  first_seen_height: number | null;
  last_seen_height: number | null;
  last_signed_height: number | null;
  uptime_1000: number | null;
  uptime_10000: number | null;
  slots_1000: number;
  slots_10000: number;
  missed_streak: number;
  proposer_share_1000: number | null;
  /** Exact observed count; optional for compatibility with older API instances. */
  proposed_blocks_1000?: number;
  status: ValidatorStatus;
  /** x/staking + x/slashing view; null on chains without staking or before the first sync. */
  staking: Staking | null;
  /**
   * Where a node with this validator's moniker was last seen peering on the
   * P2P network (observed, not registered — possibly a sentry). null = never
   * observed, an honest unknown.
   */
  location: {
    ip: string | null;
    country_code: string | null;
    country: string | null;
    city: string | null;
    isp: string | null;
    lat: number | null;
    lon: number | null;
    last_seen: string | null;
    source: string | null;
    ips_seen: number;
  } | null;
};

export type Staking = {
  operator_address: string | null;
  website: string | null;
  details: string | null;
  commission_rate: number | null;
  /** Bonded tokens in base denom (string: exceeds Number precision). */
  tokens: string | null;
  min_self_delegation: string | null;
  bond_status: string | null;
  jailed: boolean | null;
  missed_blocks_counter: number | null;
  jailed_until: string | null;
  tombstoned: boolean | null;
  signing_start_height: number | null;
};

export type ValidatorList = {
  count: number;
  windows: { short: number; long: number };
  validators: Validator[];
};

/** `signed: null` means the validator was outside the set at that height. */
export type Slot = { height: number; signed: boolean | null; time: string };

export type ValidatorDetail = { validator: Validator; window: number; slots: Slot[] };

export type SetChange = {
  height: number;
  address: string;
  type: string;
  power_before: number | null;
  power_after: number | null;
  time: string;
};

export type ValidatorSet = {
  set_size: number;
  total_voting_power: number;
  bootstrap: boolean;
  members: Validator[];
  changes: SetChange[];
};

export type SeriesPoint = {
  t: string;
  block_time_s: number | null;
  signing_rate: number | null;
  n: number;
};

export type Metrics = {
  /** Horizon the stats/series/volume cover: 24, 168 or 720 hours. */
  hours: number;
  stats: {
    avg_block_time_s: number | null;
    p95_block_time_s: number | null;
    blocks: number;
    signing_rate: number | null;
  };
  series: SeriesPoint[];
  volume: {
    unit: "hour" | "day";
    points: { t: string; n: number }[];
  };
  proposer_distribution: {
    rank: number;
    address: string;
    share: number | null;
    status: ValidatorStatus;
  }[];
};

export type Series = { minutes: number; points: SeriesPoint[] };

export type Endpoint = {
  id: number;
  label: string;
  rpc_url: string | null;
  ws_url: string | null;
  priority: number;
  is_active: boolean;
  pinned: boolean;
  healthy: boolean;
  last_height: number | null;
  latency_ms: number | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

export type EndpointList = { count: number; endpoints: Endpoint[] };

export type Config = {
  chain: {
    slug: string;
    name: string;
    chain_id: string;
    family: string;
    rpc_url: string | null;
    ws_url: string | null;
    blockscout_url: string | null;
    bech32_prefix: string | null;
    denom: Denom | null;
    lcd_urls: string[];
  };
  capabilities: Capabilities;
  indexer: {
    backfill_depth: number;
    poll_interval_ms: number;
    ingestion: string;
    database: string;
  };
  windows: { short: number; long: number };
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, r.status);
  }
  return r.json() as Promise<T>;
}

export const getNetwork = () => get<Network>("/api/v1/network");

/** One card in the consensus pipeline strip (see /api/v1/consensus/pipeline). */
export type PipelineBlock = {
  height: number;
  hash?: string | null;
  time: string;
  proposer: { address: string; moniker: string | null; avatar_url: string | null } | null;
  tx_count: number | null;
  votes: { signed: number | null; total: number | null };
  /** null on the newest block until its successor's commit arrives. >0 = extra rounds. */
  round: number | null;
};
export const getPipeline = () =>
  get<{ blocks: PipelineBlock[] }>("/api/v1/consensus/pipeline");
export const getBlocks = (limit: number = 25) =>
  get<{ blocks: PipelineBlock[] }>(`/api/v1/blocks?limit=${limit}`);
/** A ciphertext field: only its size is public. */
export type Sealed = { sealed: true; bytes: number };
export const isSealed = (v: unknown): v is Sealed =>
  typeof v === "object" && v !== null && (v as { sealed?: unknown }).sealed === true;

export type Transaction = {
  hash: string;
  height: number | null;
  timestamp: string | null;
  ok: boolean;
  code: number;
  codespace: string | null;
  gas_used: number | null;
  gas_wanted: number | null;
  fee: Coin[];
  memo: string | null;
  signer: string | null;
  /** Human label of the message type(s), e.g. "Execute contract" or "Send +1". */
  type: string;
  message_count: number;
  /** True when any message carries ciphertext. */
  encrypted: boolean;
  contract: string | null;
  contract_label: string | null;
};
export type TxMessage = {
  type: string | null;
  label: string;
  sender: string | null;
  contract: string | null;
  contract_label: string | null;
  encrypted: boolean;
  fields: Record<string, unknown>;
};
export type TxEvent = { type: string; attributes: { key: string | null; value: string | null; sealed: boolean }[] };
export type TransactionDetail = Transaction & {
  messages: TxMessage[];
  data: Sealed | string | null;
  events: TxEvent[];
  raw_log: string | null;
};
export type TransactionPage = {
  transactions: Transaction[];
  /** "yaci" when served from the transaction index, "lcd" for the live fallback, "yaci+lcd" when an address's older txs came from the node while the index backfills. */
  source?: "yaci" | "lcd" | "yaci+lcd";
  /** Block range the index holds; null on the LCD fallback. */
  index?: { earliest: number; latest: number } | null;
  /** Pass as `before` for the next older page; null when there is none. */
  next_before?: number | null;
};
export const getTransactions = (limit: number = 25, opts: { before?: number; address?: string } = {}) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (opts.before) q.set("before", String(opts.before));
  if (opts.address) q.set("address", opts.address);
  return get<TransactionPage>(`/api/v1/transactions?${q}`);
};
export type AccountFunds = {
  address: string;
  account_type: string | null;
  account_number: number | null;
  sequence: number | null;
  balances: Coin[];
  delegations: { validator: string; moniker: string | null; amount: Coin }[];
  rewards: { validator: string; amount: Coin[] }[];
  rewards_total: Coin[];
  unbonding: { validator: string; moniker: string | null; amount: string; completion_time: string | null }[];
  contract: { label: string | null; code_id: number | null; admin: string | null } | null;
};
export const getAccount = (address: string) => get<AccountFunds>(`/api/v1/accounts/${address}`);
export const getBlockTransactions = (height: number) =>
  get<{ transactions: Transaction[]; limit: number }>(`/api/v1/blocks/${height}/transactions`);
export const getTransaction = (hash: string) =>
  get<{ transaction: TransactionDetail }>(`/api/v1/transactions/${encodeURIComponent(hash)}`);

export type Tally = { yes: string; no: string; abstain: string; veto: string };
export type Proposal = {
  id: number;
  status: string;
  title: string | null;
  summary: string | null;
  submit_time: string | null;
  deposit_end_time: string | null;
  voting_start_time: string | null;
  voting_end_time: string | null;
  total_deposit: Coin[];
  expedited: boolean;
  messages: string[];
  proposer: string | null;
  upgrade: { name: string; height: number | null } | null;
  tally: Tally;
};
export type GovParams = {
  quorum: number | null;
  threshold: number | null;
  veto_threshold: number | null;
  expedited_threshold: number | null;
  min_deposit: Coin[];
  expedited_min_deposit: Coin[];
  voting_period_s: number | null;
  expedited_voting_period_s: number | null;
  deposit_period_s: number | null;
};
export type GovernanceData = { proposals: Proposal[]; params: GovParams; updated_at: string };
export const getGovernance = () => get<GovernanceData>("/api/v1/governance");

export type Upgrade = {
  name: string;
  height: number | null;
  info: string | null;
  proposal_id: number | null;
  /** scheduled = plan in x/upgrade; pending_vote = a proposal still voting. */
  status: "scheduled" | "pending_vote";
};
export type SlashingParams = {
  signed_blocks_window: number | null;
  min_signed_per_window: number | null;
  /** Missed blocks in the window above which a validator is jailed. */
  jail_threshold: number | null;
  downtime_jail_duration_s: number | null;
  slash_fraction_downtime: number | null;
  slash_fraction_double_sign: number | null;
};
export type StakingData = {
  pool: { bonded: string; not_bonded: string };
  upgrade: Upgrade | null;
  slashing: SlashingParams | null;
};
export const getStaking = () => get<StakingData>("/api/v1/staking");
export const getValidators = () => get<ValidatorList>("/api/v1/validators");
export const getValidatorSet = () => get<ValidatorSet>("/api/v1/validator-set");
export const getMetrics = (hours: number = 24) => get<Metrics>(`/api/v1/metrics?hours=${hours}`);
export const getConfig = () => get<Config>("/api/v1/config");
export const getEndpoints = () => get<EndpointList>("/api/v1/endpoints");

/** Pin an endpoint (forcing it active) or release it back to auto-selection. */
export async function setEndpointPinned(id: number, pinned: boolean): Promise<Endpoint> {
  const r = await fetch(`/api/v1/endpoints/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
  if (!r.ok) throw new ApiError(`endpoint update failed (${r.status})`, r.status);
  return r.json() as Promise<Endpoint>;
}

export const getValidatorDetail = (address: string, window: number) =>
  get<ValidatorDetail>(`/api/v1/validators/${encodeURIComponent(address)}?window=${window}`);

/** Set (or clear) a validator's local label and/or watched flag. */
export async function updateValidatorIdentity(
  address: string,
  patch: { label?: string | null; watched?: boolean },
): Promise<{ address: string; moniker: string | null; label: string | null; watched: boolean }> {
  const r = await fetch(`/api/v1/validators/${encodeURIComponent(address)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new ApiError(`validator update failed (${r.status})`, r.status);
  return r.json();
}

export const getSeries = (minutes: number, buckets: number) =>
  get<Series>(`/api/v1/series?minutes=${minutes}&buckets=${buckets}`);
