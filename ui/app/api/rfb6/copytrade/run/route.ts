import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunResult = {
  name: string;
  code: number | null;
  stdout: string;
  stderr: string;
};

const REPO_ROOT = resolve(process.cwd(), "..");

function execNpm(args: string[], label: string): Promise<RunResult> {
  return new Promise((resolveResult) => {
    const child = spawn("npm", args, { cwd: REPO_ROOT, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) =>
      resolveResult({ name: label, code, stdout, stderr }),
    );
    child.on("error", (err) =>
      resolveResult({
        name: label,
        code: -1,
        stdout,
        stderr: stderr + err.message,
      }),
    );
  });
}

function tail(s: string, lines = 80): string {
  const arr = s.split("\n");
  return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

export async function POST(req: Request) {
  if (process.env.RFB6_COPYTRADE_UI_TRIGGER !== "1") {
    return NextResponse.json(
      {
        error: "ui-trigger disabled; set RFB6_COPYTRADE_UI_TRIGGER=1 in ui env",
      },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "executor";

  const results: RunResult[] = [];
  if (mode === "rank" || mode === "all") {
    results.push(
      await execNpm(
        ["run", "copytrade:rank", "-w", "@arc-s3/rfb6-agent"],
        "copytrade:rank",
      ),
    );
  }
  if (mode === "executor" || mode === "all") {
    results.push(
      await execNpm(
        ["run", "copytrade:executor", "-w", "@arc-s3/rfb6-agent"],
        "copytrade:executor",
      ),
    );
  }

  const ok = results.every((r) => r.code === 0);
  return NextResponse.json({
    ok,
    steps: results.map((r) => ({
      name: r.name,
      code: r.code,
      stdout: tail(r.stdout),
      stderr: tail(r.stderr),
    })),
  });
}
