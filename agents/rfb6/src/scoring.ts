import type { Rfb6Allocation, WorkerAggregateMetrics, WorkerSnapshot } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eligibilityReasons(a: WorkerAggregateMetrics): {
  eligible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (a.totalSettled < 5) {
    reasons.push("insufficient sample size");
  }
  if (a.slashRateBps > 1_500) {
    reasons.push("slash rate above threshold");
  }
  if (a.calibration.sampleSize < 10) {
    reasons.push("insufficient calibration samples");
  }
  if (a.calibration.calibrationGapBps > 2_500) {
    reasons.push("calibration gap above threshold");
  }

  return { eligible: reasons.length === 0, reasons };
}

function meanRecentEvBps(snapshot: WorkerSnapshot, limit: number): number {
  const recent = snapshot.events.slice(-limit);
  if (recent.length === 0) return 0;
  const total = recent.reduce((acc, event) => acc + event.expectedValueBps, 0);
  return Math.round(total / recent.length);
}

export function buildAllocations(
  snapshots: WorkerSnapshot[],
  evWindow: number,
): Rfb6Allocation[] {
  const rows: Rfb6Allocation[] = snapshots.map((snapshot) => {
    const aggregate = snapshot.latest.aggregate;
    const eligibility = eligibilityReasons(aggregate);
    const meanEvBps = meanRecentEvBps(snapshot, evWindow);

    if (!eligibility.eligible) {
      return {
        worker: snapshot.worker,
        eligible: false,
        status: "gated",
        rawScore: 0,
        weightBps: 0,
        meanRecentEvBps: meanEvBps,
        reasons: eligibility.reasons,
        aggregate,
      };
    }

    const slashReliability = clamp(1 - aggregate.slashRateBps / 2_000, 0, 1);
    const calibrationDiscipline = clamp(
      1 - aggregate.calibration.calibrationGapBps / 3_000,
      0,
      1,
    );
    const sampleQuality = clamp(aggregate.calibration.sampleSize / 50, 0.2, 1);
    const evQuality = clamp((meanEvBps + 1_000) / 2_000, 0, 1);

    const score =
      (0.5 * slashReliability + 0.3 * calibrationDiscipline + 0.2 * evQuality) *
      sampleQuality;

    return {
      worker: snapshot.worker,
      eligible: true,
      status: "eligible",
      rawScore: score,
      weightBps: 0,
      meanRecentEvBps: meanEvBps,
      reasons: [
        `trust=${(slashReliability * 100).toFixed(1)}% calibration=${(
          calibrationDiscipline * 100
        ).toFixed(1)}% ev=${(evQuality * 100).toFixed(1)}%`,
      ],
      aggregate,
    };
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
