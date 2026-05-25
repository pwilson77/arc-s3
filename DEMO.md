# S3 — 5-Minute Demo Script

Goal: judges see _autonomous agents bonding, getting slashed, and being filtered out by trust gating_ — end to end, against deployed contracts on Arc L1, in five minutes.

## Setup (before demo)

One terminal + browser:

```bash
cd projects/arc-s3
npm run demo:clean   # wipes prior state, then creates exactly one fresh demo task
```

`npm run demo` (the entrypoint is [scripts/demo.mjs](scripts/demo.mjs)) spawns the one-shot pipeline as colour-labelled children:

| Prefix | Process             | Role                                                           |
| ------ | ------------------- | -------------------------------------------------------------- |
| RFB5   | sports-arb agent    | Publishes structured opportunities                             |
| RFB6   | leaderboard scraper | Emits copy-eligible candidates                                 |
| MATCH  | employer matcher    | Starts after the seed request and matches only that request id |
| EXEC   | rfb6 exec helper    | Worker fulfilment                                              |
| AUTO   | rfb6 autopilot      | Accept → submit → settle lifecycle driver                      |

Use `npm run demo:continuous` only when you want the firehose mode where employer-auto keeps posting and the matcher processes all open requests from Pinata.

Open three tabs against the live UI ([arc-s3-ui.vercel.app](https://arc-s3-ui.vercel.app)) or `http://localhost:3030` if running `npm run ui`:

- `/dashboard` — KPIs, settlement stream, integrity incidents
- `/network` — paginated lifecycle stream, stage funnel, failure buckets
- `/traces` — per-task trace inspector

Pre-conditions: `.env` filled with Arc testnet contract addresses + keys; alpha/beta/gamma/validator wallets funded with native USDC for gas + bonds; `PINATA_JWT` set for trace uploads.

For the “this is production” beat, also run the pm2-supervised autopilot in a second window:

```bash
npm run autopilot:up
npm run autopilot:health   # exits 0 healthy, 3 stale, 4 stuck-task
```

## Script

### 0:00 — The pitch (20s)

> "Anyone can publish a leaderboard. We make agents _bond USDC_ to be on it, and slash them when they lie. Same chain. Same dollar. Same second."

### 0:20 — Dashboard (`/dashboard`) (60s)

- Point at the four KPIs (observed / released / slashed / awaiting) and the one-line stage funnel: `created N → accepted N → submitted N → trace N → validated N`.
- Settlement stream below is fed by `validator-metrics.jsonl` — written by the validator after every on-chain settlement.
- Mention: _"This isn’t analytics. The validator writes one JSONL row per `S3EscrowCourthouse.settle*` and the page reads that file directly."_

### 1:20 — Network lifecycle (`/network`) (60s)

- Paginated 10/page lifecycle table; filter to gamma to surface invalid settlements.
- Expand the **failure buckets** `<details>` — `hash-mismatch`, `worker-mismatch`, `structure-invalid`, etc.
- Mention: _"Each row is an on-chain TaskCreatedV2 → settled lifecycle. No off-chain mirror."_

### 2:20 — Agent detail (`/agents/beta`, `/agents/gamma`) (60s)

- Sparkline for `meanScore`; cards for `slashRateBps`, `calibrationGapBps`, `sampleSize`.
- `gamma` is **ineligible** with reasons rendered inline.
- Mention: _"Confidence is committed in the trace **before** the result is known. Calibration gap = `|meanConfidence − hitRate|`. We penalize overconfidence even on valid traces."_

### 3:20 — Trace inspector (`/traces/[taskId]`) (60s)

- Click an invalid gamma settlement → opens trace inspector.
- Show decision block: direction, sizing, confidence, EV, horizon.
- Integrity warning banner: `hash-mismatch` / `worker-mismatch` / `structure-invalid`.
- Mention: _"The validator computed the trace hash, compared to the on-chain commitment, called `settleSlash` on `S3EscrowCourthouse`. The bond is gone. The reputation score dropped. All before this page re-rendered."_

### 4:20 — Close the loop (40s)

- Back to `/dashboard`. Gamma’s slash rate ticks up; eligibility badge is red.
- Optional: in a terminal, `npm run autopilot:health` shows the prod-supervised driver still ticking with fresh balances.
- > "Three layers — agent → settlement → reputation — all on Arc, all in native USDC. RFB 06 — slash-bonded copy-trading — is one `S3EscrowCourthouse.createTask` away. We’re not the consumer app. We’re what the consumer apps integrate."

## Backup checklist (if something is dead)

| Thing fails                 | Fallback                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Arc RPC slow                | Live UI on Vercel reads JSONL/snapshot blobs, not the chain — switch tabs to `https://arc-s3-ui.vercel.app`                    |
| `gamma` happens to be clean | Bump corruption rate in [simulation/src/agents/gamma.ts](simulation/src/agents/gamma.ts) and restart with `npm run demo:clean` |
| Autopilot stuck             | `npm run autopilot:health` will exit `4` and name stuck task ids; `npm run autopilot:restart`                                  |
| UI build broken             | Vercel prod deployment at `arc-s3-ui.vercel.app` is independent of the local UI build                                          |
| Sim has no data             | Empty-state copy renders cleanly; pivot to contract walkthrough                                                                |

## What to NOT do during demo

- Don't open devtools. The story is the contract loop, not the React.
- Don't explain calibration math beyond one sentence — the badge does the work.
- Don't compare to Polymarket / Hyperliquid by name unless asked. The judges read RFB 06; they know.
