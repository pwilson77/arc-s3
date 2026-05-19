import Link from "next/link";
import { notFound } from "next/navigation";
import { findTraceByTaskId } from "@/lib/traces";
import { PageHeader } from "../../_components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 5;

export default async function TracePage({
  params,
}: {
  params: { taskId: string };
}) {
  const taskId = decodeURIComponent(params.taskId);
  const trace = await findTraceByTaskId(taskId);
  if (!trace) notFound();

  const malformed = trace.integrity.malformed;

  return (
    <div>
      <PageHeader
        eyebrow="trace"
        title={<><span className="text-neutral-500">task</span>{" "}<span className="font-mono">{taskId.slice(0, 12)}…</span></>}
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
    </div>
  );
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
      <h2 className="text-[11px] text-neutral-500 mb-3 uppercase tracking-wider font-mono">{title}</h2>
      <div className="border border-neutral-800 rounded p-5 bg-neutral-900/30 space-y-2">
        {children}
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex text-sm">
      <div className="w-40 shrink-0 text-neutral-500 font-mono text-xs uppercase tracking-wider">{k}</div>
      <div className="text-neutral-200 break-all font-mono">{v}</div>
    </div>
  );
}
