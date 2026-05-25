import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { blobConfigured, readIndex, readRecentShards } from "./lifecycle-blob";
import { scanLifecycleEvents } from "./lifecycle-scanner";

export type LifecycleStage = "created" | "accepted" | "submitted" | "validated";

export type LifecycleEvent = {
  observedAt: string;
  stage: LifecycleStage;
  taskId: string;
  actor: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: string | null;
  valid?: boolean;
  reasons?: string[];
  paymentUsdc6?: string;
  bondUsdc6?: string;
  publisherFeeBps?: number;
  validatorFeeBps?: number;
  workerPayoutUsdc6?: string;
  publisherPayoutUsdc6?: string;
  validatorPayoutUsdc6?: string;
  slashedBondUsdc6?: string;
};

const LIFECYCLE_FILE = "events.jsonl";

const COURTHOUSE_ABI = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
  "event TaskAccepted(bytes32 indexed taskId, address indexed worker)",
  "event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI)",
  "event TaskSettledV2(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 publisherPayout, uint256 validatorPayout, uint256 slashedBond)",
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
] as const;
const MAX_LOG_RANGE = 9_500;

function lifecycleDir(): string {
  if (process.env.LIFECYCLE_OUTPUT_DIR) return process.env.LIFECYCLE_OUTPUT_DIR;

  const traceDir = process.env.TRACE_OUTPUT_DIR;
  if (traceDir?.endsWith("/traces")) {
    return `${traceDir.slice(0, -"/traces".length)}/lifecycle`;
  }

  return "../simulation/data/lifecycle";
}

function courthouseConfig(): { rpcUrl: string; courthouse: string } | null {
  const rpcUrl = process.env.ARC_RPC_URL;
  const courthouse = process.env.S3_ESCROW_COURTHOUSE;
  if (!rpcUrl || !courthouse) return null;
  return { rpcUrl, courthouse };
}

function lifecycleLookbackBlocks(): number {
  const parsed = Number(process.env.LIFECYCLE_EVENT_LOOKBACK_BLOCKS ?? "20000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
}

async function readLifecycleEventsOnchain(): Promise<LifecycleEvent[]> {
  const cfg = courthouseConfig();
  if (!cfg) return [];

  try {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    const courthouse = new Contract(cfg.courthouse, COURTHOUSE_ABI, provider);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - lifecycleLookbackBlocks());

    const queryInChunks = async (
      filter: ReturnType<typeof courthouse.filters.TaskCreated>,
    ) => {
      const allLogs: Array<any> = [];
      let cursor = fromBlock;
      while (cursor <= latestBlock) {
        const windowTo = Math.min(cursor + MAX_LOG_RANGE - 1, latestBlock);
        try {
          const chunk = await courthouse.queryFilter(filter, cursor, windowTo);
          allLogs.push(...chunk);
        } catch {
          // Skip a failing window so the rest of the scan still proceeds.
        }
        cursor = windowTo + 1;
      }
      return allLogs;
    };

    const [createdLogs, acceptedLogs, submittedLogs, settledLogs] =
      await Promise.all([
        queryInChunks(courthouse.filters.TaskCreated()),
        queryInChunks(courthouse.filters.TaskAccepted()),
        queryInChunks(courthouse.filters.TaskResultSubmitted()),
        queryInChunks(courthouse.filters.TaskSettledV2()),
      ]);

    const blockTimeByNumber = new Map<number, string | null>();
    const blockTimestamp = async (
      blockNumber: number,
    ): Promise<string | null> => {
      const cached = blockTimeByNumber.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await provider.getBlock(blockNumber);
      const iso = block?.timestamp
        ? new Date(block.timestamp * 1000).toISOString()
        : null;
      blockTimeByNumber.set(blockNumber, iso);
      return iso;
    };

    const events: LifecycleEvent[] = [];

    for (const log of createdLogs) {
      const parsed = courthouse.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      if (!taskId) continue;
      const actor = String(parsed.args.employer ?? "unknown");
      events.push({
        observedAt: new Date().toISOString(),
        stage: "created",
        taskId,
        actor,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockTimestamp: await blockTimestamp(log.blockNumber),
      });
    }

    for (const log of acceptedLogs) {
      const parsed = courthouse.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      if (!taskId) continue;
      const actor = String(parsed.args.worker ?? "unknown");
      events.push({
        observedAt: new Date().toISOString(),
        stage: "accepted",
        taskId,
        actor,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockTimestamp: await blockTimestamp(log.blockNumber),
      });
    }

    for (const log of submittedLogs) {
      const parsed = courthouse.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      if (!taskId) continue;
      events.push({
        observedAt: new Date().toISOString(),
        stage: "submitted",
        taskId,
        actor: "unknown",
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockTimestamp: await blockTimestamp(log.blockNumber),
      });
    }

    for (const log of settledLogs) {
      const parsed = courthouse.interface.parseLog(log);
      if (!parsed) continue;
      const taskId = String(parsed.args.taskId ?? "");
      if (!taskId) continue;
      const isValid = Boolean(parsed.args.isValid);
      let paymentUsdc6: string | undefined;
      let bondUsdc6: string | undefined;
      let publisherFeeBps: number | undefined;
      let validatorFeeBps: number | undefined;
      try {
        const task = await courthouse.tasks(taskId);
        paymentUsdc6 = String(task.paymentAmount);
        bondUsdc6 = String(task.bondAmount);
        publisherFeeBps = Number(task.publisherFeeBps);
        validatorFeeBps = Number(task.validatorFeeBps);
      } catch {
        // Keep payout details from event even if task lookup fails.
      }
      events.push({
        observedAt: new Date().toISOString(),
        stage: "validated",
        taskId,
        actor: "validator",
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        blockTimestamp: await blockTimestamp(log.blockNumber),
        valid: isValid,
        reasons: [isValid ? "released" : "slashed"],
        paymentUsdc6,
        bondUsdc6,
        publisherFeeBps,
        validatorFeeBps,
        workerPayoutUsdc6: String(parsed.args.workerPayout),
        publisherPayoutUsdc6: String(parsed.args.publisherPayout),
        validatorPayoutUsdc6: String(parsed.args.validatorPayout),
        slashedBondUsdc6: String(parsed.args.slashedBond),
      });
    }

    return events.sort((a, b) => {
      const aTime = a.blockTimestamp ? new Date(a.blockTimestamp).getTime() : 0;
      const bTime = b.blockTimestamp ? new Date(b.blockTimestamp).getTime() : 0;
      return aTime - bTime;
    });
  } catch {
    return [];
  }
}

export async function readLifecycleEvents(): Promise<LifecycleEvent[]> {
  // 1) Prefer durable Blob storage if configured.
  if (blobConfigured()) {
    const days = Number(process.env.LIFECYCLE_SHARD_DAYS ?? "30");
    const shardDays = Number.isFinite(days) && days > 0 ? days : 30;
    const fromBlob = await readRecentShards(shardDays);

    // Optional small RPC tail-fill so the UI is not behind the cron by more than one tick.
    const tailEvents = await tailFillFromIndex();
    // Also merge a live recent-window scan. Blob shards can be partial if an older
    // indexer tick wrote only one stage before the task settled; the UI should not
    // show a complete on-chain task as pending just because the durable shard is stale.
    const recentOnchainEvents = await readLifecycleEventsOnchain();
    const merged = dedupe([...fromBlob, ...tailEvents, ...recentOnchainEvents]);
    if (merged.length > 0) return merged;
    // fall through to file/rpc fallbacks if blob is empty (fresh deploy)
  }

  // 2) Local jsonl (used by simulation / dev).
  const path = join(lifecycleDir(), LIFECYCLE_FILE);
  if (existsSync(path)) {
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const events: LifecycleEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as LifecycleEvent);
      } catch {
        // Skip malformed lines.
      }
    }
    if (events.length > 0) return events;
  }

  // 3) Final fallback: live RPC scan with the legacy 20k-block window.
  return readLifecycleEventsOnchain();
}

function dedupe(events: LifecycleEvent[]): LifecycleEvent[] {
  const seen = new Set<string>();
  const out: LifecycleEvent[] = [];
  for (const ev of events) {
    const key = `${ev.taskId}|${ev.stage}|${ev.txHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber);
}

async function tailFillFromIndex(): Promise<LifecycleEvent[]> {
  const cfg = courthouseConfig();
  if (!cfg) return [];
  const idx = await readIndex();
  if (!idx) return [];
  const maxTail = Number(process.env.LIFECYCLE_TAIL_MAX_BLOCKS ?? "2000");
  try {
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    const head = await provider.getBlockNumber();
    const fromBlock = Math.max(
      idx.lastIndexedBlock + 1,
      head - (Number.isFinite(maxTail) && maxTail > 0 ? maxTail : 2000),
    );
    if (fromBlock > head) return [];
    const scan = await scanLifecycleEvents({
      rpcUrl: cfg.rpcUrl,
      courthouse: cfg.courthouse,
      fromBlock,
      toBlock: head,
    });
    return scan.events;
  } catch {
    return [];
  }
}
