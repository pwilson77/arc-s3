import type { ReasoningTrace, TaskAssignment } from "./types.js";
import type { CalibrationSnapshot } from "./metrics.js";

export type TraceValidationInputs = {
  structureValid: boolean;
  hashMatches: boolean;
  taskMatches: boolean;
  workerMatches: boolean;
};

export type ValidationVerdict = {
  valid: boolean;
  performanceScore: bigint;
  reasons: string[];
};

const SCALE = 1_000_000n;

export function evaluateTraceForSettlement(
  trace: ReasoningTrace,
  task: TaskAssignment,
  checks: TraceValidationInputs,
): ValidationVerdict {
  const reasons: string[] = [];

  if (!checks.structureValid) reasons.push("invalid-structure");
  if (!checks.hashMatches) reasons.push("hash-mismatch");
  if (!checks.taskMatches) reasons.push("task-mismatch");
  if (!checks.workerMatches) reasons.push("worker-mismatch");

  const hardFailure = reasons.length > 0;
  if (hardFailure) {
    return {
      valid: false,
      performanceScore: 0n,
      reasons,
    };
  }

  let score = SCALE;

  // Penalize overconfidence when EV is negative, reward calibrated risk-taking.
  if (trace.decision.expectedValueBps < 0) {
    const confidencePenalty = BigInt(trace.decision.confidenceBps) * 20n;
    score = score > confidencePenalty ? score - confidencePenalty : 0n;
    reasons.push("negative-ev-penalty");
  }

  // Short horizons imply harder commitments; add a small bonus for successful execution.
  if (trace.decision.timeHorizonSec <= 300) {
    score = score + 25_000n > SCALE ? SCALE : score + 25_000n;
    reasons.push("short-horizon-bonus");
  }

  // Normalize score by task bond-to-payment ratio to reward higher skin-in-the-game.
  const denom = task.paymentAmount === 0n ? 1n : task.paymentAmount;
  const ratioBps = (task.bondAmount * 10_000n) / denom;
  const ratioBoost = ratioBps > 2_500n ? 20_000n : 0n;
  score = score + ratioBoost > SCALE ? SCALE : score + ratioBoost;
  if (ratioBoost > 0n) reasons.push("high-bond-ratio-bonus");

  return {
    valid: true,
    performanceScore: score,
    reasons,
  };
}

export function calibrationScoreAdjustment(
  snapshot: CalibrationSnapshot,
  currentConfidenceBps: number,
): { delta: bigint; reason: string | null } {
  if (snapshot.sampleSize < 5) {
    return { delta: 0n, reason: null };
  }

  const overconfident = snapshot.meanConfidenceBps > snapshot.hitRateBps;
  if (
    snapshot.calibrationGapBps >= 2_000 &&
    overconfident &&
    currentConfidenceBps >= 8_000
  ) {
    return { delta: -60_000n, reason: "calibration-overconfidence-penalty" };
  }

  if (snapshot.calibrationGapBps <= 750 && currentConfidenceBps <= 7_000) {
    return { delta: 25_000n, reason: "calibration-discipline-bonus" };
  }

  return { delta: 0n, reason: null };
}

export function clampScore(score: bigint): bigint {
  if (score < 0n) return 0n;
  if (score > SCALE) return SCALE;
  return score;
}
