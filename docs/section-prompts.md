# Sealed — per-section image prompts

One prompt per section of the Sealed dashboard (Secret Network monitor). Each prompt
describes **only content**: what features, data, tables and charts the screen must show.
Visual style is deliberately left out — pair these with the theme prompt in
`docs/design-prompt.md`, or let the generator choose.

Paste the **shared context** block first, then one section prompt, to get one image per section.

---

## Shared context (prepend to every prompt)

> A desktop screenshot of one screen of "Sealed", a real-time network and validator monitor for
> Secret Network (chain ID `secret-4`), a privacy-preserving Cosmos chain whose smart contracts run
> encrypted inside SGX enclaves. Tagline: "What the chain shows, and what it seals."
> The screen has a left navigation sidebar with the Sealed logo, the subtitle "by Pathrock Network"
> and these items: Overview, Validators, Blocks, Transactions, Governance, Analytics, Network,
> RPC Console, API Reference, Settings. The item for the current screen is selected. A Pathrock
> Network card sits at the bottom of the sidebar.
> A top bar holds a search field ("Search blocks, transactions, validators, addresses…" with a ⌘K
> hint), a SCRT/USD price ticker with 24h change, the active RPC endpoint name with its latency
> (e.g. "Secret³ 445ms"), a "Live" toggle, a light/dark switch and a Share button.
> All numbers must look like real mainnet data: block heights around 27,550,000, ~5.6-second blocks,
> 23 active validators, addresses with prefixes `secret1…`, `secretvaloper1…`, `secretvalcons1…`,
> amounts in SCRT (6 decimals, base denom `uscrt`). Use real-style validator names such as Kraken01,
> PathrockNetwork, secretnodes.com, Consensus One, Lavender.Five Nodes, StarShell, SNF, crosnest.
> Data that is encrypted on Secret must never be shown as readable text — show it as a sealed
> placeholder labelled with its size only (e.g. "sealed · 444 B").

---

## 1. Overview

> Screen: **Network Overview** — "Live network data for Secret Network (secret-4)."
> Include:
> - **Five stat tiles in a row:**
>   - *Latest indexed height:* 27,552,748, with "+106 in last 10 min" and a tiny height sparkline.
>   - *Avg block time:* 5.57 s over the last 100 blocks, with a small line chart.
>   - *Signing rate:* 100.0%, "23 / 23 signed", a strip of the last 100 blocks as tiny bars and
>     "power online 100.0%".
>   - *Active validators:* "23 / 23", a 23-segment bar and "last change 2h 23m ago".
>   - *Indexer lag:* "0 blocks", "Up to date".
> - **Software-upgrade banner:**
>   - "v1.27.3 · chain halts at height 27,595,508 · ~2026-10-13 13:15 UTC · proposal #381".
>   - Status "Network upgrade · proposal still in voting", with a progress bar.
>   - A live countdown (days / hours / mins / secs) and "42,760 blocks remaining".
> - **Recent Blocks / Consensus Pipeline:**
>   - The newest 8 blocks as a horizontal chain of cards, newest on the left, joined by arrows.
>   - Each card: block height, proposer logo and name, tx count, age ("18s ago"). The newest card
>     is highlighted.
> - **Validators table (top 10):** rank, logo + moniker + short consensus address with copy icon,
>   uptime over the last 1k blocks (% with meter), uptime over 10k ("9,999 / 10k" with a dashed
>   meter), missed count, proposer share over 1k (% with bar), status chip (Active). Header note:
>   "uptime meters scaled 98–100%".
> - **Validator Network map:**
>   - A world map with dots at observed validator locations.
>   - Summary line "23 validators · 3 countries · 3 cities · 20 unobserved".
>   - Legend chips: Active (23), Degraded (0), Inactive (0). Zoom controls.
> - **Validator Set Summary:**
>   - A donut of the set by status (Active 23, Degraded 0, Inactive 0) with counts and percentages.
>   - "23 validators · 3 known countries · 20 locations unknown".
>   - No proposer ranking here; that lives on the Validators screen.
> - **Block Time chart:** the last hour of block times, y-axis 4–9 s, a target line at 7 s.
> - **"Public vs sealed" explainer card:**
>   - *Public:* sender, fee, gas, contract address, contract label, block, timestamp.
>   - *Sealed:* contract input, response data, wasm event attributes, which only the sender's wallet
>     can decrypt.
> - **Recent Validator Set Changes:** a short list of joined/left events with height and time.

## 2. Validators

> Screen: **Validators** — every validator in the active set and their signing record.
> Include:
> - **Highlight tiles:**
>   - *Total validators:* 236, of which 23 bonded.
>   - *Jailed:* count.
>   - *Average uptime.*
>   - *Top validator by voting power:* name and share of the active set, e.g. 13.6%.
> - **Status filter chips:** All, Bonded, Unbonding, Unbonded, Jailed, Tombstoned, Watched — each with
>   a count. Plus a filter text field, sort dropdown, column picker and "Clear filters".
> - **Main table:** rank; logo + moniker with operator address `secretvaloper1…` as a second line;
>   a local label tag on some rows; voting power and % of active set; "Stake · commission" (e.g.
>   "7.42M SCRT · 5%"); uptime % with meter; missed blocks; proposer share; a staking-status chip
>   (Bonded, Jailed until <date>, Unbonding, Tombstoned, or a warning "9,100 / 11,250 missed");
>   a star to watch; row actions.
> - Pagination: "Rows per page", previous/next, page indicator. A "Download CSV" button.
> - **Commission distribution** histogram (0–10%+ buckets).
> - **Top proposers** ranked list with shares.
> - **Recent validator events** feed (joined set, left set, jailed, unjailed) with heights.

## 3. Validator detail (expanded row / drawer)

> Screen: **Validator detail** for "PathrockNetwork", opened from the Validators table.
> Include:
> - **Header:**
>   - Logo, moniker, Bonded chip, a watched star.
>   - Operator address, consensus address and public key, each with a copy icon.
>   - Website link and Keybase identity.
> - **Facts grid:**
>   - Voting power and % of set, stake in SCRT, commission, min self-delegation.
>   - Uptime over 1,000 blocks, signed / missed counts, missed streak, proposer share.
>   - First seen / last seen heights, signing since.
>   - "Missed (slashing window): 0 / 11,250".
> - **Signing history heatmap:** one cell per block over a selectable window (100 / 500 / 1,000 /
>   5,000 blocks), newest first. Most cells signed, a few missed, some "not in set".
> - **Slashing & safety panel:**
>   - Jailed (no), tombstoned (no), jailed until (—), missed blocks counter.
>   - Slashing window 22,500 blocks, minimum signed 50%, jail threshold 11,250.
> - **Enclave attestation / public registration section:** "Registration not indexed" placeholder with
>   a one-line explanation that Secret nodes register an SGX enclave.
> - **Local label editor:** a text field "Label · saved in this browser" with Save / Cancel.

## 4. Blocks

> Screen: **Recent Blocks** — "Committed blocks observed by this monitor, newest first."
> Header label: "Indexed chain history".
> Include:
> - A table of ~20 blocks: height, age / timestamp, proposer (logo + moniker), transaction count,
>   commit signatures ("23 / 23"), consensus status ("Finalized"), block time since previous (5.4 s).
> - A few rows with 0 transactions, a few with 3–8.
> - Pagination and a "Live" indicator showing new blocks arriving.

## 5. Transactions (list)

> Screen: **Transactions** — recent transactions from the newest indexed blocks.
> Include:
> - **Stats header:** transactions shown, share that are sealed (encrypted contract calls), blocks
>   scanned (last 12), average fee in SCRT.
> - **Filter tabs:** All · Sealed · Public.
> - **Table:**
>   - *Columns:* tx hash (shortened, copy icon), result (Success / Failed), height, age, message type
>     ("Execute contract", "Send", "Delegate", "IBC transfer", "Withdraw rewards"), signer
>     (`secret1…` shortened), contract address with its label (e.g. `kms`) when a contract is
>     called, fee in SCRT, gas used / wanted.
>   - *Encryption column:* a lock + "Sealed" chip on contract calls, "Public" on plain Cosmos messages.

## 6. Transaction detail

> Screen: **Transaction detail** for hash `34B4916579BF2DEF5936373304C0802214BCF7DD8C84674B3E1378314690E4B0`.
> Include:
> - **Facts:**
>   - Status Success, height 27,551,228, timestamp, signer `secret1p55wr2n6…`.
>   - Fee 0.05 SCRT, gas 121,266 / 500,000, memo (empty).
>   - Contract `secret1w500qy39…` labelled `kms`, message count 3.
> - **Tabs: Messages / Response / Events.**
>   - *Messages:* each MsgExecuteContract shows sender and contract in clear, and `msg` as a sealed
>     placeholder "sealed · 444 B"; `sent_funds: []`.
>   - *Response:* data shown as "sealed · 46 B".
>   - *Events:* a `message` event with readable sender; `wasm` events where `contract_address` and
>     `msg_index` are readable and every other attribute key/value is a sealed placeholder.
> - **Decrypt note:** "Only the sender's wallet can decrypt this — connecting a wallet to reveal your
>   own transactions is planned."

## 7. Governance

> Screen: **Governance** — on-chain proposals with live tallies.
> Include:
> - **Tabs:** Voting · Deposit · Passed · Rejected · All, with counts.
> - **Params strip:** quorum 33.4%, threshold 50%, veto 33.4%, expedited threshold, min deposit and
>   voting period.
> - **Proposal cards (newest first):**
>   - *#381* "Upgrade to v1.27.3". Tags: Expedited, Software upgrade. Status Voting, ending
>     2026-10-11 02:34 UTC with a countdown. Upgrade height 27,595,508.
>   - *#380* a machine-allowlist proposal, also in voting.
>   - *Older* proposals marked Passed / Rejected.
> - **Each voting card:**
>   - A tally bar split Yes / No / No with veto / Abstain with percentages.
>   - Turnout as a share of bonded stake, with a marker at the quorum line.
>   - Submit time, proposer, deposit amount.
> - **Deposit-period card:** a deposit meter (raised vs minimum) and deposit-end countdown.

## 8. Analytics

> Screen: **Analytics** — aggregates over a selectable horizon: 24h · 7d · 30d.
> Include:
> - **Stat row:** average block time, p95 block time, blocks indexed in the horizon, average signing
>   rate.
> - **Block time chart:** bucketed average with a p95 band over the horizon.
> - **Signing rate chart:** % of validators signing per bucket, over the horizon.
> - **Block volume chart:** blocks per hour (24h) or per day (7d/30d) as bars.
> - **Proposer distribution:** each validator's share of proposed blocks as a ranked bar list, with
>   block counts.

## 9. Network

> Screen: **Network** — RPC directory and node map.
> Include:
> - **Verified endpoints:** cards for the RPC/LCD endpoints the monitor uses, e.g. "Secret³",
>   each with height, latency, sync status, archive yes/no and "probed 12s ago".
> - **Community endpoints:** a list of public Secret RPC, LCD and gRPC endpoints (operator name,
>   type, height, latency, sync status, archive flag, last probe), with healthy/lagging/down states.
> - **Observed validator locations:** a world map of validator nodes seen via P2P peers, with
>   a country / city breakdown list and an "unobserved" count.

## 10. RPC Console

> Screen: **RPC Console** — "Ask the node directly from this browser, independent of the monitor."
> Include:
> - **RPC endpoint selector:** quick endpoints ("Secret³ mainnet"), an "Add custom endpoint" field
>   with "Save and connect", current latency.
> - **Node status and network info cards:** node moniker, network `secret-4`, latest height, catching
>   up (no), peers count, app version.
> - **Method explorer:**
>   - *Methods:* status, health, net_info, block, block_results, validators, consensus_state,
>     unconfirmed_txs (mempool), abci_query, tx_search, with "View all methods".
>   - *Parameters panel* for the selected method (height, page, per page, query, prove, path, data).
>   - *Execute* button.
> - **Response panel:** raw JSON response from the node, with the request time.
> - **Direct panels:** "Recent blocks (direct)" and "Validator set (direct)" read straight from the
>   node.

## 11. API Reference

> Screen: **API Reference** — the monitor's public REST API.
> Include:
> - A base URL header: `https://secretnetwork.explorer.pathrocknetwork.org`, a note that every
>   sample is a live response, and a "Refetch samples" button.
> - **One card per endpoint:**
>   - *Card contents:* method badge (GET / PATCH), path, one-line description, a JSON sample and
>     "live · 13:04:21".
>   - *Endpoints:* `/api/v1/network`, `/api/v1/validators`, `/api/v1/validators/:address?window=500`,
>     `/api/v1/validator-set`, `/api/v1/metrics?hours=24`, `/api/v1/series`, `/api/v1/endpoints`,
>     `/api/v1/config`, `/api/v1/transactions`, `/api/v1/transactions/:hash`, `/api/v1/governance`,
>     `/api/v1/staking`, `/api/v1/market`.
>   - *JSON samples:* the transaction sample shows `"msg": { "sealed": true, "bytes": 444 }`.
>   - *PATCH cards:* show a request body instead of a response, noted as refused on the public site.

## 12. Settings

> Screen: **Settings**.
> Include:
> - **Chain configuration:**
>   - Chain name Secret Network, chain ID `secret-4`, bech32 prefix `secret`.
>   - Denom SCRT / `uscrt` (6 decimals), LCD URL.
> - **Capabilities:** chips for Delegations ✓, Governance ✓, Slashing ✓, PoA ✗.
> - **RPC endpoints:** failover table with priority, endpoint, status (Active / Standby), latency,
>   last height and a pin action.
> - **Indexer settings:** backfill depth 50,000 blocks, poll interval 60 s, signature retention 12,000
>   blocks, moniker sync every 5 min.
> - **Security / access:** "public read-only facade — mutations refused", credential redaction note.
> - **Appearance:** theme choice Dark / Light / System.
> - **Public configuration:** a shareable JSON snippet with a copy button, "Share this with your team
>   or embed it in other tools."
