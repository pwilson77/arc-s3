import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceLatestArtifact } from "@arc-s3/agent-shared/ipfs";
import { config } from "./config.js";
import type { ReasoningTrace } from "./types.js";

const REASONING_TRACE_CATEGORY = "reasoning-trace";
const DEFAULT_RETAIN = 10;

async function uploadTraceToPinata(
  trace: ReasoningTrace,
  payload: string,
): Promise<string> {
  if (!config.PINATA_JWT) {
    throw new Error("PINATA_JWT is required when PINATA_UPLOAD_ENABLED=true");
  }

  const retain =
    Number(process.env.PINATA_RETAIN ?? DEFAULT_RETAIN) || DEFAULT_RETAIN;
  const indexFilePath = process.env.PINATA_INDEX_FILE || undefined;

  const uploaded = await replaceLatestArtifact({
    jwt: config.PINATA_JWT,
    network: config.PINATA_NETWORK,
    category: REASONING_TRACE_CATEGORY,
    identityKey: trace.taskId,
    runId: `${trace.taskId}-${Date.now()}`,
    payload,
    keyvalues: {
      worker: trace.worker,
      schemaVersion: String(trace.schemaVersion),
    },
    retain,
    indexFilePath,
  });

  return uploaded.ipfsURI;
}

export async function writeTrace(
  trace: ReasoningTrace,
): Promise<{ ipfsURI: string; traceHash: string }> {
  await mkdir(config.TRACE_OUTPUT_DIR, { recursive: true });

  const payload = JSON.stringify(trace, null, 2);
  const traceHash = `0x${createHash("sha256").update(payload).digest("hex")}`;
  const fileName = `${trace.taskId}-${Date.now()}.json`;
  const filePath = join(config.TRACE_OUTPUT_DIR, fileName);

  await writeFile(filePath, payload, "utf8");

  if (config.PINATA_UPLOAD_ENABLED) {
    try {
      const ipfsURI = await uploadTraceToPinata(trace, payload);
      return { ipfsURI, traceHash };
    } catch (error) {
      if (config.PINATA_UPLOAD_STRICT) {
        throw error;
      }
      console.warn(
        `[trace-store] pinata upload failed, using local fallback: ${String(
          error,
        )}`,
      );
    }
  }

  return {
    ipfsURI: `ipfs://local-sim/${fileName}`,
    traceHash,
  };
}

function isHex32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function validateTraceStructure(trace: ReasoningTrace): boolean {
  if (
    !trace.taskId ||
    !trace.worker ||
    !trace.schemaVersion ||
    !trace.timestamp
  )
    return false;
  if (!trace.decision || trace.decision.marketType !== "task-assignment")
    return false;
  if (!trace.decision.instrumentId) return false;
  if (trace.decision.action !== "execute" && trace.decision.action !== "defer")
    return false;
  if (
    !Number.isFinite(trace.decision.notionalUsd) ||
    trace.decision.notionalUsd <= 0
  )
    return false;
  if (
    !Number.isInteger(trace.decision.confidenceBps) ||
    trace.decision.confidenceBps < 0 ||
    trace.decision.confidenceBps > 10_000
  )
    return false;
  if (
    !Number.isInteger(trace.decision.timeHorizonSec) ||
    trace.decision.timeHorizonSec <= 0
  )
    return false;
  if (!Number.isInteger(trace.decision.expectedValueBps)) return false;
  if (
    trace.decision.resolver?.kind !== "validator" ||
    !trace.decision.resolver.reference
  )
    return false;
  if (!Array.isArray(trace.plan) || trace.plan.length === 0) return false;
  if (typeof trace.result?.success !== "boolean") return false;
  if (
    typeof trace.result?.outputHash !== "string" ||
    !isHex32(trace.result.outputHash)
  )
    return false;
  if (typeof trace.integrity?.malformed !== "boolean") return false;
  return !trace.integrity.malformed;
}
