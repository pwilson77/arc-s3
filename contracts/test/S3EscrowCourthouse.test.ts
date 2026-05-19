import { ethers } from "hardhat";
import { expect } from "chai";

describe("S3EscrowCourthouse", function () {
  let owner: any,
    employer: any,
    worker: any,
    validator: any,
    usdc: any,
    courthouse: any;
  beforeEach(async () => {
    [owner, employer, worker, validator] = await ethers.getSigners();
    const USDC = await ethers.getContractFactory(
      "contracts/mocks/MockERC20.sol:MockERC20",
    );
    usdc = await USDC.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    const Courthouse = await ethers.getContractFactory("S3EscrowCourthouse");
    courthouse = await Courthouse.deploy(owner.address, usdc.getAddress());
    await courthouse.waitForDeployment();
    await courthouse.setValidator(validator.address, true);
    await usdc.mint(employer.address, 1_000_000_000);
    await usdc.mint(worker.address, 1_000_000_000);
  });

  it("creates and accepts a task", async () => {
    await usdc.connect(employer).approve(courthouse.getAddress(), 1000);
    const tx = await courthouse
      .connect(employer)
      .createTask(worker.address, 1000, 500);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l: any) => {
        try {
          return courthouse.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "TaskCreated");
    expect(event).to.exist;
    const taskId = event.args.taskId;
    await usdc.connect(worker).approve(courthouse.getAddress(), 500);
    await courthouse.connect(worker).acceptTask(taskId);
    const task = await courthouse.tasks(taskId);
    expect(task.status).to.equal(2); // Accepted
  });

  it("reverts if non-validator tries to settle", async () => {
    await expect(
      courthouse.connect(worker).settleTask(ethers.ZeroHash, true, "0x"),
    ).to.be.revertedWithCustomError(courthouse, "EscrowValidatorOnly");
  });
});
