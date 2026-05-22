import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const DATA_API = "https://data-api.polymarket.com";

export type LeaderboardCategory =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CRYPTO"
  | "CULTURE"
  | "MENTIONS"
  | "WEATHER"
  | "ECONOMICS"
  | "TECH"
  | "FINANCE";

export type LeaderboardWindow = "DAY" | "WEEK" | "MONTH" | "ALL";

export type LeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
};

export type ActivityEvent = {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type:
    | "TRADE"
    | "SPLIT"
    | "MERGE"
    | "REDEEM"
    | "REWARD"
    | "CONVERSION"
    | "MAKER_REBATE"
    | "REFERRAL_REWARD";
  size: number;
  usdcSize: number;
  transactionHash: string;
  price: number;
  asset: string;
  side?: "BUY" | "SELL";
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
  eventSlug?: string;
};

export type ClosedPosition = {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
};

export type CurrentPosition = ClosedPosition & {
  size: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  percentRealizedPnl: number;
  redeemable?: boolean;
  mergeable?: boolean;
  endDate?: string;
};

export type PolymarketClientOptions = {
  cacheDir: string;
  cacheTtlSec: number;
  userAgent?: string;
};

async function readCache<T>(file: string, ttlSec: number): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { fetchedAt: number; payload: T };
    if (Date.now() / 1000 - parsed.fetchedAt > ttlSec) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

async function writeCache<T>(file: string, payload: T): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      { fetchedAt: Math.floor(Date.now() / 1000), payload },
      null,
      2,
    ),
    "utf8",
  );
}

function cacheKey(parts: Array<string | number>): string {
  return parts
    .map((part) => String(part).replace(/[^a-z0-9-]/gi, "_"))
    .join("__");
}

async function getJson<T>(url: string, userAgent?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`polymarket request failed ${response.status} ${url}`);
  }
  return (await response.json()) as T;
}

export class PolymarketClient {
  constructor(private readonly options: PolymarketClientOptions) {}

  private cacheFile(name: string): string {
    return join(this.options.cacheDir, `${name}.json`);
  }

  async getLeaderboard(
    params: {
      category?: LeaderboardCategory;
      timePeriod?: LeaderboardWindow;
      orderBy?: "PNL" | "VOL";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<LeaderboardEntry[]> {
    const category = params.category ?? "OVERALL";
    const timePeriod = params.timePeriod ?? "MONTH";
    const orderBy = params.orderBy ?? "PNL";
    const limit = params.limit ?? 25;
    const offset = params.offset ?? 0;

    const key = cacheKey([
      "leaderboard",
      category,
      timePeriod,
      orderBy,
      limit,
      offset,
    ]);
    const file = this.cacheFile(key);
    const cached = await readCache<LeaderboardEntry[]>(
      file,
      this.options.cacheTtlSec,
    );
    if (cached) return cached;

    const url = `${DATA_API}/v1/leaderboard?category=${category}&timePeriod=${timePeriod}&orderBy=${orderBy}&limit=${limit}&offset=${offset}`;
    const payload = await getJson<LeaderboardEntry[]>(
      url,
      this.options.userAgent,
    );
    await writeCache(file, payload);
    return payload;
  }

  async getActivity(params: {
    user: string;
    limit?: number;
    offset?: number;
    type?: ActivityEvent["type"][];
    start?: number;
    end?: number;
  }): Promise<ActivityEvent[]> {
    const limit = params.limit ?? 500;
    const offset = params.offset ?? 0;
    const url = new URL(`${DATA_API}/activity`);
    url.searchParams.set("user", params.user);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (params.type && params.type.length > 0) {
      url.searchParams.set("type", params.type.join(","));
    }
    if (typeof params.start === "number")
      url.searchParams.set("start", String(params.start));
    if (typeof params.end === "number")
      url.searchParams.set("end", String(params.end));

    const key = cacheKey([
      "activity",
      params.user,
      limit,
      offset,
      (params.type ?? []).join("-"),
      params.start ?? "",
      params.end ?? "",
    ]);
    const file = this.cacheFile(key);
    const cached = await readCache<ActivityEvent[]>(
      file,
      this.options.cacheTtlSec,
    );
    if (cached) return cached;

    const payload = await getJson<ActivityEvent[]>(
      url.toString(),
      this.options.userAgent,
    );
    await writeCache(file, payload);
    return payload;
  }

  async getClosedPositions(params: {
    user: string;
    limit?: number;
    offset?: number;
  }): Promise<ClosedPosition[]> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const url = `${DATA_API}/closed-positions?user=${params.user}&limit=${limit}&offset=${offset}&sortBy=TIMESTAMP&sortDirection=DESC`;

    const key = cacheKey(["closed-positions", params.user, limit, offset]);
    const file = this.cacheFile(key);
    const cached = await readCache<ClosedPosition[]>(
      file,
      this.options.cacheTtlSec,
    );
    if (cached) return cached;

    const payload = await getJson<ClosedPosition[]>(
      url,
      this.options.userAgent,
    );
    await writeCache(file, payload);
    return payload;
  }

  async getCurrentPositions(params: {
    user: string;
    limit?: number;
    offset?: number;
  }): Promise<CurrentPosition[]> {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const url = `${DATA_API}/positions?user=${params.user}&limit=${limit}&offset=${offset}`;

    const key = cacheKey(["positions", params.user, limit, offset]);
    const file = this.cacheFile(key);
    const cached = await readCache<CurrentPosition[]>(
      file,
      this.options.cacheTtlSec,
    );
    if (cached) return cached;

    const payload = await getJson<CurrentPosition[]>(
      url,
      this.options.userAgent,
    );
    await writeCache(file, payload);
    return payload;
  }
}
