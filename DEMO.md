# S3 — 5-Minute Demo Script

Goal: judges see _autonomous agents bonding, getting slashed, and being filtered out by trust gating_ — end to end, against deployed contracts, in five minutes.

## Setup (before demo)

Two terminals + browser:

```bash
# Terminal A — simulation loop (let it run for 60s before demo so leaderboard has data)
cd projects/arc-s3 && npm run sim

# Terminal B — UI
cd projects/arc-s3 && npm run ui   # http://localhost:3030
```

Pre-conditions:

- `.env` filled with Arc testnet contract addresses + keys.
- Three agent wallets funded with native USDC for gas + bonds.

## Script

### 0:00 — The pitch (20s)

> "Anyone can publish a leaderboard. We make agents _bond USDC_ to be on it, and slash them when they lie. Same chain. Same dollar. Same second."

### 0:20 — Leaderboard (`/`) (60s)

- Three workers visible: `alpha`, `beta`, `gamma`.
- Point at the **copy-eligible badge**: only agents passing `slashRate ≤ 10% ∧ samples ≥ 10 ∧ calibration gap ≤ 15%` get it.
- `gamma` should be **ineligible** with reasons displayed inline.
- Mention: _"This isn't a database query — it's reading `validator-metrics.jsonl` that the validator writes after every on-chain settlement."_

### 1:20 — Agent detail (`/agents/beta`) (60s)

- Sparkline shows `meanScore` history.
- Recent settlements table: each row is a real on-chain settlement.
- Cards: `slashRateBps`, `calibrationGapBps`, `sampleSize`.
- Mention: _"Confidence is committed in the trace **before** the result is known. Calibration gap = `|meanConfidence − hitRate|`. We penalize overconfidence even on valid traces."_

### 2:20 — The slash (`/agents/gamma`) (60s)

- `gamma` has visibly higher `slashRateBps`.
- Click a recent **invalid** settlement row → opens trace inspector.

### 3:20 — Trace inspector (`/traces/[taskId]`) (60s)

- Show decision block: direction, sizing, confidence, EV, horizon.
- Show the **integrity warning banner** — hash mismatch / worker mismatch / structure invalid.
- Mention reasons: `hash-mismatch`, `worker-mismatch`, etc.
- Mention: _"The validator computed the trace hash, compared to the on-chain commitment, called `settleSlash` on `S3EscrowCourthouse`. The bond is gone. The reputation score dropped. All before this page re-rendered."_

### 4:20 — Close the loop (40s)

- Back to `/`. Gamma's slash rate has ticked up; its eligibility badge is still red.
- > "Three layers — agent → settlement → reputation — all on Arc, all in USDC. RFB 06 — slash-bonded copy-trading — is one `S3EscrowCourthouse.createTask` away. We're not the consumer app. We're what the consumer apps integrate."

## Backup checklist (if something is dead)

| Thing fails                 | Fallback                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Arc RPC slow                | Show pre-recorded `validator-metrics.jsonl` — UI reads the file, no chain dependency                                   |
| `gamma` happens to be clean | Send one corrupt trace by tweaking [simulation/src/agents/gamma.ts](simulation/src/agents/gamma.ts) corruption rate up |
| UI build broken             | `NODE_ENV=production` is wired into [ui/package.json](ui/package.json) build script — re-run `npm run build -w ui`     |
| Sim has no data             | Empty-state copy renders cleanly; pivot to contract walkthrough                                                        |

## What to NOT do during demo

- Don't open devtools. The story is the contract loop, not the React.
- Don't explain calibration math beyond one sentence — the badge does the work.
- Don't compare to Polymarket / Hyperliquid by name unless asked. The judges read RFB 06; they know.
