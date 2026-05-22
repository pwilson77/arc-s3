import type { WalletScorecard } from "./wallet-metrics.js";

export type AllocationResult = {
  wallet: string;
  weightBps: number;
  rawScore: number;
  eligible: boolean;
  reasons: string[];
};

export type AllocationOptions = {
  perWalletCapBps: number;
  softmaxTemperature: number;
  totalBps: number;
};

export const defaultAllocationOptions: AllocationOptions = {
  perWalletCapBps: 2500,
  softmaxTemperature: 0.08,
  totalBps: 10_000,
};

export function buildAllocations(
  scorecards: WalletScorecard[],
  options: AllocationOptions = defaultAllocationOptions,
): AllocationResult[] {
  const ranked = scorecards
    .map((card) => ({
      card,
      effectiveScore: card.score.eligible ? card.score.raw : 0,
    }))
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  const eligible = ranked.filter(
    (item) => item.card.score.eligible && item.effectiveScore > 0,
  );

  if (eligible.length === 0) {
    return ranked.map((item) => ({
      wallet: item.card.wallet,
      weightBps: 0,
      rawScore: item.card.score.raw,
      eligible: item.card.score.eligible,
      reasons: item.card.score.reasons,
    }));
  }

  const maxScore = Math.max(...eligible.map((item) => item.effectiveScore));
  const exponents = eligible.map((item) =>
    Math.exp(
      (item.effectiveScore - maxScore) /
        Math.max(options.softmaxTemperature, 0.0001),
    ),
  );
  const denominator = exponents.reduce((acc, value) => acc + value, 0);

  let weights = eligible.map((item, idx) => {
    const share = exponents[idx] / denominator;
    return {
      wallet: item.card.wallet,
      score: item.effectiveScore,
      reasons: item.card.score.reasons,
      rawBps: Math.round(share * options.totalBps),
    };
  });

  weights = capWeights(weights, options.perWalletCapBps, options.totalBps);

  const byWallet = new Map(weights.map((w) => [w.wallet, w]));
  return ranked.map((item) => {
    const allocated = byWallet.get(item.card.wallet);
    return {
      wallet: item.card.wallet,
      weightBps: allocated ? allocated.rawBps : 0,
      rawScore: item.card.score.raw,
      eligible: item.card.score.eligible,
      reasons: item.card.score.reasons,
    };
  });
}

function capWeights(
  weights: Array<{
    wallet: string;
    score: number;
    reasons: string[];
    rawBps: number;
  }>,
  capBps: number,
  totalBps: number,
): Array<{ wallet: string; score: number; reasons: string[]; rawBps: number }> {
  let pool = totalBps;
  const capped: typeof weights = [];
  let uncapped: typeof weights = [];

  for (const w of weights) {
    if (w.rawBps >= capBps) {
      capped.push({ ...w, rawBps: capBps });
      pool -= capBps;
    } else {
      uncapped.push(w);
    }
  }

  if (uncapped.length === 0 || pool <= 0) {
    return [
      ...capped,
      ...uncapped.map((w) => ({ ...w, rawBps: pool <= 0 ? 0 : w.rawBps })),
    ];
  }

  const uncappedTotalScore = uncapped.reduce((acc, w) => acc + w.score, 0);
  if (uncappedTotalScore === 0) {
    return [...capped, ...uncapped.map((w) => ({ ...w, rawBps: 0 }))];
  }

  uncapped = uncapped.map((w) => ({
    ...w,
    rawBps: Math.round((w.score / uncappedTotalScore) * pool),
  }));

  const total = [...capped, ...uncapped].reduce((acc, w) => acc + w.rawBps, 0);
  const drift = totalBps - total;
  if (drift !== 0 && uncapped.length > 0) {
    uncapped[0] = { ...uncapped[0], rawBps: uncapped[0].rawBps + drift };
  }

  return [...capped, ...uncapped];
}
