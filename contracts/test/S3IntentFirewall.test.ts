import { ethers } from "hardhat";
import { expect } from "chai";

describe("S3IntentFirewall", function () {
  let owner: any, agent: any, target: any, firewall: any;
  beforeEach(async () => {
    [owner, agent, target] = await ethers.getSigners();
    const Firewall = await ethers.getContractFactory("S3IntentFirewall");
    firewall = await Firewall.deploy(owner.address, owner.address);
    await firewall.waitForDeployment();
  });

  it("registers agent and whitelists target", async () => {
    await firewall.setAgentRegistration(agent.address, true);
    await firewall.setTargetWhitelist(target.address, true);
    expect(await firewall.registeredAgent(agent.address)).to.be.true;
    expect(await firewall.whitelistedTarget(target.address)).to.be.true;
  });

  it("reverts if agent not registered", async () => {
    await firewall.setTargetWhitelist(target.address, true);
    await expect(
      firewall
        .connect(agent)
        .executeIntent(
          target.address,
          0,
          0,
          100000,
          Math.floor(Date.now() / 1000) + 1000,
          "0x",
        ),
    ).to.be.revertedWithCustomError(firewall, "FirewallAgentNotRegistered");
  });

  it("reverts if target not whitelisted", async () => {
    await firewall.setAgentRegistration(agent.address, true);
    await expect(
      firewall
        .connect(agent)
        .executeIntent(
          target.address,
          0,
          0,
          100000,
          Math.floor(Date.now() / 1000) + 1000,
          "0x",
        ),
    ).to.be.revertedWithCustomError(firewall, "FirewallTargetNotWhitelisted");
  });
});
