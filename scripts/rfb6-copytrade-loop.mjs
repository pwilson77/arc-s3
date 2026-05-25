#!/usr/bin/env node

import { spawn } from "node:child_process";

const LOOP_MS = Number.parseInt(process.env.RFB6_COPYTRADE_LOOP_MS ?? "300000", 10);
const ONCE = process.argv.includes("--once");

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function runCycle() {
  const started = new Date().toISOString();
  console.log(`[rfb6.copytrade.loop] cycle-start ${started}`);

  await runStep("npm", ["run", "copytrade:rank", "-w", "@arc-s3/rfb6-agent"]);
  await runStep("npm", ["run", "copytrade:executor", "-w", "@arc-s3/rfb6-agent"]);

  const ended = new Date().toISOString();
  console.log(`[rfb6.copytrade.loop] cycle-complete ${ended}`);
}

async function main() {
  if (!Number.isFinite(LOOP_MS) || LOOP_MS < 15_000) {
    throw new Error("RFB6_COPYTRADE_LOOP_MS must be >= 15000");
  }

  if (ONCE) {
    await runCycle();
    return;
  }

  for (;;) {
    try {
      await runCycle();
    } catch (err) {
      console.error("[rfb6.copytrade.loop] cycle error", err);
    }

    await new Promise((resolve) => setTimeout(resolve, LOOP_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
