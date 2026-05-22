#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function main() {
  const tool = process.env.CIRCLE_SKILL_TOOL ?? "codex";

  try {
    const v = await run("circle", ["--version"]);
    if (v.stdout.trim()) {
      console.log(v.stdout.trim());
    }
  } catch {
    console.warn(
      "circle cli missing; install with: npm install -g @circle-fin/cli",
    );
  }

  try {
    await run("circle", ["skill", "install", "--tool", tool]);
    console.log(`circle skills installed for tool=${tool}`);
  } catch (err) {
    console.warn(
      `circle skill install failed, falling back to open skills registry: ${String(
        err,
      )}`,
    );
    await run("npx", ["skills", "add", "circlefin/skills", "-g"]);
    console.log(
      "circle skills installed via npx skills add circlefin/skills -g",
    );
  }

  console.log("next: run npm run circle:status and complete login if needed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
