# Design prompt: Secret Network monitor

Paste everything below the line into a design tool (Claude design, Figma Make, v0, etc.).

---

Design a high-fidelity desktop dashboard (1440px wide, plus one 400px mobile view of the Overview) for **Sealed**, a real-time network and validator monitor for **Secret Network**, a privacy-preserving Cosmos chain where smart contracts run inside Intel SGX enclaves and their inputs, outputs and state are encrypted.

## Concept

The theme is **"what the chain shows, and what it seals."** Everything public is crisp and legible. Everything encrypted is shown honestly as sealed: redaction bars, faint ciphertext texture, a small lock glyph. It is never hidden and never faked. The mood is a quiet security console: dark, precise, calm, with one luminous accent. Avoid crypto-casino clichés: no neon gradients everywhere, no 3D coins, no glowing globes.

- **Visual motifs:**
  - **Enclave frames:** thin double-line borders with notched corners around the most important panels, like a chip's die outline.
  - **Ciphertext texture:** very low-opacity monospace hex characters behind empty states and sealed fields.
  - **Redaction bars:** solid rounded bars the length of the hidden value, with a small "sealed" label.
- **Logo:** a custom wordmark "Sealed" with a simple keyhole/seal mark. Do not use Secret Network's official logo.

## Palette (dark is the primary theme; also provide a light theme)

| Token | Dark | Light |
| --- | --- | --- |
| background | #0A0B0F | #F6F5F2 |
| surface | #12141A | #FFFFFF |
| surface-raised | #191C24 | #FBFAF8 |
| line | #262A34 | #E2E0DA |
| text | #E9E7E2 | #16181D |
| text-muted | #8B909B | #6A6F78 |
| accent (seal violet) | #8B6CFF | #5B3FE0 |
| sealed (encrypted data) | #3A3550 bars, #A99BFF label | #E6E0FF bars, #5B3FE0 label |
| ok | #3CCB8A | #138A57 |
| warn | #E8B44C | #A86B00 |
| bad | #F0616D | #C62F3D |

Use the accent sparingly: active nav, the live-block pulse, focus rings, one hero number.

## Typography

- **Interface and headings:** Space Grotesk.
- **Data:** IBM Plex Mono for all hashes, addresses, heights and numbers, with tabular figures.
- **Sizes:** large numbers 32–40px, body 14px, labels 11px uppercase with letter-spacing.

## Layout

A left sidebar with the wordmark and nav. A top bar with:

- chain selector (`secret-4` mainnet), live block height with a pulsing dot
- avg block time, active RPC endpoint with a health dot
- dark/light/system theme toggle

## Screens (use the realistic sample data given)

1. **Overview**
   - **Hero strip:**
     - block height **27,550,466**, avg block time **6.0 s**
     - **23 / 80** validators bonded
     - signing rate **99.2%**, indexer lag **0 blocks**
   - **Upgrade banner:** "v1.27.3 · chain halts at height 27,595,508 · Oct 13, 13:00 UTC · proposal #381". Show a countdown and a progress bar of blocks remaining.
   - **Live block stream:** height, time, proposer moniker, tx count, signatures 22/23. New rows slide in.
   - **Block-time sparkline** for the last hour.
   - **Proposer distribution donut.**
   - **"What's public / what's sealed" explainer card:**
     - Public: tx sender, fees, gas, contract address, SCRT transfers.
     - Sealed: contract inputs, outputs, state, private token balances.

2. **Validators**
   - **Table columns:**
     - avatar (Keybase or identicon fallback), moniker, operator address `secretvaloper1…` truncated
     - voting power and %, commission
     - uptime over 1k and 10k blocks, missed streak, proposer share
     - status chip: Bonded / Unbonding / Jailed / Tombstoned
   - **Jailed row:** include one, with a red "Jailed until 10:42 UTC" chip.
   - **Near-miss row:** include one with a yellow "11,050 / 11,250 missed" warning bar (the jailing threshold in a 22,500-block window).

3. **Validator detail**
   - Header with moniker, Keybase avatar, website, commission, and self-bond vs `min_self_delegation`.
   - A signing heatmap of the last 5,000 blocks as a grid of tiny squares: signed = muted green, missed = red, outside the set = empty outline.
   - Slashing panel: `missed_blocks_counter`, `jailed_until`, `tombstoned`, start height.
   - An "Enclave" card showing that this node is SGX-registered: machine id (40 hex, truncated), registration tx, enclave measurement `f0d59dd2…20d90b`.

4. **Transactions**
   - A list of recent txs: hash, height, type (Send, Delegate, Execute contract, Vote, IBC transfer), sender, fee in SCRT, gas used, status.
   - Opening a "Execute contract" tx shows the contract address and label in plain text, while the message body, response data and event attributes appear as redaction bars labelled "sealed by enclave".
   - A secondary button: "Connect wallet to decrypt your own transactions".

5. **Governance**
   - Proposal cards in deposit and voting states.
   - Each card has a tally bar (Yes / No / Veto / Abstain), quorum marker at 33.4%, a deposit progress bar toward 5,000 SCRT, and a voting countdown.

6. **Network**
   - RPC endpoint directory discovered from peers: label, URL, chain id, height, earliest height (history depth), latency, healthy dot, pin button.
   - A minimal dot-matrix world map of observed validator node locations.

7. **Settings / API**
   - Chain identity (chain-id `secret-4`, bech32 prefix `secret`, denom `uscrt`)
   - Capability toggles shown as read-only chips: Staking, Governance, Slashing, Secret contracts, SGX registration
   - API endpoint reference list.

## States to show

At least one each of:

- loading skeleton (with ciphertext shimmer)
- an "RPC unreachable" banner, with values shown as "—" and never as 0
- an empty state
- a sealed field revealed after wallet connect: the redaction bar dissolves into decrypted JSON with a small "decrypted locally" badge

## Details

- Truncate hashes and addresses in the middle (`secret1q9…7xk4`) with copy buttons.
- Show relative times ("12 s ago") with exact UTC times on hover.
- Use 8px spacing, 10px radii on cards and 6px on chips.
- Use subtle 1px borders, not heavy shadows.
- Meet WCAG AA contrast in both themes.
- Motion is minimal: only the live-block pulse and row slide-in.
