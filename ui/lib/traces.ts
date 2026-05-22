import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";

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

function tracesDir(): string {
  return process.env.TRACE_OUTPUT_DIR ?? "../simulation/data/traces";
}

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

function traceIpfsFetchLimit(): number {
  const parsed = Number(process.env.TRACE_IPFS_FETCH_LIMIT ?? "40");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 40;
}

function traceFetchTimeoutMs(): number {
  const parsed = Number(process.env.TRACE_FETCH_TIMEOUT_MS ?? "3500");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3500;
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
    const logs = await courthouse.queryFilter(
      courthouse.filters.TaskResultSubmitted(),
      fromBlock,
      latestBlock,
    );

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

    return resolved.filter((trace): trace is ReasoningTrace => trace !== null);
  } catch {
    return [];
  }
}

function parseTraceTimestampFromFileName(fileName: string): number {
  const lastDash = fileName.lastIndexOf("-");
  const dot = fileName.lastIndexOf(".");
  if (lastDash === -1 || dot === -1 || dot <= lastDash + 1) return 0;
  const parsed = Number(fileName.slice(lastDash + 1, dot));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function readAllTraces(): Promise<ReasoningTrace[]> {
  const dir = tracesDir();
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const traces: ReasoningTrace[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, file), "utf8");
      traces.push(JSON.parse(raw) as ReasoningTrace);
    } catch {
      // Skip malformed trace files.
    }
  }

  return traces;
}

export async function readLatestTracesByTaskId(): Promise<ReasoningTrace[]> {
  const dir = tracesDir();
  if (!existsSync(dir)) {
    return readLatestTracesByTaskIdOnchain();
  }

  const files = await readdir(dir);
  const latestFileByTask = new Map<string, { file: string; ts: number }>();

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const dash = file.indexOf("-");
    if (dash <= 0) continue;

    const taskId = file.slice(0, dash);
    const ts = parseTraceTimestampFromFileName(file);
    const existing = latestFileByTask.get(taskId);

    if (!existing || ts >= existing.ts) {
      latestFileByTask.set(taskId, { file, ts });
    }
  }

  const traces: ReasoningTrace[] = [];
  for (const { file } of latestFileByTask.values()) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      traces.push(JSON.parse(raw) as ReasoningTrace);
    } catch {
      // Skip malformed trace files.
    }
  }

  return traces;
}

export async function findTraceByTaskId(
  taskId: string,
): Promise<ReasoningTrace | null> {
  const dir = tracesDir();
  if (!existsSync(dir)) {
    return findTraceByTaskIdOnchain(taskId);
  }
  const files = await readdir(dir);

  const matches = files
    .filter((f) => f.startsWith(`${taskId}-`) && f.endsWith(".json"))
    .sort(
      (a, b) =>
        parseTraceTimestampFromFileName(b) - parseTraceTimestampFromFileName(a),
    );
  if (matches.length === 0) return null;

  const raw = await readFile(join(dir, matches[0]), "utf8");
  try {
    return JSON.parse(raw) as ReasoningTrace;
  } catch {
    return findTraceByTaskIdOnchain(taskId);
  }
}
