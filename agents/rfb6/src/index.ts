import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { buildWorkerSnapshots, readAllEvents } from "./metrics.js";
import { buildAllocations } from "./scoring.js";
import { appendRun, signatureForRun } from "./store.js";
import type { Rfb6RunEvent } from "./types.js";

async function runOnce(lastSignature: string | null): Promise<string | null> {
  const events = await readAllEvents(config.RFB6_AGENT_INPUT_FILE);
  if (events.length === 0) {
    return lastSignature;
  }

  const snapshots = buildWorkerSnapshots(events);
  if (snapshots.length === 0) {
    return lastSignature;
  }

  const allocations = buildAllocations(snapshots, config.RFB6_EV_WINDOW);
  const sourceLatestTimestamp = events[events.length - 1].timestamp;

  const run: Rfb6RunEvent = {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    sourceMetricsFile: config.RFB6_AGENT_INPUT_FILE,
    sourceEventCount: events.length,
    sourceLatestTimestamp,
    workers: allocations,
  };

  const signature = signatureForRun(run);
  if (signature === lastSignature) {
    return lastSignature;
  }

  await appendRun(config.RFB6_AGENT_OUTPUT_FILE, run);

  const winners = allocations
    .filter((w) => w.weightBps > 0)
    .map((w) => `${w.worker}:${(w.weightBps / 100).toFixed(2)}%`)
    .join(", ");

  console.log(
    `[rfb6-agent] wrote run=${run.runId} workers=${allocations.length} active=${allocations.filter((w) => w.weightBps > 0).length} top=${winners || "none"}`,
  );

  return signature;
}

async function main(): Promise<void> {
  console.log("[rfb6-agent] starting standalone social-intel process");
  console.log(
    `[rfb6-agent] input=${config.RFB6_AGENT_INPUT_FILE} output=${config.RFB6_AGENT_OUTPUT_FILE} pollMs=${config.RFB6_AGENT_POLL_MS}`,
  );

  let lastSignature: string | null = null;

  for (;;) {
    try {
      lastSignature = await runOnce(lastSignature);
    } catch (error) {
      console.error("[rfb6-agent] iteration failed", error);
    }

    await new Promise((resolve) => setTimeout(resolve, config.RFB6_AGENT_POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
