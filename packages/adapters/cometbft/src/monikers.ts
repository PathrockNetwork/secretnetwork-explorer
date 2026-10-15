/**
 * Moniker sync from the chain's LCD.
 *
 * CometBFT's /validators carries no monikers — only consensus address, pubkey
 * and power. Two LCD sources are supported:
 *
 * - x/staking (Secret and most Cosmos chains): `GET /cosmos/staking/v1beta1/validators`,
 *   paginated, whose `consensus_pubkey` is `{"@type": ".../ed25519.PubKey", key: <base64>}`.
 *   The same pass carries commission, tokens, bond status and jailed, and
 *   `/cosmos/slashing/v1beta1/signing_infos` adds the missed-block counter.
 * - x/poa (PoA chains such as Mezo): `GET /poa/v1/validators`, whose consensus
 *   pubkey is bech32 (amino-prefixed).
 *
 * Either way the consensus address is a deterministic function of the ed25519
 * pubkey (sha256(key)[:20]), so the LCD list is joined onto the indexed
 * validators offline — no trust in the LCD beyond what it describes, and a
 * wrong-chain response cannot poison the mapping because the addresses simply
 * won't match.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { validators } from "@sealed/core";
import type { Database } from "@sealed/core";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

/** Decode a bech32/bech32m string to (hrp, 8-bit payload). Throws on bad data. */
export function bech32Decode(addr: string): { hrp: string; data: Uint8Array } {
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || pos + 7 > addr.length) throw new Error("invalid bech32 separator");
  const hrp = addr.slice(0, pos);
  const values: number[] = [];
  for (const c of addr.slice(pos + 1)) {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`invalid bech32 character "${c}"`);
    values.push(v);
  }
  const hrpExpand = [...hrp]
    .map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const chk = polymod([...hrpExpand, ...values]);
  if (chk !== 1 && chk !== BECH32M_CONST) throw new Error("bech32 checksum mismatch");

  const data5 = values.slice(0, -6);
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of data5) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) throw new Error("invalid bech32 padding");
  return { hrp, data: Uint8Array.from(out) };
}

/**
 * Consensus address (uppercase hex) for an amino-prefixed ed25519 bech32
 * pubkey, e.g. <prefix>valconspub1… → sha256(raw key)[:20]. Same derivation
 * CometBFT itself uses, so the result matches /validators addresses and block
 * proposer addresses byte for byte.
 */
export function consensusAddress(pubkeyBech32: string): string {
  const { data } = bech32Decode(pubkeyBech32);
  if (data.length < 32) throw new Error("pubkey payload shorter than an ed25519 key");
  const key = data.slice(data.length - 32);
  return addressFromKey(key);
}

/** sha256(raw ed25519 key)[:20], uppercase hex — CometBFT's validator address. */
function addressFromKey(key: Uint8Array): string {
  return createHash("sha256").update(key).digest().subarray(0, 20).toString("hex").toUpperCase();
}

/** Consensus address for a base64 ed25519 pubkey as x/staking serves it. */
export function consensusAddressFromBase64(keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("not a 32-byte ed25519 key");
  return addressFromKey(key);
}

type LcdValidator = {
  cons_pub_key_bech32?: unknown;
  description?: { moniker?: unknown; identity?: unknown };
};

/** x/staking + x/slashing fields; absent for x/poa sources. */
export type StakingInfo = {
  operatorAddress: string | null;
  website: string | null;
  details: string | null;
  commissionRate: number | null;
  tokens: string | null;
  minSelfDelegation: string | null;
  bondStatus: string | null;
  jailed: boolean | null;
};

export type SigningInfo = {
  missedBlocksCounter: number | null;
  jailedUntil: Date | null;
  tombstoned: boolean | null;
  startHeight: number | null;
};

/** What the indexer can learn about a validator from its LCD entry. */
export type LcdInfo = {
  moniker: string;
  identity: string | null;
  staking?: StakingInfo;
  signing?: SigningInfo;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type StakingValidator = {
  operator_address?: unknown;
  consensus_pubkey?: { "@type"?: unknown; key?: unknown };
  jailed?: unknown;
  status?: unknown;
  tokens?: unknown;
  min_self_delegation?: unknown;
  description?: { moniker?: unknown; identity?: unknown; website?: unknown; details?: unknown };
  commission?: { commission_rates?: { rate?: unknown } };
};

/**
 * Extract consensus address → info from one x/staking validators page. Entries
 * without an ed25519 key or a moniker are skipped; a malformed entry must not
 * sink the rest of the page.
 */
export function infoFromStaking(json: unknown): Map<string, LcdInfo> {
  const out = new Map<string, LcdInfo>();
  const list = (json as { validators?: unknown })?.validators;
  if (!Array.isArray(list)) return out;
  for (const v of list as StakingValidator[]) {
    const key = v?.consensus_pubkey?.key;
    const moniker = str(v?.description?.moniker);
    if (typeof key !== "string" || moniker === null) continue;
    try {
      out.set(consensusAddressFromBase64(key).toLowerCase(), {
        moniker,
        identity: str(v.description?.identity),
        staking: {
          operatorAddress: str(v.operator_address),
          website: str(v.description?.website),
          details: str(v.description?.details),
          commissionRate: num(v.commission?.commission_rates?.rate),
          tokens: str(v.tokens),
          minSelfDelegation: str(v.min_self_delegation),
          bondStatus: str(v.status),
          jailed: typeof v.jailed === "boolean" ? v.jailed : null,
        },
      });
    } catch {
      // skip
    }
  }
  return out;
}

/** Consensus address (lowercase hex) → signing info from one signing_infos page. */
export function signingFromLcd(json: unknown): Map<string, SigningInfo> {
  const out = new Map<string, SigningInfo>();
  const list = (json as { info?: unknown })?.info;
  if (!Array.isArray(list)) return out;
  for (const i of list as Record<string, unknown>[]) {
    if (typeof i?.address !== "string") continue;
    try {
      const { data } = bech32Decode(i.address);
      if (data.length !== 20) continue;
      const until = typeof i.jailed_until === "string" ? new Date(i.jailed_until) : null;
      out.set(Buffer.from(data).toString("hex"), {
        missedBlocksCounter: num(i.missed_blocks_counter),
        // The zero time (1970-01-01) means "never jailed".
        jailedUntil: until && Number.isFinite(until.getTime()) && until.getTime() > 0 ? until : null,
        tombstoned: typeof i.tombstoned === "boolean" ? i.tombstoned : null,
        startHeight: num(i.start_height),
      });
    } catch {
      // skip
    }
  }
  return out;
}

/** Extract a lowercase consensus address → {moniker, identity} map from an LCD response. */
export function monikersFromLcd(json: unknown): Map<string, LcdInfo> {
  const out = new Map<string, LcdInfo>();
  const list = (json as { validators?: unknown })?.validators;
  if (!Array.isArray(list)) return out;
  for (const v of list as LcdValidator[]) {
    if (typeof v?.cons_pub_key_bech32 !== "string") continue;
    const moniker = v?.description?.moniker;
    if (typeof moniker !== "string" || moniker.trim() === "") continue;
    const identity =
      typeof v?.description?.identity === "string" && v.description.identity.trim() !== ""
        ? v.description.identity.trim()
        : null;
    try {
      out.set(consensusAddress(v.cons_pub_key_bech32).toLowerCase(), {
        moniker: moniker.trim(),
        identity,
      });
    } catch {
      // A malformed entry must not sink the rest of the list.
    }
  }
  return out;
}

/**
 * Persist monikers and Keybase identities onto the indexed validators. Only
 * rows where something actually changed are written; addresses are matched
 * case-insensitively (CometBFT reports uppercase, the indexer stores lowercase).
 */
export async function syncMonikers(
  db: Database,
  chainId: number,
  monikers: Map<string, LcdInfo>,
): Promise<number> {
  if (monikers.size === 0) return 0;
  const rows = await db
    .select({ address: validators.address, moniker: validators.moniker, identity: validators.identity })
    .from(validators)
    .where(eq(validators.chainId, chainId));
  let updated = 0;
  for (const r of rows) {
    const info = monikers.get(r.address.toLowerCase());
    if (info === undefined) continue;
    // Staking fields (tokens, missed counter) move every block, so a staking
    // source always writes; a name-only source writes only on change.
    if (!info.staking && info.moniker === r.moniker && info.identity === r.identity) continue;
    const now = new Date();
    await db
      .update(validators)
      .set({
        moniker: info.moniker,
        identity: info.identity,
        ...(info.staking && { ...info.staking, stakingSyncedAt: now }),
        ...(info.signing && {
          missedBlocksCounter: info.signing.missedBlocksCounter,
          jailedUntil: info.signing.jailedUntil,
          tombstoned: info.signing.tombstoned,
          signingStartHeight: info.signing.startHeight,
        }),
        updatedAt: now,
      })
      .where(and(eq(validators.chainId, chainId), eq(validators.address, r.address)));
    updated++;
  }
  return updated;
}

export type MonikerSource = "staking" | "poa";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`LCD ${url}: HTTP ${res.status}`);
  return res.json();
}

/** Walk a Cosmos paginated list (`pagination.next_key`) to the end. */
async function fetchAllPages(base: string, path: string, maxPages = 20): Promise<unknown[]> {
  const pages: unknown[] = [];
  let key: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ "pagination.limit": "200" });
    if (key) q.set("pagination.key", key);
    const json = (await getJson(`${base}${path}?${q}`)) as { pagination?: { next_key?: unknown } };
    pages.push(json);
    key = typeof json?.pagination?.next_key === "string" && json.pagination.next_key ? json.pagination.next_key : null;
    if (!key) break;
  }
  return pages;
}

/** Fetch + parse the validator list from one LCD. */
export async function fetchMonikersFrom(
  lcdUrl: string,
  source: MonikerSource = "staking",
): Promise<Map<string, LcdInfo>> {
  const base = lcdUrl.replace(/\/+$/, "");
  if (source === "poa") return monikersFromLcd(await getJson(base + "/poa/v1/validators"));

  const out = new Map<string, LcdInfo>();
  for (const page of await fetchAllPages(base, "/cosmos/staking/v1beta1/validators")) {
    for (const [addr, info] of infoFromStaking(page)) out.set(addr, info);
  }
  // Signing info is a second, optional layer: a failure keeps the staking view.
  try {
    for (const page of await fetchAllPages(base, "/cosmos/slashing/v1beta1/signing_infos")) {
      for (const [addr, signing] of signingFromLcd(page)) {
        const info = out.get(addr);
        if (info) info.signing = signing;
      }
    }
  } catch (e) {
    console.warn(`signing_infos from ${base} failed: ${(e as Error).message}`);
  }
  return out;
}

/**
 * Fetch the validator list, trying each LCD in order until one answers.
 * Returns the URL that succeeded so the caller can prefer it next time; the
 * address join already discards a wrong-chain response, so trying another
 * provider cannot poison the mapping.
 */
export async function fetchMonikers(
  lcdUrls: string[],
  prefer?: string,
  source: MonikerSource = "staking",
): Promise<{ info: Map<string, LcdInfo>; url: string }> {
  const ordered = prefer && lcdUrls.includes(prefer) ? [prefer, ...lcdUrls.filter((u) => u !== prefer)] : lcdUrls;
  const errors: string[] = [];
  for (const url of ordered) {
    try {
      return { info: await fetchMonikersFrom(url, source), url };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`no LCD answered (${errors.join("; ")})`);
}
