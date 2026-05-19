import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type CalibrationSnapshot = {
  sampleSize: number;
  meanConfidenceBps: number;
  hitRateBps: number;
  calibrationGapBps: number;
};

export type WorkerAggregateMetrics = {
  totalSettled: number;
  validSettled: number;
  invalidSettled: number;
  slashRateBps: number;
  meanScore: number;
  scoreDriftBps: number;
  calibration: CalibrationSnapshot;
};

type WorkerSettlement = {
  valid: boolean;
  confidenceBps: number;
  score: number;
};

type WorkerStats = {
  totalSettled: number;
  validSettled: number;
  invalidSettled: number;
  cumulativeScore: number;
  firstScore: number | null;
  lastScore: number | null;
  recent: WorkerSettlement[];
};

export type MetricsEvent = {
  timestamp: string;
  taskId: string;
  worker: string;
  valid: boolean;
  score: string;
  confidenceBps: number;
  expectedValueBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
};

function createInitialStats(): WorkerStats {
  return {
    totalSettled: 0,
    validSettled: 0,
    invalidSettled: 0,
    cumulativeScore: 0,
    firstScore: null,
    lastScore: null,
    recent: [],
  };
}

function computeCalibrationSnapshot(
  recent: WorkerSettlement[],
): CalibrationSnapshot {
  if (recent.length === 0) {
    return {
      sampleSize: 0,
      meanConfidenceBps: 0,
      hitRateBps: 0,
      calibrationGapBps: 0,
    };
  }

  const totalConfidence = recent.reduce(
    (acc, item) => acc + item.confidenceBps,
    0,
  );
  const totalHits = recent.reduce(
    (acc, item) => acc + (item.valid ? 10_000 : 0),
    0,
  );
  const meanConfidenceBps = Math.round(totalConfidence / recent.length);
  const hitRateBps = Math.round(totalHits / recent.length);

  return {
    sampleSize: recent.length,
    meanConfidenceBps,
    hitRateBps,
    calibrationGapBps: Math.abs(meanConfidenceBps - hitRateBps),
  };
}

export class ValidatorMetricsTracker {
  private readonly windowSize: number;
  private readonly perWorker = new Map<string, WorkerStats>();

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  calibration(worker: string): CalibrationSnapshot {
    const stats = this.perWorker.get(worker) ?? createInitialStats();
    return computeCalibrationSnapshot(stats.recent);
  }

  recordSettlement(
    worker: string,
    valid: boolean,
    confidenceBps: number,
    score: number,
  ): WorkerAggregateMetrics {
    const stats = this.perWorker.get(worker) ?? createInitialStats();

    stats.totalSettled += 1;
    stats.validSettled += valid ? 1 : 0;
    stats.invalidSettled += valid ? 0 : 1;
    stats.cumulativeScore += score;
    if (stats.firstScore === null) stats.firstScore = score;
    stats.lastScore = score;

    stats.recent.push({ valid, confidenceBps, score });
    if (stats.recent.length > this.windowSize) {
      stats.recent.shift();
    }

    this.perWorker.set(worker, stats);

    const slashRateBps = Math.round(
      (stats.invalidSettled * 10_000) / stats.totalSettled,
    );
    const meanScore = Math.round(stats.cumulativeScore / stats.totalSettled);
    const firstScore = stats.firstScore ?? score;
    const scoreDriftBps =
      firstScore === 0
        ? 0
        : Math.round(((score - firstScore) * 10_000) / firstScore);

    return {
      totalSettled: stats.totalSettled,
      validSettled: stats.validSettled,
      invalidSettled: stats.invalidSettled,
      slashRateBps,
      meanScore,
      scoreDriftBps,
      calibration: computeCalibrationSnapshot(stats.recent),
    };
  }
}

export async function appendMetricsEvent(
  outputDir: string,
  event: MetricsEvent,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, "validator-metrics.jsonl");
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}
