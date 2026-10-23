/** /api/v1/transactions and /blocks/:h/transactions with and without the yaci index. */
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes, type Deps } from "../src/routes.js";
import type { ChainRow } from "../src/queries.js";
import type { TxSummary } from "../src/lcd.js";
import type { Yaci } from "../src/yaci.js";

const ADDRESS = "secret1p55wr2n6f63wyap8g9dckkxmf4wvq73ensxrw4";
const tx = (height: number): TxSummary => ({
  hash: String(height).padStart(64, "0"), height, timestamp: null, ok: true, code: 0, codespace: null,
  gas_used: 1, gas_wanted: 2, fee: [], memo: null, signer: ADDRESS, type: "Send", message_count: 1, encrypted: false, contract: null,
});

const apps: ReturnType<typeof Fastify>[] = [];
// The indexer's tip is block 40; it carried no txs worth scanning for the LCD path.
const pool = {
  query: async (sql: string) => ({ rows: sql.includes("max(height)") ? [{ h: 40 }] : [] }),
} as unknown as Deps["pool"];

function app(yaci: Partial<Yaci> | null) {
  const server = Fastify(); apps.push(server);
  registerRoutes(server, {
    pool,
    head: () => ({} as ReturnType<Deps["head"]>),
    chain: () => ({ id: 1, meta: { lcdUrls: ["https://lcd.example"], bech32Prefix: "secret" } } as ChainRow),
    yaci: yaci as Yaci | null,
  });
  return server;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); vi.unstubAllGlobals(); });

describe("transactions route", () => {
  it("rejects malformed addresses and heights", async () => {
    const server = app(null);
    for (const q of ["address=secret1nope", "address=cosmos1p55wr2n6f63wyap8g9dckkxmf4wvq73en0f8k2", "before=0", "before=abc"]) {
      expect((await server.inject(`/api/v1/transactions?${q}`)).statusCode).toBe(400);
    }
  });

  it("needs the index for address history", async () => {
    expect((await app(null).inject(`/api/v1/transactions?address=${ADDRESS}`)).statusCode).toBe(501);
  });

  it("serves address history from yaci with a paging cursor", async () => {
    const forAddress = vi.fn().mockResolvedValue([tx(30), tx(20)]);
    const server = app({ forAddress, range: async () => ({ earliest: 10, latest: 40 }) });
    const res = await server.inject(`/api/v1/transactions?address=${ADDRESS.toUpperCase()}&limit=2&before=35`);
    expect(res.statusCode).toBe(200);
    expect(forAddress).toHaveBeenCalledWith(ADDRESS, { limit: 2, before: 35 });
    expect(res.json()).toMatchObject({ source: "yaci", index: { earliest: 10, latest: 40 }, next_before: 20 });
    expect(res.json().transactions).toHaveLength(2);
  });

  it("serves the live feed from yaci only once it has caught up", async () => {
    const recent = vi.fn().mockResolvedValue([tx(39)]);
    const caughtUp = await app({ recent, range: async () => ({ earliest: 10, latest: 39 }) }).inject("/api/v1/transactions");
    expect(caughtUp.json()).toMatchObject({ source: "yaci", transactions: [{ height: 39 }] });
    recent.mockClear();
    const behind = await app({ recent, range: async () => ({ earliest: 10, latest: 12 }) }).inject("/api/v1/transactions");
    expect(behind.json()).toMatchObject({ source: "lcd" });
    expect(recent).not.toHaveBeenCalled();
  });

  it("uses yaci for indexed blocks and the LCD otherwise", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tx_responses: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const server = app({ hasBlock: async (h: number) => h === 30, atHeight: async () => [tx(30)] });
    const indexed = (await server.inject("/api/v1/blocks/30/transactions")).json();
    expect(indexed).toMatchObject({ source: "yaci", transactions: [{ height: 30 }] });
    expect(fetch).not.toHaveBeenCalled();
    expect((await server.inject("/api/v1/blocks/5/transactions")).json()).toMatchObject({ source: "lcd" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
