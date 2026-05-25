import { PageHeader } from "../../_components/PageHeader";
import {
  readRfb6RunAudit,
  readRfb6VerificationSummary,
} from "@/lib/rfb6-agent";

export const dynamic = "force-dynamic";
export const revalidate = 5;

export default async function Rfb6AgentPage({
  searchParams,
}: {
  searchParams?: { run?: string; worker?: string };
}) {
  const audited = await readRfb6RunAudit(40);
  const summary = await readRfb6VerificationSummary(200);
  const verifiedRuns = audited
    .filter((entry) => entry.valid)
    .map((entry) => entry.run);
  const latest = verifiedRuns[verifiedRuns.length - 1] ?? null;
  const recent = [...audited].reverse().slice(0, 20);
  const requestedRunId = searchParams?.run?.trim() ?? "";
  const workerFilter = searchParams?.worker?.trim().toLowerCase() ?? "";

  if (!latest) {
    return (
      <div className="text-neutral-400 text-sm">
        no verified rfb6 runs yet - start the signer process with{" "}
        <span className="font-mono">npm run agent:rfb6</span>.
      </div>
    );
  }

  const visibleWorkers = workerFilter
    ? latest.workers.filter((w) => w.worker.toLowerCase().includes(workerFilter))
    : latest.workers;

  return (
    <div>
      <PageHeader
        eyebrow="agent · rfb6"
        title="Social trading intelligence process"
        subtitle="Standalone process stream. Each run ingests validator metrics, computes trust-gated allocations, and emits a signed JSONL artifact."
        action={{ href: "/agents/rfb6/copytrade", label: "copytrade →" }}
      />

      <section className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          attested runs: {summary.valid}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          rejected runs: {summary.invalid}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30 break-all">
          publisher: {latest.publisher.erc8004Id}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          latest allocation snapshot
        </h2>
        {(requestedRunId || workerFilter) && (
          <div className="mb-3 text-xs text-neutral-400 font-mono border border-neutral-800 rounded p-2 bg-neutral-900/30">
            linked evidence context:
            {requestedRunId ? ` run=${requestedRunId}` : ""}
            {workerFilter ? ` worker=${workerFilter}` : ""}
            {requestedRunId && requestedRunId !== latest.runId
              ? ` (showing latest run=${latest.runId})`
              : ""}
          </div>
        )}
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
            {visibleWorkers.map((w) => (
              <tr
                key={`${latest.runId}-${w.worker}`}
                className="border-b border-neutral-900"
              >
                <td className="py-3 pr-4 text-neutral-100 font-mono">
                  {w.worker}
                </td>
                <td className="py-3 pr-4 text-neutral-300 font-mono uppercase text-xs">
                  {w.status}
                </td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                  {(w.weightBps / 100).toFixed(2)}%
                </td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                  {w.rawScore.toFixed(3)}
                </td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                  {(w.meanRecentEvBps / 100).toFixed(2)}%
                </td>
                <td className="py-3 pr-4 text-neutral-500 text-xs">
                  {w.reasons.join("; ") || "—"}
                </td>
              </tr>
            ))}
            {visibleWorkers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-neutral-500 text-xs">
                  no workers match the linked evidence filter.
                </td>
              </tr>
            )}
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
              <th className="py-2 pr-4 font-normal">attestation</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((entry) => (
              <tr key={entry.run.runId} className="border-b border-neutral-900">
                <td className="py-2 pr-4 text-neutral-500 font-mono tabular">
                  {new Date(entry.run.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4 text-neutral-200 font-mono">
                  {entry.run.runId.slice(0, 12)}…
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {entry.run.sourceEventCount}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {new Date(
                    entry.run.sourceLatestTimestamp,
                  ).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {entry.run.workers.filter((w) => w.weightBps > 0).length}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {entry.valid ? (
                    <span className="text-emerald-400">valid</span>
                  ) : (
                    <span className="text-rose-400">
                      invalid: {entry.reason ?? "unknown"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
