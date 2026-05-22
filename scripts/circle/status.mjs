#!/usr/bin/env node
import { firstAddress, parseArgs, runCircleJson } from "./common.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chain = args.chain ?? process.env.CIRCLE_WALLET_CHAIN ?? "BASE";

  const status = await runCircleJson(["wallet", "status"]);
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

  const output = {
    chain,
    walletStatus: status,
    walletAddress: address,
    walletList: list,
    balance: null,
    limits: null,
  };

  if (address) {
    output.balance = await runCircleJson([
      "wallet",
      "balance",
      "--address",
      address,
      "--chain",
      chain,
    ]);
    try {
      output.limits = await runCircleJson([
        "wallet",
        "limit",
        "--address",
        address,
        "--chain",
        chain,
      ]);
    } catch (err) {
      output.limits = {
        warning: "wallet limit lookup failed",
        error: String(err),
      };
    }
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
