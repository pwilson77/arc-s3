import { config } from "../config.js";
import { executeCourthouseIntent, escrowAs, usdcAs } from "../contracts.js";
import type { AgentContext } from "../context.js";
import type { TaskState } from "../state.js";
import type { TaskAssignment } from "../types.js";

export async function runAlphaLoop(
  ctx: AgentContext,
  state: TaskState,
): Promise<void> {
  const escrow = escrowAs(ctx, "alpha");
  const usdc = usdcAs(ctx, "alpha");
  let toggle = false;

  for (;;) {
    const workerWallet = toggle ? ctx.gamma : ctx.beta;
    const workerLabel = toggle ? "gamma" : "beta";
    toggle = !toggle;

    // Approve the courthouse to spend USDC for the task payment
    const approveTx = await usdc.approve(config.S3_ESCROW_COURTHOUSE, config.DEFAULT_TASK_PAYMENT);
    await approveTx.wait();
    const data = escrow.interface.encodeFunctionData("forwardCreateTask", [
      ctx.alpha.address,
      workerWallet.address,
      config.DEFAULT_TASK_PAYMENT,
      config.DEFAULT_BOND_AMOUNT,
    ]);
    const receipt = await executeCourthouseIntent(
      ctx,
      "alpha",
      data,
    );

    const createdLog = receipt.logs
      .map((log: unknown) => {
        try {
          return escrow.interface.parseLog(log as never);
        } catch {
          return null;
        }
      })
      .find(
        (parsed: { name: string } | null) => parsed?.name === "TaskCreated",
      );

    if (createdLog) {
      const task: TaskAssignment = {
        taskId: createdLog.args.taskId,
        employer: createdLog.args.employer,
        worker: workerLabel,
        paymentAmount: createdLog.args.paymentAmount,
        bondAmount: createdLog.args.bondAmount,
      };

      state.enqueueForWorker(task);
      console.log(`[alpha] created task=${task.taskId} worker=${workerLabel}`);
    }

    await new Promise((resolve) => setTimeout(resolve, config.ALPHA_LOOP_MS));
  }
}
