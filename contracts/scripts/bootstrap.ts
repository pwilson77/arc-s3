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

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (
    !value ||
    value === "0x" ||
    value === "0x0000000000000000000000000000000000000000"
  ) {
    return undefined;
  }
  return value;
}

async function main(): Promise<void> {
  const ownerPk = required("ALPHA_PRIVATE_KEY");
  const owner = new ethers.Wallet(ownerPk, ethers.provider);
  const validatorPk = required("VALIDATOR_PRIVATE_KEY");
  const betaPk = required("BETA_PRIVATE_KEY");
  const gammaPk = required("GAMMA_PRIVATE_KEY");

  const validatorAddress = new ethers.Wallet(validatorPk).address;
  const alphaAddress = owner.address;
  const betaAddress = new ethers.Wallet(betaPk).address;
  const gammaAddress = new ethers.Wallet(gammaPk).address;

  const firewallAddr = required("S3_INTENT_FIREWALL");
  const courthouseAddr = required("S3_ESCROW_COURTHOUSE");
  const registryAddr = required("S3_REPUTATION_REGISTRY");
  const identityRegistryAddr = optional("S3_AGENT_IDENTITY_REGISTRY");

  const firewall = await ethers.getContractAt(
    "S3IntentFirewall",
    firewallAddr,
    owner,
  );
  const courthouse = await ethers.getContractAt(
    "S3EscrowCourthouse",
    courthouseAddr,
    owner,
  );
  const registry = await ethers.getContractAt(
    "S3ReputationRegistry",
    registryAddr,
    owner,
  );
  if (identityRegistryAddr) {
    const identityRegistry = await ethers.getContractAt(
      "S3AgentIdentityRegistry",
      identityRegistryAddr,
      owner,
    );

    async function registerIfMissing(
      erc8004Id: string,
      wallet: string,
    ): Promise<void> {
      try {
        await identityRegistry.resolveWallet(erc8004Id);
        console.log(`identity already registered: ${erc8004Id}`);
        return;
      } catch {
        await (
          await identityRegistry.registerAgent(
            erc8004Id,
            wallet,
            ethers.ZeroHash,
          )
        ).wait();
        console.log(`identity registered: ${erc8004Id} -> ${wallet}`);
      }
    }

    const alphaErc8004Id = process.env.ALPHA_ERC8004_ID ?? "erc8004:arc:alpha";
    const betaErc8004Id = process.env.BETA_ERC8004_ID ?? "erc8004:arc:beta";
    const gammaErc8004Id = process.env.GAMMA_ERC8004_ID ?? "erc8004:arc:gamma";

    await registerIfMissing(alphaErc8004Id, alphaAddress);
    await registerIfMissing(betaErc8004Id, betaAddress);
    await registerIfMissing(gammaErc8004Id, gammaAddress);

    const rfb6Address = optional("RFB6_TESTNET_ADDRESS");
    if (rfb6Address) {
      const rfb6Erc8004Id = process.env.RFB6_ERC8004_ID ?? "erc8004:arc:rfb6";
      await registerIfMissing(rfb6Erc8004Id, rfb6Address);
    }
  } else {
    console.log(
      "Skipping identity bootstrap: S3_AGENT_IDENTITY_REGISTRY is unset.",
    );
  }

  await (await firewall.setAgentRegistration(alphaAddress, true)).wait();
  await (await firewall.setAgentRegistration(betaAddress, true)).wait();
  await (await firewall.setAgentRegistration(gammaAddress, true)).wait();
  await (await firewall.setTargetWhitelist(courthouseAddr, true)).wait();
  await (
    await firewall.setAgentPolicy(
      alphaAddress,
      100,
      Number(process.env.DEFAULT_GAS_LIMIT || "800000"),
    )
  ).wait();
  await (
    await firewall.setAgentPolicy(
      betaAddress,
      100,
      Number(process.env.DEFAULT_GAS_LIMIT || "800000"),
    )
  ).wait();
  await (
    await firewall.setAgentPolicy(
      gammaAddress,
      300,
      Number(process.env.DEFAULT_GAS_LIMIT || "800000"),
    )
  ).wait();

  try {
    await (await courthouse.setIntentFirewall(firewallAddr)).wait();
  } catch (error) {
    console.warn(
      "Skipping courthouse firewall binding (setIntentFirewall failed):",
      error,
    );
  }

  await (await courthouse.setValidator(validatorAddress, true)).wait();
  await (await registry.setUpdater(validatorAddress, true)).wait();

  const validatorFeeBpsRaw = process.env.VALIDATOR_FEE_BPS;
  if (validatorFeeBpsRaw) {
    const bps = Number(validatorFeeBpsRaw);
    if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
      throw new Error(
        `VALIDATOR_FEE_BPS out of range (0-5000): ${validatorFeeBpsRaw}`,
      );
    }
    await (await courthouse.setValidatorFeeBps(bps)).wait();
    console.log(`validatorFeeBps=${bps}`);
  }

  console.log("Bootstrap complete:");
  console.log(`owner=${owner.address}`);
  console.log(`validator=${validatorAddress}`);
  console.log(`alpha=${alphaAddress}`);
  console.log(`beta=${betaAddress}`);
  console.log(`gamma=${gammaAddress}`);
  console.log(`identityRegistry=${identityRegistryAddr ?? "(skipped)"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
