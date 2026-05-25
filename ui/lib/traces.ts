import { createHash } from "node:crypto";
import { Contract, JsonRpcProvider } from "ethers";
import { loadArtifactsByCategory } from "./ipfs-store";

export type ReasoningTrace = {
  taskId: string;
  worker: string;
  schemaVersion: string;
  timestamp: string;
  decision: {
    marketType: string;
    instrumentId: string;
    action: string;
    notionalUsd: number;
    confidenceBps: number;
    timeHorizonSec: number;
    expectedValueBps: number;
    resolver: { kind: string; reference: string };
  };
  plan: string[];
  result: {
    success: boolean;
    outputHash: string;
    details: string;
  };
  integrity: {
    malformed: boolean;
    corruptionReason?: string;
  };
};

type ExecutorEventArtifact = {
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

const EXECUTOR_EVENT_CATEGORIES = [
  "rfb5-executor-event",
  "rfb6-executor-event",
  "rfb6-copytrade-executor-event",
] as const;

function ipfsGatewayBaseUrl(): string {
  return (
    process.env.IPFS_GATEWAY_BASE_URL ?? "https://gateway.pinata.cloud/ipfs"
  );
}

function ipfsGatewayUrl(ipfsURI: string): string {
  const base = ipfsGatewayBaseUrl().replace(/\/+$/, "");
  const cidOrPath = ipfsURI.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
  return `${base}/${cidOrPath}`;
}

function traceEventLookbackBlocks(): number {
  const parsed = Number(process.env.TRACE_EVENT_LOOKBACK_BLOCKS ?? "50000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50000;
}

// ARC RPC rejects ranges larger than ~10k blocks; keep below that to be safe.
function traceEventChunkSize(): number {
  const parsed = Number(process.env.TRACE_EVENT_CHUNK_BLOCKS ?? "9000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 9000;
}

function traceIpfsFetchLimit(): number {
  const parsed = Number(process.env.TRACE_IPFS_FETCH_LIMIT ?? "40");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
}

function traceFetchTimeoutMs(): number {
  const parsed = Number(process.env.TRACE_FETCH_TIMEOUT_MS ?? "3500");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3500;
}

function traceHealthTaskId(): string | null {
  const taskId = process.env.TRACE_HEALTH_TASK_ID;
  if (!taskId || taskId.trim().length === 0) return null;
  return taskId.trim();
}

function courthouseConfig(): { rpcUrl: string; courthouse: string } | null {
  const rpcUrl = process.env.ARC_RPC_URL;
  const courthouse = process.env.S3_ESCROW_COURTHOUSE;
  if (!rpcUrl || !courthouse) return null;
  return { rpcUrl, courthouse };
}

const COURTHOUSE_ABI = [
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
  "event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI)",
];

async function fetchTraceFromIpfs(
  ipfsURI: string,
): Promise<{ trace: ReasoningTrace; raw: string } | null> {
  if (!ipfsURI.startsWith("ipfs://")) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), traceFetchTimeoutMs());

  try {
    const response = await fetch(ipfsGatewayUrl(ipfsURI), {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const raw = await response.text();
    try {
      return { trace: JSON.parse(raw) as ReasoningTrace, raw };
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sha256Hex(payload: string): string {
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

async function findTraceByTaskIdOnchain(
  taskId: string,
): Promise<ReasoningTrace | null> {
  const cfg = courthouseConfig();
  if (!cfg) return null;

  try {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    const courthouse = new Contract(cfg.courthouse, COURTHOUSE_ABI, provider);
    const task = await courthouse.tasks(taskId);
    const ipfsURI = task.ipfsURI as string;
    const traceHash = (task.traceHash as string).toLowerCase();
    if (!ipfsURI || !ipfsURI.startsWith("ipfs://")) return null;

    const fetched = await fetchTraceFromIpfs(ipfsURI);
    if (!fetched) return null;

    if (sha256Hex(fetched.raw).toLowerCase() !== traceHash) {
      return null;
    }

    return fetched.trace;
  } catch {
    return null;
  }
}

async function readLatestTracesByTaskIdOnchain(): Promise<ReasoningTrace[]> {
  const cfg = courthouseConfig();
  if (!cfg) return [];

  try {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    const courthouse = new Contract(cfg.courthouse, COURTHOUSE_ABI, provider);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - traceEventLookbackBlocks());
    const chunk = traceEventChunkSize();
    const logs: Array<
      Awaited<ReturnType<typeof courthouse.queryFilter>>[number]
    > = [];
    for (let start = fromBlock; start <= latestBlock; start += chunk + 1) {
      const end = Math.min(latestBlock, start + chunk);
      try {
        const part = await courthouse.queryFilter(
          courthouse.filters.TaskResultSubmitted(),
          start,
          end,
        );
        logs.push(...part);
      } catch {
        // Skip a failing window so the rest of the scan still proceeds.
      }
    }

    const byTaskId = new Map<string, { ipfsURI: string; traceHash: string }>();
    for (const log of logs) {
      const parsed = courthouse.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      const traceHash = String(parsed.args.traceHash ?? "").toLowerCase();
      const ipfsURI = String(parsed.args.ipfsURI ?? "");
      if (!taskId || !ipfsURI.startsWith("ipfs://")) continue;
      byTaskId.set(taskId, { ipfsURI, traceHash });
    }

    const selected = [...byTaskId.values()].slice(-traceIpfsFetchLimit());
    const resolved = await Promise.all(
      selected.map(async ({ ipfsURI, traceHash }) => {
        const fetched = await fetchTraceFromIpfs(ipfsURI);
        if (!fetched) return null;
        if (sha256Hex(fetched.raw).toLowerCase() !== traceHash) return null;
        return fetched.trace;
      }),
    );

    const traces = resolved.filter(
      (trace): trace is ReasoningTrace => trace !== null,
    );

    if (traces.length > 0) return traces;

    // Fall back to a known task id when available so network views can still
    // render trace-backed rows if log scanning returns no events.
    const fallbackTaskId = traceHealthTaskId();
    if (!fallbackTaskId) return [];
    const fallback = await findTraceByTaskIdOnchain(fallbackTaskId);
    return fallback ? [fallback] : [];
  } catch {
    const fallbackTaskId = traceHealthTaskId();
    if (!fallbackTaskId) return [];
    const fallback = await findTraceByTaskIdOnchain(fallbackTaskId);
    return fallback ? [fallback] : [];
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toHexHash(value: string): string {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value;
  return sha256Hex(value);
}

function formatUsdc6Raw(value: string): string {
  try {
    const raw = BigInt(value);
    const whole = raw / 1_000_000n;
    const fractional = (raw % 1_000_000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return fractional ? `${whole.toString()}.${fractional}` : whole.toString();
  } catch {
    return "0";
  }
}

function syntheticTraceFromExecutorEvent(
  event: ExecutorEventArtifact,
): ReasoningTrace | null {
  if (event.onchain.status !== "submitted") return null;
  if (!event.onchain.taskId) return null;

  const extras = event.intent.payload.extras ?? {};
  const paymentUsdc =
    toNumber(event.intent.payload.paymentUsdc6, 0) / 1_000_000;
  const netEdge = toNumber(extras.netEdgeBps, 0);
  const meanEv = toNumber(extras.meanRecentEvBps, 0);
  const expectedValueBps = event.agentId === "rfb5" ? netEdge : meanEv;

  const plan = [
    `candidate=${event.candidateId} label=${event.candidateLabel}`,
    `intent=${event.intent.forward}`,
    `paymentUsdc6=${event.intent.payload.paymentUsdc6} (${formatUsdc6Raw(
      event.intent.payload.paymentUsdc6,
    )} USDC) bondUsdc6=${event.intent.payload.bondUsdc6} (${formatUsdc6Raw(
      event.intent.payload.bondUsdc6,
    )} USDC)`,
  ];

  return {
    taskId: event.onchain.taskId,
    worker: event.agentId,
    schemaVersion: "artifact-executor/v1",
    timestamp: event.observedAt,
    decision: {
      marketType: event.agentId === "rfb5" ? "sports-arb" : "allocation",
      instrumentId: event.candidateId,
      action: "forwardCreateTaskV2",
      notionalUsd: paymentUsdc,
      confidenceBps: 5000,
      timeHorizonSec: 3600,
      expectedValueBps,
      resolver: {
        kind: "artifact",
        reference: event.runId,
      },
    },
    plan,
    result: {
      success: true,
      outputHash: toHexHash(
        `${event.runId}:${event.candidateId}:${event.observedAt}`,
      ),
      details: `submitted tx=${event.onchain.txHash} block=${event.onchain.blockNumber}`,
    },
    integrity: {
      malformed: false,
    },
  };
}

async function readExecutorArtifactTraces(
  limitPerCategory = 120,
): Promise<ReasoningTrace[]> {
  const traces: ReasoningTrace[] = [];

  for (const category of EXECUTOR_EVENT_CATEGORIES) {
    try {
      const events = await loadArtifactsByCategory<ExecutorEventArtifact>(
        category,
        limitPerCategory,
      );
      for (const entry of events) {
        const trace = syntheticTraceFromExecutorEvent(entry.artifact);
        if (trace) traces.push(trace);
      }
    } catch {
      // Ignore category failures so primary trace flow remains available.
    }
  }

  return traces;
}

export async function readAllTraces(): Promise<ReasoningTrace[]> {
  const artifactTraces = await readExecutorArtifactTraces();
  const onchain = await readLatestTracesByTaskIdOnchain();
  const byTask = new Map<string, ReasoningTrace>();

  for (const trace of artifactTraces) {
    byTask.set(trace.taskId, trace);
  }

  for (const trace of onchain) {
    byTask.set(trace.taskId, trace);
  }

  return [...byTask.values()];
}

export async function readLatestTracesByTaskId(): Promise<ReasoningTrace[]> {
  const artifactTraces = await readExecutorArtifactTraces();
  const onchain = await readLatestTracesByTaskIdOnchain();

  const byTask = new Map<string, ReasoningTrace>();
  for (const trace of artifactTraces) {
    const existing = byTask.get(trace.taskId);
    if (
      !existing ||
      (parseDate(trace.timestamp)?.getTime() ?? 0) >=
        (parseDate(existing.timestamp)?.getTime() ?? 0)
    ) {
      byTask.set(trace.taskId, trace);
    }
  }

  // Canonical onchain worker traces win over synthetic artifact traces.
  for (const trace of onchain) {
    byTask.set(trace.taskId, trace);
  }

  return [...byTask.values()];
}

export async function findTraceByTaskId(
  taskId: string,
): Promise<ReasoningTrace | null> {
  const onchain = await findTraceByTaskIdOnchain(taskId);
  if (onchain) return onchain;

  const artifactTraces = await readExecutorArtifactTraces();
  return artifactTraces.find((trace) => trace.taskId === taskId) ?? null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
