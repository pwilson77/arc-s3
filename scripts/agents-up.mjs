#!/usr/bin/env node
import { spawn } from "node:child_process";

const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

const children = [];
let shuttingDown = false;

function prefix(label, color) {
  return `${color}[${label}]${RESET}`;
}

function launch(name, color, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.push(child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`${prefix(name, color)} ${String(chunk)}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`${prefix(name, RED)} ${String(chunk)}`);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
    console.error(`${prefix("launcher", RED)} ${name} exited (${reason}).`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${prefix("launcher", GRAY)} stopping child processes...`);

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1200).unref();

  setTimeout(() => process.exit(exitCode), 100).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(
  `${prefix(
    "launcher",
    GRAY,
  )} starting Alpha/Beta/Gamma simulation + RFB6 signer + executor + on-chain autopilot + RFB5 arb`,
);
console.log(`${prefix("launcher", GRAY)} press Ctrl+C to stop all processes`);

launch("sim", BLUE, "npm", ["run", "sim"]);
launch("rfb6", GREEN, "npm", ["run", "agent:rfb6"]);
launch("rfb6-x", GREEN, "npm", ["run", "agent:rfb6:executor"]);
launch("rfb6-auto", GREEN, "npm", ["run", "agent:rfb6:autopilot"]);
launch("rfb5", GREEN, "npm", ["run", "agent:rfb5"]);
