import type { WorkerAggregateMetrics } from "./metrics";

export type EligibilityVerdict = {
  eligible: boolean;
  reasons: string[];
};

const MAX_SLASH_RATE_BPS = 1_000;
const MIN_SAMPLE_SIZE = 10;
const MAX_CALIBRATION_GAP_BPS = 1_500;

export function isCopyEligible(
  aggregate: WorkerAggregateMetrics,
): EligibilityVerdict {
  const reasons: string[] = [];

  if (aggregate.slashRateBps > MAX_SLASH_RATE_BPS) {
    reasons.push(
      `slash rate ${aggregate.slashRateBps}bps > ${MAX_SLASH_RATE_BPS}bps`,
    );
  }
  if (aggregate.calibration.sampleSize < MIN_SAMPLE_SIZE) {
    reasons.push(
      `sample size ${aggregate.calibration.sampleSize} < ${MIN_SAMPLE_SIZE}`,
    );
  }
  if (aggregate.calibration.calibrationGapBps > MAX_CALIBRATION_GAP_BPS) {
    reasons.push(
      `calibration gap ${aggregate.calibration.calibrationGapBps}bps > ${MAX_CALIBRATION_GAP_BPS}bps`,
    );
  }

  return { eligible: reasons.length === 0, reasons };
}
