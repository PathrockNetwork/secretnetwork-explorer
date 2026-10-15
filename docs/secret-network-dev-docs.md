# Secret Network: developer docs distilled for the explorer

Distilled 2026-10-10 from the old developer docs. They were removed from docs.scrt.network but their GitBook source
survives in `SecretFoundation/docs` (branch `gitbook`, last commit 2026-09-02), along with the SNIP specs
(`SecretFoundation/SNIPs`). Source paths are cited as `sf-docs:<path>` and `snips:<file>`.
This complements `secret-network-context.md` (chain params, Secret³ endpoints, node ops), which is not repeated here.
The secret.js API is covered elsewhere, so this doc only names SDK calls where they matter.

> **Staleness warning.** Much of sf-docs predates the move to Secret³ Dev / `secret-4` v1.27 (Cosmos SDK 0.50,
> CometBFT 0.38). Where this doc disagrees with the context doc, the context doc wins. Each conflict is marked
> **[STALE?]** and listed in §8.

---

## 1. Privacy model: what an observer can and cannot see

### 1.1 Transaction flow (summary)

Sources: `sf-docs:introduction/secret-network-techstack/consensus-for-secret-transactions.md`,
`.../privacy-technology/encryption-key-management/transaction-encryption.md`,
`.../privacy-technology/private-computation-and-consensus-flow.md`.

1. The client does ECDH between its own (ephemeral or derived) curve25519 key and the network's
   `consensus_io_exchange_pubkey`, which comes from genesis or the registration module's `/registration/v1beta1/tx-key`.
2. It derives `tx_encryption_key = HKDF(shared_secret ‖ nonce)` with a random 32-byte nonce, so every tx gets its own key.
3. It encrypts `code_hash_hex ‖ json_msg` with AES-SIV. The contract input on chain is
   `nonce(32) ‖ sender_x25519_pubkey(32) ‖ ciphertext`.
4. Validators decrypt and execute inside SGX. The enclave checks that the prepended code hash matches the
   contract's code, which stops an input from being replayed into a malicious contract.
5. Outputs are encrypted with the same `tx_encryption_key`: `data`, `log` keys and values, `err`, and the `msg` of
   any sub-message to another contract. Only the tx sender, holding the private key and the nonce, can decrypt them.
6. Consensus runs over the **encrypted** outputs and the encrypted state. Results are deterministic because the
   HKDF is deterministic.

The contract state key is `contract_key = signer_id ‖ HMAC(HKDF(consensus_state_ikm, signer_id), code_hash)`, where
`signer_id = sha256(creator ‖ block_height)`. Every storage key and value is AES-SIV encrypted under keys derived
from `contract_key` (`sf-docs:.../encryption-key-management/contract-state-encryption.md`). As a result, **IAVL
state dumps of the compute store are opaque even on an archive node.**

### 1.2 Public vs encrypted, item by item

| Item | Visibility | Notes |
| --- | --- | --- |
| Tx envelope: signer, fee, gas limit, memo, sequence, signatures | **Public** | Standard Cosmos. The Cosmos memo is public, which is why SNIPs add a private `memo` field *inside* the encrypted msg (`snips:SNIP-721.md` "Memo"). |
| `gas_used` / `gas_wanted` | **Public** | Leaks which method ran unless the contract pads gas (SNIP-50 evaporation, §4.6). |
| `MsgStoreCode.wasm_byte_code` | **Public** | Contract binaries are always public (`sf-docs:.../private-computation-and-consensus-flow.md` "Public binary"). Code hash = sha256(wasm). Optional `source`/`builder` fields support verifiable builds (`sf-docs:infrastructure/secret-cli/secret-contracts.md`). |
| `MsgInstantiateContract`: sender, code_id, **label**, admin, init_funds | **Public** | `init_msg` is encrypted. |
| `MsgExecuteContract`: sender, contract, `sent_funds`, `callback_code_hash`, `callback_sig` | **Public** | `msg` is encrypted (nonce ‖ pubkey ‖ ciphertext). The nonce and pubkey prefix can be parsed and shown. |
| `MsgMigrateContract`: sender, contract, new code_id | **Public** | `msg` is encrypted. |
| Execution result `data` | **Encrypted** for the tx sender | SNIP-20/721 put their responses here rather than in logs (`snips:SNIP-20.md` "Responses"). |
| Contract event attributes (`wasm` event, `wasm-*` custom events) | **Encrypted by default** (base64 AES-SIV of both key and value) | Contracts can emit **plaintext** attributes with `add_attribute_plaintext(...)`, used by SNIP-52 (`snips:SNIP-52.md` "How it works"). The `contract_address` attribute stays plaintext (observed; not stated in sf-docs, so verify against live txs). |
| Contract errors (`err`) | **Encrypted** | The raw log shows ciphertext, so failed contract txs show "encrypted error" to everyone except the sender. |
| Sub-messages to other contracts | Target address and funds are public; inner `msg` is encrypted | Re-encrypted with the original tx's nonce and pubkey. |
| Bank messages emitted by a contract (`BankMsg::Send`) | **Public** | `transfer`/`coin_received` events show the amount, e.g. an sSCRT `redeem` payout. |
| Contract state | **Encrypted at rest** | No raw queries; only smart queries via the enclave (`sf-docs:development/development-concepts/differences-from-vanilla-cw/feature-differences.md`). |
| Smart query requests and responses | **Encrypted** end to end between client and enclave | Not on chain, but the LCD operator sees request timing and size. |
| Native SCRT (`uscrt`) and IBC-denom balances in `x/bank` | **Public** | Standard bank queries. |
| SNIP-20 balances, transfer history, allowances | **Private** | Readable only with a viewing key or permit (§3). |
| SNIP-20 `token_info` (name, symbol, decimals, optional total_supply) | **Public** query | `total_supply` MAY be omitted to hide supply (`snips:SNIP-20.md` "TokenInfo"). |
| Wrap and unwrap amounts (sSCRT `deposit` / `redeem`) | **Public** | The deposit is visible as `sent_funds`; the redeem as a bank send (`sf-docs:.../privacy-essentials.md`). |
| Storage access patterns | Visible to node operators (host OS) | Can reveal which balance key was touched. SNIP-25 decoys mitigate this (`snips:SNIP-25.md` "Rationale"). |
| Block header extras | Public but opaque | The VRF `Erand` (encrypted random) and its proof are attached to the block proposal (`sf-docs:.../secret-vrf-on-chain-randomness.md`). The cron module adds `implicit_hash` to headers (`sf-docs:cron-module/overview.md`). |

### 1.3 Leak channels an explorer can exploit, or should avoid amplifying

From `sf-docs:development/development-concepts/secret-contract-fundamentals/privacy-essentials.md`:

- Sender address, timing, frequency and links to other accounts are public.
- Public inputs and outputs: funds sent with the msg (`sent_funds`), wrap and unwrap amounts, and bank sends out of contracts.
- Ciphertext **size** of inputs and outputs, the **number and shape of log attributes**, `gas_used`, and nested contract calls.
- Contracts mitigate with `padding` fields, gas evaporation, decoy log attributes, and decoy storage access.

Showing "probably a `transfer`" from gas or ciphertext-size heuristics is technically possible. Treat it as a
deliberate product decision, not a default.

### 1.4 What the explorer can show

- **Always:** blocks, txs, signers, fees, gas, message types, contract addresses, code ids, labels, admins, creators,
  code hashes, wasm bytecode (downloadable), funds attached to executes, bank transfers, staking, governance, IBC
  packets and transfers, and native balances.
- **Never, without user keys:** contract inputs, outputs, encrypted log attributes, errors, contract state, or SNIP
  balances and histories.
- **With the connected user's keys:** their own past txs (decrypting needs the tx-encryption seed of the wallet that
  sent them; Keplr exposes enigma decrypt), and their SNIP balances and histories via viewing keys or permits.
- **Public contract queries** (no auth): e.g. SNIP-20 `token_info`, `exchange_rate`, `minters`; SNIP-721
  `contract_info`, `nft_info`; SNIP-1155 `contract_info`, `token_id_public_info`. Even these go through the enclave and
  need an encrypted query via secret.js. A plain REST call will not work.

---

## 2. Secret contracts vs vanilla CosmWasm

Sources: `sf-docs:development/development-concepts/secret-contract-cosmwasm-framework/differences-from-vanilla-cw.md`,
`.../differences-from-vanilla-cw/feature-differences.md`, `.../secret-contract-fundamentals/secret-contracts-introduction.md`.

| Topic | Vanilla CosmWasm | Secret | Explorer impact |
| --- | --- | --- | --- |
| Module / msg type URLs | `x/wasm`, `/cosmwasm.wasm.v1.*` | `x/compute`, `/secret.compute.v1beta1.MsgStoreCode`, `MsgInstantiateContract`, `MsgExecuteContract`, `MsgMigrateContract`, … | Need Secret protos, not wasmd's. |
| CosmWasm version | — | "emulates CosmWasm v1.1.9" (`sf-docs:.../secret-contracts-introduction.md`) **[STALE?]** | — |
| Code hash | Not needed | **Required** on every execute or query and in every contract-to-contract call (`callback_code_hash`), because it is bound into the encrypted msg | Show the code hash prominently on contract pages. Look it up with `/secret.compute.v1beta1.Query/CodeHashByContractAddress` (`sf-docs:development/development-concepts/submessages/get_contract_code_hash.md`). |
| Inputs / outputs / state | Plaintext | Encrypted (§1) | Message JSON cannot be rendered. |
| Events / logs | Plaintext `wasm` + `wasm-*` events | Same event types, attributes encrypted unless `add_attribute_plaintext` | Show `wasm` events as "encrypted attributes (n)" and plaintext ones normally. |
| Raw queries | `/cosmwasm/wasm/v1/contract/{addr}/raw/{key}` | **Not available**: state is encrypted | No state browser. |
| Iterators | Native | Not available on encrypted storage; secret-toolkit provides keymap/append-store instead | — |
| Labels | Not unique | **Mandatory, unique chain-wide** (`--label "$UNIQUE_LABEL"`). Contracts can be addressed by label (`secretcli tx compute execute --label`), though docs warn against relying on it (`sf-docs:infrastructure/secret-cli/secret-contracts.md`, `sf-docs:development/getting-started/compile-and-deploy.md`) | Labels work as searchable names, but anyone can register a look-alike label, so flag that risk. |
| Migration | Native with admin | Not available until **v1.11**; native admin-based migration since then. Pre-v1.11 contracts got **hardcoded admins** via gov proposals 262/269/270 and can be called by old and new code hash (`sf-docs:.../contract-migration/README.md`, `sf-docs:infrastructure/versioning-and-changelog/secret-network-v1.11.md`, `...-v1.12.md`) | Show admin, `admin_proof`, and code history. |
| Governance-gated migration | — | Since **v1.21**: `require_governance` flag (one-way), `MsgSetContractGovernance`, gov `MsgMigrateContractProposal` (batch), query `authorized-migration` (§2.1) | Show a "governance-locked" badge and the pending authorized code id. |
| Randomness | None native | `env.block.random` (32 bytes, base64) when the `random` feature is on. Derived as `hkdf(block_seed ‖ contract_key ‖ call_count)`; the seed exists only inside the enclave (`sf-docs:development/development-concepts/randomness-api/README.md`). Since v1.9 | Nothing on chain to show except `Erand` in the header. |
| Gas metering | Public, path-dependent | Same, plus `check_gas()` / `gas_evaporate()` APIs (v1.9) to make `gas_used` constant (`sf-docs:development/testing-and-best-practices/best-practices/gas-evaporation-and-tracking.md`) | `gas_used` may be deliberately inflated, so don't read it as "cost". |
| Fee market | — | "No fee market": a higher fee only raises the number of validators willing to include the tx. Doc examples use `0.0125uscrt` as "low" (`sf-docs:.../gas-fee-usage.md`) **[STALE?]**. Context doc says `0.1uscrt` | Show the fee paid. Don't compute "priority". |
| FinalizeTx | — | v1.9: a contract can force its message to be the last one in the tx, else the tx reverts (`sf-docs:development/development-concepts/execution-finalization.md`) | Explains some multi-msg tx failures. |
| `env.transaction.hash` | — | Added in v1.11 for SNIP-52 (`sf-docs:infrastructure/versioning-and-changelog/secret-network-v1.11.md`) | — |
| FeeGrant | Standard | Widely used by Secret UIs; a community faucet at `faucet.secretsaturn.net` (`sf-docs:.../gas-fee-usage.md`) | Show `fee_payer`/`granter` distinctly. |

### 2.1 Contract migration details (v1.11 and v1.21)

`ContractInfo` (from `secretjs.query.compute.contractInfo`, `sf-docs:.../contract-migration/native-from-v1.11.md`):

```json
{ "code_id": "1303", "creator": "secret1…", "label": "migrate example",
  "created": { "block_height": "1088301", "tx_index": "0" }, "ibc_port_id": "",
  "admin": "secret1…", "admin_proof": "TSxu…=" }
```

v1.21 adds `require_governance = 9` to `ContractInfo`
(`sf-docs:.../contract-migration-flow-from-v1.21/technical-details.md`):

| Admin | `require_governance` | Upgradability (`.../migration-logic.md`) |
| --- | --- | --- |
| empty | false | Not upgradable |
| GovernanceProxy contract | true | Governance-only. A gov proposal authorizes the migration, then anyone triggers the proxy. |
| address | false | Admin-only |
| address | true | Admin plus a governance authorization |

New messages and queries: `MsgSetContractGovernance{sender, contract_address}` (one-way),
`MsgMigrateContractProposal{authority, title, description, contracts:[{address,new_code_id}]}` (gov-only), and
`QueryAuthorizedMigrationRequest{contract_address}` → `{new_code_id}` (0 = none). The CLI is
`secretcli query compute authorized-migration <addr>` (`.../cli-commands.md`). Code history comes from
`contractHistory` (`ContractCodeHistoryEntry[]`).

---

## 3. Permissioned viewing: viewing keys and query permits

Sources: `sf-docs:development/development-concepts/permissioned-viewing/*`, `snips:SNIP-20.md` "Queries",
`snips:SNIP-24.md`.

Queries are unauthenticated: the contract does not know who is asking. Contracts therefore implement auth themselves.

### 3.1 Viewing keys

- The user sends a **transaction**: `create_viewing_key { entropy }` (the contract generates the key and returns it in
  encrypted `data`) or `set_viewing_key { key }`. This costs gas and needs a block.
- Later queries pass `{ address, key }`, e.g. `{"balance":{"address":"secret1…","key":"api_key_…"}}`.
- Each contract has its own key. A wallet such as Keplr can hold keys per token and share them with dApps
  (`getSecret20ViewingKey`).
- The spec requires constant-time checks, and wrong and missing keys must be indistinguishable
  (`snips:SNIP-20.md` "Queries").
- Viewing keys are still preferred for **contract-to-contract** permissions
  (`sf-docs:.../permissioned-viewing/README.md`).

### 3.2 Query permits (SNIP-24)

A permit is an offline Amino `StdSignDoc` signed with the wallet's secp256k1 key. No tx is needed. The contract derives the
signer address from the pubkey.

| Sign-doc field | Required value |
| --- | --- |
| `account_number` | `"0"` |
| `sequence` | `"0"` |
| `chain_id` | free-form, but Keplr enforces the current chain (`secret-4`) |
| `fee` | `0uscrt`, gas `"1"` |
| `memo` | `""` |
| `msgs` | exactly one `{"type":"query_permit","value":{permit_name, allowed_tokens[], permissions[]}}` |

- `permissions` for SNIP-20: `balance`, `history` (covers `transfer_history` and `transaction_history`), `allowance`.
  SNIP-721 permits usually use `owner`, which should never be shared (`snips:SNIP-721.md` "Query Permits").
- Query shape:
  `{"with_permit":{"query":{"balance":{}},"permit":{"params":{permit_name,allowed_tokens,chain_id,permissions},"signature":{"pub_key":{"type":"tendermint/PubKeySecp256k1","value":"<b64>"},"signature":"<b64>"}}}}`
- Revocation needs a tx: `revoke_permit { permit_name }`. Revoked names are stored per account in the contract.
- One permit can list **many token addresses** in `allowed_tokens`, so the explorer can ask once for all tokens it
  wants to show.
- The contract does not check `chain_id`; a permit signed for one chain-id can work on another (`snips:SNIP-24.md`).

**For the explorer:** a connected-wallet "My private balances" view should use one permit (Keplr `signAmino`)
covering the tokens shown, cache it client-side only, and fall back to the wallet's stored viewing keys for tokens
without SNIP-24 support (older `< SNIP-24` tokens such as ALTER in §5.4). Never send permits or keys to our backend.

---

## 4. Token standards

All SNIP messages accept an ignored `padding` string. Amounts are Uint128 strings. Responses carry
`"status":"success"|"failure"` where relevant (`snips:SNIP-20.md`).

### 4.1 SNIP-20 base (`snips:SNIP-20.md`)

| Kind | Name | Auth | Fields / notes |
| --- | --- | --- | --- |
| Query | `token_info {}` | **Public** | `{name, symbol, decimals, total_supply?}`. `total_supply` may be null/absent. |
| Query | `exchange_rate {}` | Public | `{exchange_rate:{rate, denom}}`, for native-backed tokens (e.g. sSCRT ↔ uscrt). |
| Query | `minters {}` | Public | `{minters:{minters:[addr]}}` |
| Query | `balance {address, key}` | **VK / permit** | `{balance:{amount}}`, returns "0" for unknown addresses. |
| Query | `transfer_history {address, key, page_size, page?}` | **VK / permit** | `txs[]: {id?, from, sender, receiver, coins:{denom, amount}}`, newest first. |
| Query | `allowance {owner, spender, key}` | **VK / permit** (owner or spender) | `{spender, owner, allowance, expiration?}` |
| Msg | `transfer`, `send` (`recipient, amount, msg?`), `register_receive` | — | `send` calls the recipient's `receive` hook. |
| Msg | `create_viewing_key`, `set_viewing_key` | — | §3.1 |
| Msg | `increase_allowance`, `decrease_allowance`, `transfer_from`, `send_from` | — | |
| Msg | `mint`, `set_minters`, `burn`, `burn_from` | — | Mintable section |
| Msg | `deposit`, `redeem {amount, denom?}` | — | Native wrapping. The deposit amount is public via `sent_funds`. |

### 4.2 SNIP-2x extensions

| SNIP | Adds | Explorer-relevant fields | Source |
| --- | --- | --- | --- |
| **21** | Private `memo` on transfer/send/mint/burn. `total` on `transfer_history`. `block_time` (unix s) and `block_height` per history item. New **`transaction_history`** query (auth) covering every balance change | `transaction_history.txs[]: {id?, block_time, block_height, coins, memo?, action}` where `action` ∈ `transfer{from,sender,recipient}`, `mint{minter,recipient}`, `burn{burner,owner}`, `deposit{}`, `redeem{}`. `total` required. | `snips:SNIP-21.md` |
| **22** | Batch msgs: `batch_transfer`, `batch_send`, `batch_transfer_from`, `batch_send_from`, `batch_mint`, `batch_burn_from` | One tx can be many transfers (invisible anyway) | `snips:SNIP-22.md` |
| **23** | Optional `recipient_code_hash` on `send`/`send_from`, so no `register_receive` is needed | — | `snips:SNIP-23.md` |
| **24** | Query permits, `with_permit`, `revoke_permit` | §3.2 | `snips:SNIP-24.md` |
| **25** | `decoys: [addr]` and optional `entropy` on transfer/send/burn/mint/deposit/redeem and batch ops, to defeat storage-access-pattern analysis | Even node operators can't be sure which accounts changed | `snips:SNIP-25.md` |
| **26** | `allowances_given {owner, page_size, page?}` and `allowances_received {spender, …}` (auth), newest first | List-all-allowances UI | `snips:SNIP-26.md` |
| **50** | `gas_target` (uint64 string) on every msg, plus a no-op `evaporate {gas_target}` msg | Makes `gas_used` constant. Expect many txs with identical gas. | `snips:SNIP-50.md` |
| **52** | Private push notifications via plaintext event attributes | §4.3 | `snips:SNIP-52.md` |

### 4.3 SNIP-52 notifications (plaintext attributes you will see)

- Attribute keys in the `wasm` event start with `snip52:`. Single-recipient (Counter/TxHash mode):
  `snip52:<notification_id>` = `<encrypted, padded notification data>`. Multi-recipient (Bloom mode):
  `snip52:#<channel_id>` = `<bloom filter ‖ data>` (`snips:SNIP-52.md` "Event Log Attributes").
- Notification IDs are HMAC-derived from a per-user seed and a counter, so to anyone else they look random. Contracts
  SHOULD emit **decoy notifications** so every tx has the same number of attributes per channel.
- Queries: `list_channels {}` is public. `channel_info {channels[], txhash?, viewer}` and `with_permit` are auth and
  return seed, counter, next id and CDDL schema. Msg: `update_seed`.
- **Explorer:** label these attributes "SNIP-52 notification (private)". With a user's channel seed, the
  client could detect "this tx notified you". The data is ChaCha20-Poly1305 encrypted.

### 4.4 SNIP-721 (private NFTs, `snips:SNIP-721.md`)

| Query | Auth | Notes |
| --- | --- | --- |
| `contract_info {}` | Public | `{name, symbol}` |
| `num_tokens {viewer?}` | Public, or minter-only if supply is private | `{count}` |
| `all_tokens {viewer?, start_after?, limit?}` | Same as above | Token ids |
| `nft_info {token_id}` | Public | Public metadata `{token_uri?, extension?}` (only one of the two) |
| `owner_of {token_id, viewer?, include_expired?}` | Owner or whitelisted, unless ownership is public | `{owner, approvals[]}` |
| `private_metadata {token_id, viewer?}` | Auth | |
| `all_nft_info`, `nft_dossier {token_id, viewer?}` | Shows only what the viewer may see | Dossier: owner, public/private metadata, `display_private_metadata_error`, royalty info, mint run info, public flags, approvals |
| `tokens {owner, viewer?, viewing_key?, start_after?, limit?}` | Auth, or public-owner tokens only | |
| `transaction_history {address, viewing_key, page?, page_size}` | **Auth** | `txs[]: {tx_id, block_height, block_time, token_id, action, memo?}`. `action` ∈ `mint{minter,recipient}`, `transfer{from,sender?,recipient}`, `burn{owner,burner?}` |
| `token_approvals`, `approved_for_all`, `inventory_approvals`, `verify_transfer_approval` | Auth | |
| `minters {}`, `royalty_info {token_id?, viewer?}`, `is_unwrapped {token_id}` | Mostly public | |

Msgs: `transfer_nft`, `send_nft`, `approve`/`revoke`/`approve_all`/`revoke_all`, `set_whitelisted_approval`
(access levels for `view_owner`, `view_private_metadata`, `transfer`), `set_global_approval` (make owner or metadata
public), `mint_nft`, `mint_nft_clones`, `batch_*`, `burn_nft`, `set_metadata`, `set_royalty_info`, `reveal` (lootboxes),
viewing-key msgs, `revoke_permit`. Public metadata `extension` follows the Stashh/OpenSea schema: `image`, `image_data`,
`external_url`, `description`, `name`, `attributes[{trait_type,value,display_type?,max_value?}]`, `background_color`,
`animation_url`, `youtube_url`, `media[{file_type, extension, authentication{key,user}, url}]`, `protected_attributes`
(`snips:SNIP-722.md`).

**[STALE?]** SNIP-721 says block height and time are not available to queries, so approval expirations are checked
against the last execute's block. This may no longer hold on v1.27.

### 4.5 SNIP-722 (badges, POAPs, soulbound, `snips:SNIP-722.md`)

- `extension.token_subtype` (e.g. `"badge"`). Query `implements_token_subtype {}` → `{is_enabled}`.
- Non-transferable: `transferable: false` on `mint_nft` / `batch_mint_nft`. Queries `is_transferable {token_id}` and
  `implements_non_transferable_tokens {}`. `nft_dossier` gains `transferable` and `unwrapped`.

### 4.6 SNIP-1155 (multi-token, `snips:SNIP-1155.md`)

- Hierarchy: contract → `token_id` (name, symbol, `token_config`, public and private metadata) → supply.
  `token_config` is `fungible{minters, decimals, public_total_supply, enable_mint, enable_burn, minter_may_update_metadata}`
  or `nft{minters, public_total_supply, owner_is_public, enable_burn, owner_may_update_metadata, minter_may_update_metadata}`.
  NFT ids have supply exactly 1.
- Roles: instantiator, optional admin (`remove_admin` exists), curators (create token_ids), minters.
- Public queries: `contract_info {}` → `{admin?, curators[], all_token_ids[]}`;
  `token_id_public_info {token_id}` → `{token_id_info{…, private_metadata:null, curator}, total_supply?, owner?}`;
  `registered_code_hash {contract}`.
- Auth queries (viewing key or `with_permit`): `balance {owner, viewer, key, token_id}`, `all_balances`,
  `transaction_history {address, key, page?, page_size}` → `txs[]{tx_id, block_height, block_time, token_id, action, memo?}`
  (`mint{minter,recipient,amount}`, `burn{burner?,owner,amount}`, `transfer{from,sender?,recipient,amount}`), `total`;
  `permission`, `all_permissions`, `token_id_private_info`.
- Msgs: `curate_token_ids`, `mint_tokens`, `burn_tokens`, `change_metadata`, `transfer`, `send`, `batch_transfer`,
  `batch_send`, `give_permission`, `revoke_permission`, viewing-key msgs, `revoke_permit`, add/remove curators and
  minters, `change_admin`, `remove_admin`, `register_receive`.

### 4.7 Detecting a token contract

There is no on-chain interface registry. Heuristics:
1. Known lists: §5.4 and the Secret Foundation AssetRegistry (github.com/SecretFoundation/AssetRegistry, referenced
   in `sf-docs:development/resources-api-contract-addresses/secret-token-contracts/README.md`).
2. A known reference code hash (§5.4 shows most tokens share a handful).
3. Probe with public queries: `token_info` → SNIP-20; `contract_info` + `num_tokens` → SNIP-721; `contract_info` with
   `curators` → SNIP-1155. Each probe is an enclave query, so cache the results per code hash.

---

## 5. Network and infrastructure facts

### 5.1 Chain IDs

| Network | Chain-id | Source / note |
| --- | --- | --- |
| Mainnet | `secret-4` | everywhere |
| Testnet (sf-docs) | `pulsar-3` (older docs also show `pulsar-2`) | `sf-docs:.../connecting-to-the-network/testnet-pulsar-3.md`. **[STALE?]** The context doc says `trinity-b` is current and `pulsar-3` should not be used with 1.27.x. |

### 5.2 Modules beyond standard Cosmos

| Module / feature | Type URLs / names | What it does | Source |
| --- | --- | --- | --- |
| `compute` | `/secret.compute.v1beta1.*` | Secret contracts (§2) | — |
| `registration` | `/secret.registration.v1beta1.*` | Node enclave registration, tx key | context doc |
| `cron` | `/secret.cron.MsgAddSchedule`, `/secret.cron.MsgRemoveSchedule` (gov only) | Runs contract execute msgs every `period` blocks in Begin/EndBlocker as the cron module account. Params: `limit` 10, `security_address` = `secret10d07y265gmmuvt4z0w9aw880jnsr700jc88vt0` (also allowed to remove). Adds **`implicit_hash`** (SHA-256 of next-round scheduled msgs) to block headers. Schedule msgs in proposals are **plaintext**: `"<code_hash_hex>{json}"`. If one msg fails, the whole schedule rolls back. Query: `secretd q cron params`, schedules. | `sf-docs:cron-module/*.md` |
| IBC panic button (`emergencybutton`) | — | "Quickly shut down IBC in case of an emergency" (v1.9). The module name `emergencybutton` is from the SecretNetwork repo, not sf-docs. | `sf-docs:infrastructure/versioning-and-changelog/secret-network-v1.9.md` |
| IBC fee middleware (ICS-29) | — | Relayer fee market (v1.9) | same |
| Packet-forward middleware (Strangelove) | — | Multi-hop routing through Secret (v1.9, fixed v1.12) | same, `...-v1.12.md` |
| IBC hooks (Osmosis) | `wasm` memo field on ICS-20 | ICS-20 transfers trigger contract calls, e.g. auto-wrap ATOM → sATOM in one tx, cross-chain swaps, Axelar GMP. Ack/timeout callbacks for contract-sent `IbcMsg::Transfer` (v1.11). | `sf-docs:.../secret-contract-fundamentals/ibc-hooks-pfm-wasm.md` |
| ICA | — | "supported but … host module [not] live" **[STALE?]** | same |
| Secret VRF | header `Erand` + proof | §2 | `sf-docs:.../secret-vrf-on-chain-randomness.md` |
| Distribution additions | `secret_foundation_tax`, auto-restake | context doc | `sf-docs:.../secret-contract-fundamentals/auto-restaking.md` |
| FeeGrant, authz, vesting | standard | FeeGrant heavily used | — |

sf-docs says "IBC-Go v4" (`.../ibc-hooks-pfm-wasm.md`) and lists Cosmos SDK v0.45 / CometBFT v0.34 in the v1.11
changelog. **[STALE]**: mainnet now runs SDK 0.50+ / CometBFT 0.38 per the context doc.

### 5.3 Public endpoints listed in sf-docs (mainnet)

Source: `sf-docs:development/resources-api-contract-addresses/connecting-to-the-network/mainnet-secret-4.md`.
**All of these predate Secret³ and may be stale.** Prefer the context doc's Secret³ endpoints and
check liveness before use. The page also points to the Cosmos chain-registry
(`cosmos/chain-registry/secretnetwork/chain.json`) for more.

| Type | URL | Operator |
| --- | --- | --- |
| RPC | `https://scrt.public-rpc.com` | Ankr |
| RPC | `https://secretnetwork-rpc.lavenderfive.com:443` | Lavender.Five |
| RPC | `https://rpc.mainnet.secretsaturn.net` | Secret Saturn |
| RPC | `https://rpc-secret.whispernode.com:443` | Whispernode |
| RPC | `https://1rpc.io/scrt-rpc` (docs have a typo, `https:///`) | 1RPC |
| RPC | `https://rpc-secret.01node.com` | 01node |
| RPC | `https://secretnetwork-rpc.highstakes.ch:26657` | High Stakes |
| RPC | `https://public.stakewolle.com/cosmos/secretnetwork/rpc` | Stakewolle |
| gRPC-web | `https://secretnetwork-grpc.lavenderfive.com:443`, `https://grpc.mainnet.secretsaturn.net` | Lavender.Five, Secret Saturn |
| LCD | `https://rpc.ankr.com/http/scrt_cosmos` | Ankr |
| LCD | `https://lcd.mainnet.secretsaturn.net` | Secret Saturn |
| LCD | `https://1rpc.io/scrt-lcd` | 1RPC |
| LCD | `https://secretnetwork-api.lavenderfive.com:443` | Lavender.Five |
| LCD | `https://rest-secret.01node.com` | 01node |
| LCD | `https://public.stakewolle.com/cosmos/secretnetwork/rest` | Stakewolle |
| LCD | `https://secretnetwork-api.highstakes.ch:1317` | High Stakes |
| LCD (Secret AI SDK default) | `https://lcd.secret.tactus.starshell.net/` | StarShell (`sf-docs:secret-ai/sdk/setting-up-your-environment/configuration-reference.md`) |

**Archive nodes** (Mario validator). These matter for history before the public RPC's earliest block
(`26594224` per the context doc):

| Type | URL | Coverage |
| --- | --- | --- |
| RPC | `https://rpc.archive.scrt.marionode.com` | 2022-12-14 → now |
| LCD | `https://lcd.archive.scrt.marionode.com` | 2022-12-14 → now |
| RPC/LCD | `https://oldarchive.scrt.marionode.com:1317` | 2021-11-10 → 2022-12-02 |

Note the gap between 2022-12-02 and 2022-12-14 (around the v1.5/v1.6 era), and that nothing before 2021-11-10
(the `secret-4` genesis epoch) is listed. Archive state only helps with public data: compute state stays encrypted.

Seed nodes: `6fb7169f7630da9468bf7cc0bcbbed1eb9ed0d7b@scrt-seed-01.scrtlabs.com:26656`,
`ab6394e953e0b570bb1deeb5a8b387aa0dc6188a@scrt-seed-02.scrtlabs.com:26656`,
`9cdaa5856e0245ecd73bd464308fb990fbc53b57@scrt-seed-03.scrtlabs.com:26656`,
`20e1000e88125698264454a884812746c2eb4807@seeds.lavenderfive.com:17156` (scrtlabs-run, likely stale).

Other explorers listed: Mintscan (`mintscan.io/secret`), Ping.pub, ATOMScan. Testnet: secretnodes.com/pulsar,
testnet.ping.pub. Testnet endpoints: `https://pulsar.{rpc,lcd,grpc}.secretnodes.com` (SNF), faucet
`pulsar-3-faucet-wine.vercel.app`, all **[STALE?]**.

### 5.4 Known SNIP token contracts (mainnet)

Source: `sf-docs:development/resources-api-contract-addresses/secret-token-contracts/README.md`, which also
references the JSON AssetRegistry. A seed list: verify each with `token_info` and the code hash at runtime.

**Native / ecosystem**

| Token | Symbol | Dec | Address | Code hash (prefix) | SNIP |
| --- | --- | --- | --- | --- | --- |
| Secret SCRT | sSCRT | 6 | `secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek` | `af74387e…` | 20 |
| Silk stablecoin | SILK | 6 | `secret1fl449muk5yq8dlad7a22nje4p5d2pnsgymhjfd` | `638a3e1d…` | 25 |
| Shade | SHD | 8 | `secret153wu605vvp934xhd4k9dtd640zsep5jkesstdm` | `638a3e1d…` | 25 |
| Shade staked SCRT | stkd-SCRT | 6 | `secret1k6u0cy4feepm6pehnz804zmwakuwdapm69tuc4` | `f6be719b…` | 24 |
| BUTT | BUTT | 6 | `secret1yxcexylwyxlq58umhgsjgstgcg2a0ytfy4d9lt` | `f8b27343…` | 20 |
| Alter | ALTER | 6 | `secret12rcvz0umvk875kd6a803txhtlu7y0pnd73kcej` | `d4f32c1b…` | < 24 |
| Amber | AMBER | 6 | `secret1s09x2xvfd2lp2skgzm29w2xtena7s8fq98v852` | `9a00ca4a…` | 24 |
| Fina | FINA | 6 | `secret1s3z9xkpdsrhk86300tqnv6u466jmdmlegew2ve` | `cfecd51a…` | 25 |

Full sSCRT code hash: `af74387e276be8874f07bec3a87023ee49b0e7ebe08178c49d0a49c3c98ed60e`. Most bridged tokens use
`638a3e1d50175fbcb8373cf801565283e3eb23d88a9b7b7f99fcc5eb1e6b561e` (SNIP-25). Some use
`5a085bd8ed89de92b35134ddd12505a602c7759ea25fb5c089ba03c8535b3042` (SNIP-24/25).

**Axelar-bridged** (all `638a3e1d…`, SNIP-25): sAXL `secret1vcau4rkn7mvfwl8hf0dqa9p0jr59983e3qqe3z`,
saUSDC `secret1vkq022x4q8t8kx9de3r84u669l65xnwf2lg3e6`, saUSDT `secret1wk5j2cntwg2fgklf0uta3tlkvt87alfj7kepuw`,
saWETH (18) `secret139qfh3nmuzfgwsx2npnmnjl4hrvj3xq5rmq8a0`, saWBTC (8) `secret1guyayjwg5f84daaxl7w84skd8naxvq8vz9upqx`,
saDAI (18) `secret1c2prkwd8e6ratk42l4vrnwz34knfju6hmp7mg7`, plus saFRAX, saUNI, saBUSD, saWBNB, swstETH, saLINK.

**IBC-bridged** (selection; the full table has ~60 rows, mostly SNIP-25):

| Symbol | Dec | IBC denom (prefix) | Address |
| --- | --- | --- | --- |
| sATOM | 6 | `ibc/27394FB0…` | `secret19e75l25r6sa6nhdf4lggjmgpw0vmpfvsw5cnpe` |
| sOSMO | 6 | `ibc/0471F1C4…` | `secret150jec8mc2hzyyqak4umv6cfevelr0x9p0mjxgg` |
| Noble USDC | 6 | `ibc/9162FF8A…` | `secret1chsejpk9kfj4vt9ec6xvyguw539gsdtr775us2` |
| USDT (Kava) | 6 | `ibc/0B1830E5…` | `secret1htd6s29m2j9h45knwkyucz98m306n32hx8dww3` |
| stATOM | 6 | `ibc/A0E80E59…` | `secret155w9uxruypsltvqfygh5urghd5v0zc6f9g69sq` |
| TIA | 6 | `ibc/8E31B43C…` | `secret1s9h6mrp4k9gll4zfv5h78ll68hdq8ml7jrnn20` |
| INJ | 18 | `ibc/5A76568E…` | `secret14706vxakdzkz9a36872cs62vpl5qd84kpwvpew` |
| dYdX | 18 | `ibc/007F5EB5…` | `secret13lndcagy53wfzh69rtv0dex3a7cks0dv5emwke` |
| AKT | 6 | `ibc/448B29AB…` | `secret168j5f78magfce5r2j4etaytyuy7ftjkh4cndqw` |
| JUNO | 6 | `ibc/DF8D00B4…` | `secret1z6e4skg5g9w65u5sqznrmagu05xq8u6zjcdg4a` |
| KUJI | 6 | `ibc/FFA324A4…` | `secret13hvh0rn0rcf5zr486yxlrucvwpzwqu2dsz6zu8` |
| STRD | 6 | `ibc/CE591002…` | `secret1rfhgs3ryqt7makakr2qw9zsqq4h5wdqawfa2aa` |
| NTRN | 6 | `ibc/F1E2912B…` | `secret1k644rvd979wn4erjd5g42uehayjwrq094g5uvj` |
| DOT | 10 | `ibc/78F0983C…` | `secret1h5d3555tz37crrgl5rppu2np2fhaugq3q8yvv9` |
| WBTC (IBC) | 8 | `ibc/CF57A83C…` | `secret1v2kgmfwgd2an0l5ddralajg5wfdkemxl2vg4jp` |

For the rest, ingest the source table or the AssetRegistry JSON, not this list. Naming guideline
(`.../snip-asset-naming-guidelines.md`): only sSCRT keeps the `s` prefix, auto-wrapped IBC assets should be shown
unprefixed, and bridged duplicates get suffixes (`.axl`, `.nbl`, `.wh`, `.grv`, `.cmp`, `.kv`). The token
table itself still uses `sATOM`-style symbols, so display `token_info.symbol` verbatim.

Data issue in the source: **sstLUNA and sstINJ list the same IBC denom**
(`ibc/C8D8F46E3CE6F41E01E32542215597CF4B32709C8A310F728653CB91FDB8A904`). At least one is wrong.

**Other known contracts**

| Contract | Address | Code id / hash | Source |
| --- | --- | --- | --- |
| SecretPath gateway (secret-4) | `secret1qzk574v8lckjmqdg3r3qf3337pk45m7qd8x02a` | 1533 / `012dd8ef…ecc5` | `sf-docs:confidential-computing-layer/ethereum-evm-developer-toolkit/supported-networks/secret-gateway/secretpath-mainnet-secret-4-contracts.md` |
| SecretPath RNG (VRF) | `secret10jyexwp4zrv50eysn3l7n4n2spf0u380lcq5nz` | 1925 / `0b9395a7…b8c3` | same |
| Secret AI WorkerManager | `secret1xv90yettghx8uv6ug23knaf5mjqwlsghau6aqa` | — | `sf-docs:secret-ai/sdk/setting-up-your-environment/configuration-reference.md` |
| Contract owning `wasm.` IBC port (purpose inferred: likely ICS-20 for SNIP-20) | `secret1tqmms5awftpuhalcv5h5mg76fa0tkdz4jv9ex4` | — | `sf-docs:infrastructure/ibc-relayers/ibc-channel-database.md` |
| Axelar `wasm.` port contract | `secret1yxjmepvyl2c25vnt53cr2dpn8amknwausxee83` | — | same |

### 5.5 IBC channels (secret-4 side)

Source: `sf-docs:infrastructure/ibc-relayers/ibc-channel-database.md` (also lists relayer addresses per chain).
Verify live with `/ibc/core/channel/v1/channels`.

| Counterparty | chain-id | Secret ch. | Their ch. | Port | Secret client | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Cosmos Hub | cosmoshub-4 | 0 | 235 | transfer | 07-tendermint-1 | Live |
| Osmosis | osmosis-1 | 1 | 88 | transfer | 07-tendermint-2 | Live |
| Osmosis | osmosis-1 | 44 | 476 | wasm.secret1tqmms5… | 07-tendermint-2 | Live |
| Terra Classic | — | 2 | 16 | transfer | — | Dead |
| Sentinel | sentinelhub-2 | 3 | 50 | transfer | 07-tendermint-14 | Live |
| Juno | juno-1 | 8 / 40 | 48 / 161 | transfer | 07-tendermint-23 | Live |
| Juno | juno-1 | 45 | 163 | wasm.secret1tqmms5… | 07-tendermint-23 | Live |
| Chihuahua | chihuahua-1 | 11 | 16 | transfer | 07-tendermint-27 | Live |
| Sifchain | sifchain-1 | 15 | 65 | transfer | 07-tendermint-37 | Dead |
| Terra | phoenix-1 | 16 | 3 | transfer | 07-tendermint-38 | Live |
| Gravity Bridge | gravity-bridge-3 | 17 | 79 | transfer | 07-tendermint-40 | Live |
| Evmos | evmos_9001-2 | 18 | 15 | transfer | 07-tendermint-42 | Live |
| Stargaze | stargaze-1 | 19 | 48 | transfer | 07-tendermint-43 | Live |
| Axelar | axelar-dojo-1 | 20 | 12 | transfer | 07-tendermint-44 | Live |
| Axelar | axelar-dojo-1 | 61 | 69 | wasm.secret1yxjmep… | 07-tendermint-120 | Live |
| Akash | akashnet-2 | 21 | 43 | transfer | 07-tendermint-47 (new: -122) | Live |
| Kujira | kaiyo-1 | 22 | 10 | transfer | 07-tendermint-48 | Live |
| Kujira | kaiyo-1 | 46 | 44 | wasm.secret1tqmms5… | 07-tendermint-48 | Live |
| Injective | injective-1 | 23 | 88 | transfer | 07-tendermint-49 | Live |
| Crescent | crescent-1 | 24 | 10 | transfer | 07-tendermint-53 | Dead |
| OKC | — | 36 | 27 | transfer | 07-tendermint-74 | Dead |
| Stride | stride-1 | 37 | 40 | transfer | 07-tendermint-75 | Live |
| Comdex | comdex-1 | 47 → 63 (new) | 44 → 65 | transfer | 07-tendermint-93 / -125 | Live |
| Agoric | agoric-3 | 51 | 10 | transfer | 07-tendermint-111 | Live |
| Migaloo | migaloo-1 | 57 | 4 | transfer | 07-tendermint-116 | Live |
| Jackal | jackal-1 | 62 | 2 | transfer | 07-tendermint-124 | Live |
| Persistence | core-1 | 64 | 82 | transfer | 07-tendermint-126 | Live |
| Quicksilver | quicksilver-2 | 65 | 52 | transfer | 07-tendermint-138 | Live |
| Composable | centauri-1 | 80 / 83 (wasm) | 14 / 26 | transfer / wasm | 07-tendermint-166 | Live |
| Archway | archway-1 | 84 / 90 (wasm) | 21 / 39 | transfer / wasm | 07-tendermint-169 | Live |
| Noble | noble-1 | 88 | 17 | transfer | 07-tendermint-170 | Live |
| dYdX | dydx-mainnet-1 | 89 | 2 | transfer | 07-tendermint-171 | Live |
| Celestia | celestia | 91 | 14 | transfer | 07-tendermint-174 | Live |

The CCL IBC toolkit names Osmosis ch-1, Noble ch-88, Axelar ch-20, Juno ch-8 and Evmos ch-18 as hooks-enabled
(`sf-docs:confidential-computing-layer/ibc/supported-networks/mainnet.md`).

### 5.6 Indexing notes

- The public Secret³ RPC is pruned (context doc). Full history needs our own archive node or an indexer. The Mario archive
  endpoints (§5.3) are possible backfill sources, but their liveness is unknown.
- Indexing compute txs: store the raw encrypted `msg` and the encrypted event attributes as-is. Index the plaintext
  attributes (`contract_address`, `snip52:*`, anything from `add_attribute_plaintext`) and the public msg fields
  (contract, sender, funds, code_id, label, admin).
- Header parsing: Secret blocks carry extra fields (`Erand`/proof for VRF, `implicit_hash` for cron). Use a CometBFT
  client that tolerates unknown header fields, or Secret's fork. Don't recompute header hashes with vanilla code
  without checking.
- Cron executions are not txs. They happen in Begin/EndBlock and appear only in `block_results`
  (`finalize_block_events` on CometBFT 0.38), so index block events as well as tx events.
- The same applies to IBC-hooks-triggered contract calls, which sit inside the relayer's `MsgRecvPacket` tx.

---

## 6. Other features an explorer might surface

**Confidential Computing Layer: EVM (SecretPath).** Gateway contracts on EVM chains forward encrypted payloads to
the Secret gateway contract (§5.4), which decrypts and re-encrypts them for a target Secret contract and signs the
result. Relayers only provide liveness (`sf-docs:.../secretpath/architecture-overview.md`). Artifacts: EVM-side
gateway txs, and on Secret `MsgExecuteContract` calls to `secret1qzk574…` from relayer accounts, followed by contract
callbacks. The SecretPath VRF uses the RNG contract `secret10jyexwp…`. Mainnet EVM gateways live at
`0xfaFCfceC4e29e9b4ECc8C0a3f7df1011580EEEf2` on Ethereum, BSC, Optimism, Arbitrum, Avalanche and Linea, and at
`0x8EaAB5e8551781F3E8eb745E7fcc7DAeEFd27b1f` on several others (Moonbeam, Sei, Gnosis, Mantle, …). See
`sf-docs:.../supported-networks/evm/evm-mainnet-gateway-contracts.md`. The explorer can label these gateway executes
as "SecretPath message" and link the source-chain tx when the payload exposes it.

**CCL: Solana.** Same gateway model. Only a **devnet** program is listed
(`DKDX8XbTnCgEk8o1RNnCUokiCmadG1Ch5HLxaz7CnhcD`, v0.2.3); the mainnet program ID is "TBD"
(`sf-docs:confidential-computing-layer/solana-developer-toolkit/program-ids/solana-mainnet-and-testnet.md`).

**CCL: IBC.** Cosmos chains call Secret contracts through IBC hooks (ICS-20 transfer with a `wasm` memo) over the
transfer channels in §5.5. Artifacts: `MsgRecvPacket` on Secret, with an ibc-hooks contract execute inside it, plus
ack/timeout callbacks. Axelar GMP from EVM uses the same path.

**Secret AI.** Confidential LLM inference on off-chain NVIDIA CC GPU workers (Intel TDX / AMD SEV). Secret contracts
handle governance and billing: **WorkerManager** (`secret1xv90yet…`) registers workers with IP, payment wallet,
**attestation report** and type; **SubscriptionManager** holds subscribers by pubkey and SHA-256 hashed API keys; a
**RewardsManager** was planned for 2025. Payments go in sSCRT/SILK/USDC, split per epoch by
`input_tokens + 4·output_tokens` (`sf-docs:secret-ai/architecture.md`, `.../economics.md`,
`.../smart-contract-reference/*`). Artifacts: encrypted executes to these contracts and SNIP-20 payment flows. The
explorer can tag the contracts and count calls, but cannot see usage.

**SecretVM.** Confidential VMs (TDX / SEV-SNP, optionally with GPU) running docker-compose workloads. By default,
key management is a **Secret Network KMS contract** (source in `scrtlabs/secret-vm-kms`): the VM submits its
attestation quote, the contract verifies it **on chain** and releases the disk/secrets key. The contract also stores
RTMR values. Every new image added to a service emits a plaintext-looking `add_image_to_service` event with
`service_id`, `admin`, `image` (attestation fields) and `description`
(`sf-docs:secretvm-confidential-virtual-machines/architecture.md`, `.../launching-a-secretvm/choosing-the-kms-provider.md`,
`.../managing-secretvm-lifecycle/secretvm-upgradeability.md`). Agents can also register via ERC-8004 on EVM chains
(not Secret). Explorer idea: a "SecretVM services" view built from `add_image_to_service` events, showing image
upgrade history per service. The KMS contract address is not given in sf-docs; find it from the repo or live txs.

---

## 7. Explorer implications

1. **Tx detail page for compute msgs.** Render public fields (sender, contract with label and code hash, funds,
   code_id). Show `msg` as "Encrypted input (N bytes)" with nonce and pubkey parsed out. Show `data`, logs and errors as
   "Encrypted output". Offer a **"Decrypt with my wallet"** action that only works for txs the connected wallet signed.
2. **Events.** Group `wasm` / `wasm-*` events. Show plaintext attributes normally and count encrypted ones. Detect and
   label `snip52:*` attributes. Never treat encrypted attribute keys as searchable.
3. **No "token transfers" tab from events.** Unlike CW-20 explorers, SNIP-20 transfers cannot be reconstructed from
   chain data. A per-token activity tab can only list *executes against the token contract* (sender, time, gas,
   funds), labelled "method hidden". Real history comes only from the user's `transaction_history` (SNIP-21) via
   permit.
4. **Account page.** Public: native and IBC bank balances, staking, txs. Private section shown on connect:
   one SNIP-24 permit over a curated token list (§5.4) for `balance` and `history`, with a viewing-key fallback for
   `< SNIP-24` tokens. Everything client-side; nothing cached server-side.
5. **Token pages.** Show public `token_info`. Total supply may be hidden: display "private" rather than 0. Show
   `exchange_rate` for wrapped natives. Holder counts and rich lists are impossible, so don't show them.
6. **Contract pages.** Code id, code hash, label, creator, `created` height, admin, `require_governance`, pending
   `authorized-migration`, code history, downloadable wasm and verified-build info. Add a "label look-alike" warning
   because labels are chosen by creators.
7. **Gas as signal.** Don't plot "gas per method" or infer methods from `gas_used` and ciphertext size by default.
   SNIP-50 makes many txs share identical gas.
8. **Wrap/unwrap visibility.** sSCRT deposits and redeems are public bank flows. Showing them is correct, but don't
   join them into "this address holds X sSCRT".
9. **Block events.** Index Begin/EndBlock events for cron executions and show them on block pages as
   "Scheduled (cron) executions".
10. **Gov proposals.** Decode `MsgAddSchedule` (plaintext contract msgs), `MsgMigrateContractProposal` (batch
    contract → code id), and `MsgUpdateMachineWhitelistProposal` (context doc).
11. **IBC.** Ship a channel → chain map (§5.5) and resolve `ibc/…` denoms to symbols. Recognise `wasm.secret1…`
    ports as contract-owned channels, and show hooks memos on ICS-20 packets (they are public).
12. **Network selector.** `secret-4` by default. Make testnet configurable (`trinity-b` per the context doc;
    `pulsar-3` is legacy).
13. **Endpoint strategy.** Primary Secret³ LCD/RPC. A configurable fallback list (§5.3) with health checks. Our own
    archive or indexer for heights below the public RPC's `earliest_block_height`.
14. **Query cost.** Every contract query is an enclave call (gas-limited, rate-limited), so cache `token_info` and
    `contract_info` by code hash and address, and batch permit queries.

---

## 8. Stale or conflicting items found

| Item | sf-docs / SNIPs says | Context doc / reality | Action |
| --- | --- | --- | --- |
| Testnet chain-id | `pulsar-3` everywhere (108 mentions), endpoints `pulsar.*.secretnodes.com` | `trinity-b` current; `pulsar-3` not for 1.27.x | Use `trinity-b` |
| Gas price | "low" `0.0125uscrt` (`gas-fee-usage.md`) | Node `minimum-gas-prices` `0.1uscrt` | Use `0.1uscrt` |
| Stack versions | IBC-go v4, SDK 0.45.16, CometBFT 0.34.29, "emulates CosmWasm 1.1.9" | SDK 0.50+, CometBFT 0.38.22 | Assume 0.50-era REST/events (`finalize_block_events`) |
| Endpoints | Ankr / Lavender / Saturn / 01node / etc.; Mario archive; scrtlabs seeds | Secret³ RPC/LCD/snapshots | Treat the sf-docs list as an unverified fallback |
| Binaries / releases | `github.com/scrtlabs/SecretNetwork/releases` | `github.com/Secret3dev/SecretNetwork/releases` | Secret3dev |
| Doc host links | `docs.scrt.network/secret-network-documentation/...` | 404 now | Cite the repo |
| ICA | "host module not live" | Unknown on v1.27 | Verify via `/ibc/apps/interchain_accounts/host/v1/params` |
| SNIP-721 query BlockInfo | "not available to queries" | Likely outdated | Don't rely on it |
| Token list data | sstLUNA and sstINJ share one IBC denom; ALTER "< SNIP-24" | — | Verify via `token_info` / denom trace |
| Naming guideline vs list | "IBC assets unprefixed" | List uses `sATOM`, `sOSMO`, … | Display the on-chain symbol |
| Solana CCL | Mainnet program "TBD" | — | Devnet only |
| Secret AI RewardsManager | "expected 2025" | Unknown | Don't assume it is deployed |
