import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Rfb6RunEvent, Rfb6RunEventBase } from "./types.js";

function compactWorkers(run: Rfb6RunEventBase) {
  return run.workers.map((w) => ({
    worker: w.worker,
    eligible: w.eligible,
    status: w.status,
    weightBps: w.weightBps,
    rawScore: Number(w.rawScore.toFixed(6)),
    meanRecentEvBps: w.meanRecentEvBps,
    reasons: w.reasons,
    aggregate: w.aggregate,
  }));
}

export function signatureForRun(run: Rfb6RunEventBase): string {
  const compact = run.workers.map((w) => ({
    worker: w.worker,
    status: w.status,
    weightBps: w.weightBps,
    rawScore: Number(w.rawScore.toFixed(6)),
    meanRecentEvBps: w.meanRecentEvBps,
  }));

  return createHash("sha256")
    .update(
      JSON.stringify({
        latest: run.sourceLatestTimestamp,
        workers: compact,
      }),
    )
    .digest("hex");
}

export function canonicalPayloadForRun(run: Rfb6RunEventBase): string {
  return JSON.stringify({
    artifactVersion: run.artifactVersion,
    runId: run.runId,
    timestamp: run.timestamp,
    publisher: run.publisher,
    sourceMetricsFile: run.sourceMetricsFile,
    sourceEventCount: run.sourceEventCount,
    sourceLatestTimestamp: run.sourceLatestTimestamp,
    workers: compactWorkers(run),
  });
}

export function payloadHashForRun(run: Rfb6RunEventBase): string {
  return `0x${createHash("sha256")
    .update(canonicalPayloadForRun(run))
    .digest("hex")}`;
}

export async function appendRun(
  filePath: string,
  run: Rfb6RunEvent,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(run)}\n`, "utf8");
}
