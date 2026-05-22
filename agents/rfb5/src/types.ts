export type ArbOutcome = "YES" | "NO";

export type MarketQuote = {
  venue: string;
  chain: string;
  outcome: ArbOutcome;
  priceBps: number;
  availableUsd: number;
  feeBps: number;
  slippageBps: number;
  quoteTimestampMs: number;
};

export type EventMarketSnapshot = {
  snapshotId: string;
  timestampMs: number;
  sport: string;
  league: string;
  eventKey: string;
  eventLabel: string;
  startTimeMs: number;
  marketType: "winner-binary";
  quotes: MarketQuote[];
};

export type ArbLegDecision = {
  outcome: ArbOutcome;
  venue: string;
  chain: string;
  priceBps: number;
  availableUsd: number;
  feeBps: number;
  slippageBps: number;
};

export type ArbDecision = {
  eventKey: string;
  eventLabel: string;
  sport: string;
  marketType: "winner-binary";
  yesLeg: ArbLegDecision;
  noLeg: ArbLegDecision;
  grossEdgeBps: number;
  totalCostsBps: number;
  netEdgeBps: number;
  recommendedSizeUsd: number;
  staleQuote: boolean;
  profitable: boolean;
  reasons: string[];
};

export type Rfb5Publisher = {
  erc8004Id: string;
  wallet: string;
};

export type Rfb5Attestation = {
  scheme: "eip191";
  payloadHash: string;
  signature: string;
};

export type Rfb5RunBase = {
  artifactVersion: "rfb5.sports-arb/v1";
  runId: string;
  timestamp: string;
  publisher: Rfb5Publisher;
  sourceSnapshotFile: string;
  sourceSnapshotCount: number;
  sourceLatestTimestampMs: number;
  decisions: ArbDecision[];
  summary: {
    opportunitiesDetected: number;
    opportunitiesProfitable: number;
    totalRecommendedSizeUsd: number;
    avgNetEdgeBps: number;
  };
};

export type Rfb5Run = Rfb5RunBase & {
  attestation: Rfb5Attestation;
};
