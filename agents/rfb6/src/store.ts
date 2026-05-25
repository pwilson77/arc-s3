import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { replaceLatestArtifact } from "./ipfs.js";

const RFB6_DEFAULT_RETAIN = 10;
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

export type PersistRunArgs = {
  run: Rfb6RunEvent;
  pinataJwt?: string;
  pinataNetwork: "public" | "private";
  uploadEnabled: boolean;
  localMirror: boolean;
  localFilePath: string;
};

export type PersistRunResult = {
  cid: string | null;
  ipfsURI: string | null;
  mirroredLocally: boolean;
};

export async function persistRun(
  args: PersistRunArgs,
): Promise<PersistRunResult> {
  let cid: string | null = null;
  let ipfsURI: string | null = null;

  if (args.uploadEnabled) {
    if (!args.pinataJwt) {
      throw new Error(
        "PINATA_JWT must be set when PINATA_UPLOAD_ENABLED=true (the default).",
      );
    }
    const retain =
      Number(process.env.PINATA_RETAIN ?? RFB6_DEFAULT_RETAIN) ||
      RFB6_DEFAULT_RETAIN;
    const indexFilePath = process.env.PINATA_INDEX_FILE || undefined;
    const uploaded = await replaceLatestArtifact({
      jwt: args.pinataJwt,
      network: args.pinataNetwork,
      category: "rfb6-run",
      identityKey: args.run.publisher.erc8004Id,
      runId: args.run.runId,
      payload: JSON.stringify(args.run),
      keyvalues: {
        publisher: args.run.publisher.erc8004Id,
        workers: String(args.run.workers.length),
      },
      retain,
      indexFilePath,
    });
    cid = uploaded.cid;
    ipfsURI = uploaded.ipfsURI;
  }

  let mirroredLocally = false;
  if (args.localMirror) {
    await appendRun(args.localFilePath, args.run);
    mirroredLocally = true;
  }

  return { cid, ipfsURI, mirroredLocally };
}
