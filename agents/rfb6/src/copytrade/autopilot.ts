import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  id,
  type Log,
} from "ethers";
import { z } from "zod";
import { assertCirclePolicyOrThrow } from "../circle-policy.js";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: "../../.env.local", override: true });
dotenv.config({ override: true });

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const repoPath = (p: string): string =>
  isAbsolute(p) ? p : resolve(repoRoot, p);

const envSchema = z.object({
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  CIRCLE_POLICY_ENFORCE: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  CIRCLE_POLICY_REQUIRE_STATUS: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  CIRCLE_POLICY_REQUIRE_LIMITS: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  CIRCLE_WALLET_CHAIN: z.string().default("BASE"),
  CIRCLE_WALLET_ADDRESS: z.string().default(""),
  CIRCLE_POLICY_MIN_PER_TX_USDC: z.coerce.number().min(0).default(0),
  CIRCLE_POLICY_MIN_DAILY_USDC: z.coerce.number().min(0).default(0),
  USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_ESCROW_COURTHOUSE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ALPHA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  BETA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  GAMMA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  VALIDATOR_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  RFB6_COPYTRADE_AUTOPILOT_POLL_MS: z.coerce.number().default(4000),
  RFB6_COPYTRADE_AUTOPILOT_LOOKBACK_BLOCKS: z.coerce.number().default(300),
  RFB6_COPYTRADE_AUTOPILOT_STATE_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-copytrade-autopilot-state.json"),
});

const config = envSchema.parse(process.env);

const courthouseAbi = [
  "event TaskCreatedV2(bytes32 indexed taskId, address indexed publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
  "function acceptTask(bytes32 taskId) external",
  "function submitTaskResult(bytes32 taskId, bytes32 traceHash, string calldata ipfsURI) external",
  "function settleTask(bytes32 taskId, bool isValid, bytes calldata proof) external",
  "function usdc() view returns (address)",
  "function tasks(bytes32 taskId) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
] as const;

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
] as const;

type AutoState = {
  lastScannedBlock: number;
};

const STATE_FILE = repoPath(config.RFB6_COPYTRADE_AUTOPILOT_STATE_FILE);

async function readState(initialBlock: number): Promise<AutoState> {
  if (!existsSync(STATE_FILE)) {
    return { lastScannedBlock: Math.max(0, initialBlock) };
  }
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as AutoState;
    return {
      lastScannedBlock:
        typeof parsed.lastScannedBlock === "number"
          ? Math.max(0, Math.floor(parsed.lastScannedBlock))
          : Math.max(0, initialBlock),
    };
  } catch {
    return { lastScannedBlock: Math.max(0, initialBlock) };
  }
}

async function writeState(state: AutoState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function pickWorkerKey(workerAddr: string): string {
  const worker = workerAddr.toLowerCase();
  const beta = new Wallet(config.BETA_PRIVATE_KEY).address.toLowerCase();
  const gamma = new Wallet(config.GAMMA_PRIVATE_KEY).address.toLowerCase();
  if (worker === beta) return config.BETA_PRIVATE_KEY;
  if (worker === gamma) return config.GAMMA_PRIVATE_KEY;
  throw new Error(`unknown worker address ${workerAddr}`);
}

async function processTask(
  taskId: string,
  provider: JsonRpcProvider,
): Promise<void> {
  const readCourthouse = new Contract(
    config.S3_ESCROW_COURTHOUSE,
    courthouseAbi,
    provider,
  );
  const task = await readCourthouse.tasks(taskId);
  const employer = getAddress(task[0]);
  const worker = getAddress(task[1]);
  const payment = task[2] as bigint;
  const bond = task[3] as bigint;
  const status = Number(task[6]);

  const alpha = new Wallet(config.ALPHA_PRIVATE_KEY).address;
  if (employer.toLowerCase() !== alpha.toLowerCase()) {
    return;
  }

  if (status === 0 || status >= 4) {
    return;
  }

  const usdcAddress = await readCourthouse.usdc();

  if (status === 1) {
    const workerWallet = new Wallet(pickWorkerKey(worker), provider);
    const usdc = new Contract(usdcAddress, erc20Abi, workerWallet);
    const allowance = (await usdc.allowance(
      workerWallet.address,
      config.S3_ESCROW_COURTHOUSE,
    )) as bigint;
    if (allowance < bond && bond > 0n) {
      await (await usdc.approve(config.S3_ESCROW_COURTHOUSE, bond * 4n)).wait();
    }
    const workerCourthouse = new Contract(
      config.S3_ESCROW_COURTHOUSE,
      courthouseAbi,
      workerWallet,
    );
    await (await workerCourthouse.acceptTask(taskId)).wait();
    console.log(
      `[rfb6.copytrade.autopilot] accepted task=${taskId} worker=${
        workerWallet.address
      } payment=${payment.toString()} bond=${bond.toString()}`,
    );
  }

  const afterAccept = await readCourthouse.tasks(taskId);
  const statusAfterAccept = Number(afterAccept[6]);

  if (statusAfterAccept === 2) {
    const workerWallet = new Wallet(pickWorkerKey(worker), provider);
    const workerCourthouse = new Contract(
      config.S3_ESCROW_COURTHOUSE,
      courthouseAbi,
      workerWallet,
    );
    const traceHash = id(`rfb6-copytrade-demo:${taskId}:${Date.now()}`);
    await (
      await workerCourthouse.submitTaskResult(
        taskId,
        traceHash,
        `ipfs://rfb6-copytrade-autopilot/${taskId}`,
      )
    ).wait();
    console.log(`[rfb6.copytrade.autopilot] submitted task=${taskId}`);
  }

  const afterSubmit = await readCourthouse.tasks(taskId);
  const statusAfterSubmit = Number(afterSubmit[6]);

  if (statusAfterSubmit === 3) {
    const validator = new Wallet(config.VALIDATOR_PRIVATE_KEY, provider);
    const validatorCourthouse = new Contract(
      config.S3_ESCROW_COURTHOUSE,
      courthouseAbi,
      validator,
    );
    const tx = await validatorCourthouse.settleTask(taskId, true, "0x");
    const receipt = await tx.wait();
    console.log(
      `[rfb6.copytrade.autopilot] settled task=${taskId} tx=${receipt.hash} block=${receipt.blockNumber}`,
    );
  }
}

async function main(): Promise<void> {
  const circlePolicy = await assertCirclePolicyOrThrow({
    enabled: config.CIRCLE_POLICY_ENFORCE,
    requireStatus: config.CIRCLE_POLICY_REQUIRE_STATUS,
    requireLimits: config.CIRCLE_POLICY_REQUIRE_LIMITS,
    chain: config.CIRCLE_WALLET_CHAIN,
    walletAddress: config.CIRCLE_WALLET_ADDRESS,
    minPerTxUsdc: config.CIRCLE_POLICY_MIN_PER_TX_USDC,
    minDailyUsdc: config.CIRCLE_POLICY_MIN_DAILY_USDC,
  });

  const provider = new JsonRpcProvider(
    config.ARC_RPC_URL,
    config.ARC_CHAIN_ID,
    {
      staticNetwork: true,
    },
  );
  const courthouse = new Contract(
    config.S3_ESCROW_COURTHOUSE,
    courthouseAbi,
    provider,
  );
  const latestBlock = await provider.getBlockNumber();
  const initialBlock = Math.max(
    0,
    latestBlock - config.RFB6_COPYTRADE_AUTOPILOT_LOOKBACK_BLOCKS,
  );
  const state = await readState(initialBlock);

  console.log(
    `[rfb6.copytrade.autopilot] chain=${config.ARC_CHAIN_ID} courthouse=${config.S3_ESCROW_COURTHOUSE} startingFromBlock=${state.lastScannedBlock}`,
  );
  if (circlePolicy) {
    console.log(
      `[rfb6.copytrade.autopilot] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }

  for (;;) {
    try {
      const toBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, state.lastScannedBlock + 1);

      if (fromBlock <= toBlock) {
        const filter = {
          address: config.S3_ESCROW_COURTHOUSE,
          topics: [id("TaskCreatedV2(bytes32,address,uint16,uint16)")],
          fromBlock,
          toBlock,
        };
        const logs = (await provider.getLogs(filter)) as Log[];

        for (const log of logs) {
          try {
            const parsed = courthouse.interface.parseLog({
              topics: [...log.topics],
              data: log.data,
            });
            if (!parsed || parsed.name !== "TaskCreatedV2") continue;
            const taskId = parsed.args.taskId as string;
            await processTask(taskId, provider);
          } catch (err) {
            console.error(
              "[rfb6.copytrade.autopilot] log processing error",
              err,
            );
          }
        }

        state.lastScannedBlock = toBlock;
        await writeState(state);
      }
    } catch (err) {
      console.error("[rfb6.copytrade.autopilot] loop error", err);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.RFB6_COPYTRADE_AUTOPILOT_POLL_MS),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
