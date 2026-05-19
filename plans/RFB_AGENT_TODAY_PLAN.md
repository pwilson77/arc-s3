# RFB Agent Delivery Plan (Today)

Goal: Deliver RFB 06 (Social Trading Intelligence) today, with a lightweight RFB 02 (+EV signal quality) overlay.

## Selected Direction
- Primary: **RFB 06 Social Trading Intelligence**
- Overlay: **RFB 02 Prediction Market Trader Intelligence** as a ranking signal only
- Why: Reuses S3's strongest primitives (slash rate, calibration, sample size, integrity incidents) with minimal architecture risk.

## 1) Success Rubric (Target: 30 min)
- [ ] Acceptance checks:
  - [ ] Dashboard outputs ranked workers with copy weights (sum = 100%).
  - [ ] Ineligible workers get zero weight.
  - [ ] Higher slash/calibration penalties reduce weight monotonically.
  - [ ] Positive recent EV quality improves rank, negative EV quality reduces rank.
- [ ] Define one 5-minute demo path.

Template:
- RFB: <id/name>
- Inputs: <what agent reads>
- Outputs: <decision + trace fields>
- Success metric: <numeric threshold>

## 2) Social Intelligence Spec (Target: 45 min)
- [ ] Define role split:
  - Signal extraction from recent settlements
  - Trust gating from eligibility criteria
  - Weight allocation across eligible workers
- [ ] Map required fields to existing telemetry (`confidenceBps`, `expectedValueBps`, `valid`, aggregate metrics).
- [ ] Define failure classes and expected reasons for zero/low allocation.

## 3) Implement Intelligence Integration (Target: 90 min)
- [ ] Add social-intel computation module in UI lib.
- [ ] Compute per-worker `rawScore` and normalized `weightBps`.
- [ ] Expose allocation rationale (risk penalties + EV quality contribution).

## 4) Evaluation Harness (Target: 60 min)
- [ ] Run against real JSONL telemetry.
- [ ] Validate monotonic behavior under synthetic edge scenarios.
- [ ] Capture pass/fail + reasons.
- [ ] Confirm failures become visible in S3 telemetry and dashboard.

## 5) UI Surface (Target: 45 min)
- [ ] Add dashboard section for social allocation table.
- [ ] Show: worker, status, score, weight, rationale.
- [ ] Add minimal docs note for RFB 06 + RFB 02 overlay method.

## 6) End-of-Day Deliverables
- [ ] RFB 06 allocation logic live in dashboard.
- [ ] RFB 02 overlay signal integrated in worker ranking.
- [ ] Short report: what passes, what fails, what next.

## Fast Execution Order (Do Not Reorder)
1. Lock rubric and formula.
2. Implement social-intel module and weight normalization.
3. Wire into dashboard.
4. Validate with build/typecheck.
5. Write final report snippet in `SUBMISSION.md`.
