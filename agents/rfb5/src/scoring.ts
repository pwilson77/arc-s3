import { config } from "./config.js";
import type {
  ArbDecision,
  ArbLegDecision,
  EventMarketSnapshot,
  MarketQuote,
} from "./types.js";

function chooseBest(
  quotes: MarketQuote[],
  outcome: "YES" | "NO",
): MarketQuote | null {
  const filtered = quotes
    .filter((q) => q.outcome === outcome)
    .sort((a, b) => a.priceBps - b.priceBps || b.availableUsd - a.availableUsd);
  return filtered[0] ?? null;
}

function toLeg(q: MarketQuote): ArbLegDecision {
  return {
    outcome: q.outcome,
    venue: q.venue,
    chain: q.chain,
    priceBps: q.priceBps,
    availableUsd: q.availableUsd,
    feeBps: q.feeBps,
    slippageBps: q.slippageBps,
  };
}

function quoteIsStale(nowMs: number, quoteMs: number): boolean {
  return nowMs - quoteMs > config.RFB5_MAX_QUOTE_AGE_MS;
}

export function scoreSnapshots(
  snapshots: EventMarketSnapshot[],
  nowMs = Date.now(),
): ArbDecision[] {
  const out: ArbDecision[] = [];

  for (const s of snapshots) {
    if (s.marketType !== "winner-binary") continue;
    if (s.quotes.length < 2) continue;

    const bestYes = chooseBest(s.quotes, "YES");
    const bestNo = chooseBest(s.quotes, "NO");
    if (!bestYes || !bestNo) continue;

    const stale =
      quoteIsStale(nowMs, bestYes.quoteTimestampMs) ||
      quoteIsStale(nowMs, bestNo.quoteTimestampMs);
    const grossEdgeBps = 10_000 - (bestYes.priceBps + bestNo.priceBps);
    const variableCostsBps =
      bestYes.feeBps + bestNo.feeBps + bestYes.slippageBps + bestNo.slippageBps;
    const totalCostsBps = variableCostsBps + config.RFB5_EXECUTION_RISK_BPS;
    const netEdgeBps = grossEdgeBps - totalCostsBps;

    const maxSizeByLiquidity = Math.min(
      bestYes.availableUsd,
      bestNo.availableUsd,
    );
    const recommendedSizeUsd = Math.max(
      0,
      Math.min(config.RFB5_MAX_RECOMMENDED_SIZE_USD, maxSizeByLiquidity),
    );

    const reasons: string[] = [];
    if (stale) reasons.push("stale-quote");
    if (recommendedSizeUsd < config.RFB5_MIN_LEG_LIQUIDITY_USD)
      reasons.push("insufficient-liquidity");
    if (netEdgeBps < config.RFB5_MIN_NET_EDGE_BPS)
      reasons.push("net-edge-below-threshold");

    const profitable = reasons.length === 0;

    out.push({
      eventKey: s.eventKey,
      eventLabel: s.eventLabel,
      sport: s.sport,
      marketType: "winner-binary",
      yesLeg: toLeg(bestYes),
      noLeg: toLeg(bestNo),
      grossEdgeBps,
      totalCostsBps,
      netEdgeBps,
      recommendedSizeUsd,
      staleQuote: stale,
      profitable,
      reasons,
    });
  }

  return out.sort((a, b) => b.netEdgeBps - a.netEdgeBps);
}
