import { PageHeader } from "../../_components/PageHeader";
import { readRfb6Runs } from "@/lib/rfb6-agent";

export const dynamic = "force-dynamic";
export const revalidate = 5;

export default async function Rfb6AgentPage() {
  const runs = await readRfb6Runs(40);
  const latest = runs[runs.length - 1] ?? null;
  const recent = [...runs].reverse().slice(0, 20);

  if (!latest) {
    return (
      <div className="text-neutral-400 text-sm">
        no rfb6 agent runs yet - start the standalone process with <span className="font-mono">npm run agent:rfb6</span>.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="agent · rfb6"
        title="Social trading intelligence process"
        subtitle="Standalone process stream. Each run ingests validator metrics, computes trust-gated allocations, and emits a traceable JSONL event."
      />

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          latest allocation snapshot
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">worker</th>
              <th className="py-2 pr-4 font-normal">status</th>
              <th className="py-2 pr-4 font-normal">weight</th>
              <th className="py-2 pr-4 font-normal">score</th>
              <th className="py-2 pr-4 font-normal">recent ev</th>
              <th className="py-2 pr-4 font-normal">rationale</th>
            </tr>
          </thead>
          <tbody>
            {latest.workers.map((w) => (
              <tr key={`${latest.runId}-${w.worker}`} className="border-b border-neutral-900">
                <td className="py-3 pr-4 text-neutral-100 font-mono">{w.worker}</td>
                <td className="py-3 pr-4 text-neutral-300 font-mono uppercase text-xs">{w.status}</td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">{(w.weightBps / 100).toFixed(2)}%</td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">{w.rawScore.toFixed(3)}</td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">{(w.meanRecentEvBps / 100).toFixed(2)}%</td>
                <td className="py-3 pr-4 text-neutral-500 text-xs">{w.reasons.join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          recent run trace stream
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">time</th>
              <th className="py-2 pr-4 font-normal">run id</th>
              <th className="py-2 pr-4 font-normal">source events</th>
              <th className="py-2 pr-4 font-normal">source latest</th>
              <th className="py-2 pr-4 font-normal">active workers</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((run) => (
              <tr key={run.runId} className="border-b border-neutral-900">
                <td className="py-2 pr-4 text-neutral-500 font-mono tabular">{new Date(run.timestamp).toLocaleTimeString()}</td>
                <td className="py-2 pr-4 text-neutral-200 font-mono">{run.runId.slice(0, 12)}…</td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">{run.sourceEventCount}</td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">{new Date(run.sourceLatestTimestamp).toLocaleTimeString()}</td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {run.workers.filter((w) => w.weightBps > 0).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
