/**
 * Read-through views over the chain's Cosmos LCD: transactions, governance,
 * staking pool and contract labels.
 *
 * Nothing here is indexed. The indexer owns consensus data (blocks,
 * signatures); these routes are thin, cached proxies so the dashboard can show
 * tx-level and governance detail without the browser talking to a third party.
 *
 * Secret-aware but chain-agnostic: on Secret, `/secret.compute.*` messages
 * carry an encrypted `msg` and `wasm` events carry encrypted attributes. Those
 * fields are reported as sealed (with their size) rather than decoded, because
 * only the sender's wallet holds the key. Everything else is plain Cosmos.
 */

/** LCD GETs, trying each base URL in order and preferring the last that answered. */
export class Lcd {
  private preferred: string | undefined;

  constructor(private readonly urls: () => string[]) {}

  get configured(): boolean {
    return this.urls().length > 0;
  }

  async get<T = unknown>(path: string, timeoutMs = 10_000): Promise<T> {
    const urls = this.urls();
    if (urls.length === 0) throw new Error("no LCD configured");
    const ordered =
      this.preferred && urls.includes(this.preferred)
        ? [this.preferred, ...urls.filter((u) => u !== this.preferred)]
        : urls;
    const errors: string[] = [];
    for (const base of ordered) {
      try {
        const res = await fetch(base.replace(/\/+$/, "") + path, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        // A 4xx is an answer about the request (unknown tx, bad id), not an
        // outage: surface it instead of failing over.
        if (res.status >= 400 && res.status < 500) throw new LcdNotFound(res.status);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.preferred = base;
        return (await res.json()) as T;
      } catch (e) {
        if (e instanceof LcdNotFound) throw e;
        errors.push(`${new URL(base).host}: ${(e as Error).message}`);
      }
    }
    throw new Error(`no LCD answered (${errors.join("; ")})`);
  }
}

export class LcdNotFound extends Error {
  constructor(readonly status: number) {
    super(`LCD HTTP ${status}`);
  }
}

// ── Transactions ─────────────────────────────────────────────────────────────

type Coin = { denom: string; amount: string };

export type RawTxResponse = {
  txhash?: string;
  height?: string;
  code?: number;
  codespace?: string;
  raw_log?: string;
  gas_used?: string;
  gas_wanted?: string;
  timestamp?: string;
  data?: string;
  events?: { type?: string; attributes?: { key?: string; value?: string }[] }[];
  tx?: {
    body?: { messages?: Record<string, unknown>[]; memo?: string };
    auth_info?: { fee?: { amount?: Coin[]; payer?: string; granter?: string } };
  };
};

/** Fields of a Secret compute message that are ciphertext on chain. */
const SEALED_MSG_FIELDS = new Set(["msg", "init_msg"]);
/** wasm event attributes Secret leaves in plaintext. */
const PLAIN_WASM_KEYS = new Set(["contract_address", "msg_index", "_contract_address"]);

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** "/secret.compute.v1beta1.MsgExecuteContract" → "MsgExecuteContract". */
export function shortType(t: string | null): string | null {
  if (!t) return null;
  const last = t.split(".").pop() ?? t;
  return last.replace(/^\//, "");
}

/** Human label for a message type ("MsgExecuteContract" → "Execute contract"). */
export function typeLabel(t: string | null): string {
  const s = shortType(t);
  if (!s) return "Unknown";
  const known: Record<string, string> = {
    MsgSend: "Send",
    MsgMultiSend: "Multi-send",
    MsgDelegate: "Delegate",
    MsgUndelegate: "Undelegate",
    MsgBeginRedelegate: "Redelegate",
    MsgWithdrawDelegatorReward: "Claim rewards",
    MsgWithdrawValidatorCommission: "Claim commission",
    MsgVote: "Vote",
    MsgVoteWeighted: "Vote",
    MsgDeposit: "Deposit",
    MsgSubmitProposal: "Proposal",
    MsgExecuteContract: "Execute contract",
    MsgInstantiateContract: "Instantiate contract",
    MsgStoreCode: "Store code",
    MsgMigrateContract: "Migrate contract",
    MsgTransfer: "IBC transfer",
    MsgRecvPacket: "IBC receive",
    MsgAcknowledgement: "IBC ack",
    MsgTimeout: "IBC timeout",
    MsgUpdateClient: "IBC client update",
    MsgUnjail: "Unjail",
    MsgCreateValidator: "Create validator",
    MsgEditValidator: "Edit validator",
    MsgGrant: "Authz grant",
    MsgExec: "Authz exec",
    MsgGrantAllowance: "Fee grant",
    MsgRaAuthenticate: "Register node",
  };
  return known[s] ?? s.replace(/^Msg/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function decodedLength(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Tx response `data` is hex from the SDK 0.50 LCD and gRPC; older fixtures use base64. */
function dataLength(data: string): number {
  return data.length % 2 === 0 && /^[0-9A-F]+$/i.test(data) ? data.length / 2 : decodedLength(data);
}

export type SealedField = { sealed: true; bytes: number };

export type TxMessageView = {
  type: string | null;
  label: string;
  sender: string | null;
  contract: string | null;
  contract_label?: string | null;
  /** True when part of this message is ciphertext only the sender can read. */
  encrypted: boolean;
  /** Plaintext fields as sent; ciphertext fields replaced by a SealedField. */
  fields: Record<string, unknown>;
};

export type TxSummary = {
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
  type: string;
  message_count: number;
  encrypted: boolean;
  contract: string | null;
};

function viewMessage(m: Record<string, unknown>): TxMessageView {
  const type = text(m["@type"]);
  const isCompute = !!type && type.startsWith("/secret.compute.");
  const fields: Record<string, unknown> = {};
  let encrypted = false;
  for (const [k, v] of Object.entries(m)) {
    if (k === "@type") continue;
    if (isCompute && SEALED_MSG_FIELDS.has(k) && typeof v === "string" && v.length > 0) {
      fields[k] = { sealed: true, bytes: decodedLength(v) } satisfies SealedField;
      encrypted = true;
    } else {
      fields[k] = v;
    }
  }
  const sender =
    text(m.sender) ?? text(m.from_address) ?? text(m.delegator_address) ?? text(m.voter) ??
    text(m.depositor) ?? text(m.proposer) ?? text(m.signer) ?? text(m.validator_addr) ?? null;
  return { type, label: typeLabel(type), sender, contract: text(m.contract), encrypted, fields };
}

export function summarizeTx(r: RawTxResponse): TxSummary | null {
  const hash = text(r.txhash);
  if (!hash) return null;
  const msgs = (r.tx?.body?.messages ?? []).map(viewMessage);
  const types = [...new Set(msgs.map((m) => m.label))];
  return {
    hash,
    height: r.height ? Number(r.height) : null,
    timestamp: text(r.timestamp),
    ok: (r.code ?? 0) === 0,
    code: r.code ?? 0,
    codespace: text(r.codespace),
    gas_used: r.gas_used ? Number(r.gas_used) : null,
    gas_wanted: r.gas_wanted ? Number(r.gas_wanted) : null,
    fee: r.tx?.auth_info?.fee?.amount ?? [],
    memo: text(r.tx?.body?.memo),
    signer: msgs.find((m) => m.sender)?.sender ?? null,
    type: types.length === 1 ? types[0]! : types.length === 0 ? "Unknown" : `${types[0]} +${types.length - 1}`,
    message_count: msgs.length,
    encrypted: msgs.some((m) => m.encrypted),
    contract: msgs.find((m) => m.contract)?.contract ?? null,
  };
}

export type TxEventView = {
  type: string;
  attributes: { key: string | null; value: string | null; sealed: boolean }[];
};

export type TxDetail = TxSummary & {
  messages: TxMessageView[];
  /** Response data: ciphertext for compute txs, so sealed when any message is. */
  data: SealedField | string | null;
  events: TxEventView[];
  raw_log: string | null;
};

export function detailTx(r: RawTxResponse): TxDetail | null {
  const summary = summarizeTx(r);
  if (!summary) return null;
  const messages = (r.tx?.body?.messages ?? []).map(viewMessage);
  const events: TxEventView[] = (r.events ?? []).map((e) => {
    const type = e.type ?? "unknown";
    const wasm = type === "wasm" || type.startsWith("wasm-");
    return {
      type,
      attributes: (e.attributes ?? []).map((a) => {
        const sealed = wasm && !PLAIN_WASM_KEYS.has(a.key ?? "");
        return { key: sealed ? null : (a.key ?? null), value: sealed ? null : (a.value ?? null), sealed };
      }),
    };
  });
  const data = text(r.data);
  return {
    ...summary,
    messages,
    data: data && summary.encrypted ? { sealed: true, bytes: dataLength(data) } : data,
    events,
    // A failed tx's log is the only explanation the chain gives; keep it short.
    raw_log: summary.ok ? null : (text(r.raw_log)?.slice(0, 2_000) ?? null),
  };
}

/** Every tx in one block, newest first within the block. */
export async function txsAtHeight(lcd: Lcd, height: number): Promise<TxSummary[]> {
  const q = new URLSearchParams({ query: `tx.height=${height}`, "pagination.limit": "100" });
  const j = await lcd.get<{ tx_responses?: RawTxResponse[] }>(`/cosmos/tx/v1beta1/txs?${q}`);
  return (j.tx_responses ?? []).map(summarizeTx).filter((t): t is TxSummary => t !== null).reverse();
}

/**
 * An address's txs below `ceiling` (exclusive), newest first, from the node's
 * tx index: as a message sender, a transfer recipient, or a called contract.
 * Covers history the yaci index has not backfilled yet; the node only answers
 * for blocks it still retains.
 */
export async function txsForAddress(lcd: Lcd, address: string, ceiling: number, limit: number): Promise<TxSummary[]> {
  const queries = [`message.sender='${address}'`, `transfer.recipient='${address}'`, `wasm.contract_address='${address}'`];
  const pages = await Promise.all(
    queries.map(async (q) => {
      const params = new URLSearchParams({
        query: `${q} AND tx.height<${ceiling}`,
        order_by: "ORDER_BY_DESC",
        "pagination.limit": String(limit),
      });
      try {
        const j = await lcd.get<{ tx_responses?: RawTxResponse[] }>(`/cosmos/tx/v1beta1/txs?${params}`, 20_000);
        return j.tx_responses ?? [];
      } catch (e) {
        if (e instanceof LcdNotFound) return [];
        throw e;
      }
    }),
  );
  const byHash = new Map<string, TxSummary>();
  for (const r of pages.flat()) {
    const t = summarizeTx(r);
    if (t) byHash.set(t.hash, t);
  }
  return [...byHash.values()].sort((a, b) => (b.height ?? 0) - (a.height ?? 0)).slice(0, limit);
}

export async function txByHash(lcd: Lcd, hash: string): Promise<TxDetail | null> {
  const j = await lcd.get<{ tx_response?: RawTxResponse }>(`/cosmos/tx/v1beta1/txs/${hash}`);
  return j.tx_response ? detailTx(j.tx_response) : null;
}

/** Contract label + code id. Labels are chain-wide unique on Secret. */
export async function contractInfo(
  lcd: Lcd,
  address: string,
): Promise<{ label: string | null; code_id: number | null; admin: string | null } | null> {
  try {
    const j = await lcd.get<{ contract_info?: { label?: string; code_id?: string; admin?: string } }>(
      `/compute/v1beta1/info/${address}`,
    );
    const ci = j.contract_info;
    if (!ci) return null;
    return { label: text(ci.label), code_id: ci.code_id ? Number(ci.code_id) : null, admin: text(ci.admin) };
  } catch (e) {
    if (e instanceof LcdNotFound) return null;
    throw e;
  }
}

// ── Governance ───────────────────────────────────────────────────────────────

type RawTally = { yes_count?: string; no_count?: string; abstain_count?: string; no_with_veto_count?: string };
type RawProposal = {
  id?: string;
  status?: string;
  title?: string;
  summary?: string;
  submit_time?: string;
  deposit_end_time?: string;
  voting_start_time?: string | null;
  voting_end_time?: string | null;
  total_deposit?: Coin[];
  final_tally_result?: RawTally;
  expedited?: boolean;
  messages?: { "@type"?: string; plan?: { name?: string; height?: string } }[];
  proposer?: string;
};

export type Tally = { yes: string; no: string; abstain: string; veto: string };

export type ProposalView = {
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
  /** The plan a MsgSoftwareUpgrade proposal would schedule, if any. */
  upgrade: { name: string; height: number | null } | null;
  /** Live tally while voting; the final tally otherwise. */
  tally: Tally;
};

const tallyOf = (t: RawTally | undefined): Tally => ({
  yes: t?.yes_count ?? "0",
  no: t?.no_count ?? "0",
  abstain: t?.abstain_count ?? "0",
  veto: t?.no_with_veto_count ?? "0",
});

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

const seconds = (d: unknown): number | null =>
  typeof d === "string" && /^\d+(\.\d+)?s$/.test(d) ? Number(d.slice(0, -1)) : null;
const dec = (v: unknown): number | null => (typeof v === "string" && v !== "" ? Number(v) : null);

export async function govParams(lcd: Lcd): Promise<GovParams> {
  const j = await lcd.get<{ params?: Record<string, unknown> }>(`/cosmos/gov/v1/params/tallying`);
  const p = j.params ?? {};
  return {
    quorum: dec(p.quorum),
    threshold: dec(p.threshold),
    veto_threshold: dec(p.veto_threshold),
    expedited_threshold: dec(p.expedited_threshold),
    min_deposit: (p.min_deposit as Coin[] | undefined) ?? [],
    expedited_min_deposit: (p.expedited_min_deposit as Coin[] | undefined) ?? [],
    voting_period_s: seconds(p.voting_period),
    expedited_voting_period_s: seconds(p.expedited_voting_period),
    deposit_period_s: seconds(p.max_deposit_period),
  };
}

function upgradeOf(p: RawProposal): ProposalView["upgrade"] {
  const m = (p.messages ?? []).find((m) => m["@type"]?.endsWith("MsgSoftwareUpgrade") && m.plan?.name);
  if (!m?.plan?.name) return null;
  return { name: m.plan.name, height: m.plan.height ? Number(m.plan.height) : null };
}

/** Newest proposals first; voting ones get their live tally. */
export async function proposals(lcd: Lcd, limit: number): Promise<ProposalView[]> {
  const q = new URLSearchParams({ "pagination.limit": String(limit), "pagination.reverse": "true" });
  const j = await lcd.get<{ proposals?: RawProposal[] }>(`/cosmos/gov/v1/proposals?${q}`);
  const rows = j.proposals ?? [];
  return Promise.all(
    rows.map(async (p): Promise<ProposalView> => {
      let tally = tallyOf(p.final_tally_result);
      if (p.status === "PROPOSAL_STATUS_VOTING_PERIOD" && p.id) {
        try {
          const t = await lcd.get<{ tally?: RawTally }>(`/cosmos/gov/v1/proposals/${p.id}/tally`);
          tally = tallyOf(t.tally);
        } catch {
          // keep the stored tally; the card still renders
        }
      }
      return {
        id: Number(p.id),
        status: p.status ?? "PROPOSAL_STATUS_UNSPECIFIED",
        title: text(p.title),
        summary: text(p.summary)?.slice(0, 1_000) ?? null,
        submit_time: text(p.submit_time),
        deposit_end_time: text(p.deposit_end_time),
        voting_start_time: text(p.voting_start_time),
        voting_end_time: text(p.voting_end_time),
        total_deposit: p.total_deposit ?? [],
        expedited: p.expedited === true,
        messages: (p.messages ?? []).map((m) => m["@type"] ?? "unknown"),
        proposer: text(p.proposer),
        upgrade: upgradeOf(p),
        tally,
      };
    }),
  );
}

/** Bonded / not-bonded totals in base denom. */
export async function stakingPool(lcd: Lcd): Promise<{ bonded: string; not_bonded: string }> {
  const j = await lcd.get<{ pool?: { bonded_tokens?: string; not_bonded_tokens?: string } }>(
    `/cosmos/staking/v1beta1/pool`,
  );
  return { bonded: j.pool?.bonded_tokens ?? "0", not_bonded: j.pool?.not_bonded_tokens ?? "0" };
}

/** A pending software upgrade plan, if governance has scheduled one. */
export async function upgradePlan(
  lcd: Lcd,
): Promise<{ name: string; height: number | null; info: string | null } | null> {
  const j = await lcd.get<{ plan?: { name?: string; height?: string; info?: string } | null }>(
    `/cosmos/upgrade/v1beta1/current_plan`,
  );
  if (!j.plan?.name) return null;
  return { name: j.plan.name, height: j.plan.height ? Number(j.plan.height) : null, info: text(j.plan.info) };
}

export type SlashingParams = {
  signed_blocks_window: number | null;
  min_signed_per_window: number | null;
  /** Missed blocks in the window above which a validator is jailed. */
  jail_threshold: number | null;
  downtime_jail_duration_s: number | null;
  slash_fraction_downtime: number | null;
  slash_fraction_double_sign: number | null;
};

export async function slashingParams(lcd: Lcd): Promise<SlashingParams> {
  const j = await lcd.get<{ params?: Record<string, unknown> }>(`/cosmos/slashing/v1beta1/params`);
  const p = j.params ?? {};
  const window = dec(p.signed_blocks_window);
  const minSigned = dec(p.min_signed_per_window);
  return {
    signed_blocks_window: window,
    min_signed_per_window: minSigned,
    jail_threshold: window !== null && minSigned !== null ? Math.floor(window * (1 - minSigned)) : null,
    downtime_jail_duration_s: seconds(p.downtime_jail_duration),
    slash_fraction_downtime: dec(p.slash_fraction_downtime),
    slash_fraction_double_sign: dec(p.slash_fraction_double_sign),
  };
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export type AccountFunds = {
  /** Base-account type ("BaseAccount", "ContinuousVestingAccount", …); null for a never-used address. */
  account_type: string | null;
  account_number: number | null;
  sequence: number | null;
  balances: Coin[];
  delegations: { validator: string; amount: Coin }[];
  /** Unclaimed staking rewards, truncated to whole base units. */
  rewards: { validator: string; amount: Coin[] }[];
  rewards_total: Coin[];
  unbonding: { validator: string; amount: string; completion_time: string | null }[];
};

/** Decimal coin amounts (distribution rewards) → whole base units. */
const whole = (c: { denom?: string; amount?: string }): Coin => ({
  denom: c.denom ?? "",
  amount: (c.amount ?? "0").split(".")[0] || "0",
});

/**
 * An address's funds from the LCD: liquid balances, delegations, unclaimed
 * rewards and unbonding entries. Bank and staking balances are public on
 * Secret; SNIP-20 token balances are private to viewing keys and not shown.
 */
export async function accountFunds(lcd: Lcd, address: string): Promise<AccountFunds> {
  const orEmpty = <T>(p: Promise<T>, empty: T) => p.catch((e) => (e instanceof LcdNotFound ? empty : Promise.reject(e)));
  const [account, bank, delegations, rewards, unbonding] = await Promise.all([
    orEmpty(lcd.get<{ account?: Record<string, unknown> }>(`/cosmos/auth/v1beta1/accounts/${address}`), {}),
    lcd.get<{ balances?: Coin[] }>(`/cosmos/bank/v1beta1/balances/${address}?pagination.limit=200`),
    orEmpty(
      lcd.get<{ delegation_responses?: { delegation?: { validator_address?: string }; balance?: Coin }[] }>(
        `/cosmos/staking/v1beta1/delegations/${address}?pagination.limit=200`,
      ),
      {},
    ),
    orEmpty(
      lcd.get<{ rewards?: { validator_address?: string; reward?: Coin[] }[]; total?: Coin[] }>(
        `/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
      ),
      {},
    ),
    orEmpty(
      lcd.get<{ unbonding_responses?: { validator_address?: string; entries?: { balance?: string; completion_time?: string }[] }[] }>(
        `/cosmos/staking/v1beta1/delegators/${address}/unbonding_delegations?pagination.limit=200`,
      ),
      {},
    ),
  ]);
  // Vesting and module accounts nest the base account one level down.
  const acct = account.account ?? {};
  const base = (acct.base_vesting_account as { base_account?: Record<string, unknown> } | undefined)?.base_account
    ?? (acct.base_account as Record<string, unknown> | undefined)
    ?? acct;
  const num = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  return {
    account_type: typeof acct["@type"] === "string" ? (acct["@type"] as string).split(".").pop()! : null,
    account_number: num(base.account_number),
    sequence: num(base.sequence),
    balances: (bank.balances ?? []).map(whole),
    delegations: (delegations.delegation_responses ?? [])
      .filter((d) => d.delegation?.validator_address && d.balance)
      .map((d) => ({ validator: d.delegation!.validator_address!, amount: whole(d.balance!) })),
    rewards: (rewards.rewards ?? [])
      .filter((r) => r.validator_address)
      .map((r) => ({ validator: r.validator_address!, amount: (r.reward ?? []).map(whole) })),
    rewards_total: (rewards.total ?? []).map(whole),
    unbonding: (unbonding.unbonding_responses ?? []).flatMap((u) =>
      (u.entries ?? []).map((e) => ({
        validator: u.validator_address ?? "",
        amount: (e.balance ?? "0").split(".")[0] || "0",
        completion_time: e.completion_time ?? null,
      })),
    ),
  };
}

/** Operator address → moniker, or null when the LCD does not know it. */
export async function validatorMoniker(lcd: Lcd, operator: string): Promise<string | null> {
  try {
    const j = await lcd.get<{ validator?: { description?: { moniker?: string } } }>(
      `/cosmos/staking/v1beta1/validators/${operator}`,
    );
    return text(j.validator?.description?.moniker);
  } catch (e) {
    if (e instanceof LcdNotFound) return null;
    throw e;
  }
}
