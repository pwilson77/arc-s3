import Link from "next/link";
import { PageHeader } from "../../_components/PageHeader";
import {
  readRfb5RunAudit,
  readRfb5OnchainSummary,
} from "@/lib/rfb5-agent";
import { OpportunitiesTable } from "./OpportunitiesTable";

export const dynamic = "force-dynamic";
export const revalidate = 5;
export const maxDuration = 60;

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

export default async function Rfb5AgentPage({
  searchParams,
}: {
  searchParams?: { run?: string; event?: string };
}) {
  const [audited, onchain] = await Promise.all([
    withTimeout(readRfb5RunAudit(20), 20_000, []),
    withTimeout(readRfb5OnchainSummary(), 20_000, null),
  ]);

  const verifiedRuns = audited
    .filter((entry) => entry.valid)
    .map((entry) => entry.run);
  const summary = {
    total: audited.length,
    valid: verifiedRuns.length,
    invalid: audited.length - verifiedRuns.length,
  };
  const latest = verifiedRuns[verifiedRuns.length - 1] ?? null;
  const recent = [...audited].reverse().slice(0, 20);

  if (!latest) {
    return (
      <div className="text-neutral-400 text-sm">
        no verified rfb5 runs yet — start the agent with{" "}
        <span className="font-mono">npm run agent:rfb5</span>.
      </div>
    );
  }

  const allDecisions = latest.decisions ?? [];
  const profitableCount = latest.summary?.opportunitiesProfitable ?? 0;
  const requestedRunId = searchParams?.run?.trim() ?? "";
  const requestedEvent = searchParams?.event?.trim() ?? "";
  const initialQuery = requestedEvent
    ? requestedEvent.replace(/-/g, " ")
    : "";

  return (
    <div>
      <PageHeader
        eyebrow="agent · rfb5"
        title="Sports prediction-market arbitrage process"
        subtitle="Standalone process stream. Each run scans cross-venue sports quotes, computes net arbitrage edge after costs, and publishes attested execution decisions."
        action={{ href: "/agents", label: "all agents →" }}
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

      {onchain ? (
        <section className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-emerald-300">
            on-chain submitted: {onchain.submitted}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-amber-300">
            skipped: {onchain.skipped}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-rose-300">
            errors: {onchain.errors}
          </div>
          <div className="border border-neutral-800 rounded p-3 bg-neutral-950/40 text-neutral-400">
            mode: {onchain.dryRun ? "dry-run" : "live"}
          </div>
          {onchain.topSkipReasons.length > 0 ? (
            <div className="md:col-span-4 text-neutral-500">
              top skip reasons:{" "}
              {onchain.topSkipReasons
                .map((r) => `${r.reason} (${r.count})`)
                .join(", ")}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          latest opportunities ({latest.summary?.opportunitiesDetected ?? 0} detected
          · {profitableCount} profitable · avg net edge{" "}
          {((latest.summary?.avgNetEdgeBps ?? 0) / 100).toFixed(2)}%)
        </h2>
        {(requestedRunId || requestedEvent) && (
          <div className="mb-3 text-xs text-neutral-400 font-mono border border-neutral-800 rounded p-2 bg-neutral-900/30">
            linked evidence context:
            {requestedRunId ? ` run=${requestedRunId}` : ""}
            {requestedEvent ? ` event=${requestedEvent}` : ""}
            {requestedRunId && requestedRunId !== latest.runId
              ? ` (showing latest run=${latest.runId})`
              : ""}
          </div>
        )}
        <OpportunitiesTable
          decisions={allDecisions}
          runId={latest.runId}
          pageSize={25}
          initialQuery={initialQuery}
        />
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
              <th className="py-2 pr-4 font-normal">detected</th>
              <th className="py-2 pr-4 font-normal">profitable</th>
              <th className="py-2 pr-4 font-normal">avg edge</th>
              <th className="py-2 pr-4 font-normal">total size</th>
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
                  {entry.run.summary?.opportunitiesDetected ?? 0}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {entry.run.summary?.opportunitiesProfitable ?? 0}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  {((entry.run.summary?.avgNetEdgeBps ?? 0) / 100).toFixed(2)}%
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                  ${(entry.run.summary?.totalRecommendedSizeUsd ?? 0).toFixed(2)}
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

      <div className="mt-8 text-xs text-neutral-500">
        <Link href="/dashboard" className="hover:underline">
          view dashboard →
        </Link>
      </div>
    </div>
  );
}
