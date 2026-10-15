/**
 * REST surface consumed by the dashboard. Every response is derived from the
 * indexed data — where a number genuinely cannot be known (no RPC reachable,
 * window not backfilled) the field is null and the UI renders an em-dash or a
 * partial-window badge rather than a misleading zero.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import type pg from "pg";
import type { ChainHead } from "./chain-head.js";
import {
  LONG_WINDOW,
  SHORT_WINDOW,
  blocksPerBucket,
  getChain,
  indexerStall,
  isBootstrapSet,
  listEndpoints,
  metricStats,
  networkSummary,
  pipelineBlocks,
  proposedTotal,
  rpcDirectory,
  recentBlockSigning,
  seriesBuckets,
  setChanges,
  setEndpointPinned,
  setValidatorIdentity,
  signingSlots,
  validatorMetrics,
  type ChainRow,
  type ValidatorRow,
} from "./queries.js";
import { Cached, CacheMap } from "./cache.js";
import { createAvatarResolver, withAvatars } from "./avatars.js";
import {
  Lcd,
  LcdNotFound,
  contractInfo,
  govParams,
  proposals,
  slashingParams,
  stakingPool,
  txByHash,
  txsAtHeight,
  upgradePlan,
  type TxSummary,
} from "./lcd.js";

/** Lag beyond which the indexer is considered stalled rather than merely behind. */
const STALL_LAG_BLOCKS = 50;
/** Just under block cadence: a cached read is at most one block stale. */
const DERIVED_TTL_MS = 3_000;

/** Browser-safe bridge for the two public presets shown by Direct RPC.
 * Exact matching is intentional: accepting arbitrary URLs here would turn the
 * dashboard into an SSRF/open-proxy surface. Custom endpoints remain direct
 * browser connections and therefore still require their own CORS headers. */
const DIRECT_RPC_ENDPOINTS = new Map([
  ["https://rpc.secret.mainnet.secret3.dev", "https://rpc.secret.mainnet.secret3.dev"],
]);
const DIRECT_RPC_PATHS = new Set([
  "/status",
  "/health",
  "/net_info",
  "/genesis",
  "/abci_info",
  "/block",
  "/block_results",
  "/commit",
  "/blockchain",
  "/validators",
  "/unconfirmed_txs",
  "/num_unconfirmed_txs",
  "/tx",
  "/tx_search",
  "/consensus_state",
  "/dump_consensus_state",
  "/abci_query",
]);
const DIRECT_RPC_MAX_BYTES = 8 * 1024 * 1024;

export type Deps = {
  pool: pg.Pool;
  /**
   * A thunk, deliberately: the chain row (and with it the polled RPC URL)
   * changes whenever the indexer fails over or an endpoint is pinned, and the
   * server replaces the ChainHead then. Capturing the object by value at boot
   * would freeze every route on a stopped tracker — head/lag null forever
   * until process restart.
   */
  head: () => ChainHead;
  /** Resolved once at boot; null when the indexer has never seeded a chain row. */
  chain: () => ChainRow | null;
};

type ValidatorView = {
  address: string;
  moniker: string | null;
  identity: string | null;
  /** Keybase avatar for the identity, or null when there is none to fetch. */
  avatar_url: string | null;
  label: string | null;
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
  proposed_blocks_1000: number;
  status: "active" | "degraded" | "inactive";
  /** x/staking + x/slashing view; null on chains without staking or before sync. */
  staking: {
    operator_address: string | null;
    website: string | null;
    details: string | null;
    commission_rate: number | null;
    tokens: string | null;
    min_self_delegation: string | null;
    bond_status: string | null;
    jailed: boolean | null;
    missed_blocks_counter: number | null;
    jailed_until: string | null;
    tombstoned: boolean | null;
    signing_start_height: number | null;
  } | null;
  /**
   * Where a node with this validator's moniker was last seen peering on the
   * P2P network. All fields null when never observed — that is a fact about
   * our observation, not a claim the validator is nowhere. This is the node's
   * location (possibly a sentry), not the operator's registered address.
   */
  location: {
    ip: string | null;
    country_code: string | null;
    country: string | null;
    city: string | null;
    isp: string | null;
    /** Equirectangular degrees for the map view. */
    lat: number | null;
    lon: number | null;
    last_seen: string | null;
    /** "peer" = seen in an RPC's peer list; "direct" = the node's own RPC
     *  answered after it fell out of the peer view. */
    source: string | null;
    /** Distinct IPs ever observed for this validator. */
    ips_seen: number;
  } | null;
};

function viewValidator(
  v: ValidatorRow & { avatar_url?: string | null },
  proposedTotalCount: number,
): ValidatorView {
  const uptime1 = v.slots_short > 0 ? (v.signed_short / v.slots_short) * 100 : null;
  const uptime10 = v.slots_long > 0 ? (v.signed_long / v.slots_long) * 100 : null;
  const degraded = v.missed_streak >= 3 || (uptime1 !== null && uptime1 < 99.5);
  // A set member that has never signed, or gone silent for longer than the
  // long window, is offline no matter what the PoA set says. Without this
  // rule it fell through to "active" whenever no uptime window had data
  // (arashaus: in the set since 11,052,053, zero observed signatures).
  const silent =
    v.last_signed_height === null ||
    (v.last_seen_height !== null && v.last_seen_height - v.last_signed_height > LONG_WINDOW);
  return {
    address: v.address,
    moniker: v.moniker,
    identity: v.identity,
    avatar_url: v.avatar_url ?? null,
    label: v.label,
    watched: v.watched,
    pub_key: v.pub_key,
    voting_power: v.voting_power,
    is_active: v.is_active,
    first_seen_height: v.first_seen_height,
    last_seen_height: v.last_seen_height,
    last_signed_height: v.last_signed_height,
    uptime_1000: uptime1,
    uptime_10000: uptime10,
    slots_1000: v.slots_short,
    slots_10000: v.slots_long,
    missed_streak: v.missed_streak,
    proposed_blocks_1000: v.proposed_short,
    proposer_share_1000:
      proposedTotalCount > 0 ? (v.proposed_short / proposedTotalCount) * 100 : null,
    status: !v.is_active || silent ? "inactive" : degraded ? "degraded" : "active",
    staking:
      v.operator_address !== null || v.bond_status !== null
        ? {
            operator_address: v.operator_address,
            website: v.website,
            details: v.details,
            commission_rate: v.commission_rate,
            tokens: v.tokens,
            min_self_delegation: v.min_self_delegation,
            bond_status: v.bond_status,
            jailed: v.jailed,
            missed_blocks_counter: v.missed_blocks_counter,
            jailed_until: v.jailed_until ? v.jailed_until.toISOString() : null,
            tombstoned: v.tombstoned,
            signing_start_height: v.signing_start_height,
          }
        : null,
    location: v.loc_ip
      ? {
          ip: v.loc_ip,
          country_code: v.loc_country_code,
          country: v.loc_country,
          city: v.loc_city,
          isp: v.loc_isp,
          lat: v.loc_lat,
          lon: v.loc_lon,
          last_seen: v.loc_last_seen ? v.loc_last_seen.toISOString() : null,
          source: v.loc_source,
          ips_seen: v.loc_ips_seen ?? 1,
        }
      : null,
  };
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { pool } = deps;
  /** Keybase avatar per validator identity; day-TTL, fail-soft to null. */
  const resolveAvatar = createAvatarResolver();
  /** LCD reads (txs, governance, staking) follow the chain's configured URLs. */
  const lcd = new Lcd(() => deps.chain()?.meta?.lcdUrls ?? []);

  /**
   * Same-origin avatar proxy: the dashboard's <img> tags point here instead
   * of at a third-party image host, so the public site's strict img-src 'self'
   * holds AND visitors' browsers never talk to a third party for logos.
   * Bytes are cached per URL for a day; any miss or upstream failure is a
   * 404, which the client renders as its identicon fallback.
   */
  const AVATAR_LIMIT = 2 * 1024 * 1024;
  const avatarBytes = new CacheMap(async (url: string): Promise<{ type: string; body: Buffer } | null> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > AVATAR_LIMIT) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength > AVATAR_LIMIT) return null;
      const type = res.headers.get("content-type") ?? "image/png";
      return /^image\//.test(type) ? { type, body } : null;
    } catch {
      return null;
    }
  }, 24 * 60 * 60 * 1000);
  app.get<{ Params: { address: string } }>("/api/v1/validators/:address/avatar", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const r = await pool.query<{ avatar_url: string | null; identity: string | null }>(
      `select avatar_url, identity from validators where chain_id = $1 and lower(address) = lower($2)`,
      [chain.id, req.params.address],
    );
    // Same precedence as withAvatars: the chain's Keybase identity first, then
    // a stored third-party URL. Keybase URLs are only ever https (avatars.ts).
    const row = r.rows[0];
    const url = (row?.identity ? await resolveAvatar(row.identity) : null) ?? row?.avatar_url ?? null;
    if (!url) {
      reply.code(404);
      return { error: "no avatar for this validator" };
    }
    const hit = await avatarBytes.get(url);
    if (!hit) {
      reply.code(404);
      return { error: "avatar unavailable" };
    }
    reply.header("content-type", hit.type);
    reply.header("cache-control", "public, max-age=3600");
    return reply.send(hit.body);
  });

  /**
   * Landmass GeoJSON for the map, proxied same-origin: the public site's CSP
   * allows no third-party connect-src, and this way one server-side fetch
   * (day-TTL, coalesced) serves every visitor. Unreachable upstream is a 502
   * — the map degrades to its graticule rather than failing the page.
   */
  const LAND_URL = "https://cdn.jsdelivr.net/gh/holtzy/D3-graph-gallery@master/DATA/world.geojson";
  const landCache = new Cached(async () => {
    const res = await fetch(LAND_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`geojson upstream: HTTP ${res.status}`);
    return await res.json();
  }, 24 * 60 * 60 * 1000);
  app.get("/api/v1/geo/land", async (_req, reply) => {
    try {
      return await landCache.get();
    } catch (e) {
      app.log.warn({ err: e }, "land geojson fetch failed");
      reply.code(502);
      return { error: "landmass source unreachable" };
    }
  });

  app.get<{
    Querystring: { endpoint?: string; path?: string; [key: string]: string | undefined };
  }>("/api/v1/rpc/proxy", async (req, reply) => {
    const requestedEndpoint = (req.query.endpoint ?? "").replace(/\/+$/, "").toLowerCase();
    const upstreamBase = DIRECT_RPC_ENDPOINTS.get(requestedEndpoint);
    if (!upstreamBase) {
      reply.code(403);
      return { error: "endpoint is not an allowlisted Direct RPC preset" };
    }
    const rpcPath = req.query.path ?? "";
    if (!DIRECT_RPC_PATHS.has(rpcPath)) {
      reply.code(400);
      return { error: "unsupported Direct RPC method" };
    }
    const forwardedParams: Array<[string, string]> = [];
    let forwarded = 0;
    for (const [key, value] of Object.entries(req.query)) {
      if (key === "endpoint" || key === "path" || value === undefined) continue;
      if (++forwarded > 12 || key.length > 64 || value.length > 4096) {
        reply.code(400);
        return { error: "invalid Direct RPC parameters" };
      }
      forwardedParams.push([key, value]);
    }

    /* Public community nodes can rate-limit or briefly go offline. Keep the
     * selected provider as the first choice, then retry through the node the
     * indexer is currently following. The fallback never comes from request
     * input and its URL is never returned to the browser. */
    const fallbackBase = deps.chain()?.rpc_url?.replace(/\/+$/, "");
    const upstreamBases = [upstreamBase, fallbackBase]
      .filter((base): base is string => Boolean(base))
      .filter(
        (base, index, all) =>
          all.findIndex((candidate) => candidate.toLowerCase() === base.toLowerCase()) === index,
      );

    for (const [candidateIndex, base] of upstreamBases.entries()) {
      const upstream = new URL(base.replace(/\/+$/, "") + rpcPath);
      for (const [key, value] of forwardedParams) upstream.searchParams.set(key, value);
      try {
        const res = await fetch(upstream, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(4_500),
        });
        if (!res.ok) {
          req.log.warn(
            { rpcPath, candidateIndex, status: res.status },
            "Direct RPC candidate returned an error",
          );
          continue;
        }
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > DIRECT_RPC_MAX_BYTES) {
          req.log.warn({ rpcPath, candidateIndex }, "Direct RPC candidate response too large");
          continue;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength > DIRECT_RPC_MAX_BYTES) {
          req.log.warn({ rpcPath, candidateIndex }, "Direct RPC candidate response too large");
          continue;
        }
        return JSON.parse(bytes.toString("utf8")) as unknown;
      } catch (error) {
        req.log.warn(
          { err: error, rpcPath, candidateIndex },
          "Direct RPC candidate request failed",
        );
      }
    }

    reply.code(502);
    return { error: "all Direct RPC providers are temporarily unavailable" };
  });

  // Shared across the validator, validator-set and metrics routes so one
  // refresh cycle costs a single scan rather than five.
  const metricsCache = new CacheMap(
    (chainId) => validatorMetrics(pool, Number(chainId)),
    DERIVED_TTL_MS,
  );
  const proposedCache = new CacheMap(
    (chainId) => proposedTotal(pool, Number(chainId)),
    DERIVED_TTL_MS,
  );
  /**
   * The metrics horizon scans (30-day series, per-day volume) and the
   * per-validator slot joins are uncached otherwise — an anonymous flood of
   * GETs through the public facade would hold every pool connection busy.
   * Same TTL + coalescing as the other caches: a burst costs one scan.
   */
  const statsCache = new CacheMap(
    (key: string) => {
      const [chainId, hours] = key.split(":").map(Number);
      return Promise.all([
        metricStats(pool, chainId, hours),
        seriesBuckets(pool, chainId, hours * 60, hours <= 24 ? 60 : 120),
        blocksPerBucket(pool, chainId, hours),
      ]);
    },
    10_000,
  );
  const slotsCache = new CacheMap(
    (key: string) => {
      const [chainId, address, win] = key.split(":");
      return signingSlots(pool, Number(chainId), address, Number(win));
    },
    5_000,
  );

  /**
   * Any unhandled route failure is almost always the database being
   * unreachable. Report it in the shape the client already maps to its
   * `dberror` state — but never echo the raw error to the client: pg messages
   * carry internal topology (DB host, role names, timeouts) and both surfaces
   * are anonymous. The full error is logged server-side.
   */
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    app.log.error({ err }, "request failed");
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 503;
    reply.code(status).send(
      status >= 500
        ? { status: "dberror", error: "database unavailable" }
        : { error: err.message },
    );
  });

  /** Chain row or a 503 — every data route needs it. */
  const requireChain = (reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const chain = deps.chain();
    if (!chain) {
      reply.code(503).send({
        error: "no chain configured",
        hint: "start the indexer once so it seeds the chains table from chains/*.yaml",
      });
      return null;
    }
    return chain;
  };

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  /** Same-origin market snapshot for the header ticker. Keeping this proxy
   * server-side avoids browser CORS/rate-limit failures from CoinGecko and
   * coalesces all visitors into one request per minute. */
  const COINGECKO_ID = process.env.COINGECKO_ID ?? "secret";
  const price = new Cached(async () => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(COINGECKO_ID)}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`market upstream HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, { usd?: unknown; usd_24h_change?: unknown } | undefined>;
    const usd = json[COINGECKO_ID]?.usd;
    const usd24hChange = json[COINGECKO_ID]?.usd_24h_change;
    if (typeof usd !== "number" || !Number.isFinite(usd) || typeof usd24hChange !== "number" || !Number.isFinite(usd24hChange)) {
      throw new Error(`market upstream returned an invalid ${COINGECKO_ID} payload`);
    }
    return { id: COINGECKO_ID, usd, usd_24h_change: usd24hChange };
  }, 60_000);
  app.get("/api/v1/market", async (_req, reply) => {
    try {
      return await price.get();
    } catch (e) {
      app.log.warn({ err: e }, "market data unavailable");
      reply.code(503);
      return { error: "market data unavailable" };
    }
  });

  /**
   * The consensus pipeline strip: the newest blocks with proposer identity
   * (logo via the shared avatar resolver), votes, tx count and consensus
   * round. Round > 0 = the chain needed extra rounds (slow proposer) and is
   * surfaced by the UI as a timeout marker.
   */
  app.get("/api/v1/consensus/pipeline", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const rows = await pipelineBlocks(pool, chain.id, 8);
    const withLogos = await withAvatars(
      rows.map((b) => ({ ...b, address: b.proposer_address ?? "" })),
      resolveAvatar,
    );
    return {
      blocks: withLogos.map((b, i) => ({
        height: b.height,
        time: b.time.toISOString(),
        proposer: b.proposer_address
          ? {
              address: b.proposer_address,
              moniker: b.moniker,
              avatar_url: b.avatar_url,
            }
          : null,
        tx_count: b.tx_count,
        votes: { signed: b.signature_count, total: b.validator_count },
        round: rows[i].round,
      })),
    };
  });

  /** Recent indexed blocks for the dedicated Blocks view. Unlike the compact
   * pipeline strip this returns newest first and keeps the consensus fields
   * visible for inspection. */
  app.get<{ Querystring: { limit?: string } }>("/api/v1/blocks", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const requested = Number(req.query.limit ?? 25);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 25;
    const rows = await pipelineBlocks(pool, chain.id, limit);
    const withLogos = await withAvatars(
      rows.map((b) => ({ ...b, address: b.proposer_address ?? "" })),
      resolveAvatar,
    );
    return {
      blocks: withLogos.reverse().map((b) => ({
        height: b.height,
        hash: b.hash,
        time: b.time.toISOString(),
        proposer: b.proposer_address
          ? { address: b.proposer_address, moniker: b.moniker, avatar_url: b.avatar_url }
          : null,
        tx_count: b.tx_count,
        votes: { signed: b.signature_count, total: b.validator_count },
        round: b.round,
      })),
    };
  });

  /**
   * Recent transactions, read through the LCD for the newest indexed blocks
   * that carried any. The indexer stores tx counts, not payloads; a block's
   * txs never change, so each height is cached for 10 minutes. Compute
   * messages are reported as sealed (see lcd.ts) — never decoded.
   */
  const TX_BLOCKS_SCANNED = 12;
  const txsAt = new CacheMap((h: string) => txsAtHeight(lcd, Number(h)), 10 * 60_000);
  const labels = new CacheMap((addr: string) => contractInfo(lcd, addr), 60 * 60_000);
  const withLabels = async <T extends { contract: string | null }>(rows: T[]) =>
    Promise.all(
      rows.map(async (r) => ({
        ...r,
        contract_label: r.contract ? ((await labels.get(r.contract).catch(() => null))?.label ?? null) : null,
      })),
    );

  app.get<{ Params: { height: string } }>("/api/v1/blocks/:height/transactions", async (req, reply) => {
    if (!requireChain(reply)) return;
    const height = Number(req.params.height);
    if (!/^\d+$/.test(req.params.height) || !Number.isSafeInteger(height) || height < 1) {
      reply.code(400);
      return { error: "height must be a positive integer" };
    }
    try {
      return { transactions: await withLabels(await txsAt.get(String(height))), limit: 100 };
    } catch (e) {
      app.log.warn({ err: e, height }, "block transactions unavailable");
      reply.code(503);
      return { error: "block transactions unavailable" };
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/api/v1/transactions", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    if (!lcd.configured) {
      reply.code(503);
      return { error: "no LCD configured" };
    }
    const requested = Number(req.query.limit ?? 25);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 25;
    const heights = await pool.query<{ height: number }>(
      `select height from blocks where chain_id = $1 and tx_count > 0 order by height desc limit $2`,
      [chain.id, TX_BLOCKS_SCANNED],
    );
    try {
      const out: TxSummary[] = [];
      for (const { height } of heights.rows) {
        out.push(...(await txsAt.get(String(height))));
        if (out.length >= limit) break;
      }
      return { transactions: await withLabels(out.slice(0, limit)) };
    } catch (e) {
      app.log.warn({ err: e }, "LCD transactions unavailable");
      reply.code(503);
      return { error: "transaction data unavailable" };
    }
  });

  app.get<{ Params: { hash: string } }>("/api/v1/transactions/:hash", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const hash = req.params.hash.toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hash)) {
      reply.code(400);
      return { error: "hash must be 64 hex characters" };
    }
    try {
      const tx = await txByHash(lcd, hash);
      if (!tx) {
        reply.code(404);
        return { error: "transaction not found", hash };
      }
      const messages = await withLabels(tx.messages);
      const [labelled] = await withLabels([tx]);
      return { transaction: { ...labelled, messages } };
    } catch (e) {
      if (e instanceof LcdNotFound) {
        reply.code(404);
        return { error: "transaction not found", hash };
      }
      app.log.warn({ err: e }, "LCD transaction unavailable");
      reply.code(503);
      return { error: "transaction data unavailable" };
    }
  });

  /** Governance: newest proposals with live tallies, plus tally params. */
  const govCache = new Cached(async () => {
    const [list, params] = await Promise.all([proposals(lcd, 30), govParams(lcd)]);
    return { proposals: list, params };
  }, 30_000);
  app.get("/api/v1/governance", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    if (!chain.capabilities.governance || !lcd.configured) {
      reply.code(404);
      return { error: "governance not supported on this chain" };
    }
    try {
      return { ...(await govCache.get()), updated_at: new Date().toISOString() };
    } catch (e) {
      app.log.warn({ err: e }, "LCD governance unavailable");
      reply.code(503);
      return { error: "governance data unavailable" };
    }
  });

  /**
   * Staking snapshot plus the next software upgrade: the scheduled plan when
   * governance has passed one, otherwise a MsgSoftwareUpgrade still in voting
   * (flagged pending), so the Overview banner can count down either way.
   */
  const stakingCache = new Cached(async () => {
    const [pool_, plan, gov, slashing] = await Promise.all([
      stakingPool(lcd),
      upgradePlan(lcd).catch(() => null),
      govCache.get().catch(() => null),
      slashingParams(lcd).catch(() => null),
    ]);
    const pending = gov?.proposals.find(
      (p) => p.upgrade && (p.status === "PROPOSAL_STATUS_VOTING_PERIOD" || p.status === "PROPOSAL_STATUS_PASSED"),
    );
    const upgrade = plan
      ? { ...plan, proposal_id: pending?.upgrade?.name === plan.name ? pending.id : null, status: "scheduled" as const }
      : pending?.upgrade
        ? { ...pending.upgrade, info: null, proposal_id: pending.id, status: "pending_vote" as const }
        : null;
    return { pool: pool_, upgrade, slashing };
  }, 30_000);
  app.get("/api/v1/staking", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    if (!chain.capabilities.delegations || !lcd.configured) {
      reply.code(404);
      return { error: "staking not supported on this chain" };
    }
    try {
      return await stakingCache.get();
    } catch (e) {
      app.log.warn({ err: e }, "LCD staking unavailable");
      reply.code(503);
      return { error: "staking data unavailable" };
    }
  });

  /**
   * The public RPC directory (chainlist-style): verified endpoints this
   * monitor runs on, plus community endpoints discovered on the P2P
   * network — each with its own evidence (sync state, archive depth,
   * latency). Read-only; promotion to the failover rotation stays a human
   * decision made in .env.
   */
  app.get("/api/v1/rpc-directory", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const rows = await rpcDirectory(pool, chain.id);
    return {
      chain_id: chain.chain_id,
      count: rows.length,
      endpoints: rows.map((e) => ({
        ...e,
        first_seen: e.first_seen ? e.first_seen.toISOString() : null,
        last_seen: e.last_seen ? e.last_seen.toISOString() : null,
      })),
    };
  });

  app.get("/api/v1/network", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    try {
      const [n, bootstrap, changes, recent, endpoints] = await Promise.all([
        networkSummary(pool, chain.id),
        isBootstrapSet(pool, chain.id),
        setChanges(pool, chain.id, 1),
        recentBlockSigning(pool, chain.id, 100),
        listEndpoints(pool, chain.id),
      ]);
      const active = endpoints.find((e) => e.is_active) ?? null;

      const head = deps.head();
      const headState = head.current;
      const headHeight = head.isFresh ? headState.height : null;
      const lag =
        headHeight !== null && n.latest_indexed_height !== null
          ? Math.max(0, headHeight - n.latest_indexed_height)
          : null;

      const longFilled = Math.min(n.blocks_in_long_window, LONG_WINDOW);
      const longComplete = longFilled >= LONG_WINDOW;

      /**
       * Staleness fallback for when the chain head is unknown: lag needs a
       * reachable RPC, but an unreachable RPC is exactly when indexing has
       * stopped — relying on lag alone reports "normal" while nothing is being
       * ingested. Time since the last indexed block needs no RPC, so it catches
       * that case.
       */
      const stale = indexerStall(n).stale;

      const status =
        n.blocks_indexed === 0
          ? "empty"
          : (lag !== null && lag > STALL_LAG_BLOCKS) || stale
            ? "stopped"
            : !longComplete
              ? "backfill"
              : "normal";

      return {
        chain: {
          slug: chain.slug,
          name: chain.name,
          chain_id: chain.chain_id,
          family: chain.family,
          blockscout_url: chain.blockscout_url,
          capabilities: chain.capabilities,
          bech32_prefix: chain.meta?.bech32Prefix ?? null,
          denom: chain.meta?.denom ?? null,
        },
        status,
        latest_indexed_height: n.latest_indexed_height,
        earliest_indexed_height: n.earliest_indexed_height,
        blocks_indexed: n.blocks_indexed,
        blocks_indexed_24h: n.blocks_indexed_24h,
        last_block_time: n.last_block_time,
        avg_block_time_ms: n.avg_block_time_ms,
        signing_rate_100: n.signing_rate_100,
        /** Share of the set's voting power that committed over the last 100
         *  blocks — the "is consensus actually working" number. */
        signing_power_online: n.signing_power_online,
        active_validators: n.active_validators,
        total_validators: n.total_validators,
        chain_head_height: headHeight,
        indexer_lag_blocks: lag,
        node_version: headState.version,
        head_error: headState.error,
        long_window: { target: LONG_WINDOW, filled: longFilled, complete: longComplete },
        vset_bootstrap: bootstrap,
        active_endpoint: active
          ? {
              id: active.id,
              label: active.label,
              healthy: active.healthy,
              latency_ms: active.latency_ms,
              last_height: active.last_height,
              pinned: active.pinned,
            }
          : null,
        recent_signing: recent.map((b) => ({
          height: b.height,
          signed: b.signature_count,
          total: b.validator_count,
        })),
        last_set_change: changes[0]
          ? { height: changes[0].height, time: changes[0].time, type: changes[0].change_type }
          : null,
        updated_at: new Date().toISOString(),
      };
    } catch (e) {
      app.log.error({ err: e }, "network query failed");
      reply.code(503);
      return { status: "dberror", error: "database unavailable" };
    }
  });

  app.get("/api/v1/validators", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rows, total] = await Promise.all([
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
    const withLogos = await withAvatars(rows, resolveAvatar);
    const validators = withLogos.map((v) => viewValidator(v, total));
    // Rank by proposer share so the list order matches the "rank" column.
    validators.sort((a, b) => (b.proposer_share_1000 ?? 0) - (a.proposer_share_1000 ?? 0));
    return {
      count: validators.length,
      windows: { short: SHORT_WINDOW, long: LONG_WINDOW },
      validators: validators.map((v, i) => ({ rank: i + 1, ...v })),
    };
  });

  app.get<{ Params: { address: string }; Querystring: { window?: string } }>(
    "/api/v1/validators/:address",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const address = req.params.address;
      const win = Math.min(5_000, Math.max(1, Number(req.query.window ?? 500) || 500));

      const [rows, total, slots] = await Promise.all([
        metricsCache.get(chain.id),
        proposedCache.get(chain.id),
        slotsCache.get(`${chain.id}:${address}:${win}`),
      ]);
      const row = rows.find((r) => r.address.toLowerCase() === address.toLowerCase());
      if (!row) {
        reply.code(404);
        return { error: "validator not found", address };
      }
      const [withLogo] = await withAvatars([row], resolveAvatar);
      return {
        validator: viewValidator(withLogo, total),
        window: win,
        slots: slots.map((s) => ({
          height: s.height,
          // null => the validator was not in the set at that height
          signed: s.signed,
          time: s.time,
        })),
      };
    },
  );

  app.patch<{
    Params: { address: string };
    Body: { label?: string | null; watched?: boolean };
  }>("/api/v1/validators/:address", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const { label, watched } = req.body ?? {};
    if (label === undefined && watched === undefined) {
      reply.code(400);
      return { error: "body must include { label: string|null } and/or { watched: boolean }" };
    }
    if (label !== undefined && label !== null && typeof label !== "string") {
      reply.code(400);
      return { error: "label must be a string or null" };
    }
    if (watched !== undefined && typeof watched !== "boolean") {
      reply.code(400);
      return { error: "watched must be a boolean" };
    }
    const row = await setValidatorIdentity(pool, chain.id, req.params.address, { label, watched });
    if (!row) {
      reply.code(404);
      return { error: "validator not found", address: req.params.address };
    }
    return row;
  });

  app.get("/api/v1/validator-set", async (_req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const [rows, total, changes, bootstrap] = await Promise.all([
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
      setChanges(pool, chain.id, 50),
      isBootstrapSet(pool, chain.id),
    ]);
    const members = (await withAvatars(rows, resolveAvatar)).map((v) => viewValidator(v, total));
    const active = members.filter((m) => m.is_active);
    return {
      set_size: active.length,
      total_voting_power: active.reduce((a, m) => a + (m.voting_power ?? 0), 0),
      bootstrap,
      members: members.map((m, i) => ({ rank: i + 1, ...m })),
      changes: changes.map((c) => ({
        height: c.height,
        address: c.validator_address,
        type: c.change_type,
        power_before: c.voting_power_before,
        power_after: c.voting_power_after,
        time: c.time,
      })),
    };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/v1/metrics", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    // Fixed horizons, not arbitrary numbers: a 17h outage empties a 24h
    // window, so 7d/30d exist to keep history visible through one.
    const hours = [24, 168, 720].includes(Number(req.query.hours))
      ? Number(req.query.hours)
      : 24;
    const [[stats, day, volume], rows, total] = await Promise.all([
      statsCache.get(`${chain.id}:${hours}`),
      metricsCache.get(chain.id),
      proposedCache.get(chain.id),
    ]);
    // The distribution carries no avatars, so it maps the raw rows through
    // viewValidator with the logo fields left unset.
    const dist = rows
      .map((v) => viewValidator(v, total))
      .sort((a, b) => (b.proposer_share_1000 ?? 0) - (a.proposer_share_1000 ?? 0))
      .map((v, i) => ({
        rank: i + 1,
        address: v.address,
        share: v.proposer_share_1000,
        status: v.status,
      }));
    return {
      hours,
      stats,
      series: day.map((b) => ({
        t: b.bucket,
        block_time_s: b.block_time_s,
        signing_rate: b.signing_rate,
        n: b.n,
      })),
      volume: {
        unit: volume.unit,
        points: volume.rows.map((r) => ({ t: r.t, n: r.n })),
      },
      proposer_distribution: dist,
    };
  });

  app.get<{ Querystring: { minutes?: string; buckets?: string } }>(
    "/api/v1/series",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const minutes = Math.min(1440, Math.max(1, Number(req.query.minutes ?? 60) || 60));
      const buckets = Math.min(240, Math.max(2, Number(req.query.buckets ?? 60) || 60));
      const rows = await seriesBuckets(pool, chain.id, minutes, buckets);
      return {
        minutes,
        points: rows.map((b) => ({
          t: b.bucket,
          block_time_s: b.block_time_s,
          signing_rate: b.signing_rate,
          n: b.n,
        })),
      };
    },
  );

  /**
   * True when the request arrived through the public facade (set PUBLIC_HOST
   * to its hostname). Endpoint URLs and failure telemetry name the operator's
   * infrastructure — anonymous visitors get health and latency, not topology.
   */
  const viaPublicFacade = (host: string | undefined): boolean => {
    const publicHost = process.env.PUBLIC_HOST;
    return Boolean(publicHost) && Boolean(host) && host!.split(":")[0] === publicHost;
  };

  app.get<{ Headers: { host?: string } }>("/api/v1/endpoints", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const rows = await listEndpoints(pool, chain.id);
    const publicView = viaPublicFacade(req.headers.host);
    return {
      count: rows.length,
      endpoints: rows.map((e) => ({
        ...e,
        // A node URL can carry credentials; never hand them back.
        rpc_url: redactUrl(e.rpc_url),
        ws_url: redactUrl(e.ws_url),
        // And through the public facade: no URLs, no failure text.
        ...(publicView ? { rpc_url: null, ws_url: null, last_error: null } : {}),
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { pinned?: boolean } }>(
    "/api/v1/endpoints/:id",
    async (req, reply) => {
      const chain = requireChain(reply);
      if (!chain) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        reply.code(400);
        return { error: "id must be an integer" };
      }
      if (typeof req.body?.pinned !== "boolean") {
        reply.code(400);
        return { error: "body must be { pinned: boolean }" };
      }
      const row = await setEndpointPinned(pool, chain.id, id, req.body.pinned);
      if (!row) {
        reply.code(404);
        return { error: "endpoint not found for this chain", id };
      }
      return { ...row, rpc_url: redactUrl(row.rpc_url), ws_url: redactUrl(row.ws_url) };
    },
  );

  app.get<{ Headers: { host?: string } }>("/api/v1/config", async (req, reply) => {
    const chain = requireChain(reply);
    if (!chain) return;
    const publicView = viaPublicFacade(req.headers.host);
    return {
      chain: {
        slug: chain.slug,
        name: chain.name,
        chain_id: chain.chain_id,
        family: chain.family,
        // Never leak credentials that may be embedded in an RPC URL; through
        // the public facade, no URLs at all.
        rpc_url: publicView ? null : redactUrl(chain.rpc_url),
        ws_url: publicView ? null : redactUrl(chain.ws_url),
        blockscout_url: chain.blockscout_url,
        bech32_prefix: chain.meta?.bech32Prefix ?? null,
        denom: chain.meta?.denom ?? null,
        lcd_urls: publicView ? [] : (chain.meta?.lcdUrls ?? []).map((u) => redactUrl(u)),
      },
      capabilities: chain.capabilities,
      indexer: {
        backfill_depth: Number(process.env.BACKFILL_DEPTH ?? 50_000),
        poll_interval_ms: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
        ingestion: "idempotent · ON CONFLICT DO NOTHING",
        database: "postgres:16 · drizzle",
      },
      windows: { short: SHORT_WINDOW, long: LONG_WINDOW },
    };
  });
}

/**
 * Strip userinfo and query strings; keep enough to identify the endpoint.
 * The regex fallback matters: an unparseable URL returned verbatim could carry
 * credentials straight through the public facade.
 */
function redactUrl(raw: string | null): string | null {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    u.search = "";
    return u.toString();
  } catch {
    return raw.replace(/\/\/[^/@:]+:[^/@]+@/, "//").replace(/\/\/[^/@]+@/, "//");
  }
}

export { getChain };
