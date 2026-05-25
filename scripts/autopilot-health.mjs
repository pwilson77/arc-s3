#!/usr/bin/env node
// Print the autopilot health snapshot in a human-readable form.
// Exits non-zero if the snapshot is stale or contains stuck tasks, so it
// can be wired into a cron/alert.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const HEALTH_PATH = resolve(
  process.cwd(),
  process.env.AUTOPILOT_HEALTH_FILE ??
    "./simulation/data/agents/rfb6-copytrade-autopilot-health.json",
);

const STALE_SEC = Number(process.env.AUTOPILOT_HEALTH_STALE_SEC ?? 120);

if (!existsSync(HEALTH_PATH)) {
  console.error(`[autopilot.health] no snapshot at ${HEALTH_PATH}`);
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(HEALTH_PATH, "utf8"));
const lastTickMs = Date.parse(snapshot.lastTickAt);
const ageSec = Math.round((Date.now() - lastTickMs) / 1000);
const stale = ageSec > STALE_SEC;

const fmtNative = (wei) => {
  if (!wei) return "0";
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
};
const fmtUsdc = (raw) => {
  if (!raw) return "0.00";
  const n = BigInt(raw);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
};

console.log(`autopilot health (${HEALTH_PATH})`);
console.log(`  lastTickAt        ${snapshot.lastTickAt} (${ageSec}s ago)`);
console.log(`  lastScannedBlock  ${snapshot.lastScannedBlock}`);
console.log(`  pendingCount      ${snapshot.pendingCount}`);
console.log(`  stuckTasks        ${snapshot.stuckTasks.length}`);
if (snapshot.lastError) {
  console.log(`  lastError         ${snapshot.lastError}`);
}
console.log("  balances:");
for (const [name, bal] of Object.entries(snapshot.balances ?? {})) {
  console.log(
    `    ${name.padEnd(10)} ${bal.address}  native=${fmtNative(
      bal.nativeWei,
    )} usdc=${fmtUsdc(bal.usdc6)}`,
  );
}
if (snapshot.stuckTasks.length > 0) {
  console.log("  stuck:");
  for (const s of snapshot.stuckTasks) {
    console.log(
      `    ${s.taskId}  ageSec=${s.ageSec}  lastStatus=${s.lastStatus}`,
    );
  }
}

if (stale) {
  console.error(`[autopilot.health] STALE: ${ageSec}s > ${STALE_SEC}s`);
  process.exit(3);
}
if (snapshot.stuckTasks.length > 0) {
  process.exit(4);
}
