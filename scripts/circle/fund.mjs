#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { firstAddress, parseArgs, runCircleJson } from "./common.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chain = args.chain ?? process.env.CIRCLE_WALLET_CHAIN ?? "BASE";
  const amount = args.amount ?? process.env.CIRCLE_FUND_AMOUNT ?? "10";
  const method = args.method ?? process.env.CIRCLE_FUND_METHOD ?? "crypto";
  const openFlag = args.open ?? process.env.CIRCLE_FUND_OPEN ?? "true";

  const list = await runCircleJson([
    "wallet",
    "list",
    "--chain",
    chain,
    "--type",
    "agent",
  ]);
  const address =
    args.address ?? process.env.CIRCLE_WALLET_ADDRESS ?? firstAddress(list);
  if (!address) {
    throw new Error(`No agent wallet found on chain ${chain}`);
  }

  const cmd = [
    "wallet",
    "fund",
    "--address",
    address,
    "--chain",
    chain,
    "--amount",
    amount,
    "--token",
    "usdc",
    "--method",
    method,
  ];

  if (["1", "true", "yes"].includes(String(openFlag).toLowerCase())) {
    cmd.push("--open");
  } else {
    cmd.push("--no-open");
  }

  const { stdout, stderr } = await execFileAsync("circle", cmd, {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
