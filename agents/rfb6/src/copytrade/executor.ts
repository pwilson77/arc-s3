import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as dotenv from "dotenv";
import { z } from "zod";
import { assertCirclePolicyOrThrow } from "../circle-policy.js";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  verifyMessage,
  type TransactionReceipt,
} from "ethers";

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
  S3_INTENT_FIREWALL: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_ESCROW_COURTHOUSE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ALPHA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  BETA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  GAMMA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  INTENT_DEFAULT_GAS_LIMIT: z.coerce.number().default(800_000),
  INTENT_DEFAULT_DEADLINE_SECONDS: z.coerce.number().default(120),
  INTENT_QUOTED_SLIPPAGE_BPS: z.coerce.number().min(0).max(10_000).default(50),
  RFB6_ERC8004_ID: z.string().default("erc8004:arc:rfb6"),
  RFB6_COPYTRADE_INPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-copytrade.jsonl"),
  RFB6_COPYTRADE_EXECUTOR_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-copytrade-executor.jsonl"),
  RFB6_COPYTRADE_EXECUTOR_STATE_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-copytrade-executor-state.json"),
  // Notional is expressed in micro-USDC (6 decimals) so we can support sub-USDC sizes
  // when the demo follower wallet only holds a fraction of a USDC.
  RFB6_COPYTRADE_FOLLOWER_NOTIONAL_USDC6: z.coerce.bigint().default(500_000n),
  RFB6_COPYTRADE_MIN_WEIGHT_BPS: z.coerce
    .number()
    .min(1)
    .max(10_000)
    .default(50),
  RFB6_COPYTRADE_MAX_WALLET_BPS: z.coerce
    .number()
    .min(1)
    .max(10_000)
    .default(2500),
  RFB6_COPYTRADE_DAILY_NOTIONAL_CAP_USDC6: z.coerce
    .bigint()
    .default(2_000_000n),
  RFB6_COPYTRADE_BLOCKLIST: z.string().default(""),
  RFB6_COPYTRADE_DRY_RUN: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  RFB6_COPYTRADE_BOND_BPS: z.coerce.number().min(1).max(10_000).default(2_500),
  RFB6_COPYTRADE_MAX_PUBLISHER_FEE_BPS: z.coerce
    .number()
    .min(0)
    .max(5_000)
    .default(2_000),
});

const config = envSchema.parse(process.env);
const INPUT = repoPath(config.RFB6_COPYTRADE_INPUT_FILE);
const OUTPUT = repoPath(config.RFB6_COPYTRADE_EXECUTOR_OUTPUT_FILE);
const STATE = repoPath(config.RFB6_COPYTRADE_EXECUTOR_STATE_FILE);
const BLOCKLIST = new Set(
  config.RFB6_COPYTRADE_BLOCKLIST.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0),
);

const courthouseAbi = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
  "event TaskCreatedV2(bytes32 indexed taskId, address indexed publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
  "function forwardCreateTask(address employer, address worker, uint256 paymentAmount, uint256 performanceBondRequirement) external returns (bytes32 taskId)",
  "function forwardCreateTaskV2(address employer, address worker, address publisher, uint256 paymentAmount, uint256 performanceBondRequirement, uint16 publisherFeeBps) external returns (bytes32 taskId)",
] as const;

const firewallAbi = [
  "function executeIntent(address target, uint256 value, uint16 quotedSlippageBps, uint256 requestedGasLimit, uint256 deadline, bytes data) external payable returns (bytes)",
] as const;

const usdcAbi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
] as const;

type CopyTradeRun = {
  artifactVersion: "rfb6.copytrade/v1";
  runId: string;
  timestamp: number;
  publisher: { id: string; wallet: string; feeBps: number };
  source: {
    leaderboardCategory: string;
    leaderboardWindow: string;
    sampledWalletCount: number;
    timestamp: number;
  };
  wallets: Array<{
    wallet: string;
    userName: string | null;
    weightBps: number;
    rawScore: number;
    eligible: boolean;
    reasons: string[];
    stopFollowing: boolean;
    degradationReasons: string[];
    metrics: Record<string, unknown>;
  }>;
  attestation: { scheme: "eip191"; payloadHash: string; signature: string };
};

type ExecutorState = {
  lastPayloadHash: string | null;
  positions: Record<
    string,
    { weightBps: number; notionalUsdc6: string; lastRunId: string }
  >;
  dailyNotionalSpent: { day: string; usdc6: string };
};

type IntentVerdict =
  | { decision: "approved" }
  | { decision: "rejected"; reason: string };

type OnChainResult =
  | {
      status: "submitted";
      txHash: string;
      blockNumber: number;
      taskId: string | null;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

type IntentEvent = {
  observedAt: string;
  runId: string;
  payloadHash: string;
  follower: string;
  worker: string;
  wallet: string;
  userName: string | null;
  action: "open" | "resize" | "unwind" | "skip";
  fromWeightBps: number;
  toWeightBps: number;
  notionalUsdc: number;
  intent: {
    target: "S3IntentFirewall";
    forward: "S3EscrowCourthouse.forwardCreateTaskV2";
    payload: {
      follower: string;
      worker: string;
      publisher: string;
      publisherWallet: string;
      publisherFeeBps: number;
      sourceWallet: string;
      weightBps: number;
      notionalUsdc: number;
      paymentUsdc6: string;
      bondUsdc6: string;
      runId: string;
    };
  };
  firewall: IntentVerdict;
  onchain: OnChainResult;
  reasons: string[];
};

function canonical(run: CopyTradeRun): string {
  return JSON.stringify({
    artifactVersion: run.artifactVersion,
    runId: run.runId,
    timestamp: run.timestamp,
    publisher: run.publisher,
    source: run.source,
    wallets: run.wallets.map((w) => ({
      wallet: w.wallet,
      weightBps: w.weightBps,
      rawScore: Number(w.rawScore.toFixed(6)),
      eligible: w.eligible,
      stopFollowing: w.stopFollowing,
    })),
  });
}

function verify(run: CopyTradeRun): { valid: boolean; reason: string | null } {
  if (run.artifactVersion !== "rfb6.copytrade/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }
  if (run.attestation.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }
  const expected = `0x${createHash("sha256")
    .update(canonical(run))
    .digest("hex")}`;
  if (expected !== run.attestation.payloadHash) {
    return { valid: false, reason: "payload hash mismatch" };
  }
  try {
    const recovered = getAddress(
      verifyMessage(run.attestation.payloadHash, run.attestation.signature),
    );
    if (recovered !== getAddress(run.publisher.wallet)) {
      return { valid: false, reason: "signature wallet mismatch" };
    }
  } catch {
    return { valid: false, reason: "invalid signature" };
  }
  return { valid: true, reason: null };
}

async function readLatestRun(): Promise<CopyTradeRun | null> {
  if (!existsSync(INPUT)) return null;
  const raw = await readFile(INPUT, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  try {
    const parsed = JSON.parse(lines[lines.length - 1]) as CopyTradeRun;
    if (typeof parsed.publisher.feeBps !== "number") {
      parsed.publisher = { ...parsed.publisher, feeBps: 0 };
    }
    return parsed;
  } catch {
    return null;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readState(): Promise<ExecutorState> {
  if (!existsSync(STATE)) {
    return {
      lastPayloadHash: null,
      positions: {},
      dailyNotionalSpent: { day: today(), usdc6: "0" },
    };
  }
  try {
    const raw = await readFile(STATE, "utf8");
    const parsed = JSON.parse(raw) as ExecutorState;
    return {
      lastPayloadHash: parsed.lastPayloadHash ?? null,
      positions: parsed.positions ?? {},
      dailyNotionalSpent: parsed.dailyNotionalSpent ?? {
        day: today(),
        usdc6: "0",
      },
    };
  } catch {
    return {
      lastPayloadHash: null,
      positions: {},
      dailyNotionalSpent: { day: today(), usdc6: "0" },
    };
  }
}

async function writeState(state: ExecutorState): Promise<void> {
  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 2), "utf8");
}

async function appendEvent(event: IntentEvent): Promise<void> {
  await mkdir(dirname(OUTPUT), { recursive: true });
  await appendFile(OUTPUT, `${JSON.stringify(event)}\n`, "utf8");
}

function notionalForWeight(weightBps: number): bigint {
  return (
    (BigInt(weightBps) * config.RFB6_COPYTRADE_FOLLOWER_NOTIONAL_USDC6) /
    10_000n
  );
}

function firewallCheck(args: {
  wallet: string;
  toWeightBps: number;
  notionalDelta6: bigint;
  publisherFeeBps: number;
  state: ExecutorState;
}): IntentVerdict {
  if (BLOCKLIST.has(args.wallet.toLowerCase())) {
    return { decision: "rejected", reason: "blocklist" };
  }
  if (args.toWeightBps > config.RFB6_COPYTRADE_MAX_WALLET_BPS) {
    return { decision: "rejected", reason: "per-wallet-cap" };
  }
  if (args.publisherFeeBps > config.RFB6_COPYTRADE_MAX_PUBLISHER_FEE_BPS) {
    return {
      decision: "rejected",
      reason: `publisher-fee-too-high:${args.publisherFeeBps}>${config.RFB6_COPYTRADE_MAX_PUBLISHER_FEE_BPS}`,
    };
  }
  const day = today();
  const spent =
    args.state.dailyNotionalSpent.day === day
      ? BigInt(args.state.dailyNotionalSpent.usdc6)
      : 0n;
  const positive = args.notionalDelta6 > 0n ? args.notionalDelta6 : 0n;
  if (spent + positive > config.RFB6_COPYTRADE_DAILY_NOTIONAL_CAP_USDC6) {
    return { decision: "rejected", reason: "daily-notional-cap" };
  }
  return { decision: "approved" };
}

type Submitter = {
  follower: string;
  submit: (args: {
    worker: string;
    publisherWallet: string;
    publisherFeeBps: number;
    paymentUsdc6: bigint;
    bondUsdc6: bigint;
  }) => Promise<OnChainResult>;
};

async function buildSubmitter(): Promise<Submitter | null> {
  if (config.RFB6_COPYTRADE_DRY_RUN) {
    return null;
  }
  const provider = new JsonRpcProvider(
    config.ARC_RPC_URL,
    config.ARC_CHAIN_ID,
    {
      staticNetwork: true,
    },
  );
  const follower = new Wallet(config.ALPHA_PRIVATE_KEY, provider);
  const usdc = new Contract(config.USDC_ADDRESS, usdcAbi, follower);
  const firewall = new Contract(
    config.S3_INTENT_FIREWALL,
    firewallAbi,
    follower,
  );
  const courthouseInterface = new Interface(courthouseAbi);

  return {
    follower: follower.address,
    submit: async ({
      worker,
      publisherWallet,
      publisherFeeBps,
      paymentUsdc6,
      bondUsdc6,
    }) => {
      try {
        const allowance = (await usdc.allowance(
          follower.address,
          config.S3_ESCROW_COURTHOUSE,
        )) as bigint;
        if (allowance < paymentUsdc6) {
          await (
            await usdc.approve(config.S3_ESCROW_COURTHOUSE, paymentUsdc6 * 4n)
          ).wait();
        }
        const callData = courthouseInterface.encodeFunctionData(
          "forwardCreateTaskV2",
          [
            follower.address,
            worker,
            publisherWallet,
            paymentUsdc6,
            bondUsdc6,
            publisherFeeBps,
          ],
        );
        const tx = await firewall.executeIntent(
          config.S3_ESCROW_COURTHOUSE,
          0,
          config.INTENT_QUOTED_SLIPPAGE_BPS,
          config.INTENT_DEFAULT_GAS_LIMIT,
          Math.floor(Date.now() / 1000) +
            config.INTENT_DEFAULT_DEADLINE_SECONDS,
          callData,
        );
        const receipt = (await tx.wait()) as TransactionReceipt;
        const taskId = receipt.logs
          .map((log) => {
            try {
              return courthouseInterface.parseLog({
                topics: [...log.topics],
                data: log.data,
              });
            } catch {
              return null;
            }
          })
          .find((parsed) => parsed?.name === "TaskCreated")?.args.taskId as
          | string
          | undefined;
        return {
          status: "submitted",
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          taskId: taskId ?? null,
        };
      } catch (err) {
        return { status: "error", error: (err as Error).message };
      }
    },
  };
}

function workerForWallet(
  sourceWallet: string,
  beta: string,
  gamma: string,
): string {
  const hex = sourceWallet.toLowerCase().replace(/^0x/, "");
  const lastByte = parseInt(hex.slice(-2) || "0", 16);
  return lastByte % 2 === 0 ? beta : gamma;
}

async function processRun(
  run: CopyTradeRun,
  state: ExecutorState,
): Promise<void> {
  if (run.publisher.id !== config.RFB6_ERC8004_ID) {
    console.warn(
      `[rfb6.copytrade.executor] skipped run=${run.runId} reason=publisher-id-mismatch expected=${config.RFB6_ERC8004_ID} got=${run.publisher.id}`,
    );
    return;
  }
  const verdict = verify(run);
  if (!verdict.valid) {
    console.warn(
      `[rfb6.copytrade.executor] skipped run=${run.runId} reason=${verdict.reason}`,
    );
    return;
  }
  if (state.lastPayloadHash === run.attestation.payloadHash) {
    console.log(
      `[rfb6.copytrade.executor] no-op run=${run.runId} payloadHash already processed`,
    );
    return;
  }

  const day = today();
  if (state.dailyNotionalSpent.day !== day) {
    state.dailyNotionalSpent = { day, usdc6: "0" };
  }

  const submitter = await buildSubmitter();
  const beta = new Wallet(config.BETA_PRIVATE_KEY).address;
  const gamma = new Wallet(config.GAMMA_PRIVATE_KEY).address;
  const followerAddr =
    submitter?.follower ?? new Wallet(config.ALPHA_PRIVATE_KEY).address;

  const incoming = new Map(run.wallets.map((w) => [w.wallet.toLowerCase(), w]));
  const heldKeys = new Set(Object.keys(state.positions));
  const events: IntentEvent[] = [];

  for (const key of heldKeys) {
    const target = incoming.get(key);
    if (
      target &&
      !target.stopFollowing &&
      target.weightBps >= config.RFB6_COPYTRADE_MIN_WEIGHT_BPS
    ) {
      continue;
    }
    const current = state.positions[key];
    const currentNotional6 = current ? BigInt(current.notionalUsdc6) : 0n;
    events.push({
      observedAt: new Date().toISOString(),
      runId: run.runId,
      payloadHash: run.attestation.payloadHash,
      follower: followerAddr,
      worker: workerForWallet(key, beta, gamma),
      wallet: key,
      userName: target?.userName ?? null,
      action: "unwind",
      fromWeightBps: current.weightBps,
      toWeightBps: 0,
      notionalUsdc: -Number(currentNotional6) / 1_000_000,
      intent: {
        target: "S3IntentFirewall",
        forward: "S3EscrowCourthouse.forwardCreateTaskV2",
        payload: {
          follower: followerAddr,
          worker: workerForWallet(key, beta, gamma),
          publisher: run.publisher.id,
          publisherWallet: getAddress(run.publisher.wallet),
          publisherFeeBps: 0,
          sourceWallet: key,
          weightBps: 0,
          notionalUsdc: 0,
          paymentUsdc6: "0",
          bondUsdc6: "0",
          runId: run.runId,
        },
      },
      firewall: { decision: "approved" },
      onchain: {
        status: "skipped",
        reason: "unwind-resolved-by-validator-settle",
      },
      reasons: target?.stopFollowing
        ? target.degradationReasons
        : ["dropped-from-allocation"],
    });
    delete state.positions[key];
  }

  for (const wallet of run.wallets) {
    if (!wallet.eligible || wallet.stopFollowing) continue;
    if (wallet.weightBps < config.RFB6_COPYTRADE_MIN_WEIGHT_BPS) continue;

    const key = wallet.wallet.toLowerCase();
    const current = state.positions[key];
    const fromWeight = current?.weightBps ?? 0;
    const toWeight = wallet.weightBps;
    if (fromWeight === toWeight) continue;

    const fromNotional6 = current ? BigInt(current.notionalUsdc6) : 0n;
    const toNotional6 = notionalForWeight(toWeight);
    const notionalDelta6 = toNotional6 - fromNotional6;
    const action: IntentEvent["action"] = fromWeight === 0 ? "open" : "resize";
    const worker = workerForWallet(key, beta, gamma);

    const firewall = firewallCheck({
      wallet: key,
      toWeightBps: toWeight,
      notionalDelta6,
      publisherFeeBps: run.publisher.feeBps,
      state,
    });

    const paymentUsdc6 = notionalDelta6 > 0n ? notionalDelta6 : 0n;
    const bondUsdc6 =
      (paymentUsdc6 * BigInt(config.RFB6_COPYTRADE_BOND_BPS)) / 10_000n;

    let onchain: OnChainResult;
    if (firewall.decision === "rejected") {
      onchain = { status: "skipped", reason: `firewall:${firewall.reason}` };
    } else if (paymentUsdc6 === 0n) {
      onchain = { status: "skipped", reason: "no-positive-payment-delta" };
    } else if (!submitter) {
      onchain = { status: "skipped", reason: "dry-run" };
    } else if (bondUsdc6 === 0n) {
      onchain = { status: "skipped", reason: "bond-rounds-to-zero" };
    } else {
      onchain = await submitter.submit({
        worker,
        publisherWallet: getAddress(run.publisher.wallet),
        publisherFeeBps: run.publisher.feeBps,
        paymentUsdc6,
        bondUsdc6,
      });
    }

    events.push({
      observedAt: new Date().toISOString(),
      runId: run.runId,
      payloadHash: run.attestation.payloadHash,
      follower: followerAddr,
      worker,
      wallet: key,
      userName: wallet.userName,
      action: firewall.decision === "approved" ? action : "skip",
      fromWeightBps: fromWeight,
      toWeightBps: toWeight,
      notionalUsdc: Number(notionalDelta6) / 1_000_000,
      intent: {
        target: "S3IntentFirewall",
        forward: "S3EscrowCourthouse.forwardCreateTaskV2",
        payload: {
          follower: followerAddr,
          worker,
          publisher: run.publisher.id,
          publisherWallet: getAddress(run.publisher.wallet),
          publisherFeeBps: run.publisher.feeBps,
          sourceWallet: key,
          weightBps: toWeight,
          notionalUsdc: Number(toNotional6) / 1_000_000,
          paymentUsdc6: paymentUsdc6.toString(),
          bondUsdc6: bondUsdc6.toString(),
          runId: run.runId,
        },
      },
      firewall,
      onchain,
      reasons: wallet.reasons,
    });

    if (firewall.decision === "approved" && onchain.status === "submitted") {
      state.positions[key] = {
        weightBps: toWeight,
        notionalUsdc6: toNotional6.toString(),
        lastRunId: run.runId,
      };
      if (notionalDelta6 > 0n) {
        state.dailyNotionalSpent.usdc6 = (
          BigInt(state.dailyNotionalSpent.usdc6) + notionalDelta6
        ).toString();
      }
    }
  }

  for (const event of events) {
    await appendEvent(event);
  }
  state.lastPayloadHash = run.attestation.payloadHash;
  await writeState(state);

  const submitted = events.filter(
    (e) => e.onchain.status === "submitted",
  ).length;
  const errors = events.filter((e) => e.onchain.status === "error").length;
  const rejected = events.filter(
    (e) => e.firewall.decision === "rejected",
  ).length;
  console.log(
    `[rfb6.copytrade.executor] run=${run.runId} events=${events.length} submitted=${submitted} rejected=${rejected} errors=${errors} dryRun=${config.RFB6_COPYTRADE_DRY_RUN}`,
  );
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

  console.log(`[rfb6.copytrade.executor] input=${INPUT}`);
  console.log(`[rfb6.copytrade.executor] output=${OUTPUT}`);
  console.log(
    `[rfb6.copytrade.executor] mode=${
      config.RFB6_COPYTRADE_DRY_RUN ? "dry-run" : "on-chain"
    } chain=${config.ARC_CHAIN_ID} firewall=${config.S3_INTENT_FIREWALL}`,
  );
  if (circlePolicy) {
    console.log(
      `[rfb6.copytrade.executor] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }
  const run = await readLatestRun();
  if (!run) {
    console.warn("[rfb6.copytrade.executor] no copytrade artifact found");
    return;
  }
  const state = await readState();
  await processRun(run, state);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
