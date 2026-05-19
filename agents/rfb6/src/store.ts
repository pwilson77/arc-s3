import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Rfb6RunEvent } from "./types.js";

export function signatureForRun(run: Rfb6RunEvent): string {
  const compact = run.workers.map((w) => ({
    worker: w.worker,
    status: w.status,
    weightBps: w.weightBps,
    rawScore: Number(w.rawScore.toFixed(6)),
    meanRecentEvBps: w.meanRecentEvBps,
  }));

  return createHash("sha256")
    .update(JSON.stringify({
      latest: run.sourceLatestTimestamp,
      workers: compact,
    }))
    .digest("hex");
}

export async function appendRun(filePath: string, run: Rfb6RunEvent): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(run)}\n`, "utf8");
}
