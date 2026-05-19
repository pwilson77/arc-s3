import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../../.env" });
dotenv.config();

const envSchema = z.object({
  RFB6_AGENT_POLL_MS: z.coerce.number().min(1_000).default(10_000),
  RFB6_AGENT_INPUT_FILE: z
    .string()
    .default("./simulation/data/metrics/validator-metrics.jsonl"),
  RFB6_AGENT_OUTPUT_FILE: z
    .string()
    .default("./simulation/data/agents/rfb6-social-intel.jsonl"),
  RFB6_EV_WINDOW: z.coerce.number().min(1).max(200).default(20),
});

export type AppConfig = z.infer<typeof envSchema>;
export const config: AppConfig = envSchema.parse(process.env);
