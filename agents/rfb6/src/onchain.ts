// rfb6 adapter: maps a signed rfb6 social-intel run into the shared on-chain
// publisher. Each allocation with non-zero weightBps becomes a Courthouse
// task announcing the publisher's allocation to that worker.

import { Wallet, getAddress } from "ethers";
import { z } from "zod";
import { publishTasksOnChain, fileStateStore } from "@arc-s3/agent-shared";
import { config } from "./config.js";
import type { Rfb6RunEvent } from "./types.js";

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

function workerAddressFor(
  workerName: string,
  addrs: { alpha: string; beta: string; gamma: string },
): string | null {
  const key = workerName.toLowerCase();
  if (key === "alpha") return addrs.alpha;
  if (key === "beta") return addrs.beta;
  if (key === "gamma") return addrs.gamma;
  return null;
}

export async function executeRunOnChain(run: Rfb6RunEvent): Promise<void> {
  if (!config.RFB6_ONCHAIN_EXECUTE) {
    return;
  }

  const runtime = runtimeSchema.parse(process.env);
  const addrs = {
    alpha: new Wallet(runtime.ALPHA_PRIVATE_KEY).address,
    beta: new Wallet(runtime.BETA_PRIVATE_KEY).address,
    gamma: new Wallet(runtime.GAMMA_PRIVATE_KEY).address,
  };

  const candidates = run.workers
    .filter((alloc) => alloc.weightBps > 0)
    .filter((alloc) => alloc.worker.toLowerCase() !== "alpha")
    .map((alloc) => {
      const workerAddress = workerAddressFor(alloc.worker, addrs);
      if (!workerAddress) return null;
      const recommendedSizeUsd =
        alloc.weightBps * config.RFB6_ONCHAIN_NOTIONAL_PER_BP_USD;
      return {
        candidateId: alloc.worker,
        candidateLabel: `${alloc.worker}@${(alloc.weightBps / 100).toFixed(2)}%`,
        workerAddress,
        recommendedSizeUsd,
        extras: {
          weightBps: alloc.weightBps,
          eligible: alloc.eligible,
          status: alloc.status,
          meanRecentEvBps: alloc.meanRecentEvBps,
          rawScore: alloc.rawScore,
        },
        keyvalues: { worker: alloc.worker, weightBps: String(alloc.weightBps) },
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  await publishTasksOnChain({
    agentId: "rfb6",
    runId: run.runId,
    publisher: {
      erc8004Id: run.publisher.erc8004Id,
      wallet: getAddress(run.publisher.wallet),
    },
    candidates,
    policy: {
      dryRun: config.RFB6_ONCHAIN_DRY_RUN,
      maxTasksPerRun: config.RFB6_ONCHAIN_MAX_TASKS_PER_RUN,
      sizeScale: config.RFB6_ONCHAIN_SIZE_SCALE,
      minPaymentUsdc6: config.RFB6_ONCHAIN_MIN_PAYMENT_USDC6,
      maxPaymentUsdc6: config.RFB6_ONCHAIN_MAX_PAYMENT_USDC6,
      dailyNotionalCapUsdc6: config.RFB6_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6,
      bondBps: config.RFB6_ONCHAIN_BOND_BPS,
      publisherFeeBps: config.RFB6_ONCHAIN_PUBLISHER_FEE_BPS,
      quotedSlippageBps: config.INTENT_QUOTED_SLIPPAGE_BPS,
      defaultGasLimit: config.INTENT_DEFAULT_GAS_LIMIT,
      defaultDeadlineSeconds: config.INTENT_DEFAULT_DEADLINE_SECONDS,
    },
    runtime: {
      rpcUrl: runtime.ARC_RPC_URL,
      chainId: runtime.ARC_CHAIN_ID,
      usdcAddress: runtime.USDC_ADDRESS,
      firewallAddress: runtime.S3_INTENT_FIREWALL,
      courthouseAddress: runtime.S3_ESCROW_COURTHOUSE,
      followerPrivateKey: runtime.ALPHA_PRIVATE_KEY,
    },
    ipfs: {
      enabled: config.PINATA_UPLOAD_ENABLED,
      jwt: config.PINATA_JWT,
      network: config.PINATA_NETWORK,
      eventCategory: "rfb6-executor-event",
      mirrorFilePath: config.RFB6_LOCAL_MIRROR
        ? config.RFB6_ONCHAIN_OUTPUT_FILE
        : undefined,
    },
    state: fileStateStore(config.RFB6_ONCHAIN_STATE_FILE),
  });
}
