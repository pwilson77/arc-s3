import { get, list, put } from "@vercel/blob";
import type { LifecycleEvent } from "./lifecycle";

export type LifecycleIndex = {
  version: 1;
  lastIndexedBlock: number;
  shards: string[]; // unique sorted list of shardKey values (e.g. "2026-05-24")
  updatedAt: string;
};

const INDEX_PATH = "index.json";
const DEFAULT_PREFIX = "arc-s3/lifecycle";

export function blobPrefix(): string {
  return (process.env.LIFECYCLE_BLOB_PREFIX ?? DEFAULT_PREFIX).replace(
    /\/+$/,
    "",
  );
}

function indexKey(): string {
  return `${blobPrefix()}/${INDEX_PATH}`;
}

function shardKey(date: string): string {
  return `${blobPrefix()}/events-${date}.jsonl`;
}

export function shardDateFromIsoTimestamp(iso: string | null): string {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

export function blobConfigured(): boolean {
  return Boolean(blobToken());
}

async function getText(pathname: string): Promise<string | null> {
  const res = await get(pathname, {
    access: "private",
    token: blobToken(),
  });
  if (!res || res.statusCode !== 200) return null;
  return new Response(res.stream).text();
}

export async function readIndex(): Promise<LifecycleIndex | null> {
  if (!blobConfigured()) return null;
  try {
    const text = await getText(indexKey());
    if (!text) return null;
    const parsed = JSON.parse(text) as LifecycleIndex;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeIndex(idx: LifecycleIndex): Promise<void> {
  if (!blobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  await put(indexKey(), JSON.stringify(idx, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken(),
  });
}

export async function readShard(date: string): Promise<LifecycleEvent[]> {
  if (!blobConfigured()) return [];
  try {
    const text = await getText(shardKey(date));
    if (!text) return [];
    return parseJsonl(text);
  } catch {
    return [];
  }
}

function parseJsonl(text: string): LifecycleEvent[] {
  const events: LifecycleEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as LifecycleEvent);
    } catch {
      // skip malformed
    }
  }
  return events;
}

/**
 * Append new events to per-day shards, deduplicating by `${taskId}|${stage}|${txHash}`.
 * Returns the dedup'd events that were actually persisted (new only).
 */
export async function appendEventsToShards(
  events: LifecycleEvent[],
): Promise<{ written: number; shards: string[] }> {
  if (events.length === 0) return { written: 0, shards: [] };
  if (!blobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN missing");

  const byDate = new Map<string, LifecycleEvent[]>();
  for (const ev of events) {
    const date = shardDateFromIsoTimestamp(ev.blockTimestamp ?? ev.observedAt);
    const list = byDate.get(date) ?? [];
    list.push(ev);
    byDate.set(date, list);
  }

  let written = 0;
  const touchedShards: string[] = [];
  for (const [date, newEvents] of byDate) {
    const existing = await readShard(date);
    const seen = new Set(
      existing.map((e) => `${e.taskId}|${e.stage}|${e.txHash}`),
    );
    const fresh = newEvents.filter(
      (e) => !seen.has(`${e.taskId}|${e.stage}|${e.txHash}`),
    );
    if (fresh.length === 0) continue;
    const merged = [...existing, ...fresh].sort(
      (a, b) => a.blockNumber - b.blockNumber,
    );
    const body = merged.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await put(shardKey(date), body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/x-ndjson",
      token: blobToken(),
    });
    written += fresh.length;
    touchedShards.push(date);
  }

  return { written, shards: touchedShards };
}

/**
 * Read the last `days` daily shards. Newest shard first when sorted by date desc.
 */
export async function readRecentShards(
  days: number,
): Promise<LifecycleEvent[]> {
  if (!blobConfigured()) return [];
  const idx = await readIndex();
  const dates = idx?.shards ?? (await discoverShardDates());
  const sorted = [...new Set(dates)].sort().reverse().slice(0, days);
  const lists = await Promise.all(sorted.map((d) => readShard(d)));
  return lists.flat();
}

async function discoverShardDates(): Promise<string[]> {
  if (!blobConfigured()) return [];
  try {
    const out = await list({
      prefix: `${blobPrefix()}/events-`,
      token: blobToken(),
    });
    const dates: string[] = [];
    for (const b of out.blobs) {
      const m = b.pathname.match(/events-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m) dates.push(m[1]);
    }
    return dates;
  } catch {
    return [];
  }
}
