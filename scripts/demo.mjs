#!/usr/bin/env node
// Single-command demo for arc-s3 marketplace.
//
//   npm run demo                       # one-shot pipeline + autopilot + one seeded task
//   npm run demo -- --clean            # reset autopilot/matcher state files first
//   npm run demo -- --continuous       # also run employer-auto and match all open requests
//   npm run demo -- --no-auto-post     # in continuous mode, drop employer-auto
//   npm run demo -- --no-autopilot     # marketplace only (no accept/submit/settle driver)
//   npm run demo -- --no-seed          # skip the immediate kick-start request
//   npm run demo -- --no-auto-exit     # keep the launcher running after the seeded task settles
//
// All child processes run in the foreground with color-coded labelled logs so
// the entire demo fits on one screen. Ctrl+C tears everything down.
//
// For the "this is what production looks like" beat, run the autopilot under
// pm2 instead: `npm run autopilot:up` and `npm run autopilot:health`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

function loadDotenv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    const [, k, rawVal] = m;
    if (process.env[k]) continue;
    let v = rawVal;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

loadDotenv(resolve(process.cwd(), ".env"));
loadDotenv(resolve(process.cwd(), ".env.local"));

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const GRAY = "\x1b[90m";

const args = new Set(process.argv.slice(2));
const CONTINUOUS = args.has("--continuous");
const NO_AUTO_POST = args.has("--no-auto-post");
const NO_AUTOPILOT = args.has("--no-autopilot");
const NO_SEED = args.has("--no-seed");
const CLEAN = args.has("--clean");
const NO_AUTO_EXIT = args.has("--no-auto-exit");
const AUTO_EXIT = !CONTINUOUS && !NO_AUTO_EXIT;

const REPO = process.cwd();
const STATE_FILES = [
  "simulation/data/agents/rfb6-copytrade-autopilot-state.json",
  "simulation/data/agents/rfb6-copytrade-autopilot-health.json",
  "simulation/data/employer/matcher-state.json",
];

const children = [];
let shuttingDown = false;

function label(name, color) {
  return `${color}[${name}]${RESET}`;
}

function banner(lines) {
  const border = "─".repeat(72);
  console.log(`${GRAY}${border}${RESET}`);
  for (const l of lines) console.log(l);
  console.log(`${GRAY}${border}${RESET}`);
}

let stepNum = 0;
function say(title, body = [], color = CYAN) {
  stepNum += 1;
  const stripe = `${color}▌${RESET}`;
  const head = `${color}${BOLD}step ${stepNum} · ${title}${RESET}`;
  console.log("");
  console.log(`${stripe} ${head}`);
  for (const line of body) console.log(`${stripe} ${GRAY}${line}${RESET}`);
  console.log("");
}

let seededTaskId = null;
let settledHandled = false;
let indexerPinged = false;
function pingIndexer() {
  if (indexerPinged) return;
  indexerPinged = true;
  const base = process.env.UI_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    say(
      "skipping lifecycle indexer ping",
      [
        `set UI_BASE_URL and CRON_SECRET to refresh the prod blob index on settle`,
      ],
      GRAY,
    );
    return;
  }
  const url = `${base.replace(/\/$/, "")}/api/lifecycle/index`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: controller.signal,
  })
    .then((r) => r.text().then((body) => ({ status: r.status, body })))
    .then(({ status, body }) => {
      say(
        "nudged lifecycle indexer",
        [`POST ${url} → ${status}`, body.slice(0, 160)],
        GRAY,
      );
    })
    .catch((err) => {
      say(
        "lifecycle indexer ping failed (non-fatal)",
        [`${err?.message ?? err}`],
        GRAY,
      );
    })
    .finally(() => clearTimeout(timeout));
}
function handleChildLine(name, line) {
  // Milestone narration. We watch the same log lines the agents already emit.
  const m1 =
    /\[matcher\] request=(\S+) employer=(\S+) candidate=(\S+) result=(\{[^}]*\})/.exec(
      line,
    );
  if (m1) {
    try {
      const result = JSON.parse(m1[4]);
      const tx = result?.tasks?.[0]?.txHash ?? "(no tx)";
      const taskId = result?.tasks?.[0]?.taskId ?? null;
      if (taskId && !seededTaskId) seededTaskId = taskId;
      say(
        "matcher published task on-chain",
        [
          `employer ${m1[2]} → candidate ${m1[3]}`,
          `task ${taskId ?? "?"}`,
          `tx    ${tx}`,
          `open  ${uiBase}/network → click the new row`,
        ],
        BLUE,
      );
    } catch {
      // ignore parse failure
    }
    return;
  }
  const m2 = /accepted task=(0x[0-9a-fA-F]+) worker=(\S+)/.exec(line);
  if (m2) {
    if (!seededTaskId) seededTaskId = m2[1];
    say(
      "worker accepted the task",
      [
        `worker ${m2[2]}`,
        `task   ${m2[1]}`,
        `bond escrow now locked alongside the employer payment`,
      ],
      GREEN,
    );
    return;
  }
  const m3 = /submitted task=(0x[0-9a-fA-F]+) trace=(\S+)/.exec(line);
  if (m3) {
    say(
      "worker submitted result + reasoning trace",
      [
        `task  ${m3[1]}`,
        `trace ${m3[2]}`,
        `validator can now release the payment or slash the bond`,
      ],
      YELLOW,
    );
    return;
  }
  const m4 = /settled task=(0x[0-9a-fA-F]+) tx=(\S+) block=(\S+)/.exec(line);
  if (m4) {
    say(
      "validator settled the task",
      [
        `task  ${m4[1]}`,
        `tx    ${m4[2]}  (block ${m4[3]})`,
        `payout split is now visible in the modal → Overview tab`,
      ],
      MAGENTA,
    );
    pingIndexer();
    if (AUTO_EXIT && !settledHandled) {
      settledHandled = true;
      setTimeout(() => {
        banner([
          `${BOLD}${GREEN}demo complete${RESET}`,
          ``,
          `  open ${CYAN}${uiBase}/network${RESET} and click the task to inspect`,
          `  the on-chain tx links, reasoning trace, and payout split.`,
          ``,
          `  ${GRAY}auto-exit fires after settlement. pass --no-auto-exit to keep running.${RESET}`,
        ]);
        shutdown(0);
      }, 5000).unref();
    }
    return;
  }
}

function preflight() {
  const required = [
    "ARC_RPC_URL",
    "ARC_CHAIN_ID",
    "S3_ESCROW_COURTHOUSE",
    "ALPHA_PRIVATE_KEY",
    "BETA_PRIVATE_KEY",
    "GAMMA_PRIVATE_KEY",
    "VALIDATOR_PRIVATE_KEY",
    "PINATA_JWT",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `${label("preflight", RED)} missing env vars: ${missing.join(", ")}`,
    );
    console.error(
      `${label("preflight", RED)} aborting — these usually live in ./.env`,
    );
    process.exit(1);
  }
  if (!NO_AUTO_POST && !process.env.DELTA_PRIVATE_KEY) {
    console.warn(
      `${label(
        "preflight",
        YELLOW,
      )} DELTA_PRIVATE_KEY missing — employer-auto will only post alpha/sports-bet`,
    );
  }
  console.log(`${label("preflight", GREEN)} env ok (${required.length} vars)`);
}

function cleanState() {
  for (const f of STATE_FILES) {
    const full = resolve(REPO, f);
    if (existsSync(full)) {
      unlinkSync(full);
      console.log(`${label("clean", GRAY)} removed ${f}`);
    }
  }
}

function launch(name, color, script, extraArgs = [], envOverride = {}) {
  const child = spawn("npm", ["run", script, "--", ...extraArgs], {
    cwd: REPO,
    env: { ...process.env, ...envOverride },
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.push({ name, child });

  let stdoutTail = "";
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    process.stdout.write(`${label(name, color)} ${text}`);
    stdoutTail += text;
    let idx;
    while ((idx = stdoutTail.indexOf("\n")) !== -1) {
      const line = stdoutTail.slice(0, idx);
      stdoutTail = stdoutTail.slice(idx + 1);
      handleChildLine(name, line);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`${label(name, RED)} ${String(chunk)}`);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
    console.error(`${label("launcher", RED)} ${name} exited (${reason})`);
    shutdown(code ?? 1);
  });
}

function seedRequest() {
  const employer = process.env.DELTA_PRIVATE_KEY ? "delta" : "alpha";
  const kind = employer === "delta" ? "copy-trade" : "sports-bet";
  const budget = process.env.DEMO_SEED_BUDGET_USDC ?? "10";
  const ttl = "1800";
  say(
    `employer ${employer} publishes a ${kind} request`,
    [
      `budget   ${budget} USDC   (escrowed once the matcher picks a worker)`,
      `ttl      ${ttl}s`,
      `signed   on Pinata as category=employer-request`,
      `the matcher (scoped to this requestId) will pick the freshest`,
      `${
        kind === "copy-trade" ? "rfb6 copy-trade" : "rfb5 sports-bet"
      } run and publish a task on-chain.`,
    ],
    BLUE,
  );
  const result = spawnSync(
    "npm",
    [
      "run",
      "employer:post",
      "--",
      "--employer",
      employer,
      "--kind",
      kind,
      "--budget",
      budget,
      "--ttl",
      ttl,
    ],
    { cwd: REPO, env: process.env, encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.warn(
      `${label("seed", YELLOW)} seed request failed (status ${result.status})`,
    );
    return null;
  }
  try {
    const start = result.stdout.indexOf("{");
    const end = result.stdout.lastIndexOf("}");
    const parsed = JSON.parse(result.stdout.slice(start, end + 1));
    if (parsed?.requestId) return String(parsed.requestId);
  } catch {
    // handled below
  }
  console.warn(`${label("seed", YELLOW)} could not parse seed request id`);
  return null;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `${label("launcher", GRAY)} stopping ${children.length} child processes...`,
  );
  for (const { child } of children) {
    if (!child.killed) child.kill("SIGINT");
  }
  setTimeout(() => {
    for (const { child } of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

preflight();
if (CLEAN) cleanState();

const uiBase = process.env.UI_BASE_URL || "http://localhost:3030";
banner([
  `${BOLD}arc-s3 demo${RESET}  ${GRAY}(Ctrl+C to stop)${RESET}`,
  ``,
  `  ${BOLD}watch:${RESET}`,
  `    ${CYAN}${uiBase}/network${RESET}   lifecycle stream + stage funnel`,
  `    ${CYAN}${uiBase}/traces${RESET}    published reasoning traces`,
  `    ${CYAN}${uiBase}/agents${RESET}    per-agent roll-up`,
  ``,
  `  ${BOLD}mode:${RESET} ${
    CONTINUOUS
      ? "continuous matcher + employer-auto"
      : "one-shot seeded request"
  }${AUTO_EXIT ? `  ${GRAY}(auto-exit on settle)${RESET}` : ""}`,
  ``,
  `  ${BOLD}children:${RESET}`,
  `    ${MAGENTA}rfb5${RESET}/${MAGENTA}rfb6${RESET}      candidate publishers (marketplace mode)`,
  CONTINUOUS
    ? `    ${BLUE}matcher${RESET}        matches all open requests, creates on-chain tasks`
    : `    ${BLUE}matcher${RESET}        waits for the seeded request only`,
  `    ${YELLOW}rfb6-exec${RESET}      worker fulfilment helper`,
  NO_AUTOPILOT
    ? `    ${GRAY}rfb6-auto${RESET}      DISABLED (--no-autopilot)`
    : `    ${GREEN}rfb6-auto${RESET}      accept → submit → settle driver`,
  !CONTINUOUS
    ? `    ${GRAY}employer-auto${RESET}  DISABLED (one-shot mode)`
    : NO_AUTO_POST
    ? `    ${GRAY}employer-auto${RESET}  DISABLED (--no-auto-post; post with: npm run employer:post)`
    : `    ${BLUE}employer-auto${RESET}  posts alpha/sports-bet + delta/copy-trade every 60s`,
  ``,
  `  ${BOLD}prod-style autopilot:${RESET} npm run autopilot:up && npm run autopilot:health`,
]);

launch("rfb5", CYAN, "agent:rfb5");
launch("rfb6", MAGENTA, "agent:rfb6");
launch("rfb6-exec", YELLOW, "agent:rfb6:executor");
if (!NO_AUTOPILOT) launch("rfb6-auto", GREEN, "agent:rfb6:autopilot");
if (CONTINUOUS) {
  launch("matcher", BLUE, "employer:matcher");
  if (!NO_AUTO_POST) launch("employer-auto", BLUE, "employer:auto");
}

if (!NO_SEED) {
  // give producers a few seconds to publish a first candidate before we ask
  // the matcher to find one
  setTimeout(() => {
    const requestId = seedRequest();
    if (!CONTINUOUS && requestId) {
      launch("matcher", BLUE, "employer:matcher", [], {
        EMPLOYER_MATCHER_REQUEST_ID: requestId,
      });
    }
  }, 8000).unref();
} else if (!CONTINUOUS) {
  console.warn(
    `${label(
      "launcher",
      YELLOW,
    )} --no-seed without --continuous means no matcher will be started`,
  );
}
