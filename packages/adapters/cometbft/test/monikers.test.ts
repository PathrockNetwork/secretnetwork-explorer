/**
 * Tests for the LCD moniker path: bech32 decoding, the CometBFT consensus
 * address derivation, and the database sync.
 *
 * The vectors are real mainnet values (x/poa LCD, mezo_31612-1) so the
 * derivation is tested against the chain's own addresses, not a self-consistent
 * fixture that would pass even if wrong.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@sealed/core";
import { createTestDb, dropTestDb, seed } from "../../../api/test/setup.js";
import {
  consensusAddress,
  consensusAddressFromBase64,
  fetchMonikers,
  infoFromStaking,
  monikersFromLcd,
  signingFromLcd,
  syncMonikers,
} from "../src/monikers.js";
import { resolveLcdUrls, type ChainConfig } from "../src/config.js";

// Real mainnet pubkeys → monikers, from https://mezo.api.nodeshub.online/mezo/poa/v1/validators
const VECTORS: [string, string, string][] = [
  // [bech32 pubkey, consensus address (verified against the chain), moniker]
  [
    "mezovalconspub1zcjduepqcfaf4qf4m8spt2s5ksrdkcm79kflewggy0f62yzcm9upnp0n68ps9kqqh2",
    "5ADDD2EAAC2CD5FA43BA5C62433912807215474A",
    "voyage-through-time",
  ],
  [
    "mezovalconspub1zcjduepq5jqypnmxsxpjhq4uh2f9yl6ntrm33vr5y8ce9c9gu49zr7t26jwq4ef0j9",
    "919F0AC3136CE30A326BF5F549D10EA6CFE98159",
    "StakingCabin",
  ],
  [
    "mezovalconspub1zcjduepq0cl8arzytx2c4ekl7ff4h4r54qe6x2etef4v90t8hlz79crgwy7sf4nhpq",
    "143E66AFE2A69BC2A4A2B3A088E82ED007E06F1B",
    "Node.Monster",
  ],
];

// Fixture consensus addresses use the same shape as the chain (lowercase hex).
const A = VECTORS[0][1].toLowerCase();
const B = VECTORS[1][1].toLowerCase();
const C = VECTORS[2][1].toLowerCase();

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let chainId: number;

beforeAll(async () => {
  pool = await createTestDb();
  db = drizzle(pool, { schema });
  chainId = await seed(pool, { head: 100, count: 10, validators: [A, B, C] });
}, 60_000);

afterAll(async () => {
  if (pool) await dropTestDb(pool);
});

describe("consensusAddress", () => {
  it("derives the chain's own addresses from the LCD pubkeys", () => {
    for (const [pub, addr] of VECTORS) {
      expect(consensusAddress(pub)).toBe(addr);
    }
  });

  it("rejects malformed bech32 rather than guessing", () => {
    expect(() => consensusAddress("notbech32")).toThrow();
    expect(() => consensusAddress("mezovalconspub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toThrow();
  });
});

describe("monikersFromLcd", () => {
  it("maps every well-formed entry and skips broken ones", () => {
    const json = {
      validators: [
        // A carries a Keybase identity alongside its moniker
        {
          cons_pub_key_bech32: VECTORS[0][0],
          description: { moniker: "voyage-through-time", identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" },
        },
        // B: a blank identity must normalize to null, not ""
        {
          cons_pub_key_bech32: VECTORS[1][0],
          description: { moniker: "StakingCabin", identity: "  " },
        },
        { cons_pub_key_bech32: VECTORS[2][0], description: { moniker: "Node.Monster" } },
        { cons_pub_key_bech32: "garbage", description: { moniker: "X" } }, // bad pubkey
        { cons_pub_key_bech32: VECTORS[0][0], description: { moniker: "  " } }, // blank name
        { operator_bech32: "mezovaloper1nope" }, // no pubkey at all
      ],
    };
    const map = monikersFromLcd(json);
    expect(map.size).toBe(3);
    expect(map.get(A)).toEqual({
      moniker: "voyage-through-time",
      identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    });
    expect(map.get(B)).toEqual({ moniker: "StakingCabin", identity: null });
    expect(map.get(C)).toEqual({ moniker: "Node.Monster", identity: null });
  });

  it("returns an empty map (never throws) for a non-x/poa response", () => {
    expect(monikersFromLcd({ code: 12, message: "Not Implemented" }).size).toBe(0);
    expect(monikersFromLcd(null).size).toBe(0);
  });
});

describe("syncMonikers", () => {
  it("writes monikers onto matching validators and ignores the rest", async () => {
    const map = new Map([
      [A, { moniker: "voyage-through-time", identity: "ABCDEF0123456789ABCDEF0123456789ABCDEF01" }],
      [B, { moniker: "StakingCabin", identity: null }],
      // C deliberately absent: an LCD entry missing for a known validator must
      // not blank the stored name.
    ]);
    const updated = await syncMonikers(db, chainId, map);
    expect(updated).toBe(2);

    const r = await pool.query(
      `select address, moniker, identity from validators where chain_id = $1 order by address`,
      [chainId],
    );
    const byAddr = new Map(r.rows.map((x) => [x.address, x]));
    expect(byAddr.get(A)?.moniker).toBe("voyage-through-time");
    expect(byAddr.get(A)?.identity).toBe("ABCDEF0123456789ABCDEF0123456789ABCDEF01");
    expect(byAddr.get(B)?.moniker).toBe("StakingCabin");
    expect(byAddr.get(B)?.identity).toBeNull();
    expect(byAddr.get(C)?.moniker).toBeNull();

    // Re-running with the same map is a no-op.
    expect(await syncMonikers(db, chainId, map)).toBe(0);
  });

  it("updates a changed moniker but keeps a name the LCD no longer lists", async () => {
    const map = new Map([[A, { moniker: "renamed", identity: null }]]);
    expect(await syncMonikers(db, chainId, map)).toBe(1);
    const r = await pool.query<{ moniker: string }>(
      `select moniker from validators where chain_id = $1 and address = $2`,
      [chainId, A],
    );
    expect(r.rows[0].moniker).toBe("renamed");
    // B is no longer in the map; its stored moniker is untouched.
    const b = await pool.query<{ moniker: string }>(
      `select moniker from validators where chain_id = $1 and address = $2`,
      [chainId, B],
    );
    expect(b.rows[0].moniker).toBe("StakingCabin");
  });

  it("does nothing for an empty map", async () => {
    expect(await syncMonikers(db, chainId, new Map())).toBe(0);
  });
});

describe("LCD failover", () => {
  // fetchMonikers hits real URLs; stub the global so the ordering logic is
  // tested against controlled failures, not provider uptime.
  const lcdJson = {
    validators: VECTORS.map(([pub, , moniker]) => ({
      cons_pub_key_bech32: pub,
      description: { moniker },
    })),
  };
  const ok = (json: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(json),
  });

  afterEach(() => vi.unstubAllGlobals());

  it("falls through a dead LCD to the next one and reports which answered", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 502"))
      .mockResolvedValueOnce(ok(lcdJson));
    vi.stubGlobal("fetch", f);
    const { info, url } = await fetchMonikers(["https://down.example", "https://up.example"], undefined, "poa");
    expect(url).toBe("https://up.example");
    expect(info.size).toBe(3);
    expect(f.mock.calls[0][0]).toContain("down.example");
  });

  it("prefers the last good URL when told to", async () => {
    const f = vi.fn().mockResolvedValue(ok(lcdJson));
    vi.stubGlobal("fetch", f);
    const { url } = await fetchMonikers(
      ["https://a.example", "https://b.example"],
      "https://b.example",
    );
    expect(url).toBe("https://b.example");
    expect(f.mock.calls[0][0]).toContain("b.example");
  });

  it("throws an aggregate when every LCD is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("HTTP 502")));
    await expect(
      fetchMonikers(["https://a.example", "https://b.example"]),
    ).rejects.toThrow(/no LCD answered/);
  });

  it("resolveLcdUrls drops unset entries and honours the singular form", () => {
    const base = { slug: "t", name: "t", chain_id: "t", family: "cometbft" as const, rpc_url: "http://x" };
    expect(
      resolveLcdUrls({ ...base, lcd_urls: ["https://one.example", null, undefined] } as ChainConfig),
    ).toEqual(["https://one.example"]);
    expect(resolveLcdUrls({ ...base, lcd_url: "https://solo.example" } as ChainConfig)).toEqual([
      "https://solo.example",
    ]);
    expect(resolveLcdUrls({ ...base } as ChainConfig)).toEqual([]);
  });
});

// Real secret-4 values (LCD x/staking + x/slashing, 2026-10-10), joined to
// the consensus addresses CometBFT reports for the same validators.
const KRAKEN = {
  key: "pmk+WgRGOcYlc+J2Cklr63fjqXq+RByxkhlWtTYQocQ=",
  address: "d60d5ee59cf7b1f0d755fd1679661f42cc03cddd",
  valcons: "secretvalcons16cx4aevu77clp464l5t8jeslgtxq8nwajztt4d",
};
const PATHROCK = {
  key: "TqEEmVpGUuGxFG0SDr9EfGHfJOGJHZ7keFdYbpJnBvA=",
  address: "945ce215f350afcdac8759b6f23d3735063d7746",
};

describe("x/staking source", () => {
  it("derives the CometBFT address from a base64 ed25519 key", () => {
    expect(consensusAddressFromBase64(KRAKEN.key).toLowerCase()).toBe(KRAKEN.address);
    expect(consensusAddressFromBase64(PATHROCK.key).toLowerCase()).toBe(PATHROCK.address);
    expect(() => consensusAddressFromBase64("AAAA")).toThrow();
  });

  it("maps a validators page to moniker, identity and staking fields", () => {
    const map = infoFromStaking({
      validators: [
        {
          operator_address: "secretvaloper1nsf2zmhe3ktn5fqtrpffnktc4g7uag05ggse54",
          consensus_pubkey: { "@type": "/cosmos.crypto.ed25519.PubKey", key: KRAKEN.key },
          jailed: false,
          status: "BOND_STATUS_BONDED",
          tokens: "114045901412645",
          min_self_delegation: "1",
          description: { moniker: "Kraken01", identity: "F748A43D5B6066ED", website: "https://www.kraken.com/", details: "" },
          commission: { commission_rates: { rate: "0.100000000000000000" } },
        },
        // no moniker → skipped; malformed key → skipped, not fatal
        { consensus_pubkey: { key: PATHROCK.key }, description: { moniker: "" } },
        { consensus_pubkey: { key: "not-base64!" }, description: { moniker: "Broken" } },
      ],
    });
    expect(map.size).toBe(1);
    const info = map.get(KRAKEN.address)!;
    expect(info.moniker).toBe("Kraken01");
    expect(info.identity).toBe("F748A43D5B6066ED");
    expect(info.staking).toMatchObject({
      operatorAddress: "secretvaloper1nsf2zmhe3ktn5fqtrpffnktc4g7uag05ggse54",
      commissionRate: 0.1,
      tokens: "114045901412645",
      bondStatus: "BOND_STATUS_BONDED",
      jailed: false,
      details: null,
    });
  });

  it("keys signing info by the decoded valcons address", () => {
    const map = signingFromLcd({
      info: [
        {
          address: KRAKEN.valcons,
          start_height: "26649662",
          jailed_until: "1970-01-01T00:00:00Z",
          tombstoned: false,
          missed_blocks_counter: "7",
        },
      ],
    });
    expect(map.get(KRAKEN.address)).toEqual({
      missedBlocksCounter: 7,
      jailedUntil: null, // the zero time means never jailed
      tombstoned: false,
      startHeight: 26649662,
    });
  });

  it("returns empty maps (never throws) for an unexpected response", () => {
    expect(infoFromStaking({ code: 12 }).size).toBe(0);
    expect(signingFromLcd(null).size).toBe(0);
  });
});
