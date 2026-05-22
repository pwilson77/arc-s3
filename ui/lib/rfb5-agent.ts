import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

type Rfb5OnchainState = {
  lastRunId: string | null;
  dailyNotionalSpent: {
    day: string;
    usdc6: string;
  };
};

type Rfb5OnchainEvent = {
  observedAt: string;
  onchain:
    | {
        status: "submitted";
        txHash: string;
        blockNumber: number;
        taskId: string | null;
      }
    | { status: "skipped"; reason: string }
    | { status: "error"; error: string };
};

export type Rfb5OnchainSummary = {
  day: string;
  capUsdc6: bigint;
  spentUsdc6: bigint;
  remainingUsdc6: bigint;
  submitted: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  topSkipReasons: Array<{ reason: string; count: number }>;
  lastObservedAt: string | null;
};

function stateFilePath(): string {
  const configured =
    process.env.RFB5_ONCHAIN_STATE_FILE ??
    "../simulation/data/agents/rfb5-sports-arb-executor-state.json";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function outputFilePath(): string {
  const configured =
    process.env.RFB5_ONCHAIN_OUTPUT_FILE ??
    "../simulation/data/agents/rfb5-sports-arb-executor.jsonl";
  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readRfb5OnchainSummary(): Promise<Rfb5OnchainSummary> {
  const capUsdc6 = BigInt(
    process.env.RFB5_ONCHAIN_DAILY_NOTIONAL_CAP_USDC6 ?? "2000000",
  );
  const dryRun = process.env.RFB5_ONCHAIN_DRY_RUN === "true";

  let day = today();
  let spentUsdc6 = 0n;

  const statePath = stateFilePath();
  if (existsSync(statePath)) {
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as Rfb5OnchainState;
      if (parsed?.dailyNotionalSpent?.day) {
        day = parsed.dailyNotionalSpent.day;
      }
      if (parsed?.dailyNotionalSpent?.usdc6) {
        spentUsdc6 = BigInt(parsed.dailyNotionalSpent.usdc6);
      }
    } catch {
      // Keep default summary values if state file is malformed.
    }
  }

  const outputPath = outputFilePath();
  const events: Rfb5OnchainEvent[] = [];

  if (existsSync(outputPath)) {
    const raw = await readFile(outputPath, "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as Rfb5OnchainEvent;
        events.push(parsed);
      } catch {
        // Skip malformed JSONL rows.
      }
    }
  }

  const dayEvents = events.filter(
    (event) => event.observedAt.slice(0, 10) === day,
  );
  const submitted = dayEvents.filter(
    (event) => event.onchain.status === "submitted",
  ).length;
  const skippedEvents = dayEvents.filter(
    (event) => event.onchain.status === "skipped",
  );
  const errors = dayEvents.filter(
    (event) => event.onchain.status === "error",
  ).length;

  const skipReasonCounts = new Map<string, number>();
  for (const event of skippedEvents) {
    const reason = event.onchain.reason;
    skipReasonCounts.set(reason, (skipReasonCounts.get(reason) ?? 0) + 1);
  }

  const topSkipReasons = [...skipReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  const lastObservedAt = dayEvents[dayEvents.length - 1]?.observedAt ?? null;

  return {
    day,
    capUsdc6,
    spentUsdc6,
    remainingUsdc6: spentUsdc6 >= capUsdc6 ? 0n : capUsdc6 - spentUsdc6,
    submitted,
    skipped: skippedEvents.length,
    errors,
    dryRun,
    topSkipReasons,
    lastObservedAt,
  };
}
