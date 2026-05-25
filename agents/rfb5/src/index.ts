import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Wallet } from "ethers";
import { assertCirclePolicyOrThrow } from "./circle-policy.js";
import { config } from "./config.js";
import { fetchLiveSnapshots } from "./live.js";
import { executeRunOnChain } from "./onchain.js";
import { scoreSnapshots } from "./scoring.js";
import { appendRun as _legacyAppendRun, payloadHashForRun, persistRun, signatureForRun } from "./store.js";
import type { EventMarketSnapshot, Rfb5Run, Rfb5RunBase } from "./types.js";

process.on("uncaughtException", (err) => {
  console.error("[rfb5-agent] uncaught exception", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[rfb5-agent] unhandled rejection", reason);
});

async function readSnapshotsFromFile(): Promise<EventMarketSnapshot[]> {
  if (!existsSync(config.RFB5_AGENT_INPUT_FILE)) return [];
  const raw = await readFile(config.RFB5_AGENT_INPUT_FILE, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const out: EventMarketSnapshot[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as EventMarketSnapshot);
    } catch {
      // skip malformed input
    }
  }
  return out;
}

async function readSnapshots(): Promise<EventMarketSnapshot[]> {
  if (config.RFB5_LIVE_MODE) {
    return fetchLiveSnapshots();
  }
  return readSnapshotsFromFile();
}

async function runOnce(
  lastSignature: string | null,
  signer: Wallet,
): Promise<string | null> {
  const snapshots = await readSnapshots();
  if (snapshots.length === 0) {
    return lastSignature;
  }

  const latestTs = snapshots[snapshots.length - 1].timestampMs;
  const rawDecisions = scoreSnapshots(snapshots);
  const decisions =
    config.RFB5_FORCE_SYNTHETIC_PROFITABLE && rawDecisions.length > 0
      ? rawDecisions.map((d, i) =>
          i === 0
            ? {
                ...d,
                profitable: true,
                netEdgeBps: Math.max(d.netEdgeBps, 50),
                recommendedSizeUsd: Math.max(d.recommendedSizeUsd, 1),
                reasons: [...d.reasons, "synthetic-force-profitable"],
              }
            : d,
        )
      : rawDecisions;
  const profitable = decisions.filter((d) => d.profitable);
  const totalSize = profitable.reduce(
    (acc, d) => acc + d.recommendedSizeUsd,
    0,
  );
  const avgEdge =
    profitable.length === 0
      ? 0
      : profitable.reduce((acc, d) => acc + d.netEdgeBps, 0) /
        profitable.length;

  const runBase: Rfb5RunBase = {
    artifactVersion: "rfb5.sports-arb/v1",
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    publisher: {
      erc8004Id: config.RFB5_ERC8004_ID,
      wallet: signer.address,
    },
    sourceSnapshotFile: config.RFB5_AGENT_INPUT_FILE,
    sourceSnapshotCount: snapshots.length,
    sourceLatestTimestampMs: latestTs,
    decisions,
    summary: {
      opportunitiesDetected: decisions.length,
      opportunitiesProfitable: profitable.length,
      totalRecommendedSizeUsd: Number(totalSize.toFixed(4)),
      avgNetEdgeBps: Number(avgEdge.toFixed(2)),
    },
  };

  const fingerprint = signatureForRun(runBase);
  if (fingerprint === lastSignature) {
    return lastSignature;
  }

  const payloadHash = payloadHashForRun(runBase);
  const signature = await signer.signMessage(payloadHash);
  const run: Rfb5Run = {
    ...runBase,
    attestation: {
      scheme: "eip191",
      payloadHash,
      signature,
    },
  };

  let ipfsURI: string | null = null;
  try {
    const persisted = await persistRun({
      run,
      pinataJwt: config.PINATA_JWT,
      pinataNetwork: config.PINATA_NETWORK,
      uploadEnabled: config.PINATA_UPLOAD_ENABLED,
      localMirror: config.RFB5_LOCAL_MIRROR,
      localFilePath: config.RFB5_AGENT_OUTPUT_FILE,
    });
    ipfsURI = persisted.ipfsURI;
  } catch (err) {
    console.error("[rfb5-agent:ipfs] persist failed", err);
  }

  try {
    await executeRunOnChain(run);
  } catch (err) {
    console.error("[rfb5-agent:onchain] execution failed", err);
  }

  console.log(
    `[rfb5-agent] wrote run=${run.runId} detected=${run.summary.opportunitiesDetected} profitable=${run.summary.opportunitiesProfitable} avgNetEdgeBps=${run.summary.avgNetEdgeBps} ipfs=${ipfsURI ?? "-"}`,
  );

  return fingerprint;
}

async function main(): Promise<void> {
  const signer = new Wallet(config.RFB5_TESTNET_PRIVATE_KEY);

  const circlePolicy = await assertCirclePolicyOrThrow({
    enabled: config.CIRCLE_POLICY_ENFORCE,
    requireStatus: config.CIRCLE_POLICY_REQUIRE_STATUS,
    requireLimits: config.CIRCLE_POLICY_REQUIRE_LIMITS,
    chain: config.CIRCLE_WALLET_CHAIN,
    walletAddress: config.CIRCLE_WALLET_ADDRESS,
    minPerTxUsdc: config.CIRCLE_POLICY_MIN_PER_TX_USDC,
    minDailyUsdc: config.CIRCLE_POLICY_MIN_DAILY_USDC,
  });

  console.log(
    "[rfb5-agent] starting sports prediction market arbitrage process",
  );
  console.log(
    `[rfb5-agent] mode=${config.RFB5_LIVE_MODE ? "live" : "file"} input=${
      config.RFB5_AGENT_INPUT_FILE
    } output=${config.RFB5_AGENT_OUTPUT_FILE} pollMs=${
      config.RFB5_AGENT_POLL_MS
    } publisher=${config.RFB5_ERC8004_ID}`,
  );
  if (circlePolicy) {
    console.log(
      `[rfb5-agent] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }

  let lastSignature: string | null = null;

  for (;;) {
    try {
      lastSignature = await runOnce(lastSignature, signer);
    } catch (err) {
      console.error("[rfb5-agent] iteration failed", err);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.RFB5_AGENT_POLL_MS),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
