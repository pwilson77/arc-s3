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
};
