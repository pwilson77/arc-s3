import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { MetricsEvent, WorkerSnapshot } from "./types.js";

export async function readAllEvents(filePath: string): Promise<MetricsEvent[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const events: MetricsEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as MetricsEvent);
    } catch {
      // Ignore malformed lines and continue the stream.
    }
  }

  return events;
}

export function buildWorkerSnapshots(events: MetricsEvent[]): WorkerSnapshot[] {
  const byWorker = new Map<string, MetricsEvent[]>();
  for (const event of events) {
    const list = byWorker.get(event.worker) ?? [];
    list.push(event);
    byWorker.set(event.worker, list);
  }

  return [...byWorker.entries()].map(([worker, list]) => ({
    worker,
    latest: list[list.length - 1],
    events: list,
  }));
}
