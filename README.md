# Secret Network Explorer

> Real-time network and validator monitor for Secret Network — what the chain shows, and what it seals.

**Secret Network Explorer** (by Pathrock Network) indexes `secret-4` block production and validator signing (uptime, missed-block
streaks, proposer share, validator-set changes) and serves it through a REST API and a React
dashboard. Transactions, governance and staking are read through the chain's LCD. Secret's
privacy model is shown honestly: the public envelope (signer, fee, gas, contract address and
label) is displayed plainly, while contract inputs, response data and most wasm event
attributes are reported as **sealed**, with only their ciphertext size.

Ported from [mezo-monitor](https://github.com/r0bops/mezo-monitor); the CometBFT adapter is
chain-agnostic, and `chains/secret.yaml` is the chain-specific surface.

## Stack
- TypeScript (Node 20+, ESM), pnpm workspaces
- PostgreSQL 16
- Drizzle ORM · Fastify · ws · zod · React + Vite

## Layout
| Path | Responsibility |
|------|----------------|
| `packages/core` | DB schema, migrations, shared db client |
| `packages/adapters/cometbft` | Generic CometBFT indexer: block ingest, validator-set tracking, x/staking + x/slashing sync |
| `packages/api` | Fastify REST API, LCD read-through (txs, governance, staking), dashboard host |
| `packages/web` | React dashboard (Vite) |
| `chains/*.yaml` | Per-chain config (`chains/secret.yaml`) |
| `docs/` | Secret Network reference notes gathered for this project |

## Quickstart
```bash
pnpm install
cp .env.example .env         # defaults point at the public Secret³ RPC/LCD
pnpm db:up                   # Postgres in Docker on 127.0.0.1 (or use a local Postgres)
pnpm db:migrate
pnpm --filter @sealed/web build
pnpm dev                     # indexer + API; dashboard on http://127.0.0.1:3000
pnpm test                    # needs DATABASE_URL; uses a throwaway test database
```

The public Secret³ RPC is not an archive (it kept ~440k–950k blocks when checked), so keep
`BACKFILL_DEPTH` well inside its history. The default is 50,000 blocks (~3.5 days).

## Running as a service
```bash
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sealed-indexer sealed-api
```
The units expect Node/pnpm from nvm (`Environment=PATH=…`); adjust the path if Node lives elsewhere.

## Transaction index (yaci)
[yaci](https://github.com/manifest-network/yaci) indexes every transaction over gRPC into its own
database (`sealed_yaci`). With `YACI_DATABASE_URL` set, the API serves the transaction feed, block
transactions, lookups by hash, paging (`before`) and address history (`address`) from it, and falls
back to the LCD while yaci is catching up or for anything it has not indexed. The gRPC endpoint
(`YACI_GRPC`) must have server reflection enabled.

```bash
# Build yaci with the request pacing patch (public gRPC gateways 429 a burst of reflection calls)
git clone https://github.com/manifest-network/yaci && cd yaci && git checkout d086ce6
git apply ../secretnetwork-explorer/deploy/yaci/pacing.patch && go build -o /usr/local/bin/yaci .
# Database, indexes and services
sudo -u postgres psql -c "create role web_anon nologin" -c "create database sealed_yaci owner sealed"
sudo cp deploy/sealed-yaci*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now sealed-yaci                    # follows new blocks
psql "$YACI_DATABASE_URL" -f deploy/yaci/indexes.sql      # after yaci's first migration
sudo systemctl enable --now sealed-yaci-backfill           # walks history back to the node's pruning horizon
```
Concurrency is kept low (2 live, 3 backfill): 20 parallel requests drew 429s from the gateway; 3 never
did, at ~10 blocks/s. Over gRPC, Secret compute messages carry `sender`/`contract` as raw bytes;
`packages/api/src/yaci.ts` converts them to bech32, and address search matches both forms. A full
backfill of ~1M blocks takes roughly a day and ~13 GB.

## Public site
Live at https://secretnetwork.explorer.pathrocknetwork.org. Caddy terminates TLS
(Let's Encrypt, auto-renewed) and proxies to the API on 127.0.0.1:3000:
```bash
sudo apt install caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Set `PUBLIC_HOST=secretnetwork.explorer.pathrocknetwork.org` in `.env` so visitors get RPC/LCD
URLs and endpoint errors redacted. The Caddyfile answers every non-GET request with 405, so
label, watch and pin edits only work over loopback (`http://127.0.0.1:3000`).

## Endpoints
- `GET /api/v1/network` — height, block time, signing rate, active set, indexer lag
- `GET /api/v1/validators` · `GET /api/v1/validators/:address?window=N` — signing metrics plus
  the x/staking view (operator, tokens, commission, bond status, jailed, missed counter)
- `GET /api/v1/validator-set` · `/metrics` · `/series` · `/endpoints` · `/rpc-directory` · `/config`
- `GET /api/v1/transactions?limit&before&address` · `GET /api/v1/transactions/:hash` — from the
  yaci index (LCD fallback); `before` pages by height, `address` returns an account's or contract's
  history; compute ciphertext is returned as `{ sealed: true, bytes }`
  Below the oldest block yaci holds, an address's history comes from the node's tx index, then from
  `SECRET_LCD_HISTORY_URLS` (optional, deeper-retention LCDs) below that; hash lookups fall back to them too.
- `GET /api/v1/accounts/:address` — an account's or contract's public funds via the LCD:
  bank balances, delegations (with validator monikers), unclaimed rewards, unbonding.
- `GET /api/v1/governance` — newest proposals with live tallies and tally params
- `GET /api/v1/staking` — bonded pool, slashing params (jail threshold) and the next upgrade
- `GET /api/v1/market` — SCRT/USD (CoinGecko, cached)

Values that cannot be known are `null`, never `0`.

## Dashboard
Overview (with the software-upgrade countdown), Validators, Blocks, Transactions (sealed
fields), Governance, Analytics, Network (RPC directory + node map), RPC Console, API
Reference, Settings. Dark and light themes; works at phone width.
