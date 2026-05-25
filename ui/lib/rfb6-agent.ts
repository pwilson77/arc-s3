import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { getAddress, verifyMessage } from "ethers";
import { loadArtifactsByCategory } from "./ipfs-store";

import type { WorkerAggregateMetrics } from "./metrics";

export type Rfb6Allocation = {
  worker: string;
  eligible: boolean;
  status: "eligible" | "gated";
  rawScore: number;
  weightBps: number;
  meanRecentEvBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
};

export type Rfb6RunEvent = {
  artifactVersion: "rfb6.arc-s3/v1";
  runId: string;
  timestamp: string;
  publisher: {
    erc8004Id: string;
    wallet: string;
  };
  sourceMetricsFile: string;
  sourceEventCount: number;
  sourceLatestTimestamp: string;
  workers: Rfb6Allocation[];
  attestation: {
    scheme: "eip191";
    payloadHash: string;
    signature: string;
  };
};

export type Rfb6RunAudit = {
  run: Rfb6RunEvent;
  valid: boolean;
  reason: string | null;
};

export type Rfb6VerificationSummary = {
  total: number;
  valid: number;
  invalid: number;
};

function runFilePath(): string {
  const configured =
    process.env.RFB6_AGENT_OUTPUT_FILE ??
    "../simulation/data/agents/rfb6-social-intel.jsonl";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function canonicalPayload(run: Rfb6RunEvent): string {
  return JSON.stringify({
    artifactVersion: run.artifactVersion,
    runId: run.runId,
    timestamp: run.timestamp,
    publisher: run.publisher,
    sourceMetricsFile: run.sourceMetricsFile,
    sourceEventCount: run.sourceEventCount,
    sourceLatestTimestamp: run.sourceLatestTimestamp,
    workers: run.workers.map((w) => ({
      worker: w.worker,
      eligible: w.eligible,
      status: w.status,
      weightBps: w.weightBps,
      rawScore: Number(w.rawScore.toFixed(6)),
      meanRecentEvBps: w.meanRecentEvBps,
      reasons: w.reasons,
      aggregate: w.aggregate,
    })),
  });
}

function payloadHash(run: Rfb6RunEvent): string {
  return `0x${createHash("sha256")
    .update(canonicalPayload(run))
    .digest("hex")}`;
}

function verifyRun(run: Rfb6RunEvent): {
  valid: boolean;
  reason: string | null;
} {
  if (run.artifactVersion !== "rfb6.arc-s3/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }

  if (run.attestation?.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }

  const computed = payloadHash(run);
  if (computed !== run.attestation.payloadHash) {
    return { valid: false, reason: "payload hash mismatch" };
  }

  try {
    const recovered = getAddress(
      verifyMessage(run.attestation.payloadHash, run.attestation.signature),
    );
    const claimed = getAddress(run.publisher.wallet);
    if (recovered !== claimed) {
      return { valid: false, reason: "signature wallet mismatch" };
    }
  } catch {
    return { valid: false, reason: "invalid signature" };
  }

  return { valid: true, reason: null };
}

export async function readRfb6RunAudit(limit = 50): Promise<Rfb6RunAudit[]> {
  const parsed: Rfb6RunAudit[] = [];

  // Primary path: IPFS via Pinata category listing.
  try {
    const ipfsRuns = await loadArtifactsByCategory<Rfb6RunEvent>(
      "rfb6-run",
      Math.max(limit, 50),
    );
    for (const entry of ipfsRuns) {
      const run = entry.artifact;
      const verdict = verifyRun(run);
      parsed.push({ run, valid: verdict.valid, reason: verdict.reason });
    }
  } catch (err) {
    console.warn("[rfb6-agent] ipfs runs fetch failed", err);
  }

  // Fallback: local mirror file (only present when RFB6_LOCAL_MIRROR=true).
  if (parsed.length === 0) {
    const path = runFilePath();
    if (existsSync(path)) {
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const run = JSON.parse(line) as Rfb6RunEvent;
          const verdict = verifyRun(run);
          parsed.push({ run, valid: verdict.valid, reason: verdict.reason });
        } catch {
          // Ignore malformed stream lines to preserve UI availability.
        }
      }
    }
  }

  if (limit <= 0 || parsed.length <= limit) {
    return parsed;
  }

  return parsed.slice(parsed.length - limit);
}

export async function readRfb6Runs(limit = 50): Promise<Rfb6RunEvent[]> {
  const audited = await readRfb6RunAudit(limit);
  return audited.filter((entry) => entry.valid).map((entry) => entry.run);
}

export async function readLatestRfb6Run(): Promise<Rfb6RunEvent | null> {
  const runs = await readRfb6Runs(1);
  return runs[0] ?? null;
}

export async function readRfb6VerificationSummary(
  limit = 200,
): Promise<Rfb6VerificationSummary> {
  const audited = await readRfb6RunAudit(limit);
  const valid = audited.filter((entry) => entry.valid).length;
  const total = audited.length;
  return {
    total,
    valid,
    invalid: total - valid,
  };
}
