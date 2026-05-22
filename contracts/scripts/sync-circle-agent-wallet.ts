import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config({ path: "../.env" });
dotenv.config({ path: "../.env.local", override: true });

const execFileAsync = promisify(execFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value === "0x") {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function flattenObjects(input: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  function walk(node: unknown): void {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const asObj = node as Record<string, unknown>;
      out.push(asObj);
      for (const value of Object.values(asObj)) walk(value);
    }
  }

  walk(input);
  return out;
}

function extractAddress(input: unknown): string | null {
  for (const obj of flattenObjects(input)) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== "string") continue;
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) continue;
      const keyLc = key.toLowerCase();
      if (keyLc.includes("address") || keyLc.includes("wallet")) {
        return ethers.getAddress(value);
      }
    }
  }
  return null;
}

async function discoverCircleWallet(chain: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "circle",
    ["wallet", "list", "--chain", chain, "--type", "agent", "--output", "json"],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as unknown;
  const address = extractAddress(parsed);
  if (!address) {
    throw new Error(`No Circle agent wallet found on chain ${chain}`);
  }
  return address;
}

async function main(): Promise<void> {
  const [owner] = await ethers.getSigners();
  const registryAddress = required("S3_AGENT_IDENTITY_REGISTRY");

  const erc8004Id =
    process.env.CIRCLE_AGENT_ERC8004_ID ??
    process.env.RFB5_ERC8004_ID ??
    process.env.RFB6_ERC8004_ID ??
    "erc8004:arc:rfb5";

  const chain = process.env.CIRCLE_WALLET_CHAIN ?? "BASE";
  const forcedAddress = process.env.CIRCLE_AGENT_WALLET_ADDRESS;
  const walletAddress = forcedAddress
    ? ethers.getAddress(forcedAddress)
    : await discoverCircleWallet(chain);

  const registry = await ethers.getContractAt(
    "S3AgentIdentityRegistry",
    registryAddress,
    owner,
  );

  try {
    const existing = (await registry.resolveWallet(erc8004Id)) as string;
    const normalizedExisting = ethers.getAddress(existing);
    if (normalizedExisting === walletAddress) {
      console.log(
        `identity already synced: ${erc8004Id} -> ${walletAddress} (chain=${chain})`,
      );
      return;
    }

    throw new Error(
      `identity ${erc8004Id} already points to ${normalizedExisting}; set CIRCLE_AGENT_ERC8004_ID to another id or manually update registry`,
    );
  } catch (err) {
    const msg = (err as Error).message.toLowerCase();
    const missing =
      msg.includes("unregistered") ||
      msg.includes("not found") ||
      msg.includes("missing") ||
      msg.includes("revert");

    if (!missing) {
      throw err;
    }
  }

  await (
    await registry.registerAgent(erc8004Id, walletAddress, ethers.ZeroHash)
  ).wait();
  console.log(
    `identity synced: ${erc8004Id} -> ${walletAddress} (chain=${chain})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
