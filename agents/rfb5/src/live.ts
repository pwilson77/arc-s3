import { config } from "./config.js";
import type { EventMarketSnapshot } from "./types.js";

type PolymarketTag = {
  slug?: string;
  label?: string;
};

type PolymarketMarket = {
  slug?: string;
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  active?: boolean;
  closed?: boolean;
  liquidityNum?: number;
  volumeNum?: number;
};

type PolymarketEvent = {
  slug?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  tags?: PolymarketTag[];
  markets?: PolymarketMarket[];
};

type KalshiMarket = {
  ticker?: string;
  title?: string;
  subtitle?: string;
  status?: string;
  series_ticker?: string;
  event_ticker?: string;
  close_time?: string;
  expiration_time?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
  yes_ask_size_fp?: string;
  no_ask_size_fp?: string;
  open_interest?: number | string;
  volume?: number | string;
  open_interest_fp?: string;
  volume_fp?: string;
};

type KalshiMarketsResponse = {
  markets?: KalshiMarket[];
};

type KalshiOrderbook = {
  yes_dollars?: Array<[string, string]>;
  no_dollars?: Array<[string, string]>;
};

type KalshiOrderbookResponse = {
  orderbook_fp?: KalshiOrderbook;
};

type KalshiQuoteMarket = {
  ticker: string;
  eventKey: string;
  label: string;
  startTimeMs: number;
  league: string;
  yesPriceBps: number;
  noPriceBps: number;
  availableUsd: number;
};

async function fetchJsonWithRetry<T>(
  url: string,
  options: RequestInit,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`fetch failed status=${res.status} url=${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`fetch failed url=${url}`);
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v));
  } catch {
    return [];
  }
}

function asPriceBps(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10_000, Math.round(n * 10_000)));
}

function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, n));
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTokens(input: string): Set<string> {
  return new Set(
    normalizeText(input)
      .split(" ")
      .filter((p) => p.length >= 3),
  );
}

function jaccard(a: string, b: string): number {
  const ta = textTokens(a);
  const tb = textTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }

  const union = ta.size + tb.size - inter;
  if (union <= 0) return 0;
  return inter / union;
}

function tokenOverlapCount(a: string, b: string): number {
  const ta = textTokens(a);
  const tb = textTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter;
}

function normalizeLeague(tags: PolymarketTag[] | undefined): string {
  if (!tags || tags.length === 0) return "sports";
  const preferred = tags.find((t) =>
    (t.slug ?? "").toLowerCase().includes("league"),
  );
  if (preferred?.label) return preferred.label;
  return tags[0].label ?? tags[0].slug ?? "sports";
}

function parseMs(value: string | undefined, fallbackMs: number): number {
  const n = Date.parse(value ?? "");
  return Number.isFinite(n) ? n : fallbackMs;
}

function parseBookLevelPrice(
  levels: Array<[string, string]> | undefined,
): number {
  if (!Array.isArray(levels) || levels.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    const px = Number(level[0]);
    if (!Number.isFinite(px)) continue;
    if (px <= 0) continue;
    if (px < min) min = px;
  }
  if (!Number.isFinite(min)) return 0;
  return clamp(Math.round(min * 10_000), 1, 10_000);
}

function parseBookLevelSizeUsd(
  levels: Array<[string, string]> | undefined,
  priceBps: number,
): number {
  if (!Array.isArray(levels) || levels.length === 0 || priceBps <= 0) return 0;
  const topQty = Number(levels[0][1]);
  if (!Number.isFinite(topQty) || topQty <= 0) return 0;
  return topQty * (priceBps / 10_000);
}

function toFiniteNumber(value: number | string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDollarToBps(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return clamp(Math.round(n * 10_000), 0, 10_000);
}

let kalshiQuoteCache: { atMs: number; quotes: KalshiQuoteMarket[] } | null =
  null;

async function fetchKalshiQuotes(nowMs: number): Promise<KalshiQuoteMarket[]> {
  if (
    kalshiQuoteCache &&
    nowMs - kalshiQuoteCache.atMs <= config.RFB5_LIVE_KALSHI_ORDERBOOK_CACHE_MS
  ) {
    return kalshiQuoteCache.quotes;
  }

  const marketsUrl = `${config.RFB5_LIVE_KALSHI_BASE_URL}/trade-api/v2/markets?status=open&limit=${config.RFB5_LIVE_KALSHI_MARKETS_LIMIT}`;
  const marketsPayload = await fetchJsonWithRetry<KalshiMarketsResponse>(
    marketsUrl,
    { headers: { accept: "application/json" } },
    { retries: 2 },
  );
  const rawMarkets = marketsPayload.markets ?? [];
  const sportsMarkets = rawMarkets.filter((m) => {
    const st = (m.series_ticker ?? "").toUpperCase();
    const ev = (m.event_ticker ?? "").toUpperCase();
    return st.startsWith("KX") || ev.startsWith("KX") || st.includes("SPORT");
  });

  const quoteMarkets: KalshiQuoteMarket[] = [];

  for (const market of sportsMarkets) {
    const status = (market.status ?? "").toLowerCase();
    if (!["open", "active"].some((x) => status.includes(x))) continue;

    const ticker = market.ticker ?? "";
    if (!ticker) continue;

    let yesPriceBps = parseDollarToBps(market.yes_ask_dollars);
    let noPriceBps = parseDollarToBps(market.no_ask_dollars);

    let yesDepthUsd =
      Math.max(0, toFiniteNumber(market.yes_ask_size_fp)) *
      (yesPriceBps / 10_000);
    let noDepthUsd =
      Math.max(0, toFiniteNumber(market.no_ask_size_fp)) *
      (noPriceBps / 10_000);

    if (yesPriceBps <= 0 || noPriceBps <= 0) {
      const bookUrl = `${
        config.RFB5_LIVE_KALSHI_BASE_URL
      }/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook`;
      let bookPayload: KalshiOrderbookResponse;
      try {
        bookPayload = await fetchJsonWithRetry<KalshiOrderbookResponse>(
          bookUrl,
          { headers: { accept: "application/json" } },
          { retries: 1 },
        );
      } catch {
        continue;
      }
      if (yesPriceBps <= 0) {
        yesPriceBps = parseBookLevelPrice(
          bookPayload.orderbook_fp?.yes_dollars,
        );
        yesDepthUsd = parseBookLevelSizeUsd(
          bookPayload.orderbook_fp?.yes_dollars,
          yesPriceBps,
        );
      }
      if (noPriceBps <= 0) {
        noPriceBps = parseBookLevelPrice(bookPayload.orderbook_fp?.no_dollars);
        noDepthUsd = parseBookLevelSizeUsd(
          bookPayload.orderbook_fp?.no_dollars,
          noPriceBps,
        );
      }
    }

    if (yesPriceBps <= 0 || noPriceBps <= 0) continue;

    const fallbackDepth = Math.max(
      1,
      (toFiniteNumber(market.open_interest) +
        toFiniteNumber(market.open_interest_fp) +
        toFiniteNumber(market.volume) +
        toFiniteNumber(market.volume_fp)) *
        0.001,
    );
    const availableUsd = clamp(
      Math.max(yesDepthUsd, noDepthUsd, fallbackDepth),
      5,
      2_000,
    );

    const title = market.title ?? market.subtitle ?? ticker;
    const closeMs = parseMs(market.close_time ?? market.expiration_time, nowMs);

    quoteMarkets.push({
      ticker,
      eventKey: ticker,
      label: title,
      startTimeMs: closeMs,
      league: market.series_ticker ?? "sports",
      yesPriceBps,
      noPriceBps,
      availableUsd,
    });
  }

  kalshiQuoteCache = { atMs: nowMs, quotes: quoteMarkets };
  return quoteMarkets;
}

function mergeWithKalshi(
  polySnapshots: EventMarketSnapshot[],
  kalshiQuotes: KalshiQuoteMarket[],
  nowMs: number,
): EventMarketSnapshot[] {
  const remaining = [...kalshiQuotes];

  for (const snap of polySnapshots) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i += 1) {
      const k = remaining[i];
      const similarity = jaccard(snap.eventLabel, k.label);
      const overlap = tokenOverlapCount(snap.eventLabel, k.label);

      const minSimilarity = config.RFB5_LIVE_MATCH_MIN_SIMILARITY;
      const weakButAcceptable =
        overlap >= 2 && similarity >= minSimilarity * 0.55;
      if (similarity < minSimilarity && !weakButAcceptable) continue;

      const deltaMs = Math.abs(snap.startTimeMs - k.startTimeMs);
      const maxDeltaMs =
        config.RFB5_LIVE_MATCH_MAX_START_TIME_DELTA_HOURS * 60 * 60 * 1000;

      // Keep timing as a soft penalty so we still match same-fixture markets
      // when venues publish different market close/open conventions.
      const timePenalty =
        deltaMs > maxDeltaMs ? 0.06 : deltaMs / maxDeltaMs / 20;
      const score = similarity + overlap * 0.02 - timePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) continue;
    const k = remaining.splice(bestIdx, 1)[0];

    snap.quotes.push(
      {
        venue: "kalshi",
        chain: "offchain",
        outcome: "YES",
        priceBps: k.yesPriceBps,
        availableUsd: k.availableUsd,
        feeBps: 15,
        slippageBps: 30,
        quoteTimestampMs: nowMs,
      },
      {
        venue: "kalshi",
        chain: "offchain",
        outcome: "NO",
        priceBps: k.noPriceBps,
        availableUsd: k.availableUsd,
        feeBps: 15,
        slippageBps: 30,
        quoteTimestampMs: nowMs,
      },
    );
  }

  if (remaining.length > 0 && config.RFB5_LIVE_KALSHI_UNMATCHED_LIMIT > 0) {
    const limit = Math.min(
      config.RFB5_LIVE_KALSHI_UNMATCHED_LIMIT,
      remaining.length,
    );
    for (let i = 0; i < limit; i += 1) {
      const k = remaining[i];
      polySnapshots.push({
        snapshotId: `kalshi-${k.ticker}`,
        timestampMs: nowMs,
        sport: "sports",
        league: k.league,
        eventKey: k.eventKey,
        eventLabel: k.label,
        startTimeMs: k.startTimeMs,
        marketType: "winner-binary",
        quotes: [
          {
            venue: "kalshi",
            chain: "offchain",
            outcome: "YES",
            priceBps: k.yesPriceBps,
            availableUsd: k.availableUsd,
            feeBps: 15,
            slippageBps: 30,
            quoteTimestampMs: nowMs,
          },
          {
            venue: "kalshi",
            chain: "offchain",
            outcome: "NO",
            priceBps: k.noPriceBps,
            availableUsd: k.availableUsd,
            feeBps: 15,
            slippageBps: 30,
            quoteTimestampMs: nowMs,
          },
        ],
      });
    }
  }

  return polySnapshots;
}

export async function fetchLiveSnapshots(
  nowMs = Date.now(),
): Promise<EventMarketSnapshot[]> {
  const url = `https://gamma-api.polymarket.com/events?limit=${config.RFB5_LIVE_POLYMARKET_EVENTS_LIMIT}&tag_slug=sports&closed=false`;
  const events = await fetchJsonWithRetry<PolymarketEvent[]>(
    url,
    { headers: { accept: "application/json" } },
    { retries: 2 },
  );

  const snapshots: EventMarketSnapshot[] = [];

  for (const event of events) {
    const eventEndMs = Date.parse(event.endDate ?? "");
    if (!Number.isFinite(eventEndMs) || eventEndMs <= nowMs) continue;
    if (event.closed) continue;

    const markets = event.markets ?? [];
    for (const market of markets) {
      if (market.closed) continue;
      if (market.active === false) continue;

      const outcomes = parseJsonArray(market.outcomes);
      const prices = parseJsonArray(market.outcomePrices);
      if (outcomes.length !== prices.length || outcomes.length < 2) continue;

      const yesIndex = outcomes.findIndex(
        (o) => o.trim().toLowerCase() === "yes",
      );
      const noIndex = outcomes.findIndex(
        (o) => o.trim().toLowerCase() === "no",
      );
      if (yesIndex === -1 || noIndex === -1) continue;

      const yesPriceBps = asPriceBps(prices[yesIndex]);
      const noPriceBps = asPriceBps(prices[noIndex]);
      if (yesPriceBps === 0 || noPriceBps === 0) continue;

      const liquidity = Number.isFinite(market.liquidityNum)
        ? Number(market.liquidityNum)
        : Number.isFinite(market.volumeNum)
        ? Number(market.volumeNum)
        : 100;
      const availableUsd = Math.max(5, Math.min(2_000, liquidity * 0.02));

      snapshots.push({
        snapshotId: `poly-${event.slug ?? "event"}-${market.slug ?? "market"}`,
        timestampMs: nowMs,
        sport: "sports",
        league: normalizeLeague(event.tags),
        eventKey: market.slug ?? `${event.slug ?? "event"}-market`,
        eventLabel: market.question ?? event.title ?? market.slug ?? "market",
        startTimeMs: Date.parse(event.startDate ?? "") || nowMs,
        marketType: "winner-binary",
        quotes: [
          {
            venue: "polymarket",
            chain: "polygon",
            outcome: "YES",
            priceBps: yesPriceBps,
            availableUsd,
            feeBps: 20,
            slippageBps: 25,
            quoteTimestampMs: nowMs,
          },
          {
            venue: "polymarket",
            chain: "polygon",
            outcome: "NO",
            priceBps: noPriceBps,
            availableUsd,
            feeBps: 20,
            slippageBps: 25,
            quoteTimestampMs: nowMs,
          },
        ],
      });
    }
  }

  const kalshiQuotes = await fetchKalshiQuotes(nowMs);
  return mergeWithKalshi(snapshots, kalshiQuotes, nowMs);
}
