import { ethers } from "hardhat";
import { expect } from "chai";

describe("S3ReputationRegistry", function () {
  let owner: any, updater: any, agent: any, usyc: any, registry: any;
  beforeEach(async () => {
    [owner, updater, agent] = await ethers.getSigners();
    const USYC = await ethers.getContractFactory(
      "contracts/mocks/MockERC20.sol:MockERC20",
    );
    usyc = await USYC.deploy("USYC", "USYC", 6);
    await usyc.waitForDeployment();
    const Registry = await ethers.getContractFactory("S3ReputationRegistry");
    registry = await Registry.deploy(owner.address, usyc.getAddress(), 900_000);
    await registry.waitForDeployment();
    await registry.setUpdater(updater.address, true);
    await usyc.mint(agent.address, 1_000_000_000);
  });

  it("updates reputation via updater", async () => {
    await registry.connect(updater).updateReputation(agent.address, 1_000_000);
    // With alpha=900_000, SCALE=1_000_000, R_new = (0*900_000 + 1_000_000*100_000)/1_000_000 = 100_000
    expect(await registry.reputationScore(agent.address)).to.equal(100_000);
  });

  it("reverts if non-updater tries to update", async () => {
    await expect(
      registry.connect(agent).updateReputation(agent.address, 1_000_000),
    ).to.be.revertedWithCustomError(registry, "ReputationUpdaterOnly");
  });
});
