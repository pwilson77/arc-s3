#!/usr/bin/env node
import { parseArgs, runCircleJson } from "./common.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const query =
    args.query ??
    args.q ??
    process.env.CIRCLE_SERVICES_QUERY ??
    "prediction markets";
  const result = await runCircleJson(["services", "search", query]);
  console.log(JSON.stringify({ query, result }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
