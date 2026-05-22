import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Wallet, getAddress, verifyMessage } from "ethers";
import type { AllocationResult } from "./allocate.js";
import type { DegradationVerdict } from "./degradation.js";
import type { WalletScorecard } from "./wallet-metrics.js";

export type CopyTradeRunBase = {
  artifactVersion: "rfb6.copytrade/v1";
  runId: string;
  timestamp: number;
  publisher: {
    id: string;
    wallet: string;
    feeBps: number;
  };
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
    metrics: {
      realizedRoi: number;
      winRate: number;
      payoffRatio: number;
      maxRealizedDrawdown: number;
      drawdownShare: number;
      activeDays: number;
      totalTrades: number;
      lastTradeAt: number | null;
    };
  }>;
};

export type CopyTradeRun = CopyTradeRunBase & {
  attestation: {
    scheme: "eip191";
    payloadHash: string;
    signature: string;
  };
};

export function canonicalCopyTradePayload(run: CopyTradeRunBase): string {
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

export function payloadHashForCopyTrade(run: CopyTradeRunBase): string {
  return `0x${createHash("sha256")
    .update(canonicalCopyTradePayload(run))
    .digest("hex")}`;
}

export function copyTradeSignature(run: CopyTradeRunBase): string {
  const compact = run.wallets.map((w) => ({
    wallet: w.wallet,
    weightBps: w.weightBps,
    rawScore: Number(w.rawScore.toFixed(6)),
    stop: w.stopFollowing,
  }));
  return createHash("sha256")
    .update(JSON.stringify({ source: run.source, wallets: compact }))
    .digest("hex");
}

export type AssembleArgs = {
  publisherId: string;
  publisherFeeBps: number;
  signer: Wallet;
  sampleSource: {
    leaderboardCategory: string;
    leaderboardWindow: string;
    sampledWalletCount: number;
    timestamp: number;
  };
  scorecards: WalletScorecard[];
  allocations: AllocationResult[];
  degradations: Map<string, DegradationVerdict>;
};

export async function assembleSignedCopyTradeRun(
  args: AssembleArgs,
): Promise<CopyTradeRun> {
  const wallets = args.scorecards.map((card) => {
    const allocation = args.allocations.find((a) => a.wallet === card.wallet);
    const degradation = args.degradations.get(card.wallet);
    return {
      wallet: card.wallet,
      userName: card.userName,
      weightBps: allocation?.weightBps ?? 0,
      rawScore: card.score.raw,
      eligible: card.score.eligible,
      reasons: card.score.reasons,
      stopFollowing: degradation?.stopFollowing ?? false,
      degradationReasons: degradation?.reasons ?? [],
      metrics: {
        realizedRoi: card.closed.realizedRoi,
        winRate: card.closed.winRate,
        payoffRatio: card.closed.payoffRatio,
        maxRealizedDrawdown: card.risk.maxRealizedDrawdown,
        drawdownShare: card.risk.drawdownShare,
        activeDays: card.activity.activeDays,
        totalTrades: card.activity.totalTrades,
        lastTradeAt: card.activity.lastTradeAt,
      },
    };
  });

  const base: CopyTradeRunBase = {
    artifactVersion: "rfb6.copytrade/v1",
    runId: `copytrade-${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    publisher: {
      id: args.publisherId,
      wallet: getAddress(await args.signer.getAddress()),
      feeBps: args.publisherFeeBps,
    },
    source: args.sampleSource,
    wallets,
  };

  const payloadHash = payloadHashForCopyTrade(base);
  const signature = await args.signer.signMessage(payloadHash);

  return {
    ...base,
    attestation: {
      scheme: "eip191",
      payloadHash,
      signature,
    },
  };
}

export type CopyTradeVerdict = { valid: boolean; reason: string | null };

export function verifyCopyTradeRun(run: CopyTradeRun): CopyTradeVerdict {
  if (run.artifactVersion !== "rfb6.copytrade/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }
  if (run.attestation.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }
  const expected = payloadHashForCopyTrade(run);
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

export async function appendCopyTradeRun(
  filePath: string,
  run: CopyTradeRun,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(run)}\n`, "utf8");
}
