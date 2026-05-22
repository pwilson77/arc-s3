import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { executeCourthouseIntent, escrowAs, usdcAs } from "../contracts.js";
import { appendLifecycleEventFromReceipt } from "../lifecycle.js";
import type { AgentContext } from "../context.js";
import { writeTrace } from "../reasoningStore.js";
import type { TaskState } from "../state.js";
import type { ReasoningTrace } from "../types.js";

function shouldCorrupt(corruptionBps: number): boolean {
  const roll = Math.floor(Math.random() * 10_000);
  return roll < corruptionBps;
}

export async function runGammaLoop(
  ctx: AgentContext,
  state: TaskState,
): Promise<void> {
  const escrow = escrowAs(ctx, "gamma");
  const usdc = usdcAs(ctx, "gamma");

  for (;;) {
    const task = state.nextGammaTask();
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }

    const approveTx = await usdc.approve(
      config.S3_ESCROW_COURTHOUSE,
      task.bondAmount,
    );
    await approveTx.wait();
    const acceptData = escrow.interface.encodeFunctionData(
      "forwardAcceptTask",
      [ctx.gamma.address, task.taskId],
    );
    const acceptReceipt = await executeCourthouseIntent(
      ctx,
      "gamma",
      acceptData,
    );
    await appendLifecycleEventFromReceipt(
      ctx,
      config.LIFECYCLE_OUTPUT_DIR,
      {
        stage: "accepted",
        taskId: task.taskId,
        actor: ctx.gamma.address,
      },
      acceptReceipt,
    );

    const corrupted = shouldCorrupt(config.GAMMA_CORRUPTION_BPS);
    const trace: ReasoningTrace = {
      taskId: task.taskId,
      worker: ctx.gamma.address,
      schemaVersion: "1.1.0",
      timestamp: new Date().toISOString(),
      decision: {
        marketType: "task-assignment",
        instrumentId: task.taskId,
        action: "execute",
        notionalUsd: Number(task.paymentAmount) / 1_000_000,
        confidenceBps: corrupted ? 9_700 : 6_300,
        timeHorizonSec: 300,
        expectedValueBps: corrupted ? -900 : 120,
        resolver: {
          kind: "validator",
          reference: "s3-validator-v1",
        },
      },
      plan: corrupted
        ? []
        : [
            "Gather objective",
            "Perform model-guided execution",
            "Return auditable artifacts",
          ],
      result: {
        success: !corrupted,
        outputHash: `0x${randomBytes(32).toString("hex")}`,
        details: corrupted
          ? "Injected malformed reasoning artifact"
          : "Completed with adversarial noise disabled",
      },
      integrity: {
        malformed: corrupted,
        corruptionReason: corrupted ? "intentional-schema-break" : undefined,
      },
    };

    const { traceHash, ipfsURI } = await writeTrace(trace);
    const submitData = escrow.interface.encodeFunctionData(
      "forwardSubmitTaskResult",
      [ctx.gamma.address, task.taskId, traceHash, ipfsURI],
    );
    const submitReceipt = await executeCourthouseIntent(
      ctx,
      "gamma",
      submitData,
    );
    await appendLifecycleEventFromReceipt(
      ctx,
      config.LIFECYCLE_OUTPUT_DIR,
      {
        stage: "submitted",
        taskId: task.taskId,
        actor: ctx.gamma.address,
      },
      submitReceipt,
    );

    state.markSubmitted(task.taskId, "gamma", traceHash, ipfsURI);
    console.log(`[gamma] submitted task=${task.taskId} corrupted=${corrupted}`);
  }
}
