import Link from "next/link";
import { readWorkerSnapshots } from "@/lib/metrics";
import { isCopyEligible } from "@/lib/eligibility";
import {
  readLatestRfb6Run,
  readRfb6Runs,
  readRfb6VerificationSummary,
} from "@/lib/rfb6-agent";
import { readRfb5OnchainSummary } from "@/lib/rfb5-agent";
import { REGISTERED_AGENTS } from "@/lib/agent-registry";
import { PageHeader } from "../_components/PageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 5;

export default async function DashboardPage() {
  const snapshots = await readWorkerSnapshots();

  if (snapshots.length === 0) {
    return (
      <div className="text-neutral-400 text-sm">
        no settlements yet - run the simulation to populate dashboard data.
      </div>
    );
  }

  const ranked = [...snapshots].sort(
    (a, b) => b.latest.aggregate.meanScore - a.latest.aggregate.meanScore,
  );

  const latestRfb6Run = await readLatestRfb6Run();
  const recentRfb6Runs = await readRfb6Runs(20);
  const rfb6Verification = await readRfb6VerificationSummary(200);
  const rfb5Onchain = await readRfb5OnchainSummary();

  const allocations = latestRfb6Run ? latestRfb6Run.workers : [];

  const allEvents = ranked
    .flatMap((s) => s.events)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

  const recentEvents = allEvents.slice(0, 20);
  const integrityIncidents = allEvents.filter((e) => !e.valid).slice(0, 12);

  const totals = ranked.reduce(
    (acc, s) => {
      const a = s.latest.aggregate;
      acc.totalSettled += a.totalSettled;
      acc.totalSlashed += a.invalidSettled;
      return acc;
    },
    { totalSettled: 0, totalSlashed: 0 },
  );

  const latestByWorker = new Map(ranked.map((row) => [row.worker, row.latest]));

  return (
    <div>
      <PageHeader
        eyebrow="network · operational"
        title="Settlement, integrity, gating - live."
        subtitle="Live view of settlement throughput, integrity incidents, and copy-gating outcomes across all workers in this window."
      />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-10">
        <Stat
          label="registered agents"
          value={String(REGISTERED_AGENTS.length)}
        />
        <Stat label="settled workers" value={String(ranked.length)} />
        <Stat
          label="total settled"
          value={totals.totalSettled.toLocaleString()}
        />
        <Stat
          label="total slashed"
          value={totals.totalSlashed.toLocaleString()}
        />
        <Stat
          label="global slash rate"
          value={`${
            totals.totalSettled === 0
              ? "0.00"
              : ((totals.totalSlashed / totals.totalSettled) * 100).toFixed(2)
          }%`}
        />
        <Stat
          label="rfb6 attested runs"
          value={`${rfb6Verification.valid}/${rfb6Verification.total}`}
        />
        <Stat
          label="active copy set (rfb6)"
          value={String(allocations.filter((row) => row.weightBps > 0).length)}
        />
      </div>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          registered agent roster
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {REGISTERED_AGENTS.map((agent) => {
            const latestMetrics = latestByWorker.get(agent.id);
            const isRfb6 = agent.id === "rfb6";
            const hasRfb6Runs = recentRfb6Runs.length > 0;
            const href = isRfb6
              ? "/agents/rfb6"
              : `/agents/${encodeURIComponent(agent.id)}`;
            let statusLine = "no settlement metrics yet";

            if (isRfb6) {
              statusLine =
                hasRfb6Runs || rfb6Verification.valid > 0
                  ? `attested runs ${rfb6Verification.valid}`
                  : "no attested runs yet";
            } else if (latestMetrics) {
              statusLine = `settled ${
                latestMetrics.aggregate.totalSettled
              } · slash ${(latestMetrics.aggregate.slashRateBps / 100).toFixed(
                2,
              )}%`;
            }

            return (
              <Link
                key={`roster-${agent.id}`}
                href={href}
                className="border border-neutral-800 rounded p-4 bg-neutral-900/30 hover:border-neutral-700 transition-colors"
              >
                <div className="text-[11px] text-accent uppercase tracking-wider font-mono mb-2">
                  {agent.kind}
                </div>
                <div className="text-neutral-100 font-mono mb-2">
                  {agent.id}
                </div>
                <div className="text-[11px] text-neutral-500 font-mono mb-2 break-all">
                  {agent.erc8004Id}
                </div>
                <div className="text-xs text-neutral-400 leading-relaxed mb-3">
                  {agent.summary}
                </div>
                <div className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                  {agent.responsibility}
                </div>
                <div
                  className={
                    statusLine === "no settlement metrics yet"
                      ? "text-[11px] font-mono text-neutral-500"
                      : "text-[11px] font-mono text-neutral-300"
                  }
                >
                  {statusLine}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          rfb5 on-chain execution (today)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 text-xs font-mono">
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
            mode: {rfb5Onchain.dryRun ? "dry-run" : "live"}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
            cap: {(Number(rfb5Onchain.capUsdc6) / 1_000_000).toFixed(2)} usdc
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
            spent: {(Number(rfb5Onchain.spentUsdc6) / 1_000_000).toFixed(2)}{" "}
            usdc
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
            remaining:{" "}
            {(Number(rfb5Onchain.remainingUsdc6) / 1_000_000).toFixed(2)} usdc
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs font-mono">
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30 text-emerald-300">
            submitted: {rfb5Onchain.submitted}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30 text-amber-300">
            skipped: {rfb5Onchain.skipped}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30 text-rose-300">
            errors: {rfb5Onchain.errors}
          </div>
        </div>
        <div className="text-xs text-neutral-500 mb-2">
          day: {rfb5Onchain.day}
          {rfb5Onchain.lastObservedAt
            ? ` · last event ${new Date(
                rfb5Onchain.lastObservedAt,
              ).toLocaleTimeString()}`
            : " · no events yet"}
        </div>
        {rfb5Onchain.topSkipReasons.length === 0 ? (
          <div className="text-xs text-neutral-500">
            no skip reasons recorded for this day.
          </div>
        ) : (
          <div className="text-xs text-neutral-400">
            top skip reasons:{" "}
            {rfb5Onchain.topSkipReasons
              .map((entry) => `${entry.reason} (${entry.count})`)
              .join(", ")}
          </div>
        )}
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          social allocation (rfb 06 + rfb 02 overlay)
        </h2>
        {!latestRfb6Run ? (
          <div className="text-xs text-amber-300 border border-amber-900/60 rounded p-3 bg-amber-950/20 mb-3">
            No verified RFB6 artifact available. Local fallback is disabled.
            Start the signer process with{" "}
            <span className="font-mono">npm run agent:rfb6</span>.
          </div>
        ) : null}
        {latestRfb6Run ? (
          <div className="text-xs text-neutral-500 mb-3">
            source: standalone rfb6 process (verified attestation)
          </div>
        ) : null}
        {!latestRfb6Run ? null : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
                <th className="py-2 pr-4 font-normal">worker</th>
                <th className="py-2 pr-4 font-normal">status</th>
                <th className="py-2 pr-4 font-normal">score</th>
                <th className="py-2 pr-4 font-normal">weight</th>
                <th className="py-2 pr-4 font-normal">recent ev</th>
                <th className="py-2 pr-4 font-normal">rationale</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((row) => (
                <tr
                  key={`alloc-${row.worker}`}
                  className="border-b border-neutral-900 hover:bg-neutral-900/40"
                >
                  <td className="py-3 pr-4">
                    <Link
                      href={`/agents/${encodeURIComponent(row.worker)}`}
                      className="text-neutral-100 underline-offset-2 hover:underline font-mono"
                    >
                      {row.worker}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        row.eligible
                          ? "px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/60 text-emerald-300 text-[11px] font-mono uppercase tracking-wider"
                          : "px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-500 text-[11px] font-mono uppercase tracking-wider"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {row.rawScore.toFixed(3)}
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {(row.weightBps / 100).toFixed(2)}%
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {(row.meanRecentEvBps / 100).toFixed(2)}%
                  </td>
                  <td className="py-3 pr-4 text-neutral-500 text-xs">
                    {row.reasons.join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          rfb6 agent trace stream
        </h2>
        {recentRfb6Runs.length === 0 ? (
          <div className="text-xs text-neutral-500">
            no standalone rfb6 runs yet.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
                <th className="py-2 pr-4 font-normal">time</th>
                <th className="py-2 pr-4 font-normal">run id</th>
                <th className="py-2 pr-4 font-normal">source events</th>
                <th className="py-2 pr-4 font-normal">active workers</th>
              </tr>
            </thead>
            <tbody>
              {[...recentRfb6Runs]
                .reverse()
                .slice(0, 10)
                .map((run) => (
                  <tr key={run.runId} className="border-b border-neutral-900">
                    <td className="py-2 pr-4 text-neutral-500 font-mono tabular">
                      {new Date(run.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 pr-4 text-neutral-200 font-mono">
                      {run.runId.slice(0, 12)}…
                    </td>
                    <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                      {run.sourceEventCount}
                    </td>
                    <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                      {run.workers.filter((w) => w.weightBps > 0).length}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          gating outcomes (full roster)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">worker</th>
              <th className="py-2 pr-4 font-normal">settled</th>
              <th className="py-2 pr-4 font-normal">slash rate</th>
              <th className="py-2 pr-4 font-normal">calibration gap</th>
              <th className="py-2 pr-4 font-normal">samples</th>
              <th className="py-2 pr-4 font-normal">copy</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => {
              const a = s.latest.aggregate;
              const verdict = isCopyEligible(a);
              return (
                <tr
                  key={s.worker}
                  className="border-b border-neutral-900 hover:bg-neutral-900/40"
                >
                  <td className="py-3 pr-4">
                    <Link
                      href={`/agents/${encodeURIComponent(s.worker)}`}
                      className="text-neutral-100 underline-offset-2 hover:underline font-mono"
                    >
                      {s.worker}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {a.totalSettled}
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {(a.slashRateBps / 100).toFixed(2)}%
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {(a.calibration.calibrationGapBps / 100).toFixed(2)}%
                  </td>
                  <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                    {a.calibration.sampleSize}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        verdict.eligible
                          ? "px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-900/60 text-emerald-300 text-[11px] font-mono uppercase tracking-wider"
                          : "px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-500 text-[11px] font-mono uppercase tracking-wider"
                      }
                    >
                      {verdict.eligible ? "eligible" : "gated"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          recent settlements
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">time</th>
              <th className="py-2 pr-4 font-normal">worker</th>
              <th className="py-2 pr-4 font-normal">task</th>
              <th className="py-2 pr-4 font-normal">valid</th>
              <th className="py-2 pr-4 font-normal">confidence</th>
              <th className="py-2 pr-4 font-normal">ev</th>
              <th className="py-2 pr-4 font-normal">reasons</th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.map((e) => (
              <tr
                key={e.taskId + e.timestamp}
                className="border-b border-neutral-900"
              >
                <td className="py-2 pr-4 text-neutral-500 font-mono tabular">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4 text-neutral-200 font-mono">
                  {e.worker}
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
                  {(e.confidenceBps / 100).toFixed(2)}%
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {(e.expectedValueBps / 100).toFixed(2)}%
                </td>
                <td className="py-2 pr-4 text-neutral-500">
                  {e.reasons.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          integrity incidents
        </h2>
        {integrityIncidents.length === 0 ? (
          <div className="text-xs text-neutral-500">
            no integrity incidents in this window.
          </div>
        ) : (
          <ul className="space-y-2 text-xs">
            {integrityIncidents.map((e) => (
              <li
                key={`${e.timestamp}:${e.taskId}`}
                className="border border-neutral-800 rounded p-3 bg-neutral-900/30"
              >
                <div className="text-neutral-300 font-mono">
                  {new Date(e.timestamp).toLocaleString()} · {e.worker} ·{" "}
                  {e.taskId.slice(0, 12)}…
                </div>
                <div className="text-rose-300 mt-1">
                  {e.reasons.join(", ") || "integrity failure"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
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
