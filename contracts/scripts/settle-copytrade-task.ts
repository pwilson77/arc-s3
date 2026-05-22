import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  getAddress,
} from "ethers";

loadEnv({ path: "/workspace/projects/arc-s3/.env" });
loadEnv({ path: "/workspace/projects/arc-s3/.env.local" });

const courthouseAbi = [
  "function acceptTask(bytes32 taskId) external",
  "function submitTaskResult(bytes32 taskId, bytes32 traceHash, string calldata ipfsURI) external",
  "function settleTask(bytes32 taskId, bool isValid, bytes calldata) external",
  "function tasks(bytes32) view returns (address employer, address worker, uint256 paymentAmount, uint256 bondAmount, bytes32 traceHash, string ipfsURI, uint8 status, address publisher, uint16 publisherFeeBps, uint16 validatorFeeBps)",
  "function usdc() view returns (address)",
  "event TaskSettled(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 slashedBond)",
  "event TaskSettledV2(bytes32 indexed taskId, bool isValid, uint256 workerPayout, uint256 publisherPayout, uint256 validatorPayout, uint256 slashedBond)",
];

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

function pickKeyForWorker(workerAddr: string): string {
  const beta = new Wallet(process.env.BETA_PRIVATE_KEY!).address.toLowerCase();
  const gamma = new Wallet(
    process.env.GAMMA_PRIVATE_KEY!,
  ).address.toLowerCase();
  const w = workerAddr.toLowerCase();
  if (w === beta) return process.env.BETA_PRIVATE_KEY!;
  if (w === gamma) return process.env.GAMMA_PRIVATE_KEY!;
  throw new Error(`worker ${workerAddr} is neither BETA nor GAMMA`);
}

function findFirstSubmittedTaskId(): string {
  const journalPath = resolve(
    __dirname,
    "../../simulation/data/agents/rfb6-copytrade-executor.jsonl",
  );
  if (!existsSync(journalPath))
    throw new Error(`journal not found: ${journalPath}`);
  const lines = readFileSync(journalPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  for (const line of lines) {
    const e = JSON.parse(line);
    if (e.onchain?.status === "submitted" && e.onchain.taskId) {
      return e.onchain.taskId as string;
    }
  }
  throw new Error("no submitted taskId in journal");
}

async function main() {
  const taskId = process.argv[2] ?? findFirstSubmittedTaskId();
  console.log(`taskId=${taskId}`);

  const rpc = process.env.ARC_RPC_URL!;
  const chainId = Number(process.env.ARC_CHAIN_ID!);
  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const courthouseAddr = getAddress(process.env.S3_ESCROW_COURTHOUSE!);

  const ro = new Contract(courthouseAddr, courthouseAbi, provider);
  const task = await ro.tasks(taskId);
  console.log(
    `task: employer=${task[0]} worker=${task[1]} payment=${task[2]} bond=${task[3]} status=${task[6]} publisher=${task[7]} pubFeeBps=${task[8]} valFeeBps=${task[9]}`,
  );

  const usdcAddr = await ro.usdc();
  const workerAddr: string = task[1];
  const bondAmount: bigint = task[3];

  // Worker accepts (needs USDC bond approval + balance).
  if (Number(task[6]) === 1) {
    const workerKey = pickKeyForWorker(workerAddr);
    const worker = new Wallet(workerKey, provider);
    const usdc = new Contract(usdcAddr, erc20Abi, worker);
    const allowance: bigint = await usdc.allowance(
      worker.address,
      courthouseAddr,
    );
    if (allowance < bondAmount) {
      console.log(`approving ${bondAmount} USDC bond from ${worker.address}…`);
      await (await usdc.approve(courthouseAddr, bondAmount * 4n)).wait();
    }
    const cwh = new Contract(courthouseAddr, courthouseAbi, worker);
    console.log(`acceptTask…`);
    await (await cwh.acceptTask(taskId)).wait();
  } else {
    console.log(`status=${task[6]} - skipping accept`);
  }

  // Worker submits result.
  const taskAfterAccept = await ro.tasks(taskId);
  if (Number(taskAfterAccept[6]) === 2) {
    const workerKey = pickKeyForWorker(workerAddr);
    const worker = new Wallet(workerKey, provider);
    const cwh = new Contract(courthouseAddr, courthouseAbi, worker);
    const fakeHash = "0x" + "ab".repeat(32);
    console.log(`submitTaskResult…`);
    await (await cwh.submitTaskResult(taskId, fakeHash, "ipfs://demo")).wait();
  } else {
    console.log(`status=${taskAfterAccept[6]} - skipping submit`);
  }

  // Validator settles.
  const validator = new Wallet(process.env.VALIDATOR_PRIVATE_KEY!, provider);
  const cv = new Contract(courthouseAddr, courthouseAbi, validator);

  const usdcRO = new Contract(usdcAddr, erc20Abi, provider);
  const balBefore = {
    worker: (await usdcRO.balanceOf(workerAddr)) as bigint,
    publisher: (await usdcRO.balanceOf(task[7])) as bigint,
    validator: (await usdcRO.balanceOf(validator.address)) as bigint,
  };
  console.log(
    `balances before: worker=${balBefore.worker} publisher=${balBefore.publisher} validator=${balBefore.validator}`,
  );

  console.log(`settleTask(isValid=true)…`);
  const tx = await cv.settleTask(taskId, true, "0x");
  const receipt = await tx.wait();
  console.log(`settled in block ${receipt.blockNumber} tx=${receipt.hash}`);

  const iface = new Interface(courthouseAbi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (
        parsed &&
        (parsed.name === "TaskSettled" || parsed.name === "TaskSettledV2")
      ) {
        console.log(
          `  ${parsed.name} ${JSON.stringify(
            parsed.args.map((a: unknown) =>
              typeof a === "bigint" ? a.toString() : a,
            ),
          )}`,
        );
      }
    } catch {}
  }

  const balAfter = {
    worker: (await usdcRO.balanceOf(workerAddr)) as bigint,
    publisher: (await usdcRO.balanceOf(task[7])) as bigint,
    validator: (await usdcRO.balanceOf(validator.address)) as bigint,
  };
  console.log(
    `balances after:  worker=${balAfter.worker} publisher=${balAfter.publisher} validator=${balAfter.validator}`,
  );
  console.log(
    `deltas:          worker=+${
      balAfter.worker - balBefore.worker
    } publisher=+${balAfter.publisher - balBefore.publisher} validator=+${
      balAfter.validator - balBefore.validator
    }`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
