"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type StepResult = {
  name: string;
  code: number | null;
  stdout: string;
  stderr: string;
};

export function CopyTradeRunButton({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    steps: StepResult[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function trigger(mode: "rank" | "executor" | "all") {
    if (!enabled) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/rfb6/copytrade/run?mode=${mode}`, {
        method: "POST",
      });
      const body = (await res.json()) as
        | { ok: boolean; steps: StepResult[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : `http ${res.status}`);
      } else {
        setResult(body);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="border border-neutral-800 rounded p-4 bg-neutral-900/30 space-y-3">
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">
        copy-trade controls
      </div>
      {!enabled ? (
        <p className="text-xs text-amber-400 font-mono">
          UI trigger disabled. Set{" "}
          <span className="text-neutral-300">RFB6_COPYTRADE_UI_TRIGGER=1</span>{" "}
          in the UI env to enable in-browser runs.
        </p>
      ) : (
        <p className="text-xs text-neutral-400 font-mono">
          Pulls live Polymarket leaderboard, signs an allocation artifact, and
          submits per-wallet copy-trade tasks through Arc S3 firewall + escrow
          on chain {process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? ""}.
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={() => trigger("rank")}
          className="px-3 py-1.5 rounded border border-neutral-700 text-neutral-200 hover:border-neutral-500 disabled:opacity-40 text-xs font-mono"
        >
          {busy ? "running…" : "1. rank polymarket"}
        </button>
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={() => trigger("executor")}
          className="px-3 py-1.5 rounded border border-emerald-700 text-emerald-300 hover:border-emerald-500 disabled:opacity-40 text-xs font-mono"
        >
          {busy ? "running…" : "2. submit on-chain"}
        </button>
        <button
          type="button"
          disabled={!enabled || busy}
          onClick={() => trigger("all")}
          className="px-3 py-1.5 rounded border border-sky-700 text-sky-300 hover:border-sky-500 disabled:opacity-40 text-xs font-mono"
        >
          {busy ? "running…" : "rank + submit"}
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-400 font-mono">error: {error}</p>
      )}
      {result && (
        <div className="space-y-2">
          {result.steps.map((s) => (
            <details
              key={s.name}
              className="border border-neutral-800 rounded p-2 bg-neutral-950/40"
              open
            >
              <summary className="cursor-pointer text-xs font-mono">
                <span
                  className={
                    s.code === 0 ? "text-emerald-400" : "text-rose-400"
                  }
                >
                  {s.code === 0 ? "ok" : `exit ${s.code}`}
                </span>{" "}
                <span className="text-neutral-300">{s.name}</span>
              </summary>
              {s.stdout && (
                <pre className="text-[10px] text-neutral-400 mt-2 whitespace-pre-wrap break-all">
                  {s.stdout}
                </pre>
              )}
              {s.stderr && (
                <pre className="text-[10px] text-rose-300 mt-1 whitespace-pre-wrap break-all">
                  {s.stderr}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
