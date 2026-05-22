# RFB5 Sports Arbitrage Agent

RFB5 is a demo-first sports prediction-market arbitrage process for Arc S3.

## Scope

- Sport-first: focused on sports winner markets.
- Market model: binary YES/NO market pairs.
- Decision mode: detect and score opportunities, then publish signed artifacts.

## Input Contract

RFB5 reads JSONL snapshots from:

- `simulation/data/agents/rfb5-sports-quotes.jsonl`

Each line is one `EventMarketSnapshot` with:

- event metadata (`sport`, `eventKey`, `eventLabel`, `startTimeMs`)
- quote set across venues/chains with:
  - `outcome` (YES/NO)
  - `priceBps`
  - `availableUsd`
  - `feeBps`
  - `slippageBps`
  - `quoteTimestampMs`

## Decision Model

For each event:

1. pick best YES leg (lowest YES price)
2. pick best NO leg (lowest NO price)
3. compute gross edge
   - `grossEdgeBps = 10_000 - (yesPriceBps + noPriceBps)`
4. compute total costs
   - `totalCostsBps = yesFee + noFee + yesSlippage + noSlippage + executionRiskBps`
5. compute net edge
   - `netEdgeBps = grossEdgeBps - totalCostsBps`
6. recommend size based on minimum leg liquidity and safety cap

Profitability requires all of:

- quote freshness within `RFB5_MAX_QUOTE_AGE_MS`
- min liquidity on both legs
- `netEdgeBps >= RFB5_MIN_NET_EDGE_BPS`

## Artifact

RFB5 writes signed JSONL runs to:

- `simulation/data/agents/rfb5-sports-arb.jsonl`

Artifact version:

- `rfb5.sports-arb/v1`

Each run includes:

- full decision list
- summary metrics
- EIP-191 attestation (`payloadHash`, `signature`)

## Commands

From monorepo root:

- `npm run agent:rfb5`

From package dir:

- `npm run dev -w @arc-s3/rfb5-agent`

## Demo KPIs

- opportunities detected
- opportunities marked profitable
- average net edge in bps
- total recommended size
