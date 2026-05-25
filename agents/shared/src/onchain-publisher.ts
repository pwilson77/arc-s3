// Shared on-chain task publisher used by every arc-s3 agent.
//
// An agent produces a *Run* containing a list of *candidates*. This module
// takes each candidate, decides whether to submit a Courthouse task on the
// arc-s3 chain (subject to daily caps, balance, dry-run and approval state),
// then uploads the resulting executor event to IPFS so the UI / indexers can
// pick it up.
//
// The shape of an agent's candidate is opaque to this module — the caller
// passes a `PublishCandidate` describing the worker, sizing, and free-form
// payload extras that get embedded in the published event artifact.

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
import { replaceLatestArtifact } from "./ipfs.js";

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

export type OnchainStatus =
  | {
      status: "submitted";
      txHash: string;
      blockNumber: number;
      taskId: string | null;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

export type OnchainEventBase = {
  agentId: string;
  observedAt: string;
  runId: string;
  candidateId: string;
  candidateLabel: string;
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
      extras: Record<string, unknown>;
    };
  };
  onchain: OnchainStatus;
};

export type PublishCandidate = {
  /** Stable id within the run (e.g. eventKey, worker name). */
  candidateId: string;
  /** Human-readable label embedded in the event artifact. */
  candidateLabel: string;
  /** 0x address that will perform the task (becomes Courthouse `worker`). */
  workerAddress: string;
  /** Notional USD size the agent thinks the task is worth. Multiplied by `sizeScale`. */
  recommendedSizeUsd: number;
  /** Free-form extras embedded in the published event artifact. */
  extras?: Record<string, unknown>;
  /** Optional per-candidate keyvalues attached to the IPFS pin. */
  keyvalues?: Record<string, string>;
};

export type PublishPolicy = {
  dryRun: boolean;
  maxTasksPerRun: number;
  sizeScale: number;
  minPaymentUsdc6: bigint;
  maxPaymentUsdc6: bigint;
  dailyNotionalCapUsdc6: bigint;
  bondBps: number;
  publisherFeeBps: number;
  quotedSlippageBps: number;
  defaultGasLimit: number;
  defaultDeadlineSeconds: number;
};

export type PublishRuntime = {
  rpcUrl: string;
  chainId: number;
  usdcAddress: string;
  firewallAddress: string;
  courthouseAddress: string;
  followerPrivateKey: string;
};

export type PublishIpfsConfig = {
  enabled: boolean;
  jwt: string | undefined;
  network: "public" | "private";
  /** Pinata `name` for executor events, e.g. "rfb5-executor-event". */
  eventCategory: string;
  /** Optional local file path for mirrored .jsonl writes (debug only). */
  mirrorFilePath?: string;
};

export type PublishStateStore = {
  read(): Promise<{
    lastRunId: string | null;
    dailyNotionalSpent: { day: string; usdc6: string };
  }>;
  write(state: {
    lastRunId: string | null;
    dailyNotionalSpent: { day: string; usdc6: string };
  }): Promise<void>;
};

export type PublishHooks = {
  agentId: string;
  publisher: { erc8004Id: string; wallet: string };
  runId: string;
  candidates: PublishCandidate[];
  policy: PublishPolicy;
  runtime: PublishRuntime;
  ipfs: PublishIpfsConfig;
  state: PublishStateStore;
  logger?: {
    info: (msg: string) => void;
    error: (msg: string, err?: unknown) => void;
  };
};

export type PublishOnchainResult = {
  candidates: number;
  submitted: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  skippedReasons: Record<string, number>;
  errorReasons: Record<string, number>;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toUsdc6(usd: number): bigint {
  return BigInt(Math.max(0, Math.round(usd * 1_000_000)));
}

export function fileStateStore(filePath: string): PublishStateStore {
  return {
    async read() {
      if (!existsSync(filePath)) {
        return {
          lastRunId: null,
          dailyNotionalSpent: { day: today(), usdc6: "0" },
        };
      }
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as {
          lastRunId?: string | null;
          dailyNotionalSpent?: { day: string; usdc6: string };
        };
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
    },
    async write(state) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
    },
  };
}

async function publishEvent(
  ipfs: PublishIpfsConfig,
  event: OnchainEventBase,
  logger: NonNullable<PublishHooks["logger"]>,
): Promise<void> {
  if (ipfs.enabled) {
    if (!ipfs.jwt) {
      throw new Error(
        "PINATA_JWT must be set when PINATA_UPLOAD_ENABLED=true (the default).",
      );
    }
    try {
      const retain = Number(process.env.PINATA_RETAIN ?? 20) || 20;
      const indexFilePath = process.env.PINATA_INDEX_FILE || undefined;
      await replaceLatestArtifact({
        jwt: ipfs.jwt,
        network: ipfs.network,
        category: ipfs.eventCategory,
        identityKey: event.candidateId,
        runId: `${event.runId}-${event.candidateId}-${event.observedAt}`,
        payload: JSON.stringify(event),
        keyvalues: {
          agentId: event.agentId,
          runId: event.runId,
          candidateId: event.candidateId,
          status: event.onchain.status,
        },
        retain,
        indexFilePath,
      });
    } catch (err) {
      logger.error(`[${event.agentId}-executor:ipfs] upload failed`, err);
    }
  }
  if (ipfs.mirrorFilePath) {
    await mkdir(dirname(ipfs.mirrorFilePath), { recursive: true });
    await appendFile(ipfs.mirrorFilePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

export async function publishTasksOnChain(
  hooks: PublishHooks,
): Promise<PublishOnchainResult> {
  const logger = hooks.logger ?? {
    info: (msg) => console.log(msg),
    error: (msg, err) => console.error(msg, err),
  };

  const state = await hooks.state.read();
  if (state.lastRunId === hooks.runId) {
    return {
      candidates: 0,
      submitted: 0,
      skipped: 0,
      errors: 0,
      dryRun: hooks.policy.dryRun,
    };
  }

  const day = today();
  if (state.dailyNotionalSpent.day !== day) {
    state.dailyNotionalSpent = { day, usdc6: "0" };
  }

  const provider = new JsonRpcProvider(
    hooks.runtime.rpcUrl,
    hooks.runtime.chainId,
    {
      staticNetwork: true,
    },
  );
  const follower = new Wallet(hooks.runtime.followerPrivateKey, provider);
  const usdc = new Contract(hooks.runtime.usdcAddress, usdcAbi, follower);
  const firewall = new Contract(
    hooks.runtime.firewallAddress,
    firewallAbi,
    follower,
  );
  const courthouseInterface = new Interface(courthouseAbi);

  const candidates = hooks.candidates.slice(0, hooks.policy.maxTasksPerRun);
  const publisherWallet = getAddress(hooks.publisher.wallet);

  let spent = BigInt(state.dailyNotionalSpent.usdc6);
  let submitted = 0;
  let skipped = 0;
  let errors = 0;
  const skippedReasons: Record<string, number> = {};
  const errorReasons: Record<string, number> = {};

  for (const candidate of candidates) {
    const worker = getAddress(candidate.workerAddress);
    const scaled = toUsdc6(
      candidate.recommendedSizeUsd * hooks.policy.sizeScale,
    );
    const cappedPaymentUsdc6 =
      scaled > hooks.policy.maxPaymentUsdc6
        ? hooks.policy.maxPaymentUsdc6
        : scaled;

    const followerBalanceUsdc6 = (await usdc.balanceOf(
      follower.address,
    )) as bigint;
    const followerReserveUsdc6 = BigInt(
      process.env.FOLLOWER_USDC_RESERVE_USDC6 ??
        process.env.EMPLOYER_FOLLOWER_USDC_RESERVE_USDC6 ??
        "10000",
    );
    const spendableBalanceUsdc6 =
      followerBalanceUsdc6 > followerReserveUsdc6
        ? followerBalanceUsdc6 - followerReserveUsdc6
        : 0n;
    const paymentUsdc6 =
      cappedPaymentUsdc6 > spendableBalanceUsdc6
        ? spendableBalanceUsdc6
        : cappedPaymentUsdc6;

    const bondUsdc6 = (paymentUsdc6 * BigInt(hooks.policy.bondBps)) / 10_000n;
    const totalCommitUsdc6 = paymentUsdc6 + bondUsdc6;

    const preflightEnabled =
      process.env.ONCHAIN_PREFLIGHT_LOG === "true" ||
      hooks.agentId.startsWith("employer-");
    if (preflightEnabled) {
      logger.info(
        `[${hooks.agentId}:preflight] run=${hooks.runId} candidate=${candidate.candidateId} ` +
          `follower=${
            follower.address
          } balanceUsdc6=${followerBalanceUsdc6.toString()} ` +
          `reserveUsdc6=${followerReserveUsdc6.toString()} spendableUsdc6=${spendableBalanceUsdc6.toString()} ` +
          `paymentUsdc6=${paymentUsdc6.toString()} bondUsdc6=${bondUsdc6.toString()} totalCommitUsdc6=${totalCommitUsdc6.toString()} ` +
          `minPaymentUsdc6=${hooks.policy.minPaymentUsdc6.toString()} maxPaymentUsdc6=${hooks.policy.maxPaymentUsdc6.toString()} ` +
          `dailySpentUsdc6=${spent.toString()} dailyCapUsdc6=${hooks.policy.dailyNotionalCapUsdc6.toString()}`,
      );
    }

    let onchain: OnchainStatus;
    if (paymentUsdc6 < hooks.policy.minPaymentUsdc6) {
      onchain =
        followerBalanceUsdc6 < hooks.policy.minPaymentUsdc6
          ? { status: "skipped", reason: "insufficient-follower-usdc-balance" }
          : { status: "skipped", reason: "payment-below-min" };
      skipped += 1;
    } else if (spent + paymentUsdc6 > hooks.policy.dailyNotionalCapUsdc6) {
      onchain = { status: "skipped", reason: "daily-notional-cap" };
      skipped += 1;
    } else if (bondUsdc6 === 0n) {
      onchain = { status: "skipped", reason: "bond-rounds-to-zero" };
      skipped += 1;
    } else if (hooks.policy.dryRun) {
      onchain = { status: "skipped", reason: "dry-run" };
      skipped += 1;
    } else {
      try {
        const allowance = (await usdc.allowance(
          follower.address,
          hooks.runtime.courthouseAddress,
        )) as bigint;
        if (allowance < paymentUsdc6) {
          await (
            await usdc.approve(
              hooks.runtime.courthouseAddress,
              paymentUsdc6 * 4n,
            )
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
            hooks.policy.publisherFeeBps,
          ],
        );
        const tx = await firewall.executeIntent(
          hooks.runtime.courthouseAddress,
          0,
          hooks.policy.quotedSlippageBps,
          hooks.policy.defaultGasLimit,
          Math.floor(Date.now() / 1000) + hooks.policy.defaultDeadlineSeconds,
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

    if (onchain.status === "skipped") {
      skippedReasons[onchain.reason] =
        (skippedReasons[onchain.reason] ?? 0) + 1;
    } else if (onchain.status === "error") {
      const key = onchain.error.slice(0, 120);
      errorReasons[key] = (errorReasons[key] ?? 0) + 1;
    }

    await publishEvent(
      hooks.ipfs,
      {
        agentId: hooks.agentId,
        observedAt: new Date().toISOString(),
        runId: hooks.runId,
        candidateId: candidate.candidateId,
        candidateLabel: candidate.candidateLabel,
        worker,
        follower: follower.address,
        intent: {
          target: "S3IntentFirewall",
          forward: "S3EscrowCourthouse.forwardCreateTaskV2",
          payload: {
            publisher: hooks.publisher.erc8004Id,
            publisherWallet,
            publisherFeeBps: hooks.policy.publisherFeeBps,
            paymentUsdc6: paymentUsdc6.toString(),
            bondUsdc6: bondUsdc6.toString(),
            extras: candidate.extras ?? {},
          },
        },
        onchain,
      },
      logger,
    );
  }

  state.lastRunId = hooks.runId;
  state.dailyNotionalSpent.usdc6 = spent.toString();
  await hooks.state.write(state);

  logger.info(
    `[${hooks.agentId}:onchain] run=${hooks.runId} candidates=${
      candidates.length
    } submitted=${submitted} skipped=${skipped} errors=${errors} dryRun=${
      hooks.policy.dryRun
    } skipReasons=${JSON.stringify(
      skippedReasons,
    )} errorReasons=${JSON.stringify(errorReasons)}`,
  );

  return {
    candidates: candidates.length,
    submitted,
    skipped,
    errors,
    dryRun: hooks.policy.dryRun,
    skippedReasons,
    errorReasons,
  };
}
