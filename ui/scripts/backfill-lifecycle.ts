/**
 * Backfill the Vercel Blob lifecycle store by scanning the chain from a chosen
 * start block to head, writing daily shards and the index.json. Idempotent:
 * shard writes dedupe on (taskId,stage,txHash) and the index lastIndexedBlock
 * always advances forward.
 *
 * Usage:
 *   cd projects/arc-s3/ui
 *   BLOB_READ_WRITE_TOKEN=... ARC_RPC_URL=... S3_ESCROW_COURTHOUSE=0x... \
 *     [LIFECYCLE_BLOB_PREFIX=arc-s3/testnet/lifecycle] \
 *     [LIFECYCLE_BACKFILL_FROM=43000000] \
 *     [LIFECYCLE_BACKFILL_CHUNK=50000] \
 *     npx tsx scripts/backfill-lifecycle.ts
 */
import { config as loadEnv } from "dotenv";
import { JsonRpcProvider } from "ethers";
import {
  appendEventsToShards,
  blobConfigured,
  readIndex,
  shardDateFromIsoTimestamp,
  writeIndex,
  type LifecycleIndex,
} from "../lib/lifecycle-blob";
import { scanLifecycleEvents } from "../lib/lifecycle-scanner";

// Load env files in priority order — first non-empty set wins. ui/.env.local
// holds the Vercel-managed Blob token but its other slots are blank
// placeholders, so we fall back to ../.env for repo-wide vars like ARC_RPC_URL.
// Use a private buffer so dotenv's side-effect doesn't pollute process.env
// with blank values before the fallback files are read.
function loadEnvIfMissing(path: string) {
  const sandbox: Record<string, string> = {};
  loadEnv({ path, processEnv: sandbox });
  for (const [k, v] of Object.entries(sandbox)) {
    if (v && !process.env[k]) process.env[k] = v;
  }
}
loadEnvIfMissing(".env.local");
loadEnvIfMissing("../.env.local");
loadEnvIfMissing("../.env");

async function main() {
  if (!blobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN must be set");
  }
  const rpcUrl = process.env.ARC_RPC_URL;
  const courthouse = process.env.S3_ESCROW_COURTHOUSE;
  if (!rpcUrl || !courthouse) {
    throw new Error("ARC_RPC_URL and S3_ESCROW_COURTHOUSE must be set");
  }

  const chunk = Number(process.env.LIFECYCLE_BACKFILL_CHUNK ?? "50000");
  const provider = new JsonRpcProvider(rpcUrl);
  const head = await provider.getBlockNumber();

  const existing = await readIndex();
  const envStart = process.env.LIFECYCLE_BACKFILL_FROM
    ? Number(process.env.LIFECYCLE_BACKFILL_FROM)
    : undefined;

  let cursor: number;
  let backfillEnd = head;
  let preserveCursor = false;

  if (
    existing &&
    envStart !== undefined &&
    envStart < existing.lastIndexedBlock
  ) {
    // Backfill a gap BEFORE the existing cursor without rewinding the live
    // indexer. Only the [envStart .. existing.lastIndexedBlock] window is
    // scanned, and we keep the original lastIndexedBlock so the cron does not
    // re-scan ahead unnecessarily.
    cursor = envStart;
    backfillEnd = existing.lastIndexedBlock;
    preserveCursor = true;
    console.log(
      `gap-backfill [${cursor} .. ${backfillEnd}] (existing lastIndexedBlock=${existing.lastIndexedBlock} preserved)`,
    );
  } else if (existing) {
    cursor = existing.lastIndexedBlock + 1;
    console.log(
      `resuming from index.lastIndexedBlock=${existing.lastIndexedBlock}`,
    );
  } else if (envStart !== undefined) {
    cursor = envStart;
  } else {
    cursor = Math.max(0, head - 500_000);
    console.log(
      `no LIFECYCLE_BACKFILL_FROM set, starting at head-500k=${cursor}`,
    );
  }
  if (!Number.isFinite(cursor) || cursor < 0) {
    throw new Error(`invalid start block ${cursor}`);
  }

  const shards = new Set(existing?.shards ?? []);
  let totalWritten = 0;
  let lastIndexed = existing?.lastIndexedBlock ?? cursor - 1;

  while (cursor <= backfillEnd) {
    const windowStart = cursor;
    process.stdout.write(
      `scan [${windowStart} .. ${Math.min(
        windowStart + chunk - 1,
        backfillEnd,
      )}] of ${backfillEnd} ... `,
    );
    const scan = await scanLifecycleEvents({
      rpcUrl,
      courthouse,
      fromBlock: windowStart,
      toBlock: backfillEnd,
      maxBlocks: chunk,
    });
    const { written, shards: touched } = await appendEventsToShards(
      scan.events,
    );
    totalWritten += written;
    for (const s of touched) shards.add(s);
    for (const ev of scan.events) {
      shards.add(shardDateFromIsoTimestamp(ev.blockTimestamp));
    }
    if (!preserveCursor) lastIndexed = scan.toBlock;
    const next: LifecycleIndex = {
      version: 1,
      lastIndexedBlock: lastIndexed,
      shards: [...shards].sort(),
      updatedAt: new Date().toISOString(),
    };
    await writeIndex(next);
    console.log(
      `events=${scan.events.length} written=${written} cumulative=${totalWritten}`,
    );
    if (scan.toBlock < windowStart) break; // safety
    cursor = scan.toBlock + 1;
  }

  console.log(
    `done. lastIndexedBlock=${lastIndexed} shards=${shards.size} totalWritten=${totalWritten}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
