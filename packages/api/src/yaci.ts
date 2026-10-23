/**
 * Read side of the yaci transaction index (github.com/manifest-network/yaci).
 *
 * yaci stores each tx as the gRPC `GetTx` response in protojson: camelCase
 * keys, and — Secret-specific — compute messages carry `sender`/`contract` as
 * base64 address bytes rather than bech32. Rows are normalised here into the
 * LCD's snake_case `tx_response` shape so lcd.ts's summarize/detail (and its
 * sealing rules) apply unchanged, whichever source served the tx.
 */
import pg from "pg";
import { bech32Decode, bech32Encode } from "@sealed/core";
import { detailTx, summarizeTx, type RawTxResponse, type TxDetail, type TxSummary } from "./lcd.js";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type YaciTx = { tx?: Json; txResponse?: Record<string, Json> };

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Recursively snake_case object keys; "@type" and other non-camel keys pass through. */
function snakeKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(snakeKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.startsWith("@") ? k : snake(k), snakeKeys(x)]));
  }
  return v;
}

/** Secret compute message fields that are raw address bytes over gRPC. */
const COMPUTE_ADDRESS_FIELDS = ["sender", "contract", "admin"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** base64 address bytes → bech32; anything that is not 20/32 bytes is left alone. */
export function addressFromBytes(value: string, prefix: string): string {
  if (!BASE64.test(value)) return value;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === 20 || bytes.length === 32 ? bech32Encode(prefix, bytes) : value;
}

/** bech32 → the base64 form yaci stores for compute senders, or null if not an address. */
export function addressToBytes(address: string): string | null {
  try {
    return Buffer.from(bech32Decode(address).data).toString("base64");
  } catch {
    return null;
  }
}

function normaliseMessage(m: Json, prefix: string): Json {
  if (!m || typeof m !== "object" || Array.isArray(m)) return m;
  const out = snakeKeys(m) as Record<string, Json>;
  if (typeof out["@type"] === "string" && out["@type"].startsWith("/secret.compute.")) {
    for (const k of COMPUTE_ADDRESS_FIELDS) {
      if (typeof out[k] === "string" && out[k] !== "") out[k] = addressFromBytes(out[k] as string, prefix);
    }
  }
  return out;
}

/** One yaci `transactions_raw.data` document → LCD-shaped tx_response. */
export function toRawTxResponse(data: YaciTx, prefix: string): RawTxResponse {
  const r = data.txResponse ?? {};
  const tx = (snakeKeys(data.tx ?? {}) ?? {}) as { body?: { messages?: Json[] } };
  const messages = (tx.body?.messages ?? []).map((m) => normaliseMessage(m, prefix));
  return {
    txhash: r.txhash as string | undefined,
    height: r.height as string | undefined,
    code: typeof r.code === "number" ? r.code : 0,
    codespace: r.codespace as string | undefined,
    gas_used: r.gasUsed as string | undefined,
    gas_wanted: r.gasWanted as string | undefined,
    timestamp: r.timestamp as string | undefined,
    data: r.data as string | undefined,
    raw_log: r.rawLog as string | undefined,
    events: r.events as RawTxResponse["events"],
    tx: { ...tx, body: { ...tx.body, messages } } as RawTxResponse["tx"],
  };
}

/** Newest first; `before` pages by height (exclusive). */
export type Page = { limit: number; before?: number };

export class Yaci {
  private readonly pool: pg.Pool;

  constructor(url: string, private readonly prefix: () => string) {
    // A handful of connections: reads are indexed lookups, and yaci's own
    // writers need headroom on the same server.
    this.pool = new pg.Pool({ connectionString: url, max: 4 });
  }

  private rows(sql: string, args: unknown[]): Promise<YaciTx[]> {
    return this.pool.query<{ data: YaciTx }>(sql, args).then((r) => r.rows.map((x) => x.data));
  }

  private summaries(rows: YaciTx[]): TxSummary[] {
    return rows.map((d) => summarizeTx(toRawTxResponse(d, this.prefix()))).filter((t): t is TxSummary => t !== null);
  }

  /** Stored height range, or null while yaci has not written a block yet. */
  async range(): Promise<{ earliest: number; latest: number } | null> {
    const r = await this.pool.query<{ min: number | null; max: number | null }>(
      "select min(id) as min, max(id) as max from api.blocks_raw",
    );
    const { min, max } = r.rows[0] ?? {};
    return min != null && max != null ? { earliest: Number(min), latest: Number(max) } : null;
  }

  /** True when yaci holds `height`, so an empty result there is authoritative. */
  async hasBlock(height: number): Promise<boolean> {
    const r = await this.pool.query("select 1 from api.blocks_raw where id = $1", [height]);
    return (r.rowCount ?? 0) > 0;
  }

  async recent({ limit, before }: Page): Promise<TxSummary[]> {
    return this.summaries(
      await this.rows(
        `select r.data from api.transactions_main m join api.transactions_raw r using (id)
         where ($2::bigint is null or m.height < $2) order by m.height desc, m.id limit $1`,
        [limit, before ?? null],
      ),
    );
  }

  async atHeight(height: number): Promise<TxSummary[]> {
    return this.summaries(
      await this.rows(
        `select r.data from api.transactions_main m join api.transactions_raw r using (id)
         where m.height = $1 order by m.id`,
        [height],
      ),
    );
  }

  async byHash(hash: string): Promise<TxDetail | null> {
    const [data] = await this.rows("select data from api.transactions_raw where id = $1", [hash.toUpperCase()]);
    return data ? detailTx(toRawTxResponse(data, this.prefix())) : null;
  }

  /**
   * Every tx touching `address`: as a message's sender (bech32, or base64
   * bytes for compute senders), named anywhere in a message (yaci's
   * `mentions`), or as a contract in a plaintext wasm `contract_address`.
   */
  async forAddress(address: string, { limit, before }: Page): Promise<TxSummary[]> {
    const bytes = addressToBytes(address);
    return this.summaries(
      await this.rows(
        `with hits as (
           select id from api.messages_main where sender = $1 or sender = $2
           union select id from api.messages_main where mentions @> array[$1]::text[]
           union select id from api.events_main
             where attr_key = 'contract_address'
               and digest(coalesce(attr_value, ''), 'sha256') = digest($1::text, 'sha256')
         )
         select r.data from hits h
           join api.transactions_main m using (id)
           join api.transactions_raw r using (id)
         where ($4::bigint is null or m.height < $4)
         order by m.height desc, m.id limit $3`,
        [address, bytes ?? address, limit, before ?? null],
      ),
    );
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
