import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";

const REQUIRED_VARS = [
  "ARC_RPC_URL",
  "ARC_CHAIN_ID",
  "S3_INTENT_FIREWALL",
  "S3_ESCROW_COURTHOUSE",
  "S3_REPUTATION_REGISTRY",
  "S3_AGENT_IDENTITY_REGISTRY",
  "ALPHA_PRIVATE_KEY",
  "VALIDATOR_PRIVATE_KEY",
];

export function validateEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.error(`\n${RED}${BOLD}Error: Missing .env file!${RESET}`);
    console.error(`${YELLOW}Please copy .env.example to .env and configure all variables first:${RESET}`);
    console.error(`  cp .env.example .env\n`);
    process.exit(1);
  }

  // Load environment variables manually if we are pre-flight
  const envText = readFileSync(envPath, "utf8");
  const loadedVars = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      let value = parts.slice(1).join("=").trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      loadedVars[key] = value;
    }
  }

  const missing = [];
  const placeholder = [];

  for (const key of REQUIRED_VARS) {
    const val = process.env[key] || loadedVars[key];
    if (!val) {
      missing.push(key);
    } else if (
      val.startsWith("0x000000000000000000000000") || 
      val === "0x" || 
      val === "" || 
      val.includes("your-") || 
      val.includes("placeholder")
    ) {
      placeholder.push(key);
    }
  }

  if (missing.length > 0 || placeholder.length > 0) {
    console.error(`\n${RED}${BOLD}Pre-flight Environment Validation Failed!${RESET}`);
    console.error(`${YELLOW}------------------------------------------------------------${RESET}`);
    
    if (missing.length > 0) {
      console.error(`${RED}${BOLD}Missing Required Variables in .env:${RESET}`);
      for (const m of missing) {
        console.error(`  - ${m}`);
      }
    }
    
    if (placeholder.length > 0) {
      console.error(`${YELLOW}${BOLD}Unconfigured Unusable Placeholders in .env:${RESET}`);
      for (const p of placeholder) {
        console.error(`  - ${p}`);
      }
    }

    console.error(`${YELLOW}------------------------------------------------------------${RESET}`);
    console.error(`${YELLOW}Please configure these variables inside your ${BOLD}.env${RESET}${YELLOW} file before proceeding.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}✓ Pre-flight environment check passed successfully.${RESET}`);
}

// If run directly
if (process.argv[1] === import.meta.filename || process.argv[1]?.endsWith("validate-env.mjs")) {
  validateEnv();
}
