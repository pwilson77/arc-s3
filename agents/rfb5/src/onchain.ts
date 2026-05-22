import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
  type TransactionReceipt,
} from "ethers";
import { z } from "zod";
import { config } from "./config.js";
import type { ArbDecision, Rfb5Run } from "./types.js";

type Rfb5OnchainState = {
  lastRunId: string | null;
  dailyNotionalSpent: {
    day: string;
    usdc6: string;
  };
};

type OnchainEvent = {
  observedAt: string;
  runId: string;
  eventKey: string;
  eventLabel: string;
  netEdgeBps: number;
  recommendedSizeUsd: number;
  worker: string;
  follower: string;
  intent: {
    target: "S3IntentFirewall";
    forward: "S3EscrowCourthouse.forwardCreateTaskV2";
    payload: {
      publisher: string;
      publisherWallet: string;
      publisherFeeBps: number;
      paymentUsdc6: string;
      bondUsdc6: string;
      decision: {
        yesVenue: string;
        noVenue: string;
        yesPriceBps: number;
        noPriceBps: number;
      };
    };
  };
  onchain:
    | {
        status: "submitted";
        txHash: string;
        blockNumber: number;
        taskId: string | null;
      }
    | { status: "skipped"; reason: string }
    | { status: "error"; error: string };
};

const runtimeSchema = z.object({
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_INTENT_FIREWALL: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_ESCROW_COURTHOUSE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ALPHA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  BETA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  GAMMA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

const courthouseAbi = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toUsdc6(usd: number): bigint {
  return BigInt(Math.max(0, Math.round(usd * 1_000_000)));
}

function pickWorker(eventKey: string, beta: string, gamma: string): string {
  let hash = 0;
  for (let i = 0; i < eventKey.length; i += 1) {
    hash = (hash * 31 + eventKey.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? beta : gamma;
}

async function readState(): Promise<Rfb5OnchainState> {
  if (!existsSync(config.RFB5_ONCHAIN_STATE_FILE)) {
    return {
      lastRunId: null,
      dailyNotionalSpent: { day: today(), usdc6: "0" },
    };
  }
  try {
    const raw = await readFile(config.RFB5_ONCHAIN_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Rfb5OnchainState;
    return {
      lastRunId: parsed.lastRunId ?? null,
      dailyNotionalSpent: parsed.dailyNotionalSpent ?? {
        day: today(),
        usdc6: "0",
      },
    };
  } catch {
    return {
      lastRunId: null,
      dailyNotionalSpent: { day: today(), usdc6: "0" },
    };
  }
}

async function writeState(state: Rfb5OnchainState): Promise<void> {
  await mkdir(dirname(config.RFB5_ONCHAIN_STATE_FILE), { recursive: true });
  await writeFile(
    config.RFB5_ONCHAIN_STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

async function appendEvent(event: OnchainEvent): Promise<void> {
  await mkdir(dirname(config.RFB5_ONCHAIN_OUTPUT_FILE), { recursive: true });
  await appendFile(
    config.RFB5_ONCHAIN_OUTPUT_FILE,
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

export async function executeRunOnChain(run: Rfb5Run): Promise<void> {
  if (!config.RFB5_ONCHAIN_EXECUTE) {
    return;
  }

  const runtime = runtimeSchema.parse(process.env);
  const state = await readState();

  if (state.lastRunId === run.runId) {
    return;
  }

  const day = today();
  if (state.dailyNotionalSpent.day !== day) {
    state.dailyNotionalSpent = { day, usdc6: "0" };
  }

  const provider = new JsonRpcProvider(
    runtime.ARC_RPC_URL,
    runtime.ARC_CHAIN_ID,
    {
      staticNetwork: true,
    },
  );
  const follower = new Wallet(runtime.ALPHA_PRIVATE_KEY, provider);
  const beta = new Wallet(runtime.BETA_PRIVATE_KEY).address;
  const gamma = new Wallet(runtime.GAMMA_PRIVATE_KEY).address;

  const usdc = new Contract(runtime.USDC_ADDRESS, usdcAbi, follower);
  const firewall = new Contract(
    runtime.S3_INTENT_FIREWALL,
    firewallAbi,
    follower,
  );
  const courthouseInterface = new Interface(courthouseAbi);

  const candidates = run.decisions
    .filter((d) => d.profitable)
    .slice(0, config.RFB5_ONCHAIN_MAX_TASKS_PER_RUN);

  const publisherWallet = getAddress(run.publisher.wallet);
  let spent = BigInt(state.dailyNotionalSpent.usdc6);
  let submitted = 0;
  let skipped = 0;
  let errors = 0;

  for (const decision of candidates) {
    const scaled = toUsdc6(
      decision.recommendedSizeUsd * config.RFB5_ONCHAIN_SIZE_SCALE,
    );
    const cappedPaymentUsdc6 =
      scaled > config.RFB5_ONCHAIN_MAX_PAYMENT_USDC6
        ? config.RFB5_ONCHAIN_MAX_PAYMENT_USDC6
        : scaled;

    const followerBalanceUsdc6 = (await usdc.balanceOf(
      follower.address,
    )) as bigint;
    const spendableBalanceUsdc6 =
      followerBalanceUsdc6 > 10_000n ? followerBalanceUsdc6 - 10_000n : 0n;
    const paymentUsdc6 =
      cappedPaymentUsdc6 > spendableBalanceUsdc6
        ? spendableBalanceUsdc6
        : cappedPaymentUsdc6;

    const worker = pickWorker(decision.eventKey, beta, gamma);
    const bondUsdc6 =
      (paymentUsdc6 * BigInt(config.RFB5_ONCHAIN_BOND_BPS)) / 10_000n;

    let onchain: OnchainEvent["onchain"];
    if (paymentUsdc6 < config.RFB5_ONCHAIN_MIN_PAYMENT_USDC6) {
      onchain =
        followerBalanceUsdc6 < config.RFB5_ONCHAIN_MIN_PAYMENT_USDC6
          ? { status: "skipped", reason: "insufficient-follower-usdc-balance" }
          : { status: "skipped", reason: "payment-below-min" };
      skipped += 1;
    } else if (
      spent + paymentUsdc6 >
      config.RFB5_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6
    ) {
      onchain = { status: "skipped", reason: "daily-notional-cap" };
      skipped += 1;
    } else if (bondUsdc6 === 0n) {
      onchain = { status: "skipped", reason: "bond-rounds-to-zero" };
      skipped += 1;
    } else if (config.RFB5_ONCHAIN_DRY_RUN) {
      onchain = { status: "skipped", reason: "dry-run" };
      skipped += 1;
    } else {
      try {
        const allowance = (await usdc.allowance(
          follower.address,
          runtime.S3_ESCROW_COURTHOUSE,
        )) as bigint;
        if (allowance < paymentUsdc6) {
          await (
            await usdc.approve(runtime.S3_ESCROW_COURTHOUSE, paymentUsdc6 * 4n)
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
            config.RFB5_ONCHAIN_PUBLISHER_FEE_BPS,
          ],
        );
        const tx = await firewall.executeIntent(
          runtime.S3_ESCROW_COURTHOUSE,
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

        onchain = {
          status: "submitted",
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          taskId: taskId ?? null,
        };
        spent += paymentUsdc6;
        submitted += 1;
      } catch (err) {
        onchain = { status: "error", error: (err as Error).message };
        errors += 1;
      }
    }

    await appendEvent({
      observedAt: new Date().toISOString(),
      runId: run.runId,
      eventKey: decision.eventKey,
      eventLabel: decision.eventLabel,
      netEdgeBps: decision.netEdgeBps,
      recommendedSizeUsd: decision.recommendedSizeUsd,
      worker,
      follower: follower.address,
      intent: {
        target: "S3IntentFirewall",
        forward: "S3EscrowCourthouse.forwardCreateTaskV2",
        payload: {
          publisher: run.publisher.erc8004Id,
          publisherWallet,
          publisherFeeBps: config.RFB5_ONCHAIN_PUBLISHER_FEE_BPS,
          paymentUsdc6: paymentUsdc6.toString(),
          bondUsdc6: bondUsdc6.toString(),
          decision: {
            yesVenue: decision.yesLeg.venue,
            noVenue: decision.noLeg.venue,
            yesPriceBps: decision.yesLeg.priceBps,
            noPriceBps: decision.noLeg.priceBps,
          },
        },
      },
      onchain,
    });
  }

  state.lastRunId = run.runId;
  state.dailyNotionalSpent.usdc6 = spent.toString();
  await writeState(state);

  console.log(
    `[rfb5-agent:onchain] run=${run.runId} candidates=${candidates.length} submitted=${submitted} skipped=${skipped} errors=${errors} dryRun=${config.RFB5_ONCHAIN_DRY_RUN}`,
  );
}
