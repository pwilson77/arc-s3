import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
import { uploadArtifactToIpfs } from "../ipfs.js";

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
  AUTOPILOT_HEALTH_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-copytrade-autopilot-health.json"),
  AUTOPILOT_MIN_NATIVE_WEI: z
    .string()
    .default("5000000000000000")
    .describe(
      "Per-role minimum native balance (wei) to attempt a tx. Default 0.005.",
    ),
  AUTOPILOT_STUCK_TASK_GRACE_SEC: z.coerce.number().default(300),
  AUTOPILOT_PENDING_MAX: z.coerce.number().default(200),
  PINATA_UPLOAD_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  PINATA_JWT: z.string().optional(),
  PINATA_NETWORK: z.enum(["public", "private"]).default("public"),
  AUTOPILOT_EMPLOYER_ALLOWLIST: z
    .string()
    .optional()
    .describe(
      "Comma-separated 0x addresses (or names alpha,beta,gamma) to accept tasks from. Defaults to ALPHA.",
    ),
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
  "function balanceOf(address owner) external view returns (uint256)",
] as const;

type AutoState = {
  lastScannedBlock: number;
  pending?: Record<string, { firstSeenAt: number; lastStatus: number }>;
};

const STATE_FILE = repoPath(config.RFB6_COPYTRADE_AUTOPILOT_STATE_FILE);
const HEALTH_FILE = repoPath(config.AUTOPILOT_HEALTH_FILE);
const MIN_NATIVE_WEI = BigInt(config.AUTOPILOT_MIN_NATIVE_WEI);
const MAX_LOG_RANGE = 9_500;

async function readState(initialBlock: number): Promise<AutoState> {
  if (!existsSync(STATE_FILE)) {
    return { lastScannedBlock: Math.max(0, initialBlock), pending: {} };
  }
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as AutoState;
    return {
      lastScannedBlock:
        typeof parsed.lastScannedBlock === "number"
          ? Math.max(0, Math.floor(parsed.lastScannedBlock))
          : Math.max(0, initialBlock),
      pending:
        parsed.pending && typeof parsed.pending === "object"
          ? parsed.pending
          : {},
    };
  } catch {
    return { lastScannedBlock: Math.max(0, initialBlock), pending: {} };
  }
}

async function writeState(state: AutoState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

type HealthSnapshot = {
  lastTickAt: string;
  lastScannedBlock: number;
  lastError: string | null;
  balances: Record<
    string,
    { address: string; nativeWei: string; usdc6?: string }
  >;
  pendingCount: number;
  stuckTasks: Array<{
    taskId: string;
    ageSec: number;
    lastStatus: number;
  }>;
};

async function writeHealth(snapshot: HealthSnapshot): Promise<void> {
  await mkdir(dirname(HEALTH_FILE), { recursive: true });
  await writeFile(HEALTH_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

async function collectBalances(
  provider: JsonRpcProvider,
  usdcAddress: string,
): Promise<HealthSnapshot["balances"]> {
  const usdc = new Contract(usdcAddress, erc20Abi, provider);
  const roles: Array<[string, string]> = [
    ["alpha", config.ALPHA_PRIVATE_KEY],
    ["beta", config.BETA_PRIVATE_KEY],
    ["gamma", config.GAMMA_PRIVATE_KEY],
    ["validator", config.VALIDATOR_PRIVATE_KEY],
  ];
  const out: HealthSnapshot["balances"] = {};
  for (const [name, pk] of roles) {
    const addr = new Wallet(pk).address;
    try {
      const [native, usdcBal] = await Promise.all([
        provider.getBalance(addr),
        (usdc.balanceOf(addr) as Promise<bigint>).catch(() => 0n),
      ]);
      out[name] = {
        address: addr,
        nativeWei: native.toString(),
        usdc6: usdcBal.toString(),
      };
    } catch (err) {
      out[name] = {
        address: addr,
        nativeWei: "0",
        usdc6: "0",
      };
    }
  }
  return out;
}

async function hasMinNative(
  provider: JsonRpcProvider,
  address: string,
): Promise<boolean> {
  const bal = await provider.getBalance(address);
  return bal >= MIN_NATIVE_WEI;
}

function rememberPending(
  state: AutoState,
  taskId: string,
  status: number,
): void {
  const pending = state.pending ?? (state.pending = {});
  const existing = pending[taskId];
  if (existing) {
    existing.lastStatus = status;
  } else {
    if (Object.keys(pending).length >= config.AUTOPILOT_PENDING_MAX) {
      const oldestKey = Object.entries(pending).sort(
        (a, b) => a[1].firstSeenAt - b[1].firstSeenAt,
      )[0]?.[0];
      if (oldestKey) delete pending[oldestKey];
    }
    pending[taskId] = { firstSeenAt: Date.now(), lastStatus: status };
  }
}

function forgetPending(state: AutoState, taskId: string): void {
  if (state.pending && state.pending[taskId]) delete state.pending[taskId];
}

function pickWorkerKey(workerAddr: string): string {
  const worker = workerAddr.toLowerCase();
  const beta = new Wallet(config.BETA_PRIVATE_KEY).address.toLowerCase();
  const gamma = new Wallet(config.GAMMA_PRIVATE_KEY).address.toLowerCase();
  if (worker === beta) return config.BETA_PRIVATE_KEY;
  if (worker === gamma) return config.GAMMA_PRIVATE_KEY;
  throw new Error(`unknown worker address ${workerAddr}`);
}

function buildEmployerAllowlist(alphaAddress: string): Set<string> {
  const raw = (config.AUTOPILOT_EMPLOYER_ALLOWLIST ?? "").trim();
  if (!raw) return new Set([alphaAddress.toLowerCase()]);
  const out = new Set<string>();
  for (const token of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^0x[a-fA-F0-9]{40}$/.test(token)) {
      out.add(token.toLowerCase());
      continue;
    }
    const key = token.toLowerCase();
    if (key === "alpha") out.add(alphaAddress.toLowerCase());
    else if (key === "beta")
      out.add(new Wallet(config.BETA_PRIVATE_KEY).address.toLowerCase());
    else if (key === "gamma")
      out.add(new Wallet(config.GAMMA_PRIVATE_KEY).address.toLowerCase());
  }
  if (out.size === 0) out.add(alphaAddress.toLowerCase());
  return out;
}

function sha256Hex(payload: string): string {
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

async function buildSubmittedTrace(args: {
  taskId: string;
  worker: string;
  paymentUsdc6: bigint;
  bondUsdc6: bigint;
}): Promise<{ traceHash: string; ipfsURI: string }> {
  const formatUsdc6 = (value: bigint): string => {
    const whole = value / 1_000_000n;
    const fractional = (value % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return fractional ? `${whole.toString()}.${fractional}` : whole.toString();
  };
  const tracePayload = JSON.stringify({
    taskId: args.taskId,
    worker: args.worker,
    schemaVersion: "rfb6.copytrade/autopilot/v1",
    timestamp: new Date().toISOString(),
    decision: {
      marketType: "copytrade",
      instrumentId: args.taskId,
      action: "autopilot-submit",
      notionalUsd: Number(args.paymentUsdc6) / 1_000_000,
      confidenceBps: 5000,
      timeHorizonSec: 60,
      expectedValueBps: 0,
      resolver: {
        kind: "autopilot",
        reference: "rfb6-copytrade",
      },
    },
    plan: [
      "accept task",
      `submit result paymentUsdc6=${args.paymentUsdc6.toString()} (${formatUsdc6(
        args.paymentUsdc6,
      )} USDC) bondUsdc6=${args.bondUsdc6.toString()} (${formatUsdc6(
        args.bondUsdc6,
      )} USDC)`,
      "settle task",
    ],
    result: {
      success: true,
      outputHash: sha256Hex(`${args.taskId}:${Date.now()}`),
      details: "submitted by rfb6 copytrade autopilot",
    },
    integrity: {
      malformed: false,
    },
  });

  const traceHash = sha256Hex(tracePayload);

  if (!config.PINATA_UPLOAD_ENABLED) {
    throw new Error(
      "PINATA_UPLOAD_ENABLED=false; cannot publish verifiable trace artifact",
    );
  }
  if (!config.PINATA_JWT) {
    throw new Error(
      "PINATA_JWT must be set to publish verifiable trace artifacts",
    );
  }

  const uploaded = await uploadArtifactToIpfs({
    jwt: config.PINATA_JWT,
    network: config.PINATA_NETWORK,
    category: "rfb6-copytrade-trace",
    runId: `${args.taskId}-${Date.now()}`,
    payload: tracePayload,
    keyvalues: {
      taskId: args.taskId,
      worker: args.worker,
    },
  });

  return {
    traceHash,
    ipfsURI: uploaded.ipfsURI,
  };
}

async function processTask(
  taskId: string,
  provider: JsonRpcProvider,
): Promise<{ outcome: "terminal" | "pending" | "skipped"; status: number }> {
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
  const allowedEmployers = buildEmployerAllowlist(alpha);
  if (!allowedEmployers.has(employer.toLowerCase())) {
    return { outcome: "skipped", status };
  }

  if (status === 0 || status >= 4) {
    return { outcome: "terminal", status };
  }

  const usdcAddress = await readCourthouse.usdc();

  if (status === 1) {
    const workerWallet = new Wallet(pickWorkerKey(worker), provider);
    if (!(await hasMinNative(provider, workerWallet.address))) {
      console.warn(
        `[rfb6.copytrade.autopilot] preflight-skip task=${taskId} role=worker addr=${
          workerWallet.address
        } reason=insufficient_native min=${MIN_NATIVE_WEI.toString()}`,
      );
      return { outcome: "pending", status };
    }
    const usdc = new Contract(usdcAddress, erc20Abi, workerWallet);
    if (bond > 0n) {
      const usdcBal = (await usdc.balanceOf(workerWallet.address)) as bigint;
      if (usdcBal < bond) {
        console.warn(
          `[rfb6.copytrade.autopilot] preflight-skip task=${taskId} role=worker addr=${
            workerWallet.address
          } reason=insufficient_usdc need=${bond.toString()} have=${usdcBal.toString()}`,
        );
        return { outcome: "pending", status };
      }
    }
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
    if (!(await hasMinNative(provider, workerWallet.address))) {
      console.warn(
        `[rfb6.copytrade.autopilot] preflight-skip task=${taskId} role=worker addr=${workerWallet.address} reason=insufficient_native_for_submit`,
      );
      return { outcome: "pending", status: statusAfterAccept };
    }
    const workerCourthouse = new Contract(
      config.S3_ESCROW_COURTHOUSE,
      courthouseAbi,
      workerWallet,
    );
    const traceArtifact = await buildSubmittedTrace({
      taskId,
      worker: workerWallet.address,
      paymentUsdc6: payment,
      bondUsdc6: bond,
    });
    await (
      await workerCourthouse.submitTaskResult(
        taskId,
        traceArtifact.traceHash,
        traceArtifact.ipfsURI,
      )
    ).wait();
    console.log(
      `[rfb6.copytrade.autopilot] submitted task=${taskId} trace=${traceArtifact.ipfsURI}`,
    );
  }

  const afterSubmit = await readCourthouse.tasks(taskId);
  const statusAfterSubmit = Number(afterSubmit[6]);

  if (statusAfterSubmit === 3) {
    const validator = new Wallet(config.VALIDATOR_PRIVATE_KEY, provider);
    if (!(await hasMinNative(provider, validator.address))) {
      console.warn(
        `[rfb6.copytrade.autopilot] preflight-skip task=${taskId} role=validator addr=${validator.address} reason=insufficient_native_for_settle`,
      );
      return { outcome: "pending", status: statusAfterSubmit };
    }
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

  const final = Number((await readCourthouse.tasks(taskId))[6]);
  return {
    outcome: final >= 4 ? "terminal" : "pending",
    status: final,
  };
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
    let lastErrorThisTick: string | null = null;
    try {
      const toBlock = await provider.getBlockNumber();
      const minFromByLookback = Math.max(
        0,
        toBlock - config.RFB6_COPYTRADE_AUTOPILOT_LOOKBACK_BLOCKS,
      );
      const fromBlock = Math.max(minFromByLookback, state.lastScannedBlock + 1);

      if (fromBlock <= toBlock) {
        let cursor = fromBlock;
        while (cursor <= toBlock) {
          const windowTo = Math.min(cursor + MAX_LOG_RANGE - 1, toBlock);
          const filter = {
            address: config.S3_ESCROW_COURTHOUSE,
            topics: [id("TaskCreatedV2(bytes32,address,uint16,uint16)")],
            fromBlock: cursor,
            toBlock: windowTo,
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
              const result = await processTask(taskId, provider);
              if (result.outcome === "pending") {
                rememberPending(state, taskId, result.status);
              } else {
                forgetPending(state, taskId);
              }
            } catch (err) {
              console.error(
                "[rfb6.copytrade.autopilot] log processing error",
                err,
              );
              lastErrorThisTick = String((err as Error)?.message ?? err);
            }
          }

          cursor = windowTo + 1;
        }

        state.lastScannedBlock = toBlock;
      }

      // Stuck-task sweeper: retry anything we previously left pending.
      const pendingIds = Object.keys(state.pending ?? {});
      for (const taskId of pendingIds) {
        try {
          const result = await processTask(taskId, provider);
          if (result.outcome === "terminal") {
            forgetPending(state, taskId);
          } else if (result.outcome === "pending") {
            rememberPending(state, taskId, result.status);
          }
        } catch (err) {
          console.error(
            `[rfb6.copytrade.autopilot] sweeper error task=${taskId}`,
            err,
          );
          lastErrorThisTick = String((err as Error)?.message ?? err);
        }
      }

      await writeState(state);

      try {
        const usdcAddress = (await courthouse.usdc()) as string;
        const balances = await collectBalances(provider, usdcAddress);
        const nowMs = Date.now();
        const graceMs = config.AUTOPILOT_STUCK_TASK_GRACE_SEC * 1000;
        const stuckTasks = Object.entries(state.pending ?? {})
          .filter(([, info]) => nowMs - info.firstSeenAt >= graceMs)
          .map(([taskId, info]) => ({
            taskId,
            ageSec: Math.round((nowMs - info.firstSeenAt) / 1000),
            lastStatus: info.lastStatus,
          }));
        await writeHealth({
          lastTickAt: new Date(nowMs).toISOString(),
          lastScannedBlock: state.lastScannedBlock,
          lastError: lastErrorThisTick,
          balances,
          pendingCount: Object.keys(state.pending ?? {}).length,
          stuckTasks,
        });
        for (const stuck of stuckTasks) {
          console.warn(
            `[rfb6.copytrade.autopilot] stuck-task task=${stuck.taskId} ageSec=${stuck.ageSec} lastStatus=${stuck.lastStatus}`,
          );
        }
      } catch (err) {
        console.error("[rfb6.copytrade.autopilot] health snapshot error", err);
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
