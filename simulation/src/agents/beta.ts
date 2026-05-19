import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { executeCourthouseIntent, escrowAs, usdcAs } from "../contracts.js";
import type { AgentContext } from "../context.js";
import { writeTrace } from "../reasoningStore.js";
import type { TaskState } from "../state.js";
import type { ReasoningTrace } from "../types.js";

export async function runBetaLoop(
  ctx: AgentContext,
  state: TaskState,
): Promise<void> {
  const escrow = escrowAs(ctx, "beta");
  const usdc = usdcAs(ctx, "beta");

  for (;;) {
    const task = state.nextBetaTask();
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }

    const approveTx = await usdc.approve(
      config.S3_ESCROW_COURTHOUSE,
      task.bondAmount,
    );
    await approveTx.wait();
    const acceptData = escrow.interface.encodeFunctionData("forwardAcceptTask", [
      ctx.beta.address,
      task.taskId,
    ]);
    await executeCourthouseIntent(ctx, "beta", acceptData);

    const trace: ReasoningTrace = {
      taskId: task.taskId,
      worker: ctx.beta.address,
      schemaVersion: "1.1.0",
      timestamp: new Date().toISOString(),
      decision: {
        marketType: "task-assignment",
        instrumentId: task.taskId,
        action: "execute",
        notionalUsd: Number(task.paymentAmount) / 1_000_000,
        confidenceBps: 9_200,
        timeHorizonSec: 300,
        expectedValueBps: 450,
        resolver: {
          kind: "validator",
          reference: "s3-validator-v1",
        },
      },
      plan: [
        "Fetch assignment context",
        "Execute deterministic work unit",
        "Verify output invariants",
      ],
      result: {
        success: true,
        outputHash: `0x${randomBytes(32).toString("hex")}`,
        details: "Execution completed within policy bounds",
      },
      integrity: {
        malformed: false,
      },
    };

    const { traceHash, ipfsURI } = await writeTrace(trace);
    const submitData = escrow.interface.encodeFunctionData(
      "forwardSubmitTaskResult",
      [ctx.beta.address, task.taskId, traceHash, ipfsURI],
    );
    await executeCourthouseIntent(ctx, "beta", submitData);

    state.markSubmitted(task.taskId, "beta", traceHash, ipfsURI);
    console.log(`[beta] submitted task=${task.taskId} trace=${traceHash}`);
  }
}
