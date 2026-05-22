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

  describe("fee splits (V2)", function () {
    let firewall: any,
      publisher: any,
      employerEoa: any,
      workerEoa: any,
      validatorEoa: any;
    const PAYMENT = 1_000_000n; // 1 USDC (6dp)
    const BOND = 250_000n;
    const PUB_FEE_BPS = 1000; // 10%
    const VAL_FEE_BPS = 100; // 1%

    beforeEach(async () => {
      const signers = await ethers.getSigners();
      [, , , , firewall, publisher, employerEoa, workerEoa, validatorEoa] =
        signers;
      await courthouse.setIntentFirewall(firewall.address);
      await courthouse.setValidator(validatorEoa.address, true);
      await courthouse.setValidatorFeeBps(VAL_FEE_BPS);
      await usdc.mint(employerEoa.address, 10_000_000n);
      await usdc.mint(workerEoa.address, 10_000_000n);
      await usdc
        .connect(employerEoa)
        .approve(courthouse.getAddress(), 10_000_000n);
      await usdc
        .connect(workerEoa)
        .approve(courthouse.getAddress(), 10_000_000n);
    });

    async function createV2(): Promise<string> {
      const tx = await courthouse
        .connect(firewall)
        .forwardCreateTaskV2(
          employerEoa.address,
          workerEoa.address,
          publisher.address,
          PAYMENT,
          BOND,
          PUB_FEE_BPS,
        );
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l: any) => {
          try {
            return courthouse.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "TaskCreated");
      return ev.args.taskId;
    }

    async function acceptAndSubmit(taskId: string): Promise<void> {
      await courthouse
        .connect(firewall)
        .forwardAcceptTask(workerEoa.address, taskId);
      await courthouse
        .connect(firewall)
        .forwardSubmitTaskResult(
          workerEoa.address,
          taskId,
          ethers.keccak256(ethers.toUtf8Bytes("trace")),
          "ipfs://x",
        );
    }

    it("snapshots fees on Task and pays publisher + validator on valid settle", async () => {
      const taskId = await createV2();
      const stored = await courthouse.tasks(taskId);
      expect(stored.publisher).to.equal(publisher.address);
      expect(stored.publisherFeeBps).to.equal(PUB_FEE_BPS);
      expect(stored.validatorFeeBps).to.equal(VAL_FEE_BPS);

      await acceptAndSubmit(taskId);

      const beforePub = await usdc.balanceOf(publisher.address);
      const beforeVal = await usdc.balanceOf(validatorEoa.address);
      const beforeWorker = await usdc.balanceOf(workerEoa.address);
      const tx = await courthouse
        .connect(validatorEoa)
        .settleTask(taskId, true, "0x");
      const receipt = await tx.wait();

      const settled = receipt.logs
        .map((l: any) => {
          try {
            return courthouse.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "TaskSettledV2");
      expect(settled).to.exist;

      const pubFee = (PAYMENT * BigInt(PUB_FEE_BPS)) / 10_000n;
      const valFee = (PAYMENT * BigInt(VAL_FEE_BPS)) / 10_000n;
      const workerPayout = PAYMENT - pubFee - valFee + BOND;

      expect(settled.args.workerPayout).to.equal(workerPayout);
      expect(settled.args.publisherPayout).to.equal(pubFee);
      expect(settled.args.validatorPayout).to.equal(valFee);
      expect(settled.args.slashedBond).to.equal(0n);

      expect((await usdc.balanceOf(publisher.address)) - beforePub).to.equal(
        pubFee,
      );
      expect((await usdc.balanceOf(validatorEoa.address)) - beforeVal).to.equal(
        valFee,
      );
      expect((await usdc.balanceOf(workerEoa.address)) - beforeWorker).to.equal(
        workerPayout,
      );
    });

    it("ignores fees on invalid settle and refunds employer (payment + slashed bond)", async () => {
      const taskId = await createV2();
      await acceptAndSubmit(taskId);

      const beforeEmployer = await usdc.balanceOf(employerEoa.address);
      const beforePub = await usdc.balanceOf(publisher.address);
      const beforeVal = await usdc.balanceOf(validatorEoa.address);

      const tx = await courthouse
        .connect(validatorEoa)
        .settleTask(taskId, false, "0x");
      const receipt = await tx.wait();
      const settled = receipt.logs
        .map((l: any) => {
          try {
            return courthouse.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "TaskSettledV2");

      expect(settled.args.publisherPayout).to.equal(0n);
      expect(settled.args.validatorPayout).to.equal(0n);
      expect(settled.args.slashedBond).to.equal(BOND);
      expect(
        (await usdc.balanceOf(employerEoa.address)) - beforeEmployer,
      ).to.equal(PAYMENT + BOND);
      expect(await usdc.balanceOf(publisher.address)).to.equal(beforePub);
      expect(await usdc.balanceOf(validatorEoa.address)).to.equal(beforeVal);
    });

    it("reverts when publisherFeeBps + validatorFeeBps exceeds MAX_TOTAL_FEE_BPS", async () => {
      await courthouse.setValidatorFeeBps(4500);
      await expect(
        courthouse.connect(firewall).forwardCreateTaskV2(
          employerEoa.address,
          workerEoa.address,
          publisher.address,
          PAYMENT,
          BOND,
          600, // 4500 + 600 = 5100 > 5000
        ),
      ).to.be.revertedWithCustomError(courthouse, "EscrowFeeTooHigh");
    });

    it("reverts when publisher=0 but publisherFeeBps>0", async () => {
      await expect(
        courthouse
          .connect(firewall)
          .forwardCreateTaskV2(
            employerEoa.address,
            workerEoa.address,
            ethers.ZeroAddress,
            PAYMENT,
            BOND,
            500,
          ),
      ).to.be.revertedWithCustomError(courthouse, "EscrowInvalidAddress");
    });

    it("legacy forwardCreateTask still works (no publisher, fees=validatorFeeBps snapshot only)", async () => {
      const tx = await courthouse
        .connect(firewall)
        .forwardCreateTask(
          employerEoa.address,
          workerEoa.address,
          PAYMENT,
          BOND,
        );
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l: any) => {
          try {
            return courthouse.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e && e.name === "TaskCreated");
      const taskId = ev.args.taskId;
      const stored = await courthouse.tasks(taskId);
      expect(stored.publisher).to.equal(ethers.ZeroAddress);
      expect(stored.publisherFeeBps).to.equal(0);
      expect(stored.validatorFeeBps).to.equal(VAL_FEE_BPS);

      await acceptAndSubmit(taskId);
      const beforeVal = await usdc.balanceOf(validatorEoa.address);
      await courthouse.connect(validatorEoa).settleTask(taskId, true, "0x");
      const valFee = (PAYMENT * BigInt(VAL_FEE_BPS)) / 10_000n;
      expect((await usdc.balanceOf(validatorEoa.address)) - beforeVal).to.equal(
        valFee,
      );
    });

    it("setValidatorFeeBps rejects > MAX_TOTAL_FEE_BPS", async () => {
      await expect(
        courthouse.setValidatorFeeBps(5001),
      ).to.be.revertedWithCustomError(courthouse, "EscrowFeeTooHigh");
    });
  });
});
