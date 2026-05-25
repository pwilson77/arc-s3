import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { assertCirclePolicyOrThrow } from "./circle-policy.js";
import { config } from "./config.js";
import { buildWorkerSnapshots, readAllEvents } from "./metrics.js";
import { executeRunOnChain } from "./onchain.js";
import { buildAllocations } from "./scoring.js";
import { payloadHashForRun, persistRun, signatureForRun } from "./store.js";
import type { Rfb6RunEvent, Rfb6RunEventBase } from "./types.js";

async function runOnce(
  lastSignature: string | null,
  signer: Wallet,
): Promise<string | null> {
  const events = await readAllEvents(config.RFB6_AGENT_INPUT_FILE);
  if (events.length === 0) {
    return lastSignature;
  }

  const snapshots = buildWorkerSnapshots(events);
  if (snapshots.length === 0) {
    return lastSignature;
  }

  const allocations = buildAllocations(snapshots, config.RFB6_EV_WINDOW);
  const sourceLatestTimestamp = events[events.length - 1].timestamp;

  const runBase: Rfb6RunEventBase = {
    artifactVersion: "rfb6.arc-s3/v1",
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    publisher: {
      erc8004Id: config.RFB6_ERC8004_ID,
      wallet: signer.address,
    },
    sourceMetricsFile: config.RFB6_AGENT_INPUT_FILE,
    sourceEventCount: events.length,
    sourceLatestTimestamp,
    workers: allocations,
  };

  const fingerprint = signatureForRun(runBase);
  if (fingerprint === lastSignature) {
    return lastSignature;
  }

  const payloadHash = payloadHashForRun(runBase);
  const signature = await signer.signMessage(payloadHash);
  const run: Rfb6RunEvent = {
    ...runBase,
    attestation: {
      scheme: "eip191",
      payloadHash,
      signature,
    },
  };

  await persistRun({
    run,
    pinataJwt: config.PINATA_JWT,
    pinataNetwork: config.PINATA_NETWORK,
    uploadEnabled: config.PINATA_UPLOAD_ENABLED,
    localMirror: config.RFB6_LOCAL_MIRROR,
    localFilePath: config.RFB6_AGENT_OUTPUT_FILE,
  });

  try {
    await executeRunOnChain(run);
  } catch (err) {
    console.error("[rfb6-agent:onchain] execution failed", err);
  }

  const winners = allocations
    .filter((w) => w.weightBps > 0)
    .map((w) => `${w.worker}:${(w.weightBps / 100).toFixed(2)}%`)
    .join(", ");

  console.log(
    `[rfb6-agent] wrote run=${run.runId} publisher=${
      run.publisher.erc8004Id
    } workers=${allocations.length} active=${
      allocations.filter((w) => w.weightBps > 0).length
    } top=${winners || "none"}`,
  );

  return fingerprint;
}

async function main(): Promise<void> {
  const signer = new Wallet(config.RFB6_TESTNET_PRIVATE_KEY);
  const circlePolicy = await assertCirclePolicyOrThrow({
    enabled: config.CIRCLE_POLICY_ENFORCE,
    requireStatus: config.CIRCLE_POLICY_REQUIRE_STATUS,
    requireLimits: config.CIRCLE_POLICY_REQUIRE_LIMITS,
    chain: config.CIRCLE_WALLET_CHAIN,
    walletAddress: config.CIRCLE_WALLET_ADDRESS,
    minPerTxUsdc: config.CIRCLE_POLICY_MIN_PER_TX_USDC,
    minDailyUsdc: config.CIRCLE_POLICY_MIN_DAILY_USDC,
  });

  console.log("[rfb6-agent] starting standalone social-intel process");
  console.log(
    `[rfb6-agent] input=${config.RFB6_AGENT_INPUT_FILE} output=${config.RFB6_AGENT_OUTPUT_FILE} pollMs=${config.RFB6_AGENT_POLL_MS} publisher=${config.RFB6_ERC8004_ID}`,
  );
  if (circlePolicy) {
    console.log(
      `[rfb6-agent] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }

  let lastSignature: string | null = null;

  for (;;) {
    try {
      lastSignature = await runOnce(lastSignature, signer);
    } catch (error) {
      console.error("[rfb6-agent] iteration failed", error);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.RFB6_AGENT_POLL_MS),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
