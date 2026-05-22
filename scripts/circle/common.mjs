#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCircleJson(args) {
  const { stdout } = await execFileAsync(
    "circle",
    [...args, "--output", "json"],
    {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

export function firstAddress(input) {
  const queue = [input];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) continue;
    if (Array.isArray(cur)) {
      queue.push(...cur);
      continue;
    }
    if (typeof cur === "object") {
      for (const [k, v] of Object.entries(cur)) {
        if (typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v)) {
          const key = k.toLowerCase();
          if (key.includes("address") || key.includes("wallet")) return v;
        }
        queue.push(v);
      }
    }
  }
  return null;
}

export function usage(command) {
  console.error(
    `Usage: node scripts/circle/${command} [--chain BASE] [--address 0x...]`,
  );
}
