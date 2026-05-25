import Link from "next/link";
import { notFound } from "next/navigation";
import { findTraceByTaskId } from "@/lib/traces";
import { readLifecycleEvents } from "@/lib/lifecycle";
import { PageHeader } from "../../_components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 5;

const ARC_EXPLORER_BASE_URL = (
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app"
).replace(/\/$/, "");

export default async function TracePage({
  params,
}: {
  params: { taskId: string };
}) {
  const taskId = decodeURIComponent(params.taskId);
  const [trace, lifecycleEvents] = await Promise.all([
    findTraceByTaskId(taskId),
    readLifecycleEvents(),
  ]);
  if (!trace) notFound();

  const malformed = trace.integrity.malformed;
  const taskLifecycleEvents = lifecycleEvents
    .filter((event) => event.taskId === taskId)
    .sort((a, b) => a.blockNumber - b.blockNumber);

  return (
    <div>
      <PageHeader
        eyebrow="trace"
        title={
          <>
            <span className="text-neutral-500">task</span>{" "}
            <span className="font-mono">{taskId.slice(0, 12)}…</span>
          </>
        }
        subtitle={
          <>
            worker{" "}
            <Link
              href={`/agents/${encodeURIComponent(trace.worker)}`}
              className="text-neutral-200 underline-offset-4 hover:underline"
            >
              {trace.worker}
            </Link>{" "}
            · schema {trace.schemaVersion} ·{" "}
            {new Date(trace.timestamp).toLocaleString()}
          </>
        }
      />

      {malformed && (
        <div className="mb-6 text-xs text-rose-300 border border-rose-900 rounded p-3 bg-rose-950/30">
          integrity flag: malformed
          {trace.integrity.corruptionReason
            ? ` (${trace.integrity.corruptionReason})`
            : ""}
        </div>
      )}

      <Section title="decision">
        <KV k="market" v={trace.decision.marketType} />
        <KV k="action" v={trace.decision.action} />
        <KV k="notional (USD)" v={String(trace.decision.notionalUsd)} />
        <KV
          k="confidence"
          v={`${(trace.decision.confidenceBps / 100).toFixed(2)}%`}
        />
        <KV
          k="EV"
          v={`${(trace.decision.expectedValueBps / 100).toFixed(2)}%`}
        />
        <KV k="horizon" v={`${trace.decision.timeHorizonSec}s`} />
        <KV
          k="resolver"
          v={`${trace.decision.resolver.kind}:${trace.decision.resolver.reference}`}
        />
      </Section>

      <Section title="plan">
        {trace.plan.length === 0 ? (
          <div className="text-neutral-500 text-sm">— empty —</div>
        ) : (
          <ol className="list-decimal list-inside text-sm text-neutral-300 space-y-1">
            {trace.plan.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="result">
        <KV k="success" v={String(trace.result.success)} />
        <KV k="outputHash" v={trace.result.outputHash} />
        <KV k="details" v={trace.result.details} />
      </Section>

      <Section title="blockchain transactions">
        {taskLifecycleEvents.length === 0 ? (
          <div className="text-neutral-500 text-sm">
            No lifecycle transaction receipts are available for this task yet.
          </div>
        ) : (
          <div className="space-y-2">
            {taskLifecycleEvents.map((event) => (
              <div
                key={`${event.stage}:${event.txHash}`}
                className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-2 text-sm"
              >
                <div className="text-neutral-500 font-mono text-xs uppercase tracking-wider">
                  {event.stage}
                </div>
                <div className="min-w-0">
                  <a
                    href={`${ARC_EXPLORER_BASE_URL}/tx/${event.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-neutral-100 hover:underline break-all"
                  >
                    {formatHash(event.txHash)}
                  </a>
                  <div className="text-xs text-neutral-500">
                    {event.blockTimestamp
                      ? new Date(event.blockTimestamp).toLocaleString()
                      : "—"}
                  </div>
                </div>
                <a
                  href={`${ARC_EXPLORER_BASE_URL}/block/${event.blockNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-neutral-400 hover:text-neutral-200 hover:underline font-mono"
                >
                  block {event.blockNumber}
                </a>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function formatHash(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 14)}…${value.slice(-8)}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-[11px] text-neutral-500 mb-3 uppercase tracking-wider font-mono">
        {title}
      </h2>
      <div className="border border-neutral-800 rounded p-5 bg-neutral-900/30 space-y-2">
        {children}
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex text-sm">
      <div className="w-40 shrink-0 text-neutral-500 font-mono text-xs uppercase tracking-wider">
        {k}
      </div>
      <div className="text-neutral-200 break-all font-mono">{v}</div>
    </div>
  );
}
