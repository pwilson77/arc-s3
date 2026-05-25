// rfb5 adapter: maps a signed rfb5 run into the shared on-chain publisher.

import { Wallet, getAddress } from "ethers";
import { z } from "zod";
import { publishTasksOnChain, fileStateStore } from "@arc-s3/agent-shared";
import { config } from "./config.js";
import type { Rfb5Run } from "./types.js";

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

function pickWorker(eventKey: string, beta: string, gamma: string): string {
  let hash = 0;
  for (let i = 0; i < eventKey.length; i += 1) {
    hash = (hash * 31 + eventKey.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? beta : gamma;
}

export async function executeRunOnChain(run: Rfb5Run): Promise<void> {
  if (!config.RFB5_ONCHAIN_EXECUTE) {
    return;
  }

  const runtime = runtimeSchema.parse(process.env);
  const beta = new Wallet(runtime.BETA_PRIVATE_KEY).address;
  const gamma = new Wallet(runtime.GAMMA_PRIVATE_KEY).address;

  const candidates = run.decisions
    .filter((d) => d.profitable)
    .map((decision) => ({
      candidateId: decision.eventKey,
      candidateLabel: decision.eventLabel,
      workerAddress: pickWorker(decision.eventKey, beta, gamma),
      recommendedSizeUsd: decision.recommendedSizeUsd,
      extras: {
        netEdgeBps: decision.netEdgeBps,
        decision: {
          yesVenue: decision.yesLeg.venue,
          noVenue: decision.noLeg.venue,
          yesPriceBps: decision.yesLeg.priceBps,
          noPriceBps: decision.noLeg.priceBps,
        },
      },
      keyvalues: { eventKey: decision.eventKey },
    }));

  await publishTasksOnChain({
    agentId: "rfb5",
    runId: run.runId,
    publisher: {
      erc8004Id: run.publisher.erc8004Id,
      wallet: getAddress(run.publisher.wallet),
    },
    candidates,
    policy: {
      dryRun: config.RFB5_ONCHAIN_DRY_RUN,
      maxTasksPerRun: config.RFB5_ONCHAIN_MAX_TASKS_PER_RUN,
      sizeScale: config.RFB5_ONCHAIN_SIZE_SCALE,
      minPaymentUsdc6: config.RFB5_ONCHAIN_MIN_PAYMENT_USDC6,
      maxPaymentUsdc6: config.RFB5_ONCHAIN_MAX_PAYMENT_USDC6,
      dailyNotionalCapUsdc6: config.RFB5_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6,
      bondBps: config.RFB5_ONCHAIN_BOND_BPS,
      publisherFeeBps: config.RFB5_ONCHAIN_PUBLISHER_FEE_BPS,
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
      eventCategory: "rfb5-executor-event",
      mirrorFilePath: config.RFB5_LOCAL_MIRROR
        ? config.RFB5_ONCHAIN_OUTPUT_FILE
        : undefined,
    },
    state: fileStateStore(config.RFB5_ONCHAIN_STATE_FILE),
  });
}
