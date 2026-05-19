import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ReasoningTrace = {
  taskId: string;
  worker: string;
  schemaVersion: string;
  timestamp: string;
  decision: {
    marketType: string;
    instrumentId: string;
    action: string;
    notionalUsd: number;
    confidenceBps: number;
    timeHorizonSec: number;
    expectedValueBps: number;
    resolver: { kind: string; reference: string };
  };
  plan: string[];
  result: {
    success: boolean;
    outputHash: string;
    details: string;
  };
  integrity: {
    malformed: boolean;
    corruptionReason?: string;
  };
};

function tracesDir(): string {
  return process.env.TRACE_OUTPUT_DIR ?? "../simulation/data/traces";
}

export async function findTraceByTaskId(
  taskId: string,
): Promise<ReasoningTrace | null> {
  const dir = tracesDir();
  if (!existsSync(dir)) return null;
  const files = await readdir(dir);
  const match = files.find((f) => f.startsWith(`${taskId}-`));
  if (!match) return null;
  const raw = await readFile(join(dir, match), "utf8");
  try {
    return JSON.parse(raw) as ReasoningTrace;
  } catch {
    return null;
  }
}
