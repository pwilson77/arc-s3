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

function parseTraceTimestampFromFileName(fileName: string): number {
  const lastDash = fileName.lastIndexOf("-");
  const dot = fileName.lastIndexOf(".");
  if (lastDash === -1 || dot === -1 || dot <= lastDash + 1) return 0;
  const parsed = Number(fileName.slice(lastDash + 1, dot));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function readAllTraces(): Promise<ReasoningTrace[]> {
  const dir = tracesDir();
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const traces: ReasoningTrace[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      traces.push(JSON.parse(raw) as ReasoningTrace);
    } catch {
      // Skip malformed trace files.
    }
  }

  return traces;
}

export async function readLatestTracesByTaskId(): Promise<ReasoningTrace[]> {
  const dir = tracesDir();
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const latestFileByTask = new Map<string, { file: string; ts: number }>();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const dash = file.indexOf("-");
    if (dash <= 0) continue;

    const taskId = file.slice(0, dash);
    const ts = parseTraceTimestampFromFileName(file);
    const existing = latestFileByTask.get(taskId);

    if (!existing || ts >= existing.ts) {
      latestFileByTask.set(taskId, { file, ts });
    }
  }

  const traces: ReasoningTrace[] = [];
  for (const { file } of latestFileByTask.values()) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      traces.push(JSON.parse(raw) as ReasoningTrace);
    } catch {
      // Skip malformed trace files.
    }
  }

  return traces;
}

export async function findTraceByTaskId(
  taskId: string,
): Promise<ReasoningTrace | null> {
  const dir = tracesDir();
  if (!existsSync(dir)) return null;
  const files = await readdir(dir);

  const matches = files
    .filter((f) => f.startsWith(`${taskId}-`) && f.endsWith(".json"))
    .sort(
      (a, b) =>
        parseTraceTimestampFromFileName(b) - parseTraceTimestampFromFileName(a),
    );
  if (matches.length === 0) return null;

  const raw = await readFile(join(dir, matches[0]), "utf8");
  try {
    return JSON.parse(raw) as ReasoningTrace;
  } catch {
    return null;
  }
}
