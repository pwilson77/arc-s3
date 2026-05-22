import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type LifecycleStage = "created" | "accepted" | "submitted" | "validated";

export type LifecycleEvent = {
  observedAt: string;
  stage: LifecycleStage;
  taskId: string;
  actor: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: string | null;
  valid?: boolean;
  reasons?: string[];
};

const LIFECYCLE_FILE = "events.jsonl";

function lifecycleDir(): string {
  if (process.env.LIFECYCLE_OUTPUT_DIR) return process.env.LIFECYCLE_OUTPUT_DIR;

  const traceDir = process.env.TRACE_OUTPUT_DIR;
  if (traceDir?.endsWith("/traces")) {
    return `${traceDir.slice(0, -"/traces".length)}/lifecycle`;
  }

  return "../simulation/data/lifecycle";
}

export async function readLifecycleEvents(): Promise<LifecycleEvent[]> {
  const path = join(lifecycleDir(), LIFECYCLE_FILE);
  if (!existsSync(path)) return [];

  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  const events: LifecycleEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as LifecycleEvent);
    } catch {
      // Skip malformed lines.
    }
  }

  return events;
}
