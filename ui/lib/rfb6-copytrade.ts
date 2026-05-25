import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, resolve, join } from "node:path";
import { getAddress, verifyMessage } from "ethers";
import { loadArtifactsByCategory } from "./ipfs-store";

export type CopyTradeWalletEntry = {
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
};

export type CopyTradeRun = {
  artifactVersion: "rfb6.copytrade/v1";
  runId: string;
  timestamp: number;
  publisher: { id: string; wallet: string; feeBps?: number };
  source: {
    leaderboardCategory: string;
    leaderboardWindow: string;
    sampledWalletCount: number;
    timestamp: number;
  };
  wallets: CopyTradeWalletEntry[];
  attestation: { scheme: "eip191"; payloadHash: string; signature: string };
};

export type CopyTradeAudit = {
  run: CopyTradeRun;
  valid: boolean;
  reason: string | null;
};

export type ExecutorOnChainResult =
  | {
      status: "submitted";
      txHash: string;
      blockNumber: number;
      taskId: string | null;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

export type ExecutorIntentEvent = {
  observedAt: string;
  runId: string;
  payloadHash: string;
  follower: string;
  worker?: string;
  wallet: string;
  userName: string | null;
  action: "open" | "resize" | "unwind" | "skip";
  fromWeightBps: number;
  toWeightBps: number;
  notionalUsdc: number;
  intent: {
    target: string;
    forward: string;
    payload: Record<string, unknown>;
  };
  firewall: { decision: "approved" } | { decision: "rejected"; reason: string };
  onchain?: ExecutorOnChainResult;
  reasons: string[];
};

function runFilePath(): string {
  const configured =
    process.env.RFB6_COPYTRADE_OUTPUT_FILE ??
    "../simulation/data/agents/rfb6-copytrade.jsonl";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function executorFilePath(): string {
  const configured =
    process.env.RFB6_COPYTRADE_EXECUTOR_OUTPUT_FILE ??
    "../simulation/data/agents/rfb6-copytrade-executor.jsonl";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function canonicalPayload(run: CopyTradeRun): string {
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

function payloadHash(run: CopyTradeRun): string {
  return `0x${createHash("sha256")
    .update(canonicalPayload(run))
    .digest("hex")}`;
}

function verify(run: CopyTradeRun): { valid: boolean; reason: string | null } {
  if (run.artifactVersion !== "rfb6.copytrade/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }
  if (run.attestation?.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }
  if (payloadHash(run) !== run.attestation.payloadHash) {
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

export async function readCopyTradeAudit(
  limit = 20,
): Promise<CopyTradeAudit[]> {
  const out: CopyTradeAudit[] = [];

  try {
    const ipfsRuns = await loadArtifactsByCategory<CopyTradeRun>(
      "rfb6-copytrade-run",
      Math.max(limit, 20),
    );
    for (const entry of ipfsRuns) {
      const v = verify(entry.artifact);
      out.push({ run: entry.artifact, valid: v.valid, reason: v.reason });
    }
  } catch (err) {
    console.warn("[rfb6-copytrade] ipfs runs fetch failed", err);
  }

  if (out.length === 0) {
    const path = runFilePath();
    if (existsSync(path)) {
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const run = JSON.parse(line) as CopyTradeRun;
          const v = verify(run);
          out.push({ run, valid: v.valid, reason: v.reason });
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  if (limit <= 0 || out.length <= limit) return out;
  return out.slice(out.length - limit);
}

export async function readLatestCopyTradeAudit(): Promise<CopyTradeAudit | null> {
  const audited = await readCopyTradeAudit(1);
  return audited[audited.length - 1] ?? null;
}

export async function readExecutorEvents(
  limit = 100,
): Promise<ExecutorIntentEvent[]> {
  const out: ExecutorIntentEvent[] = [];

  try {
    const ipfsEvents = await loadArtifactsByCategory<ExecutorIntentEvent>(
      "rfb6-copytrade-executor-event",
      Math.max(limit, 100),
    );
    for (const entry of ipfsEvents) {
      out.push(entry.artifact);
    }
  } catch (err) {
    console.warn("[rfb6-copytrade] ipfs executor events fetch failed", err);
  }

  if (out.length === 0) {
    const path = executorFilePath();
    if (existsSync(path)) {
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          out.push(JSON.parse(line) as ExecutorIntentEvent);
        } catch {
          // skip
        }
      }
    }
  }

  if (limit <= 0 || out.length <= limit) return out;
  return out.slice(out.length - limit);
}

export interface ActivePosition {
  title: string;
  currentValue: number;
  eventSlug: string;
  slug: string;
  avgPrice: number;
  curPrice: number;
  size: number;
  outcome: string;
}

export async function readActivePositions(
  wallet: string,
): Promise<ActivePosition[]> {
  const mapPositions = (payload: any[]): ActivePosition[] =>
    payload
      .filter((p: any) => Number(p.currentValue) > 0)
      .map((p: any) => ({
        title: p.title,
        currentValue: Number(p.currentValue),
        eventSlug: p.eventSlug || "",
        slug: p.slug,
        avgPrice: Number(p.avgPrice),
        curPrice: Number(p.curPrice),
        size: Number(p.size),
        outcome: p.outcome,
      }));

  const dir = resolve(
    process.cwd(),
    "../simulation/data/agents/polymarket-cache",
  );
  if (!existsSync(dir)) {
    try {
      const url = new URL("https://data-api.polymarket.com/positions");
      url.searchParams.set("user", wallet);
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", "0");

      const res = await fetch(url.toString(), {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as any[];
      return mapPositions(Array.isArray(payload) ? payload : []);
    } catch {
      return [];
    }
  }
  try {
    const files = await readdir(dir);
    const lowerWallet = wallet.toLowerCase();
    const match = files.find((f) =>
      f.startsWith(`positions__${lowerWallet}__`),
    );
    if (!match) return [];

    const file = join(dir, match);
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    const payload = parsed.payload || [];

    return mapPositions(Array.isArray(payload) ? payload : []);
  } catch (err) {
    console.error("error reading active positions:", err);
    return [];
  }
}
