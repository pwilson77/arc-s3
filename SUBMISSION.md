# S3 — Submission Brief

**Agora Agents Hackathon · Canteen × Circle × Arc · May 11–25, 2026**
Chain: Arc L1 (chainId `5042002`) · Gas + settlement asset: native USDC.

## One-liner

**Accountable picks, not just picks.** S3 is the slash-bonded settlement + reputation substrate for autonomous trading agents on Arc. Agents bond USDC, publish structured `ReasoningTrace`s, and lose stake on misbehavior — so users can copy bonded agents instead of unverified leaderboards.

## What's in the repo

| Layer            | Path                                                                                         | Purpose                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Settlement       | [contracts/contracts/S3EscrowCourthouse.sol](contracts/contracts/S3EscrowCourthouse.sol)     | Bonded escrow lifecycle: create → accept → submit → settle/slash              |
| Pre-flight       | [contracts/contracts/S3IntentFirewall.sol](contracts/contracts/S3IntentFirewall.sol)         | Risk bounds + whitelist gating before bond lock                               |
| Reputation       | [contracts/contracts/S3ReputationRegistry.sol](contracts/contracts/S3ReputationRegistry.sol) | Decayed score updates + USYC stake signaling                                  |
| Agent economy    | [simulation/src/agents](simulation/src/agents)                                               | Three autonomous agents (alpha/beta/gamma) running unattended loops           |
| Validator        | [simulation/src/validator.ts](simulation/src/validator.ts)                                   | Trace integrity + scoring + on-chain settlement                               |
| Scoring policy   | [simulation/src/scoring.ts](simulation/src/scoring.ts)                                       | Calibration-aware reputation deltas                                           |
| Metrics surface  | [simulation/src/metrics.ts](simulation/src/metrics.ts)                                       | JSONL stream: slashRateBps, calibrationGapBps, meanScore                      |
| Consumer UI      | [ui/app](ui/app)                                                                             | Leaderboard, agent detail, trace inspector — server-rendered, no client fetch |
| Eligibility rule | [ui/lib/eligibility.ts](ui/lib/eligibility.ts)                                               | `slashRateBps ≤ 1000 ∧ sampleSize ≥ 10 ∧ calibrationGapBps ≤ 1500`            |

## How it maps to RFB 06 (Slash-bonded leaderboard copy-trading)

> _"A USDC performance bond on Arc … if the leader falls below a defined threshold, the bond slashes proportionally and settles in under a second."_

| RFB 06 requirement          | S3 component                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| USDC performance bond       | `S3EscrowCourthouse.createTask{bondAmount}`                        |
| Leaderboard rank via oracle | `S3ReputationRegistry.reputationScore(worker)`                     |
| Threshold slashing          | Validator → `settleSlash` on trace integrity / calibration failure |
| Sub-second settlement       | Arc L1 native finality + native-USDC gas                           |
| Stake alongside             | `isCopyEligible(aggregate)` gates which agents are followable      |

## Judging rubric mapping

### 30% — Agentic sophistication

- Three autonomous agents (`alpha`, `beta`, `gamma`) running concurrent loops with structured outputs.
- Every decision emits a deterministic `ReasoningTrace` (market context, direction, sizing, confidence, time horizon, expected value). See [simulation/src/types.ts](simulation/src/types.ts).
- `gamma` intentionally perturbs traces — validator catches it, courthouse slashes the bond. This is the accountability loop, not theater.
- Calibration-aware scoring penalizes overconfidence even on valid traces ([scoring.ts](simulation/src/scoring.ts) `calibrationScoreAdjustment`).

### 30% — Traction

- End-to-end loop runs against deployed contracts on Arc testnet (see [.env.example](.env.example)).
- Every settlement writes a row to `validator-metrics.jsonl`. The UI reads this directly — single source of truth, no fake numbers.
- See [TRACTION.md](TRACTION.md) for the exact metrics judges should look at and how each is computed.

### 20% — Circle tool usage

- Native USDC is the only settlement asset; bonds, payments, and slashes all denominate in USDC.
- Gas paid in native USDC (Arc’s 18-dec gas vs 6-dec token boundary handled in `contracts/`).
- Optional USYC reputation stake signaling in `S3ReputationRegistry`.
- No bridging, no wrapping — Circle-native by construction.

### 20% — Innovation

- **Slash-bonded accountability for agents** is the missing piece between the _agent layer_ (TradingAgents-style frameworks) and the _venue layer_ (Polymarket V2, Hyperliquid). S3 is the _identity + settlement layer_ that lets an agent's track record travel.
- `ReasoningTrace` as canonical structured-output log — agents commit to plan **before** result; validator settles on whether the commitment held.
- Copy-eligibility = `slashRate × calibrationGap × sampleSize`, not raw return. This is what RFB 06 actually needs.

## What's deliberately out of scope

- Multi-venue bridge adapters (Polymarket / Hyperliquid). Reputation registry is venue-agnostic by design; integration is post-hackathon work.
- Auth, accounts, write paths in the UI. v1 is read-only by design — the contracts are the write surface.
- Charts/dependencies in UI. One inline-SVG sparkline, Tailwind only.

## Repro

```bash
cp .env.example .env       # fill Arc testnet addresses + keys
npm install
npm run build              # contracts + simulation + ui
npm run sim                # autonomous loop against Arc testnet
npm run ui                 # localhost:3030 — leaderboard + traces
```

See [DEMO.md](DEMO.md) for the 5-minute judge walkthrough.
