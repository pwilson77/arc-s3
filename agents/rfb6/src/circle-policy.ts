import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CirclePolicyOptions = {
  enabled: boolean;
  requireStatus: boolean;
  requireLimits: boolean;
  chain: string;
  walletAddress?: string;
  minPerTxUsdc: number;
  minDailyUsdc: number;
};

type CirclePolicySummary = {
  chain: string;
  walletAddress: string;
  statusChecked: boolean;
  limitsChecked: boolean;
};

async function runCircleJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("circle", args, {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function flattenObjects(input: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  function walk(node: unknown): void {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const asObj = node as Record<string, unknown>;
      out.push(asObj);
      for (const value of Object.values(asObj)) walk(value);
    }
  }

  walk(input);
  return out;
}

function extractAddress(input: unknown): string | null {
  for (const obj of flattenObjects(input)) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== "string") continue;
      if (!/^0x[a-fA-F0-9]{40}$/.test(value)) continue;
      const k = key.toLowerCase();
      if (k.includes("address") || k.includes("wallet")) {
        return value;
      }
    }
  }
  return null;
}

function extractNumber(input: unknown, keys: string[]): number | null {
  for (const obj of flattenObjects(input)) {
    for (const [key, value] of Object.entries(obj)) {
      const keyLc = key.toLowerCase();
      if (!keys.some((k) => keyLc.includes(k))) continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function statusLooksValid(input: unknown): boolean {
  for (const obj of flattenObjects(input)) {
    for (const value of Object.values(obj)) {
      if (typeof value !== "string") continue;
      const v = value.toLowerCase();
      if (v === "valid" || v === "ok" || v === "authenticated") return true;
    }
  }
  return false;
}

export async function assertCirclePolicyOrThrow(
  options: CirclePolicyOptions,
): Promise<CirclePolicySummary | null> {
  if (!options.enabled) {
    return null;
  }

  let walletAddress = options.walletAddress?.trim() ?? "";

  if (options.requireStatus) {
    const statusJson = await runCircleJson([
      "wallet",
      "status",
      "--output",
      "json",
    ]);
    if (!statusLooksValid(statusJson)) {
      throw new Error(
        "circle wallet session is not valid; run Circle login/setup first",
      );
    }
  }

  if (!walletAddress) {
    const listJson = await runCircleJson([
      "wallet",
      "list",
      "--chain",
      options.chain,
      "--type",
      "agent",
      "--output",
      "json",
    ]);
    const discovered = extractAddress(listJson);
    if (!discovered) {
      throw new Error(
        `no Circle agent wallet found for chain ${options.chain}`,
      );
    }
    walletAddress = discovered;
  }

  if (options.requireLimits) {
    const limitsJson = await runCircleJson([
      "wallet",
      "limit",
      "--address",
      walletAddress,
      "--chain",
      options.chain,
      "--output",
      "json",
    ]);

    const perTx = extractNumber(limitsJson, ["per", "tx"]);
    const daily = extractNumber(limitsJson, ["daily"]);

    if (
      options.minPerTxUsdc > 0 &&
      (perTx === null || perTx < options.minPerTxUsdc)
    ) {
      throw new Error(
        `circle wallet limit per-tx too low: got=${perTx ?? "n/a"} required>=${
          options.minPerTxUsdc
        }`,
      );
    }
    if (
      options.minDailyUsdc > 0 &&
      (daily === null || daily < options.minDailyUsdc)
    ) {
      throw new Error(
        `circle wallet limit daily too low: got=${daily ?? "n/a"} required>=${
          options.minDailyUsdc
        }`,
      );
    }
  }

  return {
    chain: options.chain,
    walletAddress,
    statusChecked: options.requireStatus,
    limitsChecked: options.requireLimits,
  };
}
