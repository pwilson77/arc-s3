import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Rfb5Run, Rfb5RunBase } from "./types.js";

function compactDecisions(run: Rfb5RunBase) {
  return run.decisions.map((d) => ({
    eventKey: d.eventKey,
    netEdgeBps: d.netEdgeBps,
    profitable: d.profitable,
    recommendedSizeUsd: Number(d.recommendedSizeUsd.toFixed(4)),
    yes: {
      venue: d.yesLeg.venue,
      priceBps: d.yesLeg.priceBps,
    },
    no: {
      venue: d.noLeg.venue,
      priceBps: d.noLeg.priceBps,
    },
  }));
}

export function signatureForRun(run: Rfb5RunBase): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceLatestTimestampMs: run.sourceLatestTimestampMs,
        decisions: compactDecisions(run),
      }),
    )
    .digest("hex");
}

export function canonicalPayloadForRun(run: Rfb5RunBase): string {
  return JSON.stringify({
    artifactVersion: run.artifactVersion,
    runId: run.runId,
    timestamp: run.timestamp,
    publisher: run.publisher,
    sourceSnapshotFile: run.sourceSnapshotFile,
    sourceSnapshotCount: run.sourceSnapshotCount,
    sourceLatestTimestampMs: run.sourceLatestTimestampMs,
    decisions: run.decisions,
    summary: run.summary,
  });
}

export function payloadHashForRun(run: Rfb5RunBase): string {
  return `0x${createHash("sha256")
    .update(canonicalPayloadForRun(run))
    .digest("hex")}`;
}

export async function appendRun(filePath: string, run: Rfb5Run): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(run)}\n`, "utf8");
}
