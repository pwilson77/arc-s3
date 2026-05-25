import { Contract, JsonRpcProvider } from "ethers";
import type { LifecycleEvent } from "./lifecycle";

const COURTHOUSE_ABI = [
  "event TaskCreated(bytes32 indexed taskId, address indexed employer, address indexed worker, uint256 paymentAmount, uint256 bondAmount)",
  "event TaskAccepted(bytes32 indexed taskId, address indexed worker)",
  "event TaskResultSubmitted(bytes32 indexed taskId, bytes32 traceHash, string ipfsURI)",
  "event TaskSettledV2(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 publisherPayout, uint256 validatorPayout, uint256 slashedBond)",
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
] as const;

const MAX_LOG_RANGE = 9_500;

export type ScanResult = {
  events: LifecycleEvent[];
  fromBlock: number;
  toBlock: number;
};

export type ScannerConfig = {
  rpcUrl: string;
  courthouse: string;
  fromBlock: number;
  toBlock?: number;
  /** Optional cap on the number of blocks scanned in a single call. */
  maxBlocks?: number;
};

export async function scanLifecycleEvents(
  cfg: ScannerConfig,
): Promise<ScanResult> {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const courthouse = new Contract(cfg.courthouse, COURTHOUSE_ABI, provider);
  const head = cfg.toBlock ?? (await provider.getBlockNumber());
  const cap = cfg.maxBlocks ?? Number.MAX_SAFE_INTEGER;
  const toBlock = Math.min(head, cfg.fromBlock + cap - 1);

  if (toBlock < cfg.fromBlock) {
    return { events: [], fromBlock: cfg.fromBlock, toBlock: cfg.fromBlock - 1 };
  }

  const queryInChunks = async (
    filter: ReturnType<typeof courthouse.filters.TaskCreated>,
  ) => {
    const allLogs: Array<any> = [];
    let cursor = cfg.fromBlock;
    while (cursor <= toBlock) {
      const windowTo = Math.min(cursor + MAX_LOG_RANGE - 1, toBlock);
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
  const observedAt = new Date().toISOString();

  for (const log of createdLogs) {
    const parsed = courthouse.interface.parseLog(log);
    if (!parsed) continue;
    const taskId = String(parsed.args.taskId ?? "");
    if (!taskId) continue;
    events.push({
      observedAt,
      stage: "created",
      taskId,
      actor: String(parsed.args.employer ?? "unknown"),
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
    events.push({
      observedAt,
      stage: "accepted",
      taskId,
      actor: String(parsed.args.worker ?? "unknown"),
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
      observedAt,
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
      observedAt,
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

  return {
    events: events.sort((a, b) => a.blockNumber - b.blockNumber),
    fromBlock: cfg.fromBlock,
    toBlock,
  };
}
