import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes, type Deps } from "../src/routes.js";
import type { ChainRow } from "../src/queries.js";

const apps: ReturnType<typeof Fastify>[] = [];
function app() {
  const server = Fastify(); apps.push(server);
  registerRoutes(server, { pool: {} as Deps["pool"], head: () => ({} as ReturnType<Deps["head"]>), chain: () => ({ id: 1, meta: { lcdUrls: ["https://lcd.example"] } } as ChainRow) });
  return server;
}
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); vi.unstubAllGlobals(); });

describe("block transactions route", () => {
  it("rejects invalid heights before contacting an upstream", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const server = app();
    for (const height of ["0", "-1", "1.5", "abc", "9007199254740992"]) expect((await server.inject(`/api/v1/blocks/${height}/transactions`)).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("scopes the LCD request to the selected block and reuses the cached result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tx_responses: [] }), { status: 200 })); vi.stubGlobal("fetch", fetch);
    const server = app();
    const first = await server.inject('/api/v1/blocks/42/transactions');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ transactions: [], limit: 100 });
    expect(String(fetch.mock.calls[0][0])).toContain('query=tx.height%3D42');
    await server.inject('/api/v1/blocks/42/transactions');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns an unavailable state when transaction retrieval fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await app().inject('/api/v1/blocks/42/transactions');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "block transactions unavailable" });
  });
});
