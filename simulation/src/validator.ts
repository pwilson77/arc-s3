import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AbiCoder } from "ethers";
import { config } from "./config.js";
import { escrowAs, reputationAs } from "./contracts.js";
import type { AgentContext } from "./context.js";
import { appendMetricsEvent, ValidatorMetricsTracker } from "./metrics.js";
import { appendLifecycleEventFromReceipt } from "./lifecycle.js";
import {
  calibrationScoreAdjustment,
  clampScore,
  evaluateTraceForSettlement,
} from "./scoring.js";
import { validateTraceStructure } from "./reasoningStore.js";
import type { TaskState } from "./state.js";
import type { ReasoningTrace } from "./types.js";

function traceFileNameFromIpfs(ipfsURI: string): string {
  return ipfsURI.replace("ipfs://local-sim/", "");
}

function ipfsGatewayUrl(ipfsURI: string): string {
  const base = config.IPFS_GATEWAY_BASE_URL.replace(/\/+$/, "");
  const cidOrPath = ipfsURI.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
  return `${base}/${cidOrPath}`;
}

async function readTracePayload(ipfsURI: string): Promise<string> {
  if (ipfsURI.startsWith("ipfs://local-sim/")) {
    const tracePath = join(
      config.TRACE_OUTPUT_DIR,
      traceFileNameFromIpfs(ipfsURI),
    );
    return readFile(tracePath, "utf8");
  }

  if (ipfsURI.startsWith("ipfs://")) {
    const response = await fetch(ipfsGatewayUrl(ipfsURI));
    if (!response.ok) {
      throw new Error(
        `failed to fetch trace from gateway (${response.status})`,
      );
    }
    return response.text();
  }

  throw new Error(`unsupported trace URI: ${ipfsURI}`);
}

function expectedWorkerAddress(
  workerLabel: string,
  ctx: AgentContext,
): string | null {
  if (workerLabel === "beta") return ctx.beta.address;
  if (workerLabel === "gamma") return ctx.gamma.address;
  return null;
}

export async function runValidatorLoop(
  ctx: AgentContext,
  state: TaskState,
): Promise<void> {
  const courthouse = escrowAs(ctx, "validator");
  const registry = reputationAs(ctx, "validator");
  const abiCoder = AbiCoder.defaultAbiCoder();
  const metrics = new ValidatorMetricsTracker(config.METRICS_WINDOW_SIZE);

  for (;;) {
    const pending = state.pending();
    for (const item of pending) {
      try {
        const raw = await readTracePayload(item.ipfsURI);
        const trace = JSON.parse(raw) as ReasoningTrace;
        const expectedWorker = expectedWorkerAddress(item.worker, ctx);
        const computedHash = `0x${createHash("sha256")
          .update(raw)
          .digest("hex")}`;
        const hashMatches = computedHash === item.traceHash;
        const taskMatches = trace.taskId === item.taskId;
        const workerMatches =
          expectedWorker !== null &&
          trace.worker.toLowerCase() === expectedWorker.toLowerCase();
        const structureValid = validateTraceStructure(trace);
        const verdict = evaluateTraceForSettlement(trace, item.task, {
          structureValid,
          hashMatches,
          taskMatches,
          workerMatches,
        });

        const calibrationSnapshot = metrics.calibration(item.worker);
        const calibrationDelta = calibrationScoreAdjustment(
          calibrationSnapshot,
          trace.decision.confidenceBps,
        );
        const adjustedScore = clampScore(
          verdict.valid
            ? verdict.performanceScore + calibrationDelta.delta
            : verdict.performanceScore,
        );
        const reasons =
          calibrationDelta.reason !== null
            ? [...verdict.reasons, calibrationDelta.reason]
            : verdict.reasons;

        const proof = abiCoder.encode(
          ["string[]", "uint256", "bytes32"],
          [reasons, adjustedScore, computedHash],
        );

        const settleReceipt = await (
          await courthouse.settleTask(item.taskId, verdict.valid, proof)
        ).wait();
        await appendLifecycleEventFromReceipt(
          ctx,
          config.LIFECYCLE_OUTPUT_DIR,
          {
            stage: "validated",
            taskId: item.taskId,
            actor: ctx.validator.address,
            valid: verdict.valid,
            reasons,
          },
          settleReceipt,
        );
        const targetAgent =
          item.worker === "beta" ? ctx.beta.address : ctx.gamma.address;
        await (
          await registry.updateReputation(targetAgent, adjustedScore)
        ).wait();

        const aggregate = metrics.recordSettlement(
          item.worker,
          verdict.valid,
          trace.decision.confidenceBps,
          Number(adjustedScore),
        );
        await appendMetricsEvent(config.METRICS_OUTPUT_DIR, {
          timestamp: new Date().toISOString(),
          taskId: item.taskId,
          worker: item.worker,
          valid: verdict.valid,
          score: adjustedScore.toString(),
          confidenceBps: trace.decision.confidenceBps,
          expectedValueBps: trace.decision.expectedValueBps,
          reasons,
          aggregate,
        });

        state.markSettled(item.taskId);
        console.log(
          `[validator] settled task=${item.taskId} valid=${
            verdict.valid
          } score=${adjustedScore} reasons=${reasons.join(",")} slashRateBps=${
            aggregate.slashRateBps
          } calibrationGapBps=${
            aggregate.calibration.calibrationGapBps
          } hashMatch=${hashMatches} taskMatch=${taskMatches} workerMatch=${workerMatches}`,
        );
      } catch (error) {
        console.error(`[validator] failed task=${item.taskId}`, error);
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.VALIDATOR_POLL_MS),
    );
  }
}
