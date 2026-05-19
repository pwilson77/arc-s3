import { isCopyEligible } from "./eligibility";
import type { WorkerAggregateMetrics, WorkerSnapshot } from "./metrics";

export type SocialAllocationRow = {
  worker: string;
  eligible: boolean;
  status: "eligible" | "gated";
  rawScore: number;
  weightBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
  meanRecentEvBps: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function meanRecentEvBps(snapshot: WorkerSnapshot, limit = 20): number {
  const recent = snapshot.events.slice(-limit);
  if (recent.length === 0) return 0;
  const total = recent.reduce((acc, event) => acc + event.expectedValueBps, 0);
  return Math.round(total / recent.length);
}

function computeRawScore(snapshot: WorkerSnapshot): {
  score: number;
  reasons: string[];
  meanEvBps: number;
} {
  const aggregate = snapshot.latest.aggregate;
  const eligibility = isCopyEligible(aggregate);
  const reasons = [...eligibility.reasons];
  const meanEvBps = meanRecentEvBps(snapshot);

  if (!eligibility.eligible) {
    return { score: 0, reasons, meanEvBps };
  }

  // RFB 06: trust, calibration, sample quality.
  const slashReliability = clamp(1 - aggregate.slashRateBps / 2_000, 0, 1);
  const calibrationDiscipline = clamp(
    1 - aggregate.calibration.calibrationGapBps / 3_000,
    0,
    1,
  );
  const sampleQuality = clamp(aggregate.calibration.sampleSize / 50, 0.2, 1);

  // RFB 02 overlay: reward recent +EV quality, penalize negative EV drift.
  const evQuality = clamp((meanEvBps + 1_000) / 2_000, 0, 1);

  const score =
    (0.5 * slashReliability + 0.3 * calibrationDiscipline + 0.2 * evQuality) *
    sampleQuality;

  reasons.push(
    `trust=${(slashReliability * 100).toFixed(1)}% calibration=${(
      calibrationDiscipline * 100
    ).toFixed(1)}% ev=${(evQuality * 100).toFixed(1)}%`,
  );

  return { score, reasons, meanEvBps };
}

export function buildSocialAllocations(
  snapshots: WorkerSnapshot[],
): SocialAllocationRow[] {
  const rows = snapshots.map((snapshot) => {
    const { score, reasons, meanEvBps } = computeRawScore(snapshot);
    const eligibility = isCopyEligible(snapshot.latest.aggregate);
    return {
      worker: snapshot.worker,
      eligible: eligibility.eligible,
      status: eligibility.eligible ? "eligible" : "gated",
      rawScore: score,
      weightBps: 0,
      reasons,
      aggregate: snapshot.latest.aggregate,
      meanRecentEvBps: meanEvBps,
    } satisfies SocialAllocationRow;
  });

  const eligible = rows.filter((row) => row.eligible && row.rawScore > 0);
  const total = eligible.reduce((acc, row) => acc + row.rawScore, 0);

  if (total > 0) {
    for (const row of rows) {
      row.weightBps = row.eligible
        ? Math.round((row.rawScore / total) * 10_000)
        : 0;
    }
  }

  // Keep allocation exactly at 10_000 bps when possible.
  const allocated = rows.reduce((acc, row) => acc + row.weightBps, 0);
  const diff = 10_000 - allocated;
  if (diff !== 0) {
    const best = rows
      .filter((row) => row.eligible)
      .sort((a, b) => b.rawScore - a.rawScore)[0];
    if (best) {
      best.weightBps = Math.max(0, best.weightBps + diff);
    }
  }

  return rows.sort((a, b) => b.weightBps - a.weightBps || b.rawScore - a.rawScore);
}
