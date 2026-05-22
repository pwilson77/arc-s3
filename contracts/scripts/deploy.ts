import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config({ path: "../.env" });

function required(name: string): string {
  const value = process.env[name];
  if (
    !value ||
    value === "0x" ||
    value === "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}`);

  const permit2 = required("PERMIT2_ADDRESS");
  const usdc = required("USDC_ADDRESS");
  const usyc = required("USYC_ADDRESS");

  const firewallFactory = await ethers.getContractFactory("S3IntentFirewall");
  const firewall = await firewallFactory.deploy(deployer.address, permit2);
  await firewall.waitForDeployment();

  const courthouseFactory = await ethers.getContractFactory(
    "S3EscrowCourthouse",
  );
  const courthouse = await courthouseFactory.deploy(deployer.address, usdc);
  await courthouse.waitForDeployment();

  const registryFactory = await ethers.getContractFactory(
    "S3ReputationRegistry",
  );
  const registry = await registryFactory.deploy(
    deployer.address,
    usyc,
    900_000,
  );
  await registry.waitForDeployment();

  const identityFactory = await ethers.getContractFactory(
    "S3AgentIdentityRegistry",
  );
  const identityRegistry = await identityFactory.deploy(deployer.address);
  await identityRegistry.waitForDeployment();

  console.log("Deployment complete:");
  console.log(`S3_INTENT_FIREWALL=${await firewall.getAddress()}`);
  console.log(`S3_ESCROW_COURTHOUSE=${await courthouse.getAddress()}`);
  console.log(`S3_REPUTATION_REGISTRY=${await registry.getAddress()}`);
  console.log(
    `S3_AGENT_IDENTITY_REGISTRY=${await identityRegistry.getAddress()}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
