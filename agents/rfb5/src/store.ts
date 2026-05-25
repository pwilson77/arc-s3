import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { replaceLatestArtifact } from "./ipfs.js";

const RFB5_DEFAULT_RETAIN = 10;
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

export type PersistRunArgs = {
  run: Rfb5Run;
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
        "PINATA_JWT must be set when PINATA_UPLOAD_ENABLED=true (the default); set RFB5_LOCAL_MIRROR=true and PINATA_UPLOAD_ENABLED=false to keep local-only writes.",
      );
    }
    const retain =
      Number(process.env.PINATA_RETAIN ?? RFB5_DEFAULT_RETAIN) ||
      RFB5_DEFAULT_RETAIN;
    const indexFilePath = process.env.PINATA_INDEX_FILE || undefined;
    const uploaded = await replaceLatestArtifact({
      jwt: args.pinataJwt,
      network: args.pinataNetwork,
      category: "rfb5-run",
      identityKey: args.run.publisher.erc8004Id,
      runId: args.run.runId,
      payload: JSON.stringify(args.run),
      keyvalues: {
        publisher: args.run.publisher.erc8004Id,
        opportunitiesDetected: String(args.run.summary.opportunitiesDetected),
        opportunitiesProfitable: String(
          args.run.summary.opportunitiesProfitable,
        ),
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
