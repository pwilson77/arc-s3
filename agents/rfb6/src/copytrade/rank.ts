import { Wallet } from "ethers";
import { assertCirclePolicyOrThrow } from "../circle-policy.js";
import { config } from "../config.js";
import { PolymarketClient } from "./polymarket.js";
import {
  buildWalletScorecard,
  defaultScorecardOptions,
  type WalletScorecard,
} from "./wallet-metrics.js";
import { buildAllocations, defaultAllocationOptions } from "./allocate.js";
import {
  evaluateDegradation,
  defaultDegradationOptions,
} from "./degradation.js";
import {
  appendCopyTradeRun,
  assembleSignedCopyTradeRun,
  persistCopyTradeRun,
  verifyCopyTradeRun,
} from "./artifact.js";

const CATEGORY = process.env.RFB6_POLY_CATEGORY ?? "OVERALL";
const WINDOW = process.env.RFB6_POLY_WINDOW ?? "MONTH";
const ORDER_BY = process.env.RFB6_POLY_ORDER_BY ?? "PNL";
const SAMPLE = Number.parseInt(process.env.RFB6_POLY_SAMPLE ?? "25", 10);
const TRADE_HISTORY_LIMIT = Number.parseInt(
  process.env.RFB6_POLY_TRADE_LIMIT ?? "500",
  10,
);
const CLOSED_LIMIT = Number.parseInt(
  process.env.RFB6_POLY_CLOSED_LIMIT ?? "50",
  10,
);
const CURRENT_LIMIT = Number.parseInt(
  process.env.RFB6_POLY_CURRENT_LIMIT ?? "100",
  10,
);

async function run(): Promise<void> {
  const circlePolicy = await assertCirclePolicyOrThrow({
    enabled: config.CIRCLE_POLICY_ENFORCE,
    requireStatus: config.CIRCLE_POLICY_REQUIRE_STATUS,
    requireLimits: config.CIRCLE_POLICY_REQUIRE_LIMITS,
    chain: config.CIRCLE_WALLET_CHAIN,
    walletAddress: config.CIRCLE_WALLET_ADDRESS,
    minPerTxUsdc: config.CIRCLE_POLICY_MIN_PER_TX_USDC,
    minDailyUsdc: config.CIRCLE_POLICY_MIN_DAILY_USDC,
  });

  const cacheDir =
    process.env.RFB6_POLY_CACHE_DIR ??
    config.RFB6_AGENT_OUTPUT_FILE.replace(/[^/]+$/, "polymarket-cache");

  const cacheTtlSec = Number.parseInt(
    process.env.RFB6_POLY_CACHE_TTL_SEC ?? "900",
    10,
  );
  if (circlePolicy) {
    console.log(
      `[rfb6.copytrade] circle-policy chain=${circlePolicy.chain} wallet=${circlePolicy.walletAddress} statusChecked=${circlePolicy.statusChecked} limitsChecked=${circlePolicy.limitsChecked}`,
    );
  }

  const client = new PolymarketClient({
    cacheDir,
    cacheTtlSec,
    userAgent: "rfb6-copytrade/0.1",
  });

  console.log(
    `[rfb6.copytrade] fetching leaderboard category=${CATEGORY} window=${WINDOW} orderBy=${ORDER_BY} limit=${SAMPLE}`,
  );
  const leaderboard = await client.getLeaderboard({
    category: CATEGORY as never,
    timePeriod: WINDOW as never,
    orderBy: ORDER_BY as never,
    limit: SAMPLE,
  });

  if (leaderboard.length === 0) {
    console.warn("[rfb6.copytrade] empty leaderboard, nothing to do");
    return;
  }

  const scorecards: WalletScorecard[] = [];
  const degradations = new Map<
    string,
    ReturnType<typeof evaluateDegradation>
  >();

  for (const entry of leaderboard) {
    const wallet = entry.proxyWallet;
    try {
      const [activity, closed, current] = await Promise.all([
        client.getActivity({
          user: wallet,
          limit: TRADE_HISTORY_LIMIT,
          type: ["TRADE"],
        }),
        client.getClosedPositions({ user: wallet, limit: CLOSED_LIMIT }),
        client.getCurrentPositions({ user: wallet, limit: CURRENT_LIMIT }),
      ]);

      const scorecard = buildWalletScorecard(
        {
          wallet,
          leaderboard: { entry, category: CATEGORY, window: WINDOW },
          activity,
          closed,
          current,
        },
        defaultScorecardOptions,
      );

      const degradation = evaluateDegradation(
        wallet,
        closed,
        scorecard,
        defaultDegradationOptions,
      );
      scorecards.push(scorecard);
      degradations.set(wallet, degradation);
    } catch (err) {
      console.warn(
        `[rfb6.copytrade] skipping ${wallet}: ${(err as Error).message}`,
      );
    }
  }

  if (scorecards.length === 0) {
    console.warn("[rfb6.copytrade] no scorecards produced");
    return;
  }

  // demote stop-following wallets before allocation
  const adjusted = scorecards.map((card) => {
    const degradation = degradations.get(card.wallet);
    if (degradation?.stopFollowing) {
      return {
        ...card,
        score: {
          ...card.score,
          eligible: false,
          reasons: Array.from(
            new Set([...card.score.reasons, ...degradation.reasons]),
          ),
        },
      };
    }
    return card;
  });

  const allocations = buildAllocations(adjusted, defaultAllocationOptions);
  const signer = new Wallet(config.RFB6_TESTNET_PRIVATE_KEY);

  const run = await assembleSignedCopyTradeRun({
    publisherId: config.RFB6_ERC8004_ID,
    publisherFeeBps: config.RFB6_PUBLISHER_FEE_BPS,
    signer,
    sampleSource: {
      leaderboardCategory: CATEGORY,
      leaderboardWindow: WINDOW,
      sampledWalletCount: leaderboard.length,
      timestamp: Math.floor(Date.now() / 1000),
    },
    scorecards: adjusted,
    allocations,
    degradations,
  });

  const verdict = verifyCopyTradeRun(run);
  if (!verdict.valid) {
    throw new Error(`refused to emit invalid artifact: ${verdict.reason}`);
  }

  const outputFile =
    process.env.RFB6_COPYTRADE_OUTPUT_FILE ??
    config.RFB6_AGENT_OUTPUT_FILE.replace(
      /rfb6-social-intel\.jsonl$/,
      "rfb6-copytrade.jsonl",
    );

  await persistCopyTradeRun({
    run,
    pinataJwt: config.PINATA_JWT,
    pinataNetwork: config.PINATA_NETWORK,
    uploadEnabled: config.PINATA_UPLOAD_ENABLED,
    localMirror: config.RFB6_LOCAL_MIRROR,
    localFilePath: outputFile,
  });

  const eligibleCount = allocations.filter((a) => a.weightBps > 0).length;
  const totalBps = allocations.reduce((acc, a) => acc + a.weightBps, 0);
  console.log(
    `[rfb6.copytrade] wrote run wallets=${run.wallets.length} eligible=${eligibleCount} totalBps=${totalBps} file=${outputFile}`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
