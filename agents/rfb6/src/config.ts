import * as dotenv from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: "../../.env.local", override: true });
dotenv.config({ override: true });

const envSchema = z.object({
  RFB6_AGENT_POLL_MS: z.coerce.number().min(1_000).default(10_000),
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
  RFB6_AGENT_INPUT_FILE: z
    .string()
    .default("./simulation/data/metrics/validator-metrics.jsonl"),
  RFB6_AGENT_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-social-intel.jsonl"),
  RFB6_BACKTEST_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-backtest.json"),
  RFB6_EV_WINDOW: z.coerce.number().min(1).max(200).default(20),
  RFB6_BACKTEST_MIN_HISTORY: z.coerce.number().min(1).max(1_000).default(10),
  RFB6_ERC8004_ID: z.string().default("erc8004:arc:rfb6"),
  RFB6_TESTNET_PRIVATE_KEY: z.string().min(2),
  RFB6_PUBLISHER_FEE_BPS: z.coerce.number().min(0).max(5_000).default(1_000),
  PINATA_JWT: z.string().optional(),
  PINATA_NETWORK: z.enum(["public", "private"]).default("public"),
  PINATA_UPLOAD_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  RFB6_LOCAL_MIRROR: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  RFB6_ONCHAIN_EXECUTE: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(false),
  RFB6_ONCHAIN_DRY_RUN: z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean"
        ? v
        : ["1", "true", "yes"].includes(v.toLowerCase()),
    )
    .default(true),
  RFB6_ONCHAIN_MAX_TASKS_PER_RUN: z.coerce.number().min(1).max(20).default(3),
  RFB6_ONCHAIN_NOTIONAL_PER_BP_USD: z.coerce
    .number()
    .min(0.0001)
    .default(0.01),
  RFB6_ONCHAIN_SIZE_SCALE: z.coerce.number().min(0.01).max(1).default(1),
  RFB6_ONCHAIN_MIN_PAYMENT_USDC6: z.coerce.bigint().default(100_000n),
  RFB6_ONCHAIN_MAX_PAYMENT_USDC6: z.coerce.bigint().default(1_000_000n),
  RFB6_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6: z.coerce.bigint().default(2_000_000n),
  RFB6_ONCHAIN_BOND_BPS: z.coerce.number().min(1).max(10_000).default(2_500),
  RFB6_ONCHAIN_PUBLISHER_FEE_BPS: z.coerce
    .number()
    .min(0)
    .max(5_000)
    .default(1_000),
  RFB6_ONCHAIN_STATE_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-social-intel-executor-state.json"),
  RFB6_ONCHAIN_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-social-intel-executor.jsonl"),
  INTENT_DEFAULT_GAS_LIMIT: z.coerce.number().default(800_000),
  INTENT_DEFAULT_DEADLINE_SECONDS: z.coerce.number().default(600),
  INTENT_QUOTED_SLIPPAGE_BPS: z.coerce.number().min(0).max(10_000).default(50),
});

export type AppConfig = z.infer<typeof envSchema>;

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function resolveRepoPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(repoRoot, filePath);
}

const parsed = envSchema.parse(process.env);

export const config: AppConfig = {
  ...parsed,
  RFB6_AGENT_INPUT_FILE: resolveRepoPath(parsed.RFB6_AGENT_INPUT_FILE),
  RFB6_AGENT_OUTPUT_FILE: resolveRepoPath(parsed.RFB6_AGENT_OUTPUT_FILE),
  RFB6_BACKTEST_OUTPUT_FILE: resolveRepoPath(parsed.RFB6_BACKTEST_OUTPUT_FILE),
  RFB6_ONCHAIN_STATE_FILE: resolveRepoPath(parsed.RFB6_ONCHAIN_STATE_FILE),
  RFB6_ONCHAIN_OUTPUT_FILE: resolveRepoPath(parsed.RFB6_ONCHAIN_OUTPUT_FILE),
};
