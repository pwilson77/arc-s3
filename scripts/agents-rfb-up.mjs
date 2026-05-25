#!/usr/bin/env node
import { spawn } from "node:child_process";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

const children = [];
let shuttingDown = false;

function label(name, color) {
  return `${color}[${name}]${RESET}`;
}

function launch(name, color, script) {
  const child = spawn("npm", ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.push(child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`${label(name, color)} ${String(chunk)}`);
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

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${label("launcher", GRAY)} stopping child processes...`);
  for (const child of children) {
    if (!child.killed) child.kill("SIGINT");
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1200).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`${label("launcher", GRAY)} starting rfb5 + rfb6`);
console.log(`${label("launcher", GRAY)} press Ctrl+C to stop both`);

launch("rfb5", CYAN, "agent:rfb5");
launch("rfb6", MAGENTA, "agent:rfb6");
