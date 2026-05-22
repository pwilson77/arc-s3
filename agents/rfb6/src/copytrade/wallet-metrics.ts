import type {
  ActivityEvent,
  ClosedPosition,
  CurrentPosition,
  LeaderboardEntry,
} from "./polymarket.js";

export type WalletScorecard = {
  wallet: string;
  userName: string | null;
  source: {
    leaderboard?: {
      rank: number | null;
      pnl: number;
      vol: number;
      category: string;
      window: string;
    };
  };
  activity: {
    totalTrades: number;
    buyTrades: number;
    sellTrades: number;
    totalUsdc: number;
    firstTradeAt: number | null;
    lastTradeAt: number | null;
    activeDays: number;
    distinctMarkets: number;
  };
  closed: {
    samples: number;
    realizedPnl: number;
    totalBought: number;
    realizedRoi: number;
    winRate: number;
    averageWin: number;
    averageLoss: number;
    payoffRatio: number;
    expectancy: number;
  };
  current: {
    samples: number;
    notional: number;
    unrealizedPnl: number;
    largestPositionShare: number;
    redeemableShare: number;
  };
  risk: {
    maxRealizedDrawdown: number;
    drawdownShare: number;
    recencyDays: number | null;
    inactivityFlag: boolean;
    concentrationFlag: boolean;
    smallSampleFlag: boolean;
  };
  score: {
    raw: number;
    eligible: boolean;
    reasons: string[];
  };
};

export type ScorecardInputs = {
  wallet: string;
  leaderboard?: {
    entry: LeaderboardEntry;
    category: string;
    window: string;
  };
  activity: ActivityEvent[];
  closed: ClosedPosition[];
  current: CurrentPosition[];
};

export type ScorecardOptions = {
  minClosedSamples: number;
  minActivityDays: number;
  maxInactivityDays: number;
  maxConcentrationShare: number;
  maxDrawdownShare: number;
  recencyHalflifeDays: number;
};

export const defaultScorecardOptions: ScorecardOptions = {
  minClosedSamples: 10,
  minActivityDays: 14,
  maxInactivityDays: 30,
  maxConcentrationShare: 0.6,
  maxDrawdownShare: 0.5,
  recencyHalflifeDays: 45,
};

const DAY_SECONDS = 86_400;

function uniqueCount<T>(values: T[]): number {
  return new Set(values).size;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator))
    return fallback;
  if (denominator === 0) return fallback;
  return numerator / denominator;
}

function summarizeActivity(
  activity: ActivityEvent[],
): WalletScorecard["activity"] {
  if (activity.length === 0) {
    return {
      totalTrades: 0,
      buyTrades: 0,
      sellTrades: 0,
      totalUsdc: 0,
      firstTradeAt: null,
      lastTradeAt: null,
      activeDays: 0,
      distinctMarkets: 0,
    };
  }

  const trades = activity.filter((event) => event.type === "TRADE");
  const timestamps = trades
    .map((event) => event.timestamp)
    .filter((value) => value > 0);
  const buyCount = trades.filter((event) => event.side === "BUY").length;
  const sellCount = trades.filter((event) => event.side === "SELL").length;
  const totalUsdc = trades.reduce(
    (acc, event) => acc + (event.usdcSize ?? 0),
    0,
  );
  const distinctMarkets = uniqueCount(trades.map((event) => event.conditionId));
  const dayBuckets = uniqueCount(
    timestamps.map((ts) => Math.floor(ts / DAY_SECONDS)),
  );

  return {
    totalTrades: trades.length,
    buyTrades: buyCount,
    sellTrades: sellCount,
    totalUsdc,
    firstTradeAt: timestamps.length === 0 ? null : Math.min(...timestamps),
    lastTradeAt: timestamps.length === 0 ? null : Math.max(...timestamps),
    activeDays: dayBuckets,
    distinctMarkets,
  };
}

function summarizeClosed(
  closed: ClosedPosition[],
): WalletScorecard["closed"] & {
  ordered: ClosedPosition[];
} {
  const ordered = [...closed].sort((a, b) => a.timestamp - b.timestamp);
  const samples = ordered.length;
  const realizedPnl = ordered.reduce(
    (acc, position) => acc + position.realizedPnl,
    0,
  );
  const totalBought = ordered.reduce(
    (acc, position) => acc + (position.totalBought ?? 0),
    0,
  );
  const wins = ordered.filter((position) => position.realizedPnl > 0);
  const losses = ordered.filter((position) => position.realizedPnl < 0);
  const averageWin =
    wins.length === 0
      ? 0
      : wins.reduce((a, p) => a + p.realizedPnl, 0) / wins.length;
  const averageLoss =
    losses.length === 0
      ? 0
      : losses.reduce((a, p) => a + Math.abs(p.realizedPnl), 0) / losses.length;
  const winRate = samples === 0 ? 0 : wins.length / samples;
  const payoffRatio = averageLoss === 0 ? 0 : averageWin / averageLoss;
  const expectancy = winRate * averageWin - (1 - winRate) * averageLoss;
  const realizedRoi = safeDiv(realizedPnl, totalBought);

  return {
    samples,
    realizedPnl,
    totalBought,
    realizedRoi,
    winRate,
    averageWin,
    averageLoss,
    payoffRatio,
    expectancy,
    ordered,
  };
}

function summarizeCurrent(
  current: CurrentPosition[],
): WalletScorecard["current"] {
  const notional = current.reduce(
    (acc, position) => acc + (position.currentValue ?? 0),
    0,
  );
  const unrealizedPnl = current.reduce(
    (acc, position) => acc + (position.cashPnl ?? 0),
    0,
  );
  const largest = current.reduce(
    (max, position) => Math.max(max, position.currentValue ?? 0),
    0,
  );
  const redeemableValue = current
    .filter((position) => position.redeemable)
    .reduce((acc, position) => acc + (position.currentValue ?? 0), 0);

  return {
    samples: current.length,
    notional,
    unrealizedPnl,
    largestPositionShare: safeDiv(largest, notional),
    redeemableShare: safeDiv(redeemableValue, notional),
  };
}

function maxRealizedDrawdown(ordered: ClosedPosition[]): {
  absolute: number;
  share: number;
} {
  if (ordered.length === 0) return { absolute: 0, share: 0 };
  let runningPnl = 0;
  let peak = 0;
  let worst = 0;
  let peakAtWorst = 0;
  for (const position of ordered) {
    runningPnl += position.realizedPnl;
    if (runningPnl > peak) peak = runningPnl;
    const drawdown = peak - runningPnl;
    if (drawdown > worst) {
      worst = drawdown;
      peakAtWorst = peak;
    }
  }
  return {
    absolute: worst,
    share: safeDiv(worst, Math.max(peakAtWorst, 1)),
  };
}

export function buildWalletScorecard(
  inputs: ScorecardInputs,
  options: ScorecardOptions = defaultScorecardOptions,
): WalletScorecard {
  const activitySummary = summarizeActivity(inputs.activity);
  const closedSummaryFull = summarizeClosed(inputs.closed);
  const { ordered, ...closedSummary } = closedSummaryFull;
  const currentSummary = summarizeCurrent(inputs.current);
  const drawdown = maxRealizedDrawdown(ordered);

  const now = Math.floor(Date.now() / 1000);
  const recencyDays =
    activitySummary.lastTradeAt === null
      ? null
      : Math.max(
          0,
          Math.round((now - activitySummary.lastTradeAt) / DAY_SECONDS),
        );

  const reasons: string[] = [];
  const smallSampleFlag = closedSummary.samples < options.minClosedSamples;
  if (smallSampleFlag) reasons.push("small-closed-sample");
  if (activitySummary.activeDays < options.minActivityDays)
    reasons.push("low-time-coverage");

  const inactivityFlag =
    recencyDays !== null && recencyDays > options.maxInactivityDays;
  if (inactivityFlag) reasons.push("inactive");

  const concentrationFlag =
    currentSummary.largestPositionShare > options.maxConcentrationShare;
  if (concentrationFlag) reasons.push("concentration");

  const drawdownBreachFlag = drawdown.share > options.maxDrawdownShare;
  if (drawdownBreachFlag) reasons.push("drawdown-breach");

  const recencyDecay =
    recencyDays === null
      ? 0
      : Math.exp(-recencyDays / options.recencyHalflifeDays);

  const roiSignal = clamp((closedSummary.realizedRoi + 0.5) / 1.5, 0, 1);
  const winRateSignal = clamp(closedSummary.winRate, 0, 1);
  const payoffSignal = clamp(closedSummary.payoffRatio / 3, 0, 1);
  const expectancySignal = clamp(safeDiv(closedSummary.expectancy, 100), 0, 1);
  const drawdownSignal = clamp(1 - drawdown.share, 0, 1);
  const sampleSignal = clamp(closedSummary.samples / 50, 0, 1);

  let raw =
    0.3 * roiSignal +
    0.2 * winRateSignal +
    0.15 * payoffSignal +
    0.15 * expectancySignal +
    0.1 * drawdownSignal +
    0.1 * sampleSignal;
  raw *= recencyDecay || 0.1;

  const eligible =
    !smallSampleFlag &&
    !inactivityFlag &&
    !drawdownBreachFlag &&
    closedSummary.realizedRoi > -0.25;

  if (!eligible && !reasons.includes("ineligible")) {
    if (closedSummary.realizedRoi <= -0.25) reasons.push("negative-roi");
  }

  return {
    wallet: inputs.wallet,
    userName: inputs.leaderboard?.entry.userName ?? null,
    source: inputs.leaderboard
      ? {
          leaderboard: {
            rank: Number.parseInt(inputs.leaderboard.entry.rank, 10) || null,
            pnl: inputs.leaderboard.entry.pnl,
            vol: inputs.leaderboard.entry.vol,
            category: inputs.leaderboard.category,
            window: inputs.leaderboard.window,
          },
        }
      : {},
    activity: activitySummary,
    closed: closedSummary,
    current: currentSummary,
    risk: {
      maxRealizedDrawdown: drawdown.absolute,
      drawdownShare: drawdown.share,
      recencyDays,
      inactivityFlag,
      concentrationFlag,
      smallSampleFlag,
    },
    score: {
      raw,
      eligible,
      reasons,
    },
  };
}
