# S3 — Traction Metrics

Every metric judges see in the UI comes from `validator-metrics.jsonl`, written by the validator after every on-chain settlement. No off-chain telemetry, no analytics service.

## Source of truth

- File: `simulation/data/metrics/validator-metrics.jsonl` (path overridable via `METRICS_OUTPUT_DIR`).
- Writer: [simulation/src/metrics.ts](simulation/src/metrics.ts) — `appendFile` per settled task.
- Reader: [ui/lib/metrics.ts](ui/lib/metrics.ts) — server component, no client fetch.
- Event shape: `MetricsEvent` in [simulation/src/metrics.ts](simulation/src/metrics.ts).

## Headline numbers

| Metric                            | Where it's computed                              | What it answers                                   |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `totalSettled`                    | per-worker counter                               | How many bonds have run the full lifecycle on Arc |
| `validSettled` / `invalidSettled` | validator verdict                                | How often each agent's trace held vs got slashed  |
| `slashRateBps`                    | `invalidSettled / totalSettled × 10000`          | The actual on-chain failure rate                  |
| `meanScore`                       | `cumulativeScore / totalSettled` (1e6-scaled)    | Reputation level, scoring policy applied          |
| `scoreDriftBps`                   | `(lastScore − firstScore) / firstScore × 10000`  | Is the agent improving or degrading?              |
| `calibration.meanConfidenceBps`   | mean of trace `confidenceBps` over recent window | What the agent _claimed_                          |
| `calibration.hitRateBps`          | `validRecent / windowSize × 10000`               | What actually happened                            |
| `calibration.calibrationGapBps`   | `\|meanConfidence − hitRate\|`                   | The honesty signal — overconfident or under       |

## Copy-eligibility (the consumer-facing claim)

Defined in [ui/lib/eligibility.ts](ui/lib/eligibility.ts):

```ts
slashRateBps         ≤ 1000     // ≤ 10% of bonds slashed
sampleSize           ≥ 10       // enough history to be statistical
calibrationGapBps    ≤ 1500     // confidence within 15% of reality
```

This is the entire trust gate. Any judge can verify it against `validator-metrics.jsonl` with a one-liner:

```bash
jq -s 'group_by(.worker) | map({
  worker: .[0].worker,
  totalSettled: (.[-1].aggregate.totalSettled),
  slashRateBps: (.[-1].aggregate.slashRateBps),
  calibrationGapBps: (.[-1].aggregate.calibration.calibrationGapBps),
  sampleSize: (.[-1].aggregate.calibration.sampleSize)
})' simulation/data/metrics/validator-metrics.jsonl
```

## How to read the JSONL directly

```bash
# Most recent settlement per worker
tail -n 50 simulation/data/metrics/validator-metrics.jsonl | jq -c '{ts: .timestamp, worker, valid, score, reasons}'

# Slash count per worker
jq -r 'select(.valid==false) | .worker' simulation/data/metrics/validator-metrics.jsonl | sort | uniq -c
```

## What this is _not_

- Not a PnL leaderboard. Returns are out of scope — the point is _whether the agent did what it committed to_.
- Not aggregated across venues. Single-substrate (Arc) on purpose. Venue adapters are integration work, not S3 itself.
- Not synthetic. The validator writes a row only after `S3EscrowCourthouse.settle*` succeeds on chain.

## Mapping to judging dimensions

| Judging dim            | Metric                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Agentic sophistication | `calibration.calibrationGapBps` — agents that pre-commit honest confidence score better      |
| Traction               | `totalSettled` aggregated across workers — total bonds processed end-to-end on Arc           |
| Circle usage           | every settlement is a USDC transfer — `totalSettled` _is_ the Circle-tool usage metric       |
| Innovation             | `slashRateBps` × `calibrationGapBps` is the novel trust surface — neither is a return metric |
