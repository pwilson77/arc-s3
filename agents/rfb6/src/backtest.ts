import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import { readAllEvents, buildWorkerSnapshots } from "./metrics.js";
import { buildAllocations } from "./scoring.js";
import type { MetricsEvent, Rfb6Allocation } from "./types.js";

type EvaluationPoint = {
  atIndex: number;
  atTimestamp: string;
  activeWorkers: string[];
  allocatedNextEvBps: number;
  baselineNextEvBps: number;
  upliftBps: number;
  allocatedNextValidityBps: number;
  baselineNextValidityBps: number;
  turnoverBps: number;
  evaluatedWorkers: number;
};

type BacktestReport = {
  version: "rfb6-backtest/v1";
  generatedAt: string;
  inputFile: string;
  totalEvents: number;
  evaluationPoints: number;
  gateViolationCount: number;
  meanAllocatedNextEvBps: number;
  meanBaselineNextEvBps: number;
  meanUpliftBps: number;
  meanAllocatedNextValidityBps: number;
  meanBaselineNextValidityBps: number;
  averageTurnoverBps: number;
  averageActiveWorkers: number;
  selectionCountByWorker: Record<string, number>;
  samples: EvaluationPoint[];
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function activeWorkers(rows: Rfb6Allocation[]): Rfb6Allocation[] {
  return rows.filter((row) => row.weightBps > 0);
}

function setTurnoverBps(previous: string[] | null, current: string[]): number {
  if (!previous || previous.length === 0) return 0;
  const prev = new Set(previous);
  const next = new Set(current);
  const union = new Set([...previous, ...current]);
  const intersection = [...prev].filter((worker) => next.has(worker));
  if (union.size === 0) return 0;
  return Math.round((1 - intersection.length / union.size) * 10_000);
}

function nextOutcomeByWorker(
  events: MetricsEvent[],
  startIndex: number,
  workers: Set<string>,
): Map<string, MetricsEvent> {
  const outcomes = new Map<string, MetricsEvent>();
  for (let index = startIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!workers.has(event.worker) || outcomes.has(event.worker)) {
      continue;
    }
    outcomes.set(event.worker, event);
    if (outcomes.size === workers.size) {
      break;
    }
  }
  return outcomes;
}

function weightedExpectedValueBps(
  rows: Rfb6Allocation[],
  outcomes: Map<string, MetricsEvent>,
): number {
  let totalWeight = 0;
  let weighted = 0;
  for (const row of rows) {
    const outcome = outcomes.get(row.worker);
    if (!outcome) continue;
    totalWeight += row.weightBps;
    weighted += row.weightBps * outcome.expectedValueBps;
  }
  if (totalWeight === 0) return 0;
  return round(weighted / totalWeight);
}

function weightedValidityBps(
  rows: Rfb6Allocation[],
  outcomes: Map<string, MetricsEvent>,
): number {
  let totalWeight = 0;
  let weighted = 0;
  for (const row of rows) {
    const outcome = outcomes.get(row.worker);
    if (!outcome) continue;
    totalWeight += row.weightBps;
    weighted += row.weightBps * (outcome.valid ? 10_000 : 0);
  }
  if (totalWeight === 0) return 0;
  return round(weighted / totalWeight);
}

function equalWeightExpectedValueBps(
  outcomes: Map<string, MetricsEvent>,
): number {
  return round(
    mean([...outcomes.values()].map((event) => event.expectedValueBps)),
  );
}

function equalWeightValidityBps(outcomes: Map<string, MetricsEvent>): number {
  return round(
    mean([...outcomes.values()].map((event) => (event.valid ? 10_000 : 0))),
  );
}

async function main(): Promise<void> {
  const events = await readAllEvents(config.RFB6_AGENT_INPUT_FILE);
  const samples: EvaluationPoint[] = [];
  const selectionCountByWorker = new Map<string, number>();
  let gateViolationCount = 0;
  let previousActive: string[] | null = null;

  for (
    let index = Math.max(0, config.RFB6_BACKTEST_MIN_HISTORY - 1);
    index < events.length - 1;
    index += 1
  ) {
    const history = events.slice(0, index + 1);
    const snapshots = buildWorkerSnapshots(history);
    if (snapshots.length === 0) {
      continue;
    }

    const rows = buildAllocations(snapshots, config.RFB6_EV_WINDOW);
    gateViolationCount += rows.filter(
      (row) => !row.eligible && row.weightBps > 0,
    ).length;

    const active = activeWorkers(rows);
    if (active.length === 0) {
      continue;
    }

    const workerSet = new Set(active.map((row) => row.worker));
    const outcomes = nextOutcomeByWorker(events, index, workerSet);
    if (outcomes.size === 0) {
      continue;
    }

    const allocatedNextEvBps = weightedExpectedValueBps(active, outcomes);
    const baselineNextEvBps = equalWeightExpectedValueBps(outcomes);
    const allocatedNextValidityBps = weightedValidityBps(active, outcomes);
    const baselineNextValidityBps = equalWeightValidityBps(outcomes);
    const activeWorkerNames = active.map((row) => row.worker);

    for (const worker of activeWorkerNames) {
      selectionCountByWorker.set(
        worker,
        (selectionCountByWorker.get(worker) ?? 0) + 1,
      );
    }

    samples.push({
      atIndex: index,
      atTimestamp: events[index].timestamp,
      activeWorkers: activeWorkerNames,
      allocatedNextEvBps,
      baselineNextEvBps,
      upliftBps: round(allocatedNextEvBps - baselineNextEvBps),
      allocatedNextValidityBps,
      baselineNextValidityBps,
      turnoverBps: setTurnoverBps(previousActive, activeWorkerNames),
      evaluatedWorkers: outcomes.size,
    });

    previousActive = activeWorkerNames;
  }

  const report: BacktestReport = {
    version: "rfb6-backtest/v1",
    generatedAt: new Date().toISOString(),
    inputFile: config.RFB6_AGENT_INPUT_FILE,
    totalEvents: events.length,
    evaluationPoints: samples.length,
    gateViolationCount,
    meanAllocatedNextEvBps: round(
      mean(samples.map((sample) => sample.allocatedNextEvBps)),
    ),
    meanBaselineNextEvBps: round(
      mean(samples.map((sample) => sample.baselineNextEvBps)),
    ),
    meanUpliftBps: round(mean(samples.map((sample) => sample.upliftBps))),
    meanAllocatedNextValidityBps: round(
      mean(samples.map((sample) => sample.allocatedNextValidityBps)),
    ),
    meanBaselineNextValidityBps: round(
      mean(samples.map((sample) => sample.baselineNextValidityBps)),
    ),
    averageTurnoverBps: round(
      mean(samples.map((sample) => sample.turnoverBps)),
    ),
    averageActiveWorkers: round(
      mean(samples.map((sample) => sample.activeWorkers.length)),
    ),
    selectionCountByWorker: Object.fromEntries(
      [...selectionCountByWorker.entries()].sort((a, b) => b[1] - a[1]),
    ),
    samples,
  };

  await mkdir(dirname(config.RFB6_BACKTEST_OUTPUT_FILE), { recursive: true });
  await writeFile(
    config.RFB6_BACKTEST_OUTPUT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  console.log("[rfb6-backtest] wrote report", config.RFB6_BACKTEST_OUTPUT_FILE);
  console.log(
    `[rfb6-backtest] points=${report.evaluationPoints} upliftBps=${
      report.meanUpliftBps
    } allocatedValid=${(report.meanAllocatedNextValidityBps / 100).toFixed(
      2,
    )}% baselineValid=${(report.meanBaselineNextValidityBps / 100).toFixed(
      2,
    )}% turnover=${(report.averageTurnoverBps / 100).toFixed(
      2,
    )}% gateViolations=${report.gateViolationCount}`,
  );
}

main().catch((error) => {
  console.error("[rfb6-backtest] failed", error);
  process.exit(1);
});
