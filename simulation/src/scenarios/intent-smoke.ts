import { randomBytes } from "node:crypto";
import { Contract } from "ethers";
import { config } from "../config.js";
import { intentFirewallAbi } from "../abi.js";
import { createContext } from "../context.js";
import { executeCourthouseIntent, escrowAs, usdcAs } from "../contracts.js";
import { appendLifecycleEventFromReceipt } from "../lifecycle.js";

function parseEventArg(
  receiptLogs: readonly unknown[],
  escrow: ReturnType<typeof escrowAs>,
  eventName: string,
): Record<string, unknown> {
  const parsed = receiptLogs
    .map((log) => {
      try {
        return escrow.interface.parseLog(log as never);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === eventName);

  if (!parsed) {
    throw new Error(`Expected ${eventName} event was not emitted`);
  }

  return parsed.args as Record<string, unknown>;
}

async function main(): Promise<void> {
  const ctx = createContext();
  const firewall = new Contract(
    config.S3_INTENT_FIREWALL,
    intentFirewallAbi,
    ctx.provider,
  );
  const escrowAlpha = escrowAs(ctx, "alpha");
  const escrowBeta = escrowAs(ctx, "beta");
  const usdcAlpha = usdcAs(ctx, "alpha");
  const usdcBeta = usdcAs(ctx, "beta");

  console.log("Running intent smoke scenario...");
  console.log(
    `alpha=${ctx.alpha.address} beta=${ctx.beta.address} courthouse=${config.S3_ESCROW_COURTHOUSE} firewall=${config.S3_INTENT_FIREWALL}`,
  );

  const [alphaRegistered, betaRegistered, courthouseWhitelisted] =
    await Promise.all([
      firewall.registeredAgent(ctx.alpha.address),
      firewall.registeredAgent(ctx.beta.address),
      firewall.whitelistedTarget(config.S3_ESCROW_COURTHOUSE),
    ]);

  if (!alphaRegistered || !betaRegistered || !courthouseWhitelisted) {
    throw new Error(
      [
        "Firewall preflight failed.",
        `registered(alpha)=${alphaRegistered}`,
        `registered(beta)=${betaRegistered}`,
        `whitelisted(courthouse)=${courthouseWhitelisted}`,
        "Run bootstrap on current deployment, then retry.",
      ].join(" "),
    );
  }

  const approveAlphaTx = await usdcAlpha.approve(
    config.S3_ESCROW_COURTHOUSE,
    config.DEFAULT_TASK_PAYMENT,
  );
  await approveAlphaTx.wait();

  const approveBetaTx = await usdcBeta.approve(
    config.S3_ESCROW_COURTHOUSE,
    config.DEFAULT_BOND_AMOUNT,
  );
  await approveBetaTx.wait();

  const createData = escrowAlpha.interface.encodeFunctionData(
    "forwardCreateTask",
    [
      ctx.alpha.address,
      ctx.beta.address,
      config.DEFAULT_TASK_PAYMENT,
      config.DEFAULT_BOND_AMOUNT,
    ],
  );

  const createReceipt = await executeCourthouseIntent(ctx, "alpha", createData);
  const createdArgs = parseEventArg(
    createReceipt.logs,
    escrowAlpha,
    "TaskCreated",
  );
  const taskId = String(createdArgs.taskId);
  await appendLifecycleEventFromReceipt(
    ctx,
    config.LIFECYCLE_OUTPUT_DIR,
    {
      stage: "created",
      taskId,
      actor: ctx.alpha.address,
    },
    createReceipt,
  );
  console.log(`Intent createTask passed taskId=${taskId}`);

  const acceptData = escrowBeta.interface.encodeFunctionData(
    "forwardAcceptTask",
    [ctx.beta.address, taskId],
  );
  const acceptReceipt = await executeCourthouseIntent(ctx, "beta", acceptData);
  parseEventArg(acceptReceipt.logs, escrowBeta, "TaskAccepted");
  await appendLifecycleEventFromReceipt(
    ctx,
    config.LIFECYCLE_OUTPUT_DIR,
    {
      stage: "accepted",
      taskId,
      actor: ctx.beta.address,
    },
    acceptReceipt,
  );
  console.log(`Intent acceptTask passed taskId=${taskId}`);

  const traceHash = `0x${randomBytes(32).toString("hex")}`;
  const ipfsURI = `ipfs://intent-smoke-${Date.now()}`;
  const submitData = escrowBeta.interface.encodeFunctionData(
    "forwardSubmitTaskResult",
    [ctx.beta.address, taskId, traceHash, ipfsURI],
  );
  const submitReceipt = await executeCourthouseIntent(ctx, "beta", submitData);
  parseEventArg(submitReceipt.logs, escrowBeta, "TaskResultSubmitted");
  await appendLifecycleEventFromReceipt(
    ctx,
    config.LIFECYCLE_OUTPUT_DIR,
    {
      stage: "submitted",
      taskId,
      actor: ctx.beta.address,
    },
    submitReceipt,
  );
  console.log(
    `Intent submitTaskResult passed taskId=${taskId} trace=${traceHash}`,
  );

  console.log("Intent smoke scenario completed successfully.");
}

main().catch((error) => {
  console.error("Intent smoke scenario failed:", error);
  process.exit(1);
});
