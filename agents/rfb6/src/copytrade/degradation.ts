import type { ClosedPosition } from "./polymarket.js";
import type { WalletScorecard } from "./wallet-metrics.js";

export type DegradationOptions = {
  recentSampleSize: number;
  winRateDropThreshold: number;
  roiDropThreshold: number;
  drawdownShareCeiling: number;
};

export const defaultDegradationOptions: DegradationOptions = {
  recentSampleSize: 15,
  winRateDropThreshold: 0.15,
  roiDropThreshold: 0.1,
  drawdownShareCeiling: 0.4,
};

export type DegradationVerdict = {
  wallet: string;
  stopFollowing: boolean;
  reasons: string[];
  metrics: {
    recentWinRate: number;
    baselineWinRate: number;
    recentRoi: number;
    baselineRoi: number;
    recentDrawdownShare: number;
  };
};

export function evaluateDegradation(
  wallet: string,
  closed: ClosedPosition[],
  scorecard: WalletScorecard,
  options: DegradationOptions = defaultDegradationOptions,
): DegradationVerdict {
  const ordered = [...closed].sort((a, b) => a.timestamp - b.timestamp);
  const n = ordered.length;
  if (n < options.recentSampleSize * 2) {
    return {
      wallet,
      stopFollowing: false,
      reasons: ["insufficient-history-for-degradation"],
      metrics: {
        recentWinRate: 0,
        baselineWinRate: 0,
        recentRoi: 0,
        baselineRoi: 0,
        recentDrawdownShare: 0,
      },
    };
  }

  const recent = ordered.slice(-options.recentSampleSize);
  const baseline = ordered.slice(0, n - options.recentSampleSize);

  const summarize = (slice: ClosedPosition[]) => {
    const wins = slice.filter((p) => p.realizedPnl > 0).length;
    const realized = slice.reduce((acc, p) => acc + p.realizedPnl, 0);
    const bought = slice.reduce((acc, p) => acc + (p.totalBought ?? 0), 0);
    return {
      winRate: slice.length === 0 ? 0 : wins / slice.length,
      roi: bought === 0 ? 0 : realized / bought,
    };
  };

  const recentStats = summarize(recent);
  const baselineStats = summarize(baseline);

  let runningPnl = 0;
  let peak = 0;
  let worst = 0;
  for (const position of recent) {
    runningPnl += position.realizedPnl;
    if (runningPnl > peak) peak = runningPnl;
    worst = Math.max(worst, peak - runningPnl);
  }
  const recentDrawdownShare = peak === 0 ? 0 : worst / peak;

  const reasons: string[] = [];
  if (
    baselineStats.winRate - recentStats.winRate >
    options.winRateDropThreshold
  ) {
    reasons.push("win-rate-decay");
  }
  if (baselineStats.roi - recentStats.roi > options.roiDropThreshold) {
    reasons.push("roi-decay");
  }
  if (recentDrawdownShare > options.drawdownShareCeiling) {
    reasons.push("recent-drawdown");
  }
  if (scorecard.risk.inactivityFlag) {
    reasons.push("inactive");
  }

  return {
    wallet,
    stopFollowing: reasons.length > 0,
    reasons,
    metrics: {
      recentWinRate: recentStats.winRate,
      baselineWinRate: baselineStats.winRate,
      recentRoi: recentStats.roi,
      baselineRoi: baselineStats.roi,
      recentDrawdownShare,
    },
  };
}
