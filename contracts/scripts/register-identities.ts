import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config({ path: "../.env" });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value === "0x") {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value === "0x") {
    return undefined;
  }
  return value;
}

async function main(): Promise<void> {
  const [owner] = await ethers.getSigners();
  const registryAddress = required("S3_AGENT_IDENTITY_REGISTRY");

  const registry = await ethers.getContractAt(
    "S3AgentIdentityRegistry",
    registryAddress,
    owner,
  );

  const alphaAddress = new ethers.Wallet(required("ALPHA_PRIVATE_KEY")).address;
  const betaAddress = new ethers.Wallet(required("BETA_PRIVATE_KEY")).address;
  const gammaAddress = new ethers.Wallet(required("GAMMA_PRIVATE_KEY")).address;
  const rfb6Address = optional("RFB6_TESTNET_ADDRESS");

  const alphaId = process.env.ALPHA_ERC8004_ID ?? "erc8004:arc:alpha";
  const betaId = process.env.BETA_ERC8004_ID ?? "erc8004:arc:beta";
  const gammaId = process.env.GAMMA_ERC8004_ID ?? "erc8004:arc:gamma";
  const rfb6Id = process.env.RFB6_ERC8004_ID ?? "erc8004:arc:rfb6";

  async function registerIfMissing(id: string, wallet: string): Promise<void> {
    try {
      await registry.resolveWallet(id);
      console.log(`identity already registered: ${id}`);
      return;
    } catch {
      await (await registry.registerAgent(id, wallet, ethers.ZeroHash)).wait();
      console.log(`registered: ${id} -> ${wallet}`);
    }
  }

  await registerIfMissing(alphaId, alphaAddress);
  await registerIfMissing(betaId, betaAddress);
  await registerIfMissing(gammaId, gammaAddress);
  if (rfb6Address) {
    await registerIfMissing(rfb6Id, rfb6Address);
  }

  console.log("Identity registration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
