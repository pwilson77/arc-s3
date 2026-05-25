import { JsonRpcProvider } from "ethers";
import { NextResponse, type NextRequest } from "next/server";
import {
  appendEventsToShards,
  blobConfigured,
  readIndex,
  shardDateFromIsoTimestamp,
  writeIndex,
  type LifecycleIndex,
} from "@/lib/lifecycle-blob";
import { scanLifecycleEvents } from "@/lib/lifecycle-scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${expected}`) return true;
  const query = req.nextUrl.searchParams.get("secret");
  return query === expected;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function runOnce(): Promise<{
  status: "ok" | "skipped" | "error";
  message?: string;
  fromBlock?: number;
  toBlock?: number;
  written?: number;
  shards?: string[];
  done?: boolean;
}> {
  if (!blobConfigured()) {
    return { status: "skipped", message: "BLOB_READ_WRITE_TOKEN not set" };
  }
  const rpcUrl = process.env.ARC_RPC_URL;
  const courthouse = process.env.S3_ESCROW_COURTHOUSE;
  if (!rpcUrl || !courthouse) {
    return {
      status: "skipped",
      message: "ARC_RPC_URL or S3_ESCROW_COURTHOUSE missing",
    };
  }

  const maxBlocks = envInt("LIFECYCLE_INDEX_MAX_BLOCKS_PER_TICK", 50_000);
  const provider = new JsonRpcProvider(rpcUrl);
  const head = await provider.getBlockNumber();

  const idx = (await readIndex()) ?? {
    version: 1 as const,
    lastIndexedBlock: envInt(
      "LIFECYCLE_INDEX_START_BLOCK",
      Math.max(0, head - envInt("LIFECYCLE_INDEX_BOOTSTRAP_LOOKBACK", 200_000)),
    ),
    shards: [],
    updatedAt: new Date(0).toISOString(),
  };

  const fromBlock = idx.lastIndexedBlock + 1;
  if (fromBlock > head) {
    return {
      status: "ok",
      fromBlock,
      toBlock: head,
      written: 0,
      shards: [],
      done: true,
    };
  }

  const scan = await scanLifecycleEvents({
    rpcUrl,
    courthouse,
    fromBlock,
    toBlock: head,
    maxBlocks,
  });

  const { written, shards } = await appendEventsToShards(scan.events);

  const mergedShards = new Set(idx.shards);
  for (const ev of scan.events) {
    mergedShards.add(shardDateFromIsoTimestamp(ev.blockTimestamp));
  }
  for (const s of shards) mergedShards.add(s);

  const next: LifecycleIndex = {
    version: 1,
    lastIndexedBlock: scan.toBlock,
    shards: [...mergedShards].sort(),
    updatedAt: new Date().toISOString(),
  };
  await writeIndex(next);

  const done = scan.toBlock >= head;
  return {
    status: "ok",
    fromBlock: scan.fromBlock,
    toBlock: scan.toBlock,
    written,
    shards,
    done,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runOnce();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: String((err as Error)?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

export const POST = GET;
