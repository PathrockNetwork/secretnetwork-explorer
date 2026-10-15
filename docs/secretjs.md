# secret.js: reference for the explorer

Studied from `scrtlabs/secret.js` at commit `075919e` (2025-10-24), which is npm `secretjs@1.22.1`. The
Secret3dev fork has no newer commits. Paths below are relative to that repo. Claims were checked against `src/`;
where the README disagrees with `src/`, this doc says so. Chain basics and endpoints are in
[secret-network-context.md](./secret-network-context.md) and are not repeated here.

## TL;DR

| Topic | Answer |
| --- | --- |
| What it is | A TypeScript SDK that talks to the **LCD / gRPC-gateway only** (`fetch` to `/cosmos/...`, `/compute/...`, `/registration/...`). It has no CometBFT RPC or WebSocket client. |
| Readonly client | `new SecretNetworkClient({ url, chainId })`, no wallet needed. |
| Why use it at all | Contract **encryption/decryption** (`queryContract`, decrypting the connected user's own txs), SNIP-20/721/1155 helpers, permits, wallet signing. |
| Why not use it for everything | `getTx` and `txsQuery` decode and *try to decrypt* every tx, may poll for IBC acks, and drop the `total` count. Bundle is about 3.35 MB min / 840 KB gzip. |
| Who can decrypt a tx | Only someone holding the **sender's encryption seed** (in practice, the user's wallet via `getEnigmaUtils`). A readonly explorer client can't decrypt anything. |
| CHANGELOG | Ends at **1.15.0**. Nothing is written for 1.16 to 1.22.1. |

## 1. Install, import, client construction

```bash
npm install secretjs        # 1.22.1; CommonJS build (tsconfig "module": "commonjs"), types in dist/index.d.ts
```

```ts
import { SecretNetworkClient, Wallet, MsgExecuteContract, TxResultCode } from "secretjs";
// Browser UMD (package.json "browser": "dist/browser.js"): window.secretjs.SecretNetworkClient
```

`CreateClientOptions` (`src/secret_network_client.ts` ~L322):

| Option | Required | Notes |
| --- | --- | --- |
| `url` | yes | LCD base URL. Trailing slashes are stripped. Every querier calls `${url}${path}`. |
| `chainId` | yes | `"secret-4"`. Used when signing. |
| `wallet` | no | `Signer` = `AminoSigner \| DirectSigner`. If you omit it you get a `ReadonlySigner` that throws on sign. |
| `walletAddress` | if `wallet` | The constructor throws `Must also pass 'walletAddress' when passing 'wallet'`. |
| `encryptionSeed` | no | A 32-byte `Uint8Array`. If omitted, a **random seed is made per client instance** (`src/encryption.ts` `GenerateNewSeed`). |
| `encryptionUtils` | no | Overrides the seed completely. Pass `window.keplr.getEnigmaUtils(chainId)` / `window.leap.getEnigmaUtils(chainId)`. |

The client exposes `secretjs.query.*`, `secretjs.tx.*`, `secretjs.address`, and `secretjs.utils.accessControl.permit`.
The constructor makes one shared `EncryptionUtils` and gives it to `query.compute` (constructor ~L1078).
**`query.snip20/snip721/snip1155` are separate `ComputeQuerier` subclasses built with only `url`**, so each one has
its own random seed. That's fine for queries, but they never use Keplr's enigma utils.

### Readonly vs signing

```ts
// Readonly (the explorer default)
const ro = new SecretNetworkClient({ url: LCD, chainId: "secret-4" });

// Keplr (Leap: replace window.keplr with window.leap)
await window.keplr.enable("secret-4");
const signer = window.keplr.getOfflineSignerAuto
  ? await window.keplr.getOfflineSignerAuto("secret-4") // Ledger -> amino, else direct
  : window.keplr.getOfflineSigner("secret-4");
const [{ address }] = await signer.getAccounts();
const user = new SecretNetworkClient({
  url: LCD, chainId: "secret-4", wallet: signer, walletAddress: address,
  encryptionUtils: window.keplr.getEnigmaUtils("secret-4"), // the wallet's persistent seed: decrypts past txs
});

// MetaMask (EIP-191). The address comes from the ETH key, so it differs from the user's Keplr address
const [eth] = await window.ethereum.request({ method: "eth_requestAccounts" });
const mm = await MetaMaskWallet.create(window.ethereum, eth); // personal_sign "Get secret address" once, cached in localStorage
const mmClient = new SecretNetworkClient({ url: LCD, chainId: "secret-4", wallet: mm, walletAddress: mm.address });
```

### Amino vs direct signers

The client checks `isOfflineDirectSigner(wallet)` (does `signDirect` exist?) and uses `SIGN_MODE_DIRECT`. Otherwise
it uses `signAmino` with `SIGN_MODE_LEGACY_AMINO_JSON`, or the signer's `getSignMode()` (`sign()` ~L1810).

| Signer | Mode on chain | Notes |
| --- | --- | --- |
| `Wallet` (mnemonic, `src/wallet_proto.ts`) | DIRECT | `Wallet extends AminoWallet` and adds `signDirect`. Default HD path `m/44'/529'/0'/0/i`. |
| `AminoWallet` | LEGACY_AMINO_JSON | **Deprecated** since 1.15.0. Some messages and queries may not work. |
| Keplr/Leap `getOfflineSigner` | DIRECT | Not usable for Ledger. |
| Keplr/Leap `getOfflineSignerOnlyAmino` | LEGACY_AMINO_JSON | Needed for Ledger. Can't sign IBC client/connection/channel msgs or some gov proposals (README "SignerOnlyAmino"). |
| `MetaMaskWallet` | `SIGN_MODE_EIP_191` | `getSignMode()` in `src/wallet_metamask.ts`. Permits are signed with `eth_sign`. |

Explorer display: `tx.auth_info.signer_infos[i].mode_info.single.mode` shows which of these was used. A sampled
mainnet contract tx showed `SIGN_MODE_DIRECT`. `SIGN_MODE_EIP_191` means a MetaMask user.

## 2. `secretjs.query.*` modules

Every querier method has the shape `method(req, headers?: HeadersInit)`. It's a thin wrapper over a generated
grpc-gateway client (`src/grpc_gateway/**.pb.ts`), so response fields are **snake_case, optional, and numbers come as
strings** (`height: "27550606"`). To query **historical state**, pass `[["x-cosmos-block-height", "123"]]` as `headers`.
This only works within the node's pruning window (see the context doc).

| Module | Explorer-relevant methods (all in `src/query/<module>.ts`) |
| --- | --- |
| *(root)* | `getTx(hash, ibcOpts?)`, `txsQuery(query, ibcOpts?, pagination?, order_by?)` (see §3) |
| `tendermint` | `getLatestBlock({})`, `getBlockByHeight({height})` → `{block_id, block, sdk_block}`; `getNodeInfo`, `getSyncing`, `getLatestValidatorSet({pagination})`, `getValidatorSetByHeight({height, pagination})`, `aBCIQuery` |
| `node` | `status({})` (`height`, `earliest_store_height`, `timestamp`, `app_hash`), `config({})` (min gas price) |
| `auth` | `account({address})` (`@type` BaseAccount / vesting / ModuleAccount), `accounts`, `moduleAccounts`, `moduleAccountByName`, `params`, `accountInfo`, `bech32Prefix` |
| `bank` | `balance({address, denom})`, `allBalances({address, pagination})`, `spendableBalances`, `totalSupply`, `supplyOf({denom})`, `denomMetadata`, `denomsMetadata`, `denomOwners` |
| `staking` | `validators({status, pagination})`, `validator({validator_addr})`, `validatorDelegations`, `validatorUnbondingDelegations`, `delegatorDelegations`, `delegatorUnbondingDelegations`, `redelegations`, `delegation`, `historicalInfo`, `pool`, `params` |
| `distribution` | `delegationTotalRewards({delegator_address})`, `delegationRewards`, `validatorCommission`, `validatorOutstandingRewards`, `validatorSlashes`, `communityPool`, `params`; Secret-specific: `foundationTax`, `restakeThreshold`, `restakingEntries`, `validatorDistributionInfo` |
| `slashing` | `signingInfos({pagination})`, `signingInfo({cons_address})`, `params` |
| `gov` (= **v1**) | `proposals({proposal_status, voter, depositor, pagination})`, `proposal({proposal_id})`, `votes`, `vote`, `deposits`, `deposit`, `tallyResult`, `params({params_type})`, `constitution` |
| `gov_v1beta1` | Same method set without `constitution`. Legacy content-style proposals. |
| `mint` | `inflation({})`, `annualProvisions({})`, `params({})` |
| `compute` | See the table below |
| `registration` | `txKey({})` (consensus IO x25519 pubkey, base64), `registrationKey({})`, `encryptedSeed({pub_key})` |
| `ibc_transfer` | `denomTrace({hash})`, `denomTraces`, `denomHash`, `escrowAddress`, `totalEscrowForDenom`, `params` |
| `ibc_channel` / `ibc_client` / `ibc_connection` | `channels`, `channel`, `connectionChannels`, `packetCommitments`, `unreceivedPackets`…; `clientStates`, `clientState`, `clientStatus`, `consensusStateHeights`; `connections`, `connection`, `clientConnections` |
| `ibc_fee`, `ibc_packet_forward`, `ibc_iterchain_accounts_host/_controller` | Note the **typo `iterchain`** in the property names (Querier type ~L463) |
| others | `authz` (grants), `feegrant` (allowances), `evidence`, `upgrade` (`currentPlan`, `appliedPlan`, `moduleVersions`), `params`, `consensus`, `emergency_button` (IBC switch params), `app`, `orm`, `autocli` |

The CHANGELOG mentions `secretjs.query.cometbft.abciQuery()`, but **there's no `cometbft` querier** in `src/`. Use
`tendermint.aBCIQuery`. There's also no wrapper for `GetBlockWithTxs` (`/cosmos/tx/v1beta1/txs/block/{h}`). The
generated `Service.GetBlockWithTxs` exists in `src/grpc_gateway/cosmos/tx/v1beta1/service.pb.ts` but the client doesn't expose it.

### `compute` (Secret contracts, `src/query/compute.ts`)

| Method | Returns |
| --- | --- |
| `contractInfo({contract_address})` | `{contract_address, contract_info: {code_id, creator, label, created: {block_height, tx_index}, ibc_port_id, admin, admin_proof, require_governance}}` |
| `contractsByCodeId({code_id})` | `{contract_infos: [{contract_address, contract_info}]}`. **No pagination.** The README calls it `contractsByCode` (wrong). |
| `codes({})` | `{code_infos: [{code_id, creator, code_hash, source, builder}]}`. **No pagination**, returns every code. |
| `code({code_id})` | `{code_info, wasm}`. **Includes the full wasm bytes.** Use `codes()` or a cache for metadata. |
| `codeHashByContractAddress({contract_address})`, `codeHashByCodeId({code_id})` | `{code_hash}`, memoized per querier instance |
| `labelByAddress`, `addressByLabel` | `{label}` / `{contract_address}` |
| `contractHistory({contract_address})` | `{entries: [{operation, code_id, updated, msg}]}`. Tries to decrypt `msg`, and if that fails leaves it as base64 ciphertext. |
| `queryContract({contract_address, code_hash?, query})` | Encrypts `query`, GETs `/compute/v1beta1/query/{addr}?query=<b64>`, decrypts, then `JSON.parse`. **On a contract error it returns the decrypted error string instead of throwing**, so check `typeof result === "string"`. |

```ts
const { token_info } = await ro.query.compute.queryContract<any, any>({
  contract_address: "secret1k0jntykt7e4g3y88ltc60czgjuqdy4c9e8fzek", // sSCRT
  code_hash: "af74387e276be8874f07bec3a87023ee49b0e7ebe08178c49d0a49c3c98ed60e", // omit => extra LCD call + console.warn
  query: { token_info: {} },
});
```

Public contract queries like `token_info`, `num_tokens`, and `contract_info` work from a readonly client. The client
makes a throwaway key, and the enclave answers encrypted to that key. That's how an explorer can show token
name/symbol/decimals/total_supply for SNIP-20s.

### Pagination

`PageRequest = { key?, offset?, limit?, count_total?, reverse? }`. Every value is a string. Nested objects get
flattened to `pagination.limit=…` (`renderURLSearchParams` in `src/grpc_gateway/fetch.pb.ts`). Responses carry
`pagination: { next_key, total }`. Pass `next_key` back as `key`. `count_total` costs extra on large stores.

## 3. Transactions: query, decode, decrypt

### `getTx` / `txsQuery`

```ts
const tx = await ro.query.getTx(HASH_UPPER_HEX, { resolveResponses: false }); // null if not found
const txs = await ro.query.txsQuery(
  `message.sender='secret1...' AND tx.height>=27000000`,  // no spaces around operators (SDK >= 0.46)
  { resolveResponses: false },
  { limit: "50", offset: "0" },     // see the pagination note below
  "ORDER_BY_DESC" as any,           // string enum OrderBy, not re-exported from the package root
);
```

- Query syntax is CometBFT's: `cond AND cond`, no `OR`. Operators are `= < <= > >= CONTAINS EXISTS`, and strings go
  in single quotes. Keys are `{eventType}.{attrKey}`, for example `transfer.sender`, `message.action='/secret.compute.v1beta1.MsgExecuteContract'`,
  `wasm.contract_address='secret1…'`, `tx.height=5`, `acknowledge_packet.packet_sequence='…'`.
- `txsQuery` sends **both** `events=[…]` (split on `" AND "`) and `query=…`, plus `limit`, and sets `page = offset + 1`
  (`txsQuery()` ~L1120). The SDK 0.50 endpoint pages by `page`/`limit`, so **`offset` acts like a 0-based page
  index, not an item offset**. The repo test only covers `limit: "1"`, where the two are the same.
- **`txsQuery` returns only `TxResponse[]`, and the response's `total` is thrown away.** The live LCD does return
  `total` (for example `"11010"` for `MsgExecuteContract`). Use raw LCD for list pages that need counts.
- **IBC response polling:** `getTx` defaults to `resolveResponses: true`. For a tx with `send_packet` events it
  starts background loops that run `txsQuery` every 15 s for up to 2 min, looking for the ack or timeout
  (`waitForIbcResponse` ~L1149). `txsQuery` defaults to `false`. **An explorer should always pass `{resolveResponses: false}`**
  and look up acks itself.
- `getTx` returns `null` on "tx not found". Other LCD errors are thrown as the **parsed JSON body**
  `{code, message, details}`, not an `Error` (`fetchReq`: `if (!r.ok) throw body`).

### `TxResponse` shape (secret.js-decoded, ~L509)

| Field | Content |
| --- | --- |
| `height`, `gasUsed`, `gasWanted` | `number` (converted from strings) |
| `timestamp` | RFC 3339 string |
| `transactionHash` | Upper-case hex |
| `code`, `codespace`, `info` | `code` 0 = success (`TxResultCode` enum) |
| `rawLog` | Error text when `code != 0`. On SDK 0.50 success it's `""`. A decryptable contract error is substituted in place. |
| `jsonLog` | `[{msg_index, events:[{type, attributes:[{key,value}]}]}]`. **Rebuilt from `events`** (only events that have a `msg_index` attribute), deduplicated, with wasm attributes decrypted when possible. |
| `arrayLog` | Flattened `[{msg, type, key, value}]`, same source. |
| `events` | Raw ABCI events. Note that the decrypt loop **mutates these attribute objects in place**, so decrypted wasm attrs also show up here even though the docs say "not decrypted". |
| `data` | `Uint8Array[]`, one entry per message (`TxMsgData.msg_responses[i].value`). For compute msgs the inner `data` is replaced with plaintext when decryptable. |
| `tx` | Decoded `Tx` JSON from LCD: `body.messages[]` with `@type`, `auth_info`, `signatures`. Compute `msg`/`init_msg` are replaced by the **parsed JSON object** when decryptable, and otherwise stay a **base64 string**. |
| `ibcResponses` | `Promise<{type:"ack"\|"timeout", tx}>[]`. Empty unless `resolveResponses`. |

What the raw LCD returns for a mainnet `MsgExecuteContract` (checked live 2026-10-10, height 27550606):
`sender`/`contract` are bech32 strings, `msg` is base64 ciphertext, `sent_funds: []`, `callback_sig: null`. `raw_log`
is `""`. `data` is upper-case hex `TxMsgData`. `wasm` events carry plaintext `contract_address` and `msg_index`,
while every other attribute **key and value are base64 ciphertext**. Plaintext attributes only show up when the
contract used `add_attribute_plaintext`.

### When decryption happens (`decodeTxResponse` ~L1203)

1. For each message with `@type` `/secret.compute.v1beta1.MsgInstantiateContract` (`init_msg`), `MsgExecuteContract`
   or `MsgMigrateContract` (`msg`): base64-decode it, take `nonce = bytes[0:32]`, skip `bytes[32:64]` (the sender's
   x25519 pubkey), and call `encryptionUtils.decrypt(bytes[64:], nonce)`. The plaintext is `codeHash(64 hex chars) + JSON`.
   On success it replaces the field with the parsed JSON and remembers the nonce for that msg index.
2. On success (`code 0`), for `wasm` events whose `msg_index` has a saved nonce, it tries to decrypt each attribute key and value.
3. On failure (`code != 0`), it pulls the encrypted error out of `rawLog` with
   `/; message index: (\d+):(?: dispatch: submessages:)* encrypted: (.+?): (?:instantiate|execute|…) contract failed/`
   and decrypts it with that msg's nonce.
4. For each compute `msg_response` with a saved nonce, it decodes `MsgExecuteContractResponse` (or the Instantiate/Migrate
   response), then decrypts and base64-decodes `data`.

Every step is wrapped in `try {} catch {}`. **If you don't have the seed, nothing throws.** You get the base64 ciphertext,
encrypted attrs, and raw `data`. That's always the case for a readonly explorer client, because its seed is random.
Contract *outputs* can only be decrypted if the *input* decrypted first, because that's where the nonce comes from.

### The encryption scheme (`src/encryption.ts`)

```
seed (32B, random or wallet-held) ──curve25519 generateKeyPair──► (privkey, pubkey)  [x25519]
consensusIoPubKey = GET /registration/v1beta1/tx-key        (cached per EncryptionUtils)
txKey = HKDF-SHA256( ikm = x25519(privkey, consensusIoPubKey) || nonce,
                     salt = 0x000000000000000000024bead8df69990852c202db0e0097c1a12ea637d7e96d, info="", len 32 )
ciphertext = AES-SIV(txKey).seal( utf8(codeHashHex + JSON.stringify(msg)), AD=[empty] )
on-chain msg = nonce(32, fresh random per msg) || senderPubkey(32) || ciphertext
```

Outputs (events, data, errors, query results) are AES-SIV under the same `txKey`, so they're tied to that tx's nonce.
Query results arrive as base64 inside the ciphertext, which is why there's an extra `fromBase64` in `queryContract`.

What this means for the explorer:

- **Show "encrypted" fields well.** For a compute msg, decode the base64 and show `nonce` (hex, bytes 0 to 31) and the
  `sender encryption pubkey` (bytes 32 to 63). The pubkey is the same across a user's txs if they used a persistent seed,
  so it's a weak linkability signal. Show the ciphertext length as "encrypted payload (N bytes)". Encrypted wasm attrs are base64
  for both key and value. Render them as "encrypted attribute" and keep `contract_address`/`msg_index` plaintext.
- **Decrypt the connected user's own txs** by building the client with the wallet's `encryptionUtils`
  (`keplr.getEnigmaUtils`/`leap.getEnigmaUtils`) and calling `getTx`. That works only if the tx was *created* with that same
  seed. Wallet-made txs and dApps that used `getEnigmaUtils` qualify. Txs from dApps or scripts that used secret.js's
  default random seed are **undecryptable forever**, even by the sender.
- **Sharing one tx:** `encryptionUtils.getTxEncryptionKey(nonce)` returns the per-tx AES-SIV key. A user could hand the
  explorer that 32-byte key to decrypt just that tx without exposing their seed. You'd have to write that path yourself with
  `miscreant` (secret.js has no "decrypt with tx key" helper).
- Never ask for or store a seed server-side. Decryption belongs in the browser.

## 4. SNIP-20 / 721 / 1155, viewing keys, permits

Private data (balances, history, owned NFTs) needs either a **viewing key** (a password set on-chain, per contract)
or a **query permit** (an offline amino signature, nothing on-chain).

### Viewing keys

```ts
// Ask the wallet first, which avoids a tx (Keplr/Leap API, not secret.js):
await window.keplr.suggestToken("secret-4", tokenAddr);
const key = await window.keplr.getSecret20ViewingKey("secret-4", tokenAddr);

// Or set one with a tx (MsgExecuteContract under the hood)
await user.tx.snip20.setViewingKey(
  { sender: address, contract_address: tokenAddr, code_hash, msg: { set_viewing_key: { key: "hunter2" } } },
  { gasLimit: 50_000 },
);
// also: tx.snip20.createViewingKey({ ..., msg: { create_viewing_key: { entropy } } })
// (the key is returned in the decrypted tx.data)
```

### Query permits (`src/extensions/access_control/permit/`)

```ts
const permit = await user.utils.accessControl.permit.sign(
  address, "secret-4", "explorer-permit", [tokenAddr], ["balance", "history"], /* keplr = */ true,
);
```

- `Permission = "owner" | "history" | "balance" | "allowance"`. The sign doc is fixed: `account_number "0"`,
  `sequence "0"`, fee `0uscrt`/gas `"1"`, one msg `{type:"query_permit", value:{permit_name, allowed_tokens, permissions}}`, empty memo.
- The **`keplr` argument defaults to `true`**. Then it calls `window.keplr.signAmino(...)` directly and **ignores the
  client's wallet**. For Leap or MetaMask pass `false`, which uses `signer.signPermit` (MetaMask) or `signer.signAmino`.
- A pure direct signer throws `DirectSignerUnsupported` ("Only amino signer is supported for permits"). Keplr's
  `getOfflineSigner` has both methods, so it works.
- `permit.verify(permit, forAddress, forContract, permissions)` / `verifyNoExcept` check it client-side.
- Cache permits per user (localStorage). They hold no secret, but signing one costs the user a wallet popup.
  A permit is revoked on-chain by name with the contract's `revoke_permit` execute msg.

### Reading private data

```ts
const c = { address: tokenAddr, code_hash };          // SNIP-20 and SNIP-1155 use `code_hash`
const auth = { permit };                               // or { key: viewingKey }
const { balance } = await ro.query.snip20.getBalance({ contract: c, address, auth }); // {balance:{amount}}
const { transaction_history } = await ro.query.snip20.getTransactionHistory({
  contract: c, address, auth, page: 0, page_size: 20, should_filter_decoys: true,
}); // {txs: RichTx[], total?}
```

| Querier (`src/extensions/...`) | Methods |
| --- | --- |
| `snip20` | `getSnip20Params` (= `token_info`, public), `getBalance`, `getTransferHistory` (`Tx[]`: `from, sender, receiver, coins, memo, block_time, block_height`), `getTransactionHistory` (`RichTx[]`: `action` ∈ transfer/mint/burn/deposit/redeem), `GetAllowance` |
| `snip721` | `GetTokenInfo` (`all_nft_info`), `GetOwnedTokens` (`tokens`). **It uses `contract.codeHash` (camelCase)** and `auth.viewer = {viewing_key, address}`. |
| `snip1155` | `getBalance`, `getAllBalances` (owner only), `getTransactionHistory`, `getPublicTokenInfo`, `getPrivateTokenInfo` |

Notes: authenticated queries go through a readonly client, so no wallet is needed once you have the key or permit. Viewing-key
queries put the key in the encrypted query. Permits sent with `with_permit` make the GET URL long, because the whole
query is base64'd into `?query=`. Watch for URL-length limits on proxies. `getTransferHistory` is legacy, so prefer
`getTransactionHistory`. Not every SNIP-20 implements both.

## 5. Gotchas

| Area | Detail |
| --- | --- |
| Transport | LCD only. `cross-fetch` gets polyfilled into `global.fetch` when `window.fetch` is missing (Node, RN). It's GET-heavy, so CDN or proxy caching works. |
| CORS | The public Secret³ LCD sends `access-control-allow-origin: *` (context doc), so the browser works directly. Other providers may not. |
| Rate limits | No retry, backoff, or batching built in. `getTx` without a `code_hash` may make extra calls, and so may IBC resolution. Each new `EncryptionUtilsImpl` fetches `/registration/v1beta1/tx-key` once. **Reuse one client.** |
| Error objects | LCD errors are thrown as the JSON body (`{code, message}`), not `Error`. `queryContract` *returns* contract error strings. |
| Code hash | Leaving out `code_hash` gives a timestamped `console.warn` and an extra LCD round-trip (`getMissingCodeHashWarning` in `src/tx/compute.ts`). It's memoized per querier. |
| Gas defaults | `gasLimit 25_000`, `gasPriceInFeeDenom 0.1`, `feeDenom "uscrt"`, fee = `ceil(gasLimit*price)` (`prepareAndSign` ~L1682). 25k is too low for any contract call, so set it explicitly. |
| Simulation | `tx.compute.executeContract.simulate` / `instantiateContract.simulate` are **unsupported "for security reasons"** (`SingleMsgTx` doc comment). |
| Broadcast | `BroadcastMode.Block` is deprecated and silently mapped to `Sync`. With `waitForCommit` (default) it polls `getTx` every 6 s for up to 60 s. |
| Sequence | Signing calls `auth.account` each time unless you pass `explicitSignerData`. Supported account types: Base, Continuous/Delayed vesting, Module. Others throw. |
| Amino | `AminoWallet` is deprecated. Amino-only signers can't sign IBC core msgs or some gov proposals. Permits *need* amino. |
| Gov | `query.gov` is **v1** since 1.15 (breaking). Use `gov_v1beta1` for legacy shapes. |
| Unpaginated | `compute.codes()` and `compute.contractsByCodeId()` return everything, and `compute.code()` returns the wasm. Cache them. |
| `txsQuery` | No `total`. `offset` maps to `page = offset+1`. No spaces in conditions. |
| Types | Generated types make every field optional, uint64 values are strings, and `bytes` are typed `Uint8Array` but arrive as **base64 strings** in JSON (the casts in `compute.ts` show this). |
| Bundle | `dist/browser.js` is **3.35 MB minified / about 840 KB gzip** (measured on unpkg). It's CommonJS with no `sideEffects` flag, so tree-shaking is poor. npm unpacked size is about 30 MB. It pulls in protobufjs, google-protobuf, bip32/bip39, `@noble/*`, miscreant, curve25519-js, and node polyfills. Lazy-load it on routes that need decryption or wallets. |
| Node vs browser | Works in both. `MetaMaskWallet` assumes `localStorage`. React Native needs `react-native-get-random-values`. `BigInt` is polyfilled with `big-integer`. |
| Install | `postinstall: patch-package` runs in consumers. It's harmless because `patches/` isn't shipped, but it adds a dependency. |
| Docs drift | The README says `contractsByCode` (actually `contractsByCodeId`) and `SecretNetworkClient.create()` (doesn't exist). The CHANGELOG lists `query.cometbft` (doesn't exist) and stops at 1.15.0. The README still carries a "Beta Version Notice" ("APIs may break"), so pin exact versions. |
| Known issues (1.15 CHANGELOG) | `tx.ibc.transfer()` needs a non-empty `memo`. `MsgPayPacketFee` needs `relayers` even when empty. Tx data moved from `rawLog` to `events` (secret.js rebuilds `jsonLog` from events). |
| Helpers worth reusing | `pubkeyToAddress`, `base64PubkeyToAddress`, `selfDelegatorAddressToValidatorAddress`, `validatorAddressToSelfDelegatorAddress`, `tendermintPubkeyToValconsAddress` / `base64TendermintPubkeyToValconsAddress` (to map block proposer and signing info to a validator), `ibcDenom`, `validateAddress`, `stringToCoins` (`src/utils.ts`). |

## 6. Recommendation: secret.js vs raw RPC/LCD

| Use **secret.js** for | Use **raw LCD/RPC/CometBFT** (plain `fetch`, or our indexer) for |
| --- | --- |
| Public contract queries (`token_info`, NFT `contract_info`, `num_tokens`) via `query.compute.queryContract`. Server-side or edge is fine because it needs no secret. | Blocks: RPC `/block`, `/block_results`, `/blockchain`, plus WebSocket `NewBlock` for live tips. secret.js has no RPC or WS support. |
| **Decrypting the connected user's own txs** in the browser with `encryptionUtils: wallet.getEnigmaUtils(chainId)` + `getTx(hash, {resolveResponses:false})` | Tx lists and search: LCD `/cosmos/tx/v1beta1/txs?query=…&page=&limit=&order_by=` (keeps `total`) or RPC `tx_search`. Long term, our own indexer, since public nodes only keep recent history. |
| SNIP-20/721/1155 private balances and history for the connected user (viewing key from the wallet, or a permit) | Tx detail rendering: decode LCD JSON ourselves. Show compute msgs as nonce, pubkey, and ciphertext, and wasm attrs as encrypted. Then *offer* "decrypt with your wallet" when the connected address is the sender. |
| Wallet connect and signing (if we ever add actions like set viewing key or revoke permit) | Module state (staking, gov, bank, slashing, distribution, mint, IBC): LCD directly, or secret.js's typed wrappers if we already ship the bundle |
| Address helpers (valoper ↔ account, valcons from consensus pubkey) — or copy those 10 lines of bech32 | Counts, aggregates, rich lists, contract-by-code listings: our indexer. LCD endpoints are unpaginated or have no `total`. |

Practical setup: keep a small hand-written LCD/RPC client for 90% of pages. Load `secretjs` lazily (dynamic `import("secretjs")`)
only for (a) public contract queries if they're done in the browser, (b) "connect wallet → decrypt my txs / show my private
token balances". Use one shared readonly `SecretNetworkClient` per tab, always pass `code_hash` and `{resolveResponses:false}`,
and set `x-cosmos-block-height` headers only for heights inside the node's retained window.
