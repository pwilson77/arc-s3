import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../.env" });
dotenv.config();

const envSchema = z.object({
  ARC_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  USDC_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_INTENT_FIREWALL: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_ESCROW_COURTHOUSE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  S3_REPUTATION_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ALPHA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  BETA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  GAMMA_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  VALIDATOR_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  DEFAULT_TASK_PAYMENT: z.coerce.bigint().default(1_000_000n),
  DEFAULT_BOND_AMOUNT: z.coerce.bigint().default(250_000n),
  ALPHA_LOOP_MS: z.coerce.number().default(60_000),
  VALIDATOR_POLL_MS: z.coerce.number().default(3_000),
  INTENT_DEFAULT_GAS_LIMIT: z.coerce.number().default(800_000),
  INTENT_DEFAULT_DEADLINE_SECONDS: z.coerce.number().default(120),
  INTENT_QUOTED_SLIPPAGE_BPS: z.coerce.number().min(0).max(10_000).default(50),
  GAMMA_CORRUPTION_BPS: z.coerce.number().min(0).max(10_000).default(1_500),
  PINATA_JWT: z.string().optional(),
  PINATA_NETWORK: z.enum(["public", "private"]).default("public"),
  PINATA_UPLOAD_ENABLED: z.coerce.boolean().default(false),
  PINATA_UPLOAD_STRICT: z.coerce.boolean().default(false),
  IPFS_GATEWAY_BASE_URL: z
    .string()
    .url()
    .default("https://gateway.pinata.cloud/ipfs"),
  TRACE_OUTPUT_DIR: z.string().default("./simulation/data/traces"),
  METRICS_OUTPUT_DIR: z.string().default("./simulation/data/metrics"),
  LIFECYCLE_OUTPUT_DIR: z.string().default("./simulation/data/lifecycle"),
  METRICS_WINDOW_SIZE: z.coerce.number().min(5).max(1_000).default(50),
});

export type AppConfig = z.infer<typeof envSchema>;
export const config: AppConfig = envSchema.parse(process.env);
