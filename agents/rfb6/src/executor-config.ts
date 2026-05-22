import * as dotenv from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: "../../.env" });
dotenv.config({ path: "../../.env.local", override: true });
dotenv.config({ override: true });

const envSchema = z.object({
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
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
  USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_INTENT_FIREWALL: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_ESCROW_COURTHOUSE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ALPHA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  BETA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  GAMMA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  DEFAULT_TASK_PAYMENT: z.coerce.bigint().default(1_000_000n),
  DEFAULT_BOND_AMOUNT: z.coerce.bigint().default(250_000n),
  INTENT_DEFAULT_GAS_LIMIT: z.coerce.number().default(800_000),
  INTENT_DEFAULT_DEADLINE_SECONDS: z.coerce.number().default(120),
  INTENT_QUOTED_SLIPPAGE_BPS: z.coerce.number().min(0).max(10_000).default(50),
  RFB6_ERC8004_ID: z.string().default("erc8004:arc:rfb6"),
  RFB6_AGENT_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-social-intel.jsonl"),
  RFB6_EXECUTOR_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-executor.jsonl"),
  RFB6_EXECUTOR_STATE_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-executor-state.json"),
  RFB6_EXECUTOR_POLL_MS: z.coerce.number().min(1_000).default(10_000),
  RFB6_EXECUTOR_MIN_WEIGHT_BPS: z.coerce
    .number()
    .min(1)
    .max(10_000)
    .default(100),
});

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function resolveRepoPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(repoRoot, filePath);
}

const parsed = envSchema.parse(process.env);

export const executorConfig = {
  ...parsed,
  RFB6_AGENT_OUTPUT_FILE: resolveRepoPath(parsed.RFB6_AGENT_OUTPUT_FILE),
  RFB6_EXECUTOR_OUTPUT_FILE: resolveRepoPath(parsed.RFB6_EXECUTOR_OUTPUT_FILE),
  RFB6_EXECUTOR_STATE_FILE: resolveRepoPath(parsed.RFB6_EXECUTOR_STATE_FILE),
};
