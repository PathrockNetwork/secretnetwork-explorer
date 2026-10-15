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
- `GET /api/v1/transactions` · `GET /api/v1/transactions/:hash` — LCD read-through; compute
  ciphertext is returned as `{ sealed: true, bytes }`
- `GET /api/v1/governance` — newest proposals with live tallies and tally params
- `GET /api/v1/staking` — bonded pool, slashing params (jail threshold) and the next upgrade
- `GET /api/v1/market` — SCRT/USD (CoinGecko, cached)

Values that cannot be known are `null`, never `0`.

## Dashboard
Overview (with the software-upgrade countdown), Validators, Blocks, Transactions (sealed
fields), Governance, Analytics, Network (RPC directory + node map), RPC Console, API
Reference, Settings. Dark and light themes; works at phone width.
