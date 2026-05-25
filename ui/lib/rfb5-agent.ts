import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { Contract, JsonRpcProvider, getAddress, verifyMessage } from "ethers";
import { loadArtifactsByCategory } from "./ipfs-store";

export type Rfb5ArbLeg = {
  outcome: "YES" | "NO";
  venue: string;
  chain: string;
  priceBps: number;
  availableUsd: number;
  feeBps: number;
  slippageBps: number;
};

export type Rfb5Decision = {
  eventKey: string;
  eventLabel: string;
  sport: string;
  marketType: "winner-binary";
  yesLeg: Rfb5ArbLeg;
  noLeg: Rfb5ArbLeg;
  grossEdgeBps: number;
  totalCostsBps: number;
  netEdgeBps: number;
  recommendedSizeUsd: number;
  staleQuote: boolean;
  profitable: boolean;
  reasons: string[];
};

export type Rfb5RunEvent = {
  artifactVersion: "rfb5.sports-arb/v1";
  runId: string;
  timestamp: string;
  publisher: {
    erc8004Id: string;
    wallet: string;
  };
  sourceSnapshotFile: string;
  sourceSnapshotCount: number;
  sourceLatestTimestampMs: number;
  decisions: Rfb5Decision[];
  summary: {
    opportunitiesDetected: number;
    opportunitiesProfitable: number;
    totalRecommendedSizeUsd: number;
    avgNetEdgeBps: number;
  };
  attestation: {
    scheme: "eip191";
    payloadHash: string;
    signature: string;
  };
};

export type Rfb5RunAudit = {
  run: Rfb5RunEvent;
  valid: boolean;
  reason: string | null;
};

export type Rfb5VerificationSummary = {
  total: number;
  valid: number;
  invalid: number;
};

type Rfb5OnchainState = {
  lastRunId: string | null;
  dailyNotionalSpent: {
    day: string;
    usdc6: string;
  };
};

type Rfb5OnchainEvent = {
  observedAt: string;
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

export type Rfb5OnchainSummary = {
  day: string;
  capUsdc6: bigint;
  spentUsdc6: bigint;
  remainingUsdc6: bigint;
  submitted: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  topSkipReasons: Array<{ reason: string; count: number }>;
  lastObservedAt: string | null;
};

type Rfb5OnchainLogSummary = {
  submitted: number;
  lastObservedAt: string | null;
};

const COURTHOUSE_ABI = [
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
  "event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI)",
];

function stateFilePath(): string {
  const configured =
    process.env.RFB5_ONCHAIN_STATE_FILE ??
    "../simulation/data/agents/rfb5-sports-arb-executor-state.json";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function outputFilePath(): string {
  const configured =
    process.env.RFB5_ONCHAIN_OUTPUT_FILE ??
    "../simulation/data/agents/rfb5-sports-arb-executor.jsonl";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function rpcUrl(): string | null {
  return process.env.ARC_RPC_URL ?? null;
}

function courthouseAddress(): string | null {
  return process.env.S3_ESCROW_COURTHOUSE ?? null;
}

function publisherAddress(): string | null {
  const configured = process.env.RFB5_PUBLISHER_ADDRESS?.trim();
  if (!configured) return null;
  try {
    return getAddress(configured);
  } catch {
    return null;
  }
}

function lookbackBlocks(): number {
  const parsed = Number(process.env.RFB5_EVENT_LOOKBACK_BLOCKS ?? "50000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50000;
}

async function readOnchainSubmittedFallback(): Promise<Rfb5OnchainLogSummary | null> {
  const rpc = rpcUrl();
  const courthouse = courthouseAddress();
  const publisher = publisherAddress();
  if (!rpc || !courthouse || !publisher) return null;

  try {
    const provider = new JsonRpcProvider(rpc);
    const contract = new Contract(courthouse, COURTHOUSE_ABI, provider);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - lookbackBlocks());

    const logs = await contract.queryFilter(
      contract.filters.TaskResultSubmitted(),
      fromBlock,
      latestBlock,
    );

    if (logs.length === 0) {
      return { submitted: 0, lastObservedAt: null };
    }

    let submitted = 0;
    let latestTimestamp: number | null = null;

    for (const log of logs) {
      const parsed = contract.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      if (!taskId) continue;

      const task = await contract.tasks(taskId);
      const taskPublisher = String(task.publisher ?? "");
      if (!taskPublisher) continue;

      try {
        if (getAddress(taskPublisher) !== publisher) continue;
      } catch {
        continue;
      }

      submitted += 1;
      if (typeof log.blockNumber === "number") {
        const block = await provider.getBlock(log.blockNumber);
        if (block?.timestamp) {
          const ts = block.timestamp * 1000;
          latestTimestamp = latestTimestamp === null ? ts : Math.max(latestTimestamp, ts);
        }
      }
    }

    return {
      submitted,
      lastObservedAt: latestTimestamp
        ? new Date(latestTimestamp).toISOString()
        : null,
    };
  } catch {
    return null;
  }
}

export async function readRfb5OnchainSummary(): Promise<Rfb5OnchainSummary> {
  const capUsdc6 = BigInt(
    process.env.RFB5_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6 ?? "2000000",
  );
  const dryRun = process.env.RFB5_ONCHAIN_DRY_RUN === "true";

  let day = today();
  let spentUsdc6 = 0n;

  const statePath = stateFilePath();
  if (existsSync(statePath)) {
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as Rfb5OnchainState;
      if (parsed?.dailyNotionalSpent?.day) {
        day = parsed.dailyNotionalSpent.day;
      }
      if (parsed?.dailyNotionalSpent?.usdc6) {
        spentUsdc6 = BigInt(parsed.dailyNotionalSpent.usdc6);
      }
    } catch {
      // Keep default summary values if state file is malformed.
    }
  }

  const outputPath = outputFilePath();
  const events: Rfb5OnchainEvent[] = [];

  // Primary path: IPFS — listed via Pinata category, fetched via gateway.
  try {
    const ipfsEvents = await loadArtifactsByCategory<Rfb5OnchainEvent>(
      "rfb5-executor-event",
      200,
    );
    for (const entry of ipfsEvents) {
      events.push(entry.artifact);
    }
  } catch (err) {
    console.warn("[rfb5-agent] ipfs events fetch failed", err);
  }

  // Fallback: local mirror file (only present when *_LOCAL_MIRROR=true).
  if (events.length === 0 && existsSync(outputPath)) {
    const raw = await readFile(outputPath, "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as Rfb5OnchainEvent;
        events.push(parsed);
      } catch {
        // Skip malformed JSONL rows.
      }
    }
  }

  const dayEvents = events.filter(
    (event) => event.observedAt.slice(0, 10) === day,
  );
  const submitted = dayEvents.filter(
    (event) => event.onchain.status === "submitted",
  ).length;
  const skippedEvents = dayEvents.filter(
    (
      event,
    ): event is Rfb5OnchainEvent & {
      onchain: { status: "skipped"; reason: string };
    } => event.onchain.status === "skipped",
  );
  const errors = dayEvents.filter(
    (event) => event.onchain.status === "error",
  ).length;

  const skipReasonCounts = new Map<string, number>();
  for (const event of skippedEvents) {
    const reason = event.onchain.reason;
    skipReasonCounts.set(reason, (skipReasonCounts.get(reason) ?? 0) + 1);
  }

  const topSkipReasons = [...skipReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  const lastObservedAt = dayEvents[dayEvents.length - 1]?.observedAt ?? null;
  const onchainFallback = await readOnchainSubmittedFallback();

  const submittedFinal =
    submitted > 0 ? submitted : (onchainFallback?.submitted ?? 0);
  const lastObservedAtFinal =
    lastObservedAt ?? onchainFallback?.lastObservedAt ?? null;

  return {
    day,
    capUsdc6,
    spentUsdc6,
    remainingUsdc6: spentUsdc6 >= capUsdc6 ? 0n : capUsdc6 - spentUsdc6,
    submitted: submittedFinal,
    skipped: skippedEvents.length,
    errors,
    dryRun,
    topSkipReasons,
    lastObservedAt: lastObservedAtFinal,
  };
}

function canonicalRunPayload(run: Rfb5RunEvent): string {
  return JSON.stringify({
    artifactVersion: run.artifactVersion,
    runId: run.runId,
    timestamp: run.timestamp,
    publisher: run.publisher,
    sourceSnapshotFile: run.sourceSnapshotFile,
    sourceSnapshotCount: run.sourceSnapshotCount,
    sourceLatestTimestampMs: run.sourceLatestTimestampMs,
    decisions: run.decisions,
    summary: run.summary,
  });
}

function rfb5PayloadHash(run: Rfb5RunEvent): string {
  return `0x${createHash("sha256")
    .update(canonicalRunPayload(run))
    .digest("hex")}`;
}

function verifyRfb5Run(run: Rfb5RunEvent): {
  valid: boolean;
  reason: string | null;
} {
  if (run.artifactVersion !== "rfb5.sports-arb/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }
  if (run.attestation?.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }
  const computed = rfb5PayloadHash(run);
  if (computed !== run.attestation.payloadHash) {
    return { valid: false, reason: "payload hash mismatch" };
  }
  try {
    const recovered = getAddress(
      verifyMessage(run.attestation.payloadHash, run.attestation.signature),
    );
    const claimed = getAddress(run.publisher.wallet);
    if (recovered !== claimed) {
      return { valid: false, reason: "signature wallet mismatch" };
    }
  } catch {
    return { valid: false, reason: "invalid signature" };
  }
  return { valid: true, reason: null };
}

export async function readRfb5RunAudit(limit = 50): Promise<Rfb5RunAudit[]> {
  const parsed: Rfb5RunAudit[] = [];
  try {
    const ipfsRuns = await loadArtifactsByCategory<Rfb5RunEvent>(
      "rfb5-run",
      Math.max(limit, 50),
    );
    for (const entry of ipfsRuns) {
      const run = entry.artifact;
      const verdict = verifyRfb5Run(run);
      parsed.push({ run, valid: verdict.valid, reason: verdict.reason });
    }
  } catch (err) {
    console.warn("[rfb5-agent] ipfs runs fetch failed", err);
  }

  if (limit <= 0 || parsed.length <= limit) {
    return parsed;
  }
  return parsed.slice(parsed.length - limit);
}

export async function readLatestRfb5Run(): Promise<Rfb5RunEvent | null> {
  const audited = await readRfb5RunAudit(1);
  return audited[audited.length - 1]?.run ?? null;
}

export async function readRfb5VerificationSummary(
  limit = 200,
): Promise<Rfb5VerificationSummary> {
  const audited = await readRfb5RunAudit(limit);
  const valid = audited.filter((entry) => entry.valid).length;
  const total = audited.length;
  return { total, valid, invalid: total - valid };
}
