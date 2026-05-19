import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

const METRICS_FILE = "validator-metrics.jsonl";

function metricsDir(): string {
  return process.env.METRICS_OUTPUT_DIR ?? "../simulation/data/metrics";
}

export async function readAllEvents(): Promise<MetricsEvent[]> {
  const path = join(metricsDir(), METRICS_FILE);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const events: MetricsEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as MetricsEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export type WorkerSnapshot = {
  worker: string;
  latest: MetricsEvent;
  events: MetricsEvent[];
};

export async function readWorkerSnapshots(): Promise<WorkerSnapshot[]> {
  const events = await readAllEvents();
  const byWorker = new Map<string, MetricsEvent[]>();
  for (const e of events) {
    const list = byWorker.get(e.worker) ?? [];
    list.push(e);
    byWorker.set(e.worker, list);
  }
  return [...byWorker.entries()].map(([worker, list]) => ({
    worker,
    latest: list[list.length - 1],
    events: list,
  }));
}

export async function readWorkerSnapshot(
  worker: string,
): Promise<WorkerSnapshot | null> {
  const snapshots = await readWorkerSnapshots();
  return snapshots.find((s) => s.worker === worker) ?? null;
}
