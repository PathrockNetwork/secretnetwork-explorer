# Secret Network — context for the explorer

Distilled from https://docs.scrt.network/ (full text: https://docs.scrt.network/llms-full.txt), read 2026-10-10.
That site is now **node-operator documentation from Secret³ Dev** (setup, SGX, registration, upgrades, validators).
It does not cover contract development, SNIP-20/721, viewing keys/permits, or tx encryption. Get those from
other sources (secret.js docs, the SecretNetwork repo).

## Chain basics

| Item | Value |
| --- | --- |
| Mainnet chain-id | `secret-4` |
| Testnet chain-ids mentioned | `trinity-b` (current "TRINITY" testnet builds); `pulsar-3` (old; don't use with 1.27.x) |
| Node binary | `secretd` (also `secretcli`), current version `1.27.2`, then `1.27.3` |
| Stack | Cosmos SDK 0.50+ (`config set client ...` syntax), CometBFT, CosmWasm in an Intel SGX enclave |
| Denom | `uscrt` (1 SCRT = 1,000,000 uscrt) |
| Bech32 prefixes | account `secret`, validator operator `secretvaloper`, consensus `secretvalcons` |
| Coin type / purpose | `529` / `44` (`--legacy-hd-path` = 118) |
| Account key algo | secp256k1; consensus key algo is ed25519 (only allowed pubkey type) |
| Block time | ~6 s (`timeout_commit` 5s) |
| Recommended gas price | `0.1uscrt` (node `minimum-gas-prices`) |
| Gov authority address | `secret10d07y265gmmuvt4z0w9aw880jnsr700jc88vt0` |

## Public endpoints (Secret³)

| Role | URL |
| --- | --- |
| RPC (CometBFT JSON-RPC) | `https://rpc.secret.mainnet.secret3.dev` |
| LCD (Cosmos REST, what secret.js uses) | `https://lcd.secret.mainnet.secret3.dev` |
| WebSocket | `wss://<rpc-host>/websocket` (`subscribe`/`unsubscribe` only over WS) |
| Snapshots | `https://mainnet-secret-snapshot.secret3.dev` |
| Governance UI referenced | https://secretnodes.com/governance/<id> |

The release RPC is **not an archive**. Default pruning keeps the last 362,880 versions (~3.5 weeks), so
historical state queries (`x-cosmos-block-height` header) fail for old heights on non-archive nodes with
`version does not exist...`. Old blocks/txs may still be served (`min-retain-blocks = 0`, `indexer = "kv"`).
An explorer that needs full history needs its own archive node (`pruning = "nothing"`, replayed from genesis
or from the first needed height) or its own indexer.

### Useful routes

- RPC: `/status`, `/net_info`, `/abci_info`, `/block`, `/block_results`, `/tx`, `tx_search`, `block_search`,
  `/validators`, `/consensus_state`, `/unconfirmed_txs`, `/health` (does not check sync).
- LCD: `/cosmos/base/tendermint/v1beta1/node_info`, `/cosmos/base/tendermint/v1beta1/blocks/latest`,
  `/cosmos/base/node/v1beta1/status` (`height`, `earliest_store_height`), standard Cosmos module routes
  (bank, staking, slashing, distribution, gov).
- Secret registration module (LCD): `/registration/v1beta1/tx-key`, `/registration/v1beta1/registration-key`,
  `/registration/v1beta1/encrypted-seed/{pub_key}`.
- RPC limits on a default node: `max_request_batch_size` 10, 100 WS clients, 5 subscriptions per client.
  Public providers are expected to rate-limit `tx_search`, `block_search`, `abci_query`. Cache and back off.

### secret.js

```js
import { SecretNetworkClient } from "secretjs";
const secretjs = new SecretNetworkClient({
  url: "https://lcd.secret.mainnet.secret3.dev", // LCD, not RPC 26657 and not gRPC 9090
  chainId: "secret-4",
});
```

Browsers hitting LCD need CORS from the provider or our own proxy (operator guidance is `enabled-unsafe-cors = false`).

## Secret-specific modules / messages an explorer will see

- `compute` module (`/secret.compute.v1beta1.*`): secret contracts. Inputs/outputs are encrypted. `pruning = "nothing"`
  keeps ciphertext but does not decrypt it; decrypting needs the tx sender's key, or a registered enclave for queries.
  - `MsgUpdateMachineWhitelistProposal` (gov), `update-machine-whitelist` tx.
  - Contract query gas limit `10000000`.
- `register` / `registration` module: node registration (`tx register auth`). Success event attributes:
  `signer`, `encrypted_seed` (`0x`+hex), `node_id` (`0x`+64 hex). Failure: `Failed to authenticate node`
  (codespace `register`, code 2). Response data starts with `S: `.
- Machine allowlist (PPID whitelist): machine id = first 20 bytes of SHA-256(PPID), 40 hex chars.

## Staking params (live)

| Param | Value |
| --- | --- |
| `max_validators` | 80 |
| bonded validators (snapshot in docs) | 23 |
| `unbonding_time` | 1814400s (21 days) |
| `max_entries` | 7 |
| `historical_entries` | 10000 |
| `min_commission_rate` | 0 |
| Consensus power | `tokens / 1_000_000` (under 1 SCRT = power 0, not bonded) |

Description byte limits: moniker 70, identity 3000, website 140, security contact 140, details 280.
Commission: max one change per 24h; `max-rate` and `max-change-rate` are fixed at creation.

## Slashing params

| Param | Value |
| --- | --- |
| `signed_blocks_window` | 22500 |
| `min_signed_per_window` | 0.5 (jail at > 11250 missed) |
| `downtime_jail_duration` | 600s |
| `slash_fraction_downtime` | 0.0001 |
| `slash_fraction_double_sign` | 0.05, plus tombstone, `jailed_until` 9999-12-31 |

Signing info fields to show: `missed_blocks_counter`, `jailed_until`, `tombstoned`, `start_height`.

## Distribution params

`community_tax` 0, `secret_foundation_tax` 0, `base_proposer_reward` 0, `bonus_proposer_reward` 0,
`withdraw_addr_enabled` true, plus Secret-specific `minimum_restake_threshold` 10000000 and `restake_period` 1000.

## Governance params

- Min deposit 5000 SCRT (`5000000000uscrt`) normal; 12,500 SCRT expedited.
- Initial deposit ratio 0. Later deposits at least 50 SCRT (125 SCRT expedited).
- Deposit period 7 days. Voting period 7 days (1 day expedited).
- Quorum 0.334, veto 0.334, threshold 0.5 (0.667 expedited).

## Upgrade timeline

- `v1.27.2`: chain halted at height `27286266`, now producing blocks.
- `v1.27.3`: proposal 381, halt height `27595508`, scheduled 2026-10-13 13:00 UTC. Host binary only,
  module migrations only, no store changes. Expect a short gap in blocks around that height.
- Releases: https://github.com/Secret3dev/SecretNetwork/releases

## Live check (2026-10-10 15:35 UTC)

- RPC `/status`: network `secret-4`, CometBFT `0.38.22`, height `27550466`, **earliest block `26594224`**
  (about 956k blocks of history, so the public RPC does not have blocks back to genesis).
- LCD `/cosmos/base/node/v1beta1/status` answers. CORS returns `access-control-allow-origin: *`, so a
  browser app can call the public LCD directly.
