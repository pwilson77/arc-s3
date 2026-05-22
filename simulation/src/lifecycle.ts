import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { TransactionReceipt } from "ethers";
import type { AgentContext } from "./context.js";

export type LifecycleStage = "created" | "accepted" | "submitted" | "validated";

export type LifecycleEvent = {
  observedAt: string;
  stage: LifecycleStage;
  taskId: string;
  actor: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: string | null;
  valid?: boolean;
  reasons?: string[];
};

const LIFECYCLE_FILE = "events.jsonl";

export async function appendLifecycleEvent(
  outputDir: string,
  event: LifecycleEvent,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, LIFECYCLE_FILE);
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendLifecycleEventFromReceipt(
  ctx: AgentContext,
  outputDir: string,
  payload: {
    stage: LifecycleStage;
    taskId: string;
    actor: string;
    valid?: boolean;
    reasons?: string[];
  },
  receipt: TransactionReceipt,
): Promise<void> {
  const block = await ctx.provider.getBlock(receipt.blockNumber);

  await appendLifecycleEvent(outputDir, {
    observedAt: new Date().toISOString(),
    stage: payload.stage,
    taskId: payload.taskId,
    actor: payload.actor,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    blockTimestamp:
      typeof block?.timestamp === "number"
        ? new Date(block.timestamp * 1000).toISOString()
        : null,
    valid: payload.valid,
    reasons: payload.reasons,
  });
}
