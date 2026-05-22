import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { PolymarketClient } from "./polymarket.js";
import {
  buildWalletScorecard,
  defaultScorecardOptions,
} from "./wallet-metrics.js";
import { buildAllocations, defaultAllocationOptions } from "./allocate.js";
import type { ClosedPosition } from "./polymarket.js";

type WalletReplay = {
  wallet: string;
  userName: string | null;
  closed: ClosedPosition[];
};

const CATEGORY = process.env.RFB6_POLY_CATEGORY ?? "OVERALL";
const WINDOW = process.env.RFB6_POLY_WINDOW ?? "ALL";
const ORDER_BY = process.env.RFB6_POLY_ORDER_BY ?? "PNL";
const SAMPLE = Number.parseInt(process.env.RFB6_POLY_SAMPLE ?? "25", 10);
const FOLDS = Number.parseInt(process.env.RFB6_POLY_BACKTEST_FOLDS ?? "5", 10);
const WARMUP = Number.parseInt(
  process.env.RFB6_POLY_BACKTEST_WARMUP ?? "20",
  10,
);

function sliceClosedBefore(
  closed: ClosedPosition[],
  cutoff: number,
): ClosedPosition[] {
  return closed.filter((p) => p.timestamp <= cutoff);
}

function sliceClosedBetween(
  closed: ClosedPosition[],
  from: number,
  to: number,
): ClosedPosition[] {
  return closed.filter((p) => p.timestamp > from && p.timestamp <= to);
}

function realizedRoi(positions: ClosedPosition[]): number {
  const realized = positions.reduce((acc, p) => acc + p.realizedPnl, 0);
  const bought = positions.reduce((acc, p) => acc + (p.totalBought ?? 0), 0);
  if (bought <= 0) return 0;
  return realized / bought;
}

async function loadWallets(client: PolymarketClient): Promise<WalletReplay[]> {
  const leaderboard = await client.getLeaderboard({
    category: CATEGORY as never,
    timePeriod: WINDOW as never,
    orderBy: ORDER_BY as never,
    limit: SAMPLE,
  });

  const wallets: WalletReplay[] = [];
  for (const entry of leaderboard) {
    try {
      const closed = await client.getClosedPositions({
        user: entry.proxyWallet,
        limit: 500,
      });
      wallets.push({
        wallet: entry.proxyWallet,
        userName: entry.userName ?? null,
        closed: closed.sort((a, b) => a.timestamp - b.timestamp),
      });
    } catch (err) {
      console.warn(
        `[rfb6.copytrade.backtest] skip ${entry.proxyWallet}: ${
          (err as Error).message
        }`,
      );
    }
  }
  return wallets;
}

async function run(): Promise<void> {
  const cacheDir =
    process.env.RFB6_POLY_CACHE_DIR ??
    config.RFB6_AGENT_OUTPUT_FILE.replace(/[^/]+$/, "polymarket-cache");
  const client = new PolymarketClient({
    cacheDir,
    cacheTtlSec: Number.parseInt(
      process.env.RFB6_POLY_CACHE_TTL_SEC ?? "3600",
      10,
    ),
    userAgent: "rfb6-copytrade-backtest/0.1",
  });

  const wallets = await loadWallets(client);
  const allTimestamps = wallets
    .flatMap((w) => w.closed.map((p) => p.timestamp))
    .filter((t) => t > 0)
    .sort((a, b) => a - b);

  if (allTimestamps.length < WARMUP + FOLDS) {
    console.warn(
      "[rfb6.copytrade.backtest] insufficient closed positions across cohort",
    );
  }

  const start =
    allTimestamps[Math.min(WARMUP, allTimestamps.length - 1)] ??
    Math.floor(Date.now() / 1000);
  const end =
    allTimestamps[allTimestamps.length - 1] ?? Math.floor(Date.now() / 1000);
  const windowSize = Math.max(
    1,
    Math.floor((end - start) / Math.max(FOLDS, 1)),
  );

  const folds = [];
  for (let i = 0; i < FOLDS; i += 1) {
    const cutoff = start + i * windowSize;
    const horizon = cutoff + windowSize;

    const scorecards = wallets.map((w) => {
      const trainingClosed = sliceClosedBefore(w.closed, cutoff);
      return buildWalletScorecard(
        {
          wallet: w.wallet,
          activity: [],
          closed: trainingClosed,
          current: [],
        },
        defaultScorecardOptions,
      );
    });

    const allocations = buildAllocations(scorecards, defaultAllocationOptions);
    const totalBps = allocations.reduce((acc, a) => acc + a.weightBps, 0) || 1;

    let allocatedReturn = 0;
    let equalWeightReturn = 0;
    const eligibleWallets = wallets.filter(
      (_, idx) => scorecards[idx].score.eligible,
    );

    for (let idx = 0; idx < wallets.length; idx += 1) {
      const w = wallets[idx];
      const future = sliceClosedBetween(w.closed, cutoff, horizon);
      const roi = realizedRoi(future);
      const allocation = allocations[idx];
      allocatedReturn += (allocation.weightBps / totalBps) * roi;
      if (eligibleWallets.length > 0 && scorecards[idx].score.eligible) {
        equalWeightReturn += roi / eligibleWallets.length;
      }
    }

    folds.push({
      foldIndex: i,
      cutoffTimestamp: cutoff,
      horizonTimestamp: horizon,
      eligibleWallets: eligibleWallets.length,
      allocatedReturn,
      equalWeightReturn,
      upliftBps: Math.round((allocatedReturn - equalWeightReturn) * 10_000),
    });
  }

  const summary = {
    generatedAt: Math.floor(Date.now() / 1000),
    cohort: wallets.map((w) => ({
      wallet: w.wallet,
      closedSamples: w.closed.length,
    })),
    leaderboard: {
      category: CATEGORY,
      window: WINDOW,
      orderBy: ORDER_BY,
      sample: SAMPLE,
    },
    config: {
      folds: FOLDS,
      warmup: WARMUP,
      windowSize,
      start,
      end,
    },
    folds,
    aggregates: {
      meanAllocatedReturn:
        folds.reduce((a, f) => a + f.allocatedReturn, 0) /
        Math.max(folds.length, 1),
      meanEqualWeightReturn:
        folds.reduce((a, f) => a + f.equalWeightReturn, 0) /
        Math.max(folds.length, 1),
      meanUpliftBps:
        folds.reduce((a, f) => a + f.upliftBps, 0) / Math.max(folds.length, 1),
    },
  };

  const outputFile =
    process.env.RFB6_COPYTRADE_BACKTEST_FILE ??
    join(
      dirname(config.RFB6_BACKTEST_OUTPUT_FILE),
      "rfb6-copytrade-backtest.json",
    );
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(summary, null, 2), "utf8");
  console.log(
    `[rfb6.copytrade.backtest] folds=${
      folds.length
    } meanUpliftBps=${summary.aggregates.meanUpliftBps.toFixed(
      2,
    )} file=${outputFile}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
