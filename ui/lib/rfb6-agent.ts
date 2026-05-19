import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { WorkerAggregateMetrics } from "./metrics";

export type Rfb6Allocation = {
  worker: string;
  eligible: boolean;
  status: "eligible" | "gated";
  rawScore: number;
  weightBps: number;
  meanRecentEvBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
};

export type Rfb6RunEvent = {
  runId: string;
  timestamp: string;
  sourceMetricsFile: string;
  sourceEventCount: number;
  sourceLatestTimestamp: string;
  workers: Rfb6Allocation[];
};

function runFilePath(): string {
  return process.env.RFB6_AGENT_OUTPUT_FILE ?? "../simulation/data/agents/rfb6-social-intel.jsonl";
}

export async function readRfb6Runs(limit = 50): Promise<Rfb6RunEvent[]> {
  const path = runFilePath();
  if (!existsSync(path)) return [];

  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const parsed: Rfb6RunEvent[] = [];

  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line) as Rfb6RunEvent);
    } catch {
      // Ignore malformed stream lines to preserve UI availability.
    }
  }

  if (limit <= 0 || parsed.length <= limit) {
    return parsed;
  }

  return parsed.slice(parsed.length - limit);
}

export async function readLatestRfb6Run(): Promise<Rfb6RunEvent | null> {
  const runs = await readRfb6Runs(1);
  return runs[0] ?? null;
}
