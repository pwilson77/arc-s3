import Link from "next/link";
import { notFound } from "next/navigation";
import { readWorkerSnapshot } from "@/lib/metrics";
import { isCopyEligible } from "@/lib/eligibility";
import { getRegisteredAgent } from "@/lib/agent-registry";
import { readLatestTracesByTaskId } from "@/lib/traces";
import { readRfb5OnchainSummary } from "@/lib/rfb5-agent";
import { PageHeader } from "../../_components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 5;

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => resolve(fallback), timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } catch {
    return fallback;
  }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 320;
  const height = 60;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-neutral-300"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

export default async function AgentPage({
  params,
}: {
  params: { worker: string };
}) {
  const worker = decodeURIComponent(params.worker);
  const snapshot = await readWorkerSnapshot(worker);
  const registered = getRegisteredAgent(worker);

  if (!snapshot && !registered) {
    notFound();
  }

  if (!snapshot && registered) {
    const onchainTraces = await withTimeout(readLatestTracesByTaskId(), 8000, []);
    const latestTrace = onchainTraces[onchainTraces.length - 1] ?? null;
    const rfb5Summary =
      registered.id === "rfb5"
        ? await withTimeout(readRfb5OnchainSummary(), 8000, null)
        : null;

    return (
      <div>
        <PageHeader
          eyebrow={`${registered.kind} · registered`}
          title={<span className="font-mono">{registered.id}</span>}
          subtitle={registered.summary}
          action={
            registered.id === "rfb6"
              ? {
                  href: "/agents/rfb6/copytrade",
                  label: "view copytrade dashboard →",
                }
              : { href: "/agents", label: "all agents →" }
          }
        />

        <div className="border border-neutral-800 rounded p-5 bg-neutral-900/30 mb-8">
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono mb-3">
            erc-8004 id
          </div>
          <div className="text-xs text-neutral-300 font-mono break-all mb-4">
            {registered.erc8004Id}
          </div>
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono mb-3">
            responsibility
          </div>
          <div className="text-sm text-neutral-300 leading-relaxed">
            {registered.responsibility}
          </div>
        </div>

        <div className="border border-neutral-800 rounded p-5 bg-neutral-900/30">
          <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono mb-2">
            status
          </div>
          <div className="text-sm text-neutral-400 leading-relaxed">
            {registered.id === "rfb6" ? (
              <span>
                As a standalone social-intelligence allocator process, rfb6 has
                a dedicated copy-trading dashboard that displays ranked wallets,
                signed allocations, and active trade intelligence.
              </span>
            ) : (
              <span>
                No settlement metrics yet for this worker. Once validator events
                are written to
                <span className="font-mono"> validator-metrics.jsonl</span>,
                this page will show score history and gating outcomes.
              </span>
            )}
          </div>
          {latestTrace ? (
            <div className="mt-4 border border-neutral-800 rounded p-4 bg-neutral-950/40 text-xs">
              <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono mb-2">
                onchain trace fallback
              </div>
              <div className="text-neutral-300 mb-1">
                Live traces are available via chain/IPFS even though this worker-specific metrics stream is empty in the current runtime.
              </div>
              <div className="text-neutral-500 font-mono break-all mb-2">
                latest task: {latestTrace.taskId}
              </div>
              <Link
                href={`/traces/${encodeURIComponent(latestTrace.taskId)}`}
                className="text-sm text-neutral-200 hover:underline"
              >
                open latest trace →
              </Link>
            </div>
          ) : null}
          {rfb5Summary ? (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
              <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-emerald-300">
                submitted: {rfb5Summary.submitted}
              </div>
              <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-amber-300">
                skipped: {rfb5Summary.skipped}
              </div>
              <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-rose-300">
                errors: {rfb5Summary.errors}
              </div>
              <div className="md:col-span-3 text-neutral-500">
                day: {rfb5Summary.day}
                {rfb5Summary.lastObservedAt
                  ? ` · last event ${new Date(rfb5Summary.lastObservedAt).toLocaleTimeString()}`
                  : " · no events yet"}
              </div>
            </div>
          ) : null}
          <div className="mt-4">
            {registered.id === "rfb6" ? (
              <Link
                href="/agents/rfb6/copytrade"
                className="text-sm text-neutral-200 hover:underline"
              >
                Go to Copytrade Dashboard →
              </Link>
            ) : (
              <Link
                href="/dashboard"
                className="text-sm text-neutral-200 hover:underline"
              >
                view dashboard →
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const liveSnapshot = snapshot;
  if (!liveSnapshot) {
    notFound();
  }

  const a = liveSnapshot.latest.aggregate;
  const verdict = isCopyEligible(a);
  const scores = liveSnapshot.events.map((e) => Number(e.score));
  const recent = [...liveSnapshot.events].reverse().slice(0, 20);

  return (
    <div>
      <PageHeader
        eyebrow={`worker · ${verdict.eligible ? "eligible" : "gated"}`}
        title={<span className="font-mono">{worker}</span>}
        subtitle={
          verdict.eligible
            ? "This worker passes the trust gate. Followers can copy from it."
            : verdict.reasons.length > 0
            ? `Gated: ${verdict.reasons.join(", ")}.`
            : "This worker does not pass the trust gate right now."
        }
        action={{ href: "/agents", label: "all workers →" }}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <Metric label="mean score" value={a.meanScore.toLocaleString()} />
        <Metric
          label="slash rate"
          value={`${(a.slashRateBps / 100).toFixed(2)}%`}
        />
        <Metric
          label="calibration gap"
          value={`${(a.calibration.calibrationGapBps / 100).toFixed(2)}%`}
        />
        <Metric label="samples" value={String(a.calibration.sampleSize)} />
      </div>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-3 uppercase tracking-wider font-mono">
          score history
        </h2>
        <Sparkline values={scores} />
      </section>

      <section>
        <h2 className="text-[11px] text-neutral-500 mb-3 uppercase tracking-wider font-mono">
          recent settlements
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">when</th>
              <th className="py-2 pr-4 font-normal">task</th>
              <th className="py-2 pr-4 font-normal">valid</th>
              <th className="py-2 pr-4 font-normal">score</th>
              <th className="py-2 pr-4 font-normal">conf</th>
              <th className="py-2 pr-4 font-normal">reasons</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e) => (
              <tr
                key={e.taskId + e.timestamp}
                className="border-b border-neutral-900"
              >
                <td className="py-2 pr-4 text-neutral-500 font-mono tabular">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/traces/${encodeURIComponent(e.taskId)}`}
                    className="text-neutral-200 hover:underline font-mono"
                  >
                    {e.taskId.slice(0, 10)}…
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      e.valid
                        ? "text-emerald-400 font-mono"
                        : "text-rose-400 font-mono"
                    }
                  >
                    {e.valid ? "yes" : "no"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {Number(e.score).toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {(e.confidenceBps / 100).toFixed(2)}%
                </td>
                <td className="py-2 pr-4 text-neutral-500">
                  {e.reasons.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-800 rounded p-4 bg-neutral-900/30">
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">
        {label}
      </div>
      <div className="text-2xl text-neutral-50 mt-1 font-mono tabular">
        {value}
      </div>
    </div>
  );
}
