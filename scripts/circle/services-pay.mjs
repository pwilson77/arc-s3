#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { firstAddress, parseArgs, runCircleJson, usage } from "./common.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? process.env.CIRCLE_SERVICE_URL;
  if (!url) {
    usage(
      'services-pay.mjs --url <service-url> [--chain BASE] [--data \'{"k":"v"}\']',
    );
    process.exitCode = 2;
    return;
  }

  const chain = args.chain ?? process.env.CIRCLE_WALLET_CHAIN ?? "BASE";
  const payload = args.data ?? process.env.CIRCLE_SERVICE_PAYLOAD ?? "{}";

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

  const inspect = await runCircleJson(["services", "inspect", url]);

  const payArgs = [
    "services",
    "pay",
    url,
    "--address",
    address,
    "--chain",
    chain,
    "--data",
    payload,
  ];

  const { stdout, stderr } = await execFileAsync("circle", payArgs, {
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const out = {
    inspected: inspect,
    paymentStdout: stdout,
    paymentStderr: stderr,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
