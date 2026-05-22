import * as dotenv from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: "../../.env.local", override: true });
dotenv.config({ override: true });

const rfb5KeyFallback =
  process.env.RFB5_TESTNET_PRIVATE_KEY ??
  process.env.RFB6_TESTNET_PRIVATE_KEY ??
  process.env.ALPHA_PRIVATE_KEY ??
  "";

const envSchema = z.object({
  RFB5_AGENT_POLL_MS: z.coerce.number().min(1_000).default(10_000),
  CIRCLE_POLICY_ENFORCE: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  CIRCLE_POLICY_REQUIRE_STATUS: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  CIRCLE_POLICY_REQUIRE_LIMITS: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  CIRCLE_WALLET_CHAIN: z.string().default("BASE"),
  CIRCLE_WALLET_ADDRESS: z.string().default(""),
  CIRCLE_POLICY_MIN_PER_TX_USDC: z.coerce.number().min(0).default(0),
  CIRCLE_POLICY_MIN_DAILY_USDC: z.coerce.number().min(0).default(0),
  RFB5_LIVE_MODE: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  RFB5_LIVE_POLYMARKET_EVENTS_LIMIT: z.coerce
    .number()
    .min(10)
    .max(500)
    .default(120),
  RFB5_LIVE_KALSHI_BASE_URL: z
    .string()
    .url()
    .default("https://api.elections.kalshi.com"),
  RFB5_LIVE_KALSHI_MARKETS_LIMIT: z.coerce
    .number()
    .min(10)
    .max(300)
    .default(80),
  RFB5_LIVE_KALSHI_ORDERBOOK_CACHE_MS: z.coerce
    .number()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  RFB5_LIVE_KALSHI_UNMATCHED_LIMIT: z.coerce
    .number()
    .min(0)
    .max(400)
    .default(100),
  RFB5_LIVE_MATCH_MIN_SIMILARITY: z.coerce
    .number()
    .min(0.1)
    .max(1)
    .default(0.22),
  RFB5_LIVE_MATCH_MAX_START_TIME_DELTA_HOURS: z.coerce
    .number()
    .min(1)
    .max(720)
    .default(240),
  RFB5_AGENT_INPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb5-sports-quotes.jsonl"),
  RFB5_AGENT_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb5-sports-arb.jsonl"),
  RFB5_ERC8004_ID: z.string().default("erc8004:arc:rfb5"),
  RFB5_TESTNET_PRIVATE_KEY: z.string().min(2).default(rfb5KeyFallback),
  RFB5_MIN_NET_EDGE_BPS: z.coerce.number().min(1).max(2_000).default(80),
  RFB5_MIN_LEG_LIQUIDITY_USD: z.coerce.number().min(1).default(25),
  RFB5_MAX_RECOMMENDED_SIZE_USD: z.coerce.number().min(1).default(300),
  RFB5_MAX_QUOTE_AGE_MS: z.coerce.number().min(500).default(10_000),
  RFB5_EXECUTION_RISK_BPS: z.coerce.number().min(0).max(1_000).default(45),
  RFB5_ONCHAIN_EXECUTE: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  RFB5_ONCHAIN_DRY_RUN: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  RFB5_ONCHAIN_MAX_TASKS_PER_RUN: z.coerce.number().min(1).max(20).default(3),
  RFB5_ONCHAIN_SIZE_SCALE: z.coerce.number().min(0.01).max(1).default(0.25),
  RFB5_ONCHAIN_MIN_PAYMENT_USDC6: z.coerce.bigint().default(100_000n),
  RFB5_ONCHAIN_MAX_PAYMENT_USDC6: z.coerce.bigint().default(1_000_000n),
  RFB5_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6: z.coerce.bigint().default(2_000_000n),
  RFB5_ONCHAIN_BOND_BPS: z.coerce.number().min(1).max(10_000).default(2_500),
  RFB5_ONCHAIN_PUBLISHER_FEE_BPS: z.coerce
    .number()
    .min(0)
    .max(5_000)
    .default(1_000),
  RFB5_ONCHAIN_STATE_FILE: z
    .string()
    .default("./simulation/data/agents/rfb5-sports-arb-executor-state.json"),
  RFB5_ONCHAIN_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb5-sports-arb-executor.jsonl"),
  INTENT_DEFAULT_GAS_LIMIT: z.coerce.number().default(800_000),
  INTENT_DEFAULT_DEADLINE_SECONDS: z.coerce.number().default(600),
  INTENT_QUOTED_SLIPPAGE_BPS: z.coerce.number().min(0).max(10_000).default(50),
});

export type AppConfig = z.infer<typeof envSchema>;

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function resolveRepoPath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(repoRoot, pathValue);
}

const parsed = envSchema.parse(process.env);

export const config: AppConfig = {
  ...parsed,
  RFB5_AGENT_INPUT_FILE: resolveRepoPath(parsed.RFB5_AGENT_INPUT_FILE),
  RFB5_AGENT_OUTPUT_FILE: resolveRepoPath(parsed.RFB5_AGENT_OUTPUT_FILE),
  RFB5_ONCHAIN_STATE_FILE: resolveRepoPath(parsed.RFB5_ONCHAIN_STATE_FILE),
  RFB5_ONCHAIN_OUTPUT_FILE: resolveRepoPath(parsed.RFB5_ONCHAIN_OUTPUT_FILE),
};
