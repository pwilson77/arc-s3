import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { Contract, Interface, JsonRpcProvider, Wallet } from "ethers";
import { assertCirclePolicyOrThrow } from "./circle-policy.js";
import { verifyRunAttestation } from "./attestation.js";
import { executorConfig as config } from "./executor-config.js";
import type { Rfb6Allocation, Rfb6RunEvent } from "./types.js";

type ExecutorState = {
  lastPayloadHash: string | null;
};

const escrowAbi = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
  "function forwardCreateTask(address employer, address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external returns (bytes32 taskId)",
] as const;

const firewallAbi = [
  "function executeIntent(address target, uint256 value, uint16 quotedSlippageBps, uint256 requestedGasLimit, uint256 deadline, bytes data) external payable returns (bytes)",
] as const;

const usdcAbi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;

function chooseWorker(rows: Rfb6Allocation[]): Rfb6Allocation | null {
  const eligible = rows
    .filter(
      (row) =>
        row.eligible &&
        row.status === "eligible" &&
        row.weightBps >= config.RFB6_EXECUTOR_MIN_WEIGHT_BPS,
    )
    .sort((a, b) => b.weightBps - a.weightBps || b.rawScore - a.rawScore);

  return eligible[0] ?? null;
}

function workerAddress(
  worker: string,
  beta: Wallet,
  gamma: Wallet,
): string | null {
  const key = worker.toLowerCase();
  if (key === "beta") return beta.address;
  if (key === "gamma") return gamma.address;
  return null;
}

async function readLatestRun(): Promise<Rfb6RunEvent | null> {
  if (!existsSync(config.RFB6_AGENT_OUTPUT_FILE)) {
    return null;
  }

  const raw = await readFile(config.RFB6_AGENT_OUTPUT_FILE, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(lines[lines.length - 1]) as Rfb6RunEvent;
  } catch {
    return null;
  }
}

async function readState(): Promise<ExecutorState> {
  if (!existsSync(config.RFB6_EXECUTOR_STATE_FILE)) {
    return { lastPayloadHash: null };
  }
  try {
    const raw = await readFile(config.RFB6_EXECUTOR_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as ExecutorState;
    return {
      lastPayloadHash: parsed.lastPayloadHash ?? null,
    };
  } catch {
    return { lastPayloadHash: null };
  }
}

async function writeState(state: ExecutorState): Promise<void> {
  await mkdir(dirname(config.RFB6_EXECUTOR_STATE_FILE), { recursive: true });
  await writeFile(
    config.RFB6_EXECUTOR_STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

async function appendExecutorEvent(
  event: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(config.RFB6_EXECUTOR_OUTPUT_FILE), { recursive: true });
  await appendFile(
    config.RFB6_EXECUTOR_OUTPUT_FILE,
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

async function main(): Promise<void> {
  const provider = new JsonRpcProvider(
    config.ARC_RPC_URL,
    config.ARC_CHAIN_ID,
    {
      staticNetwork: true,
    },
  );
  const circlePolicy = await assertCirclePolicyOrThrow({
    enabled: config.CIRCLE_POLICY_ENFORCE,
    requireStatus: config.CIRCLE_POLICY_REQUIRE_STATUS,
    requireLimits: config.CIRCLE_POLICY_REQUIRE_LIMITS,
    chain: config.CIRCLE_WALLET_CHAIN,
    walletAddress: config.CIRCLE_WALLET_ADDRESS,
    minPerTxUsdc: config.CIRCLE_POLICY_MIN_PER_TX_USDC,
    minDailyUsdc: config.CIRCLE_POLICY_MIN_DAILY_USDC,
  });

  const alpha = new Wallet(config.ALPHA_PRIVATE_KEY, provider);
  const beta = new Wallet(config.BETA_PRIVATE_KEY, provider);
  const gamma = new Wallet(config.GAMMA_PRIVATE_KEY, provider);

  const usdc = new Contract(config.USDC_ADDRESS, usdcAbi, alpha);
  const firewall = new Contract(config.S3_INTENT_FIREWALL, firewallAbi, alpha);
  const courthouse = new Contract(
    config.S3_ESCROW_COURTHOUSE,
    escrowAbi,
    alpha,
  );
  const courthouseInterface = new Interface(escrowAbi);

  console.log("[rfb6-executor] starting signed-artifact executor");
  console.log(
    `[rfb6-executor] input=${config.RFB6_AGENT_OUTPUT_FILE} output=${config.RFB6_EXECUTOR_OUTPUT_FILE} minWeightBps=${config.RFB6_EXECUTOR_MIN_WEIGHT_BPS}`,
  );
  if (circlePolicy) {
    console.log(
      `[rfb6-executor] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }

  let state = await readState();

  for (;;) {
    try {
      const run = await readLatestRun();
      if (!run) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      if (run.publisher.erc8004Id !== config.RFB6_ERC8004_ID) {
        console.warn(
          `[rfb6-executor] skipped run=${run.runId} reason=publisher-id-mismatch expected=${config.RFB6_ERC8004_ID} got=${run.publisher.erc8004Id}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      const verdict = verifyRunAttestation(run);
      if (!verdict.valid) {
        console.warn(
          `[rfb6-executor] skipped run=${run.runId} reason=${
            verdict.reason ?? "invalid attestation"
          }`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      if (state.lastPayloadHash === run.attestation.payloadHash) {
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      const selected = chooseWorker(run.workers);
      if (!selected) {
        state.lastPayloadHash = run.attestation.payloadHash;
        await writeState(state);
        await appendExecutorEvent({
          observedAt: new Date().toISOString(),
          runId: run.runId,
          payloadHash: run.attestation.payloadHash,
          action: "skip",
          reason: "no-eligible-worker",
        });
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      const targetWorker = workerAddress(selected.worker, beta, gamma);
      if (!targetWorker) {
        state.lastPayloadHash = run.attestation.payloadHash;
        await writeState(state);
        await appendExecutorEvent({
          observedAt: new Date().toISOString(),
          runId: run.runId,
          payloadHash: run.attestation.payloadHash,
          action: "skip",
          reason: `unknown-worker:${selected.worker}`,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
        );
        continue;
      }

      const allowance = (await usdc.allowance(
        alpha.address,
        config.S3_ESCROW_COURTHOUSE,
      )) as bigint;
      if (allowance < config.DEFAULT_TASK_PAYMENT) {
        await (
          await usdc.approve(
            config.S3_ESCROW_COURTHOUSE,
            config.DEFAULT_TASK_PAYMENT,
          )
        ).wait();
      }

      const callData = courthouse.interface.encodeFunctionData(
        "forwardCreateTask",
        [
          alpha.address,
          targetWorker,
          config.DEFAULT_TASK_PAYMENT,
          config.DEFAULT_BOND_AMOUNT,
        ],
      );

      const tx = await firewall.executeIntent(
        config.S3_ESCROW_COURTHOUSE,
        0,
        config.INTENT_QUOTED_SLIPPAGE_BPS,
        config.INTENT_DEFAULT_GAS_LIMIT,
        Math.floor(Date.now() / 1000) + config.INTENT_DEFAULT_DEADLINE_SECONDS,
        callData,
      );
      const receipt = await tx.wait();

      const createdLog = receipt.logs
        .map((log: unknown) => {
          try {
            return courthouseInterface.parseLog(log as never);
          } catch {
            return null;
          }
        })
        .find(
          (parsed: { name: string } | null) => parsed?.name === "TaskCreated",
        );

      state.lastPayloadHash = run.attestation.payloadHash;
      await writeState(state);

      await appendExecutorEvent({
        observedAt: new Date().toISOString(),
        runId: run.runId,
        payloadHash: run.attestation.payloadHash,
        action: "forwardCreateTask",
        selectedWorker: selected.worker,
        selectedWeightBps: selected.weightBps,
        txHash: receipt.hash,
        taskId: createdLog ? createdLog.args.taskId : null,
      });

      console.log(
        `[rfb6-executor] run=${run.runId} worker=${selected.worker} weight=${(
          selected.weightBps / 100
        ).toFixed(2)}% tx=${receipt.hash}`,
      );
    } catch (error) {
      console.error("[rfb6-executor] iteration failed", error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.RFB6_EXECUTOR_POLL_MS),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
