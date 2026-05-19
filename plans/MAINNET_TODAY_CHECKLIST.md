# S3 Mainnet Today Checklist

Goal: Ship a production-ready mainnet configuration and operational path today.

## 1) Config Freeze (Target: 60 min)
- [ ] Create `.env.mainnet` from `.env.example`.
- [ ] Fill and validate:
  - `ARC_RPC_URL`, `ARC_CHAIN_ID`
  - `USDC_ADDRESS`, `S3_ESCROW_COURTHOUSE`, `S3_REPUTATION_REGISTRY`, `S3_INTENT_FIREWALL`
  - `ALPHA_PRIVATE_KEY`, `BETA_PRIVATE_KEY`, `GAMMA_PRIVATE_KEY`, `VALIDATOR_PRIVATE_KEY`
  - `DEFAULT_TASK_PAYMENT`, `DEFAULT_BOND_AMOUNT`, timing params
- [ ] Add RPC fallback list in ops notes (primary + two backups).
- [ ] Confirm all addresses are checksummed and non-zero.

Validation commands:
```bash
cd /workspace/projects/arc-s3
npm run build
```

## 2) Contract Permission Hardening (Target: 60 min)
- [ ] Run bootstrap against target config.
- [ ] Verify validator permissions:
  - Courthouse `validators[validator] == true`
  - Registry `updaters[validator] == true`
- [ ] Verify firewall registrations/policies for beta/gamma.
- [ ] Record tx hashes in launch log.

Reference:
- `contracts/scripts/bootstrap.ts`

## 3) End-to-End Runtime Dry Run (Target: 75 min)
- [ ] Start simulation loops with mainnet-like config.
- [ ] Confirm:
  - Alpha creates tasks
  - Beta/Gamma accept + submit results
  - Validator settles each submitted task
  - Reputation updates on each settlement
- [ ] Verify telemetry output at `simulation/data/metrics/validator-metrics.jsonl`.

Runtime command:
```bash
cd /workspace/projects/arc-s3
npm run sim
```

## 4) UI and Gating Verification (Target: 45 min)
- [ ] Run UI and verify dashboard route renders with live events.
- [ ] Check worker gating reflects slash/calibration/sample thresholds.
- [ ] Confirm trace pages resolve for recent task IDs.

Commands:
```bash
cd /workspace/projects/arc-s3
npm run ui
```

## 5) Ops Readiness (Target: 45 min)
- [ ] Finalize runbook:
  - Validator crash/restart
  - RPC outage failover
  - Stuck pending queue handling
- [ ] Set basic alert thresholds:
  - No settlements in X minutes
  - Spike in invalid settlements
  - Process down
- [ ] Confirm wallet custody model (owner/validator).

## 6) Exit Criteria (Go/No-Go)
- [ ] Build passes.
- [ ] Bootstrap passes and permissions verified.
- [ ] E2E settlements observed with telemetry updates.
- [ ] Dashboard shows live events and gating outcomes.
- [ ] Runbook and tx hashes committed to repo notes.
