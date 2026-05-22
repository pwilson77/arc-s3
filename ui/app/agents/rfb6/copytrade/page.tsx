import { PageHeader } from "../../../_components/PageHeader";
import {
  readCopyTradeAudit,
  readExecutorEvents,
  readActivePositions,
  type CopyTradeWalletEntry,
  type ExecutorIntentEvent,
  type ActivePosition,
} from "@/lib/rfb6-copytrade";
import { CopyTradeRunButton } from "./CopyTradeRunButton";
import { AllocationTableClient } from "./AllocationTableClient";
import { IntentStreamClient } from "./IntentStreamClient";

export const dynamic = "force-dynamic";
export const revalidate = 5;

// Utility functions
function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function tradeAge(ts: number | null): string {
  if (ts === null) return "—";
  const now = Math.floor(Date.now() / 1000);
  const days = Math.max(0, Math.round((now - ts) / 86_400));
  return `${days}d`;
}

export default async function CopyTradePage() {
  const audited = await readCopyTradeAudit(20);
  const latest = audited.filter((a) => a.valid).slice(-1)[0] ?? null;
  const events = await readExecutorEvents(200);

  if (!latest) {
    return (
      <div className="text-neutral-400 text-sm">
        no verified copytrade runs yet — run{" "}
        <span className="font-mono">
          npm run copytrade:rank -w @arc-s3/rfb6-agent
        </span>
        .
      </div>
    );
  }

  const run = latest.run;
  const sortedRaw = [...run.wallets].sort((a, b) => b.weightBps - a.weightBps);
  const wallets = await Promise.all(
    sortedRaw.map(async (w) => {
      const activePositions = await readActivePositions(w.wallet);
      return {
        ...w,
        activePositions,
      };
    }),
  );
  const eligibleCount = wallets.filter((w) => w.weightBps > 0).length;
  const stopCount = wallets.filter((w) => w.stopFollowing).length;
  const totalBps = wallets.reduce((acc, w) => acc + w.weightBps, 0);
  const meanRoi =
    wallets
      .filter((w) => w.eligible)
      .reduce((acc, w) => acc + w.metrics.realizedRoi, 0) /
    Math.max(1, wallets.filter((w) => w.eligible).length);
  const totalAudit = audited.length;
  const validAudit = audited.filter((a) => a.valid).length;

  const eventsForRun = events.filter((e) => e.runId === run.runId);

  return (
    <div>
      <PageHeader
        eyebrow="agent · rfb6 · copytrade"
        title="Polymarket copy-trading intelligence"
        subtitle="RFB6 ranks Polymarket wallets, signs an allocation artifact, and submits per-wallet intents through Arc S3 firewall + escrow."
      />

      <div className="mb-8">
        <CopyTradeRunButton
          enabled={process.env.RFB6_COPYTRADE_UI_TRIGGER === "1"}
        />
      </div>

      <section className="mb-8 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs font-mono">
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          eligible: {eligibleCount}/{wallets.length}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          allocated: {formatBps(totalBps)}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          stop-follow: {stopCount}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          mean roi: {formatPct(meanRoi || 0)}
        </div>
        <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30">
          attested: {validAudit}/{totalAudit}
        </div>
      </section>

      <section className="mb-8 border border-neutral-800 rounded p-4 bg-neutral-900/20 text-xs font-mono space-y-1">
        <div className="text-neutral-500">run</div>
        <div className="text-neutral-200 break-all">{run.runId}</div>
        <div className="text-neutral-500 mt-2">publisher</div>
        <div className="text-neutral-200 break-all">
          {run.publisher.id} · {run.publisher.wallet}
          {typeof run.publisher.feeBps === "number" && (
            <span className="text-neutral-500">
              {" "}
              · declared fee {run.publisher.feeBps} bps
            </span>
          )}
        </div>
        <div className="text-neutral-500 mt-2">source</div>
        <div className="text-neutral-200">
          leaderboard {run.source.leaderboardCategory.toLowerCase()} ·{" "}
          {run.source.leaderboardWindow.toLowerCase()} · sample{" "}
          {run.source.sampledWalletCount}
        </div>
        <div className="text-neutral-500 mt-2">payload hash</div>
        <div className="text-neutral-200 break-all">
          {run.attestation.payloadHash}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          allocation snapshot
        </h2>
        <AllocationTableClient wallets={wallets} />
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          arc s3 intent stream
        </h2>
        {eventsForRun.length === 0 ? (
          <p className="text-neutral-500 text-sm">
            no executor events for this run yet — run{" "}
            <span className="font-mono">
              npm run copytrade:executor -w @arc-s3/rfb6-agent
            </span>
            .
          </p>
        ) : (
          <IntentStreamClient events={eventsForRun} />
        )}
      </section>

      <section>
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          recent runs
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">time</th>
              <th className="py-2 pr-4 font-normal">run</th>
              <th className="py-2 pr-4 font-normal">wallets</th>
              <th className="py-2 pr-4 font-normal">eligible</th>
              <th className="py-2 pr-4 font-normal">stop-follow</th>
              <th className="py-2 pr-4 font-normal">attestation</th>
            </tr>
          </thead>
          <tbody>
            {audited.map((a) => {
              const eligible = a.run.wallets.filter(
                (w) => w.weightBps > 0,
              ).length;
              const stop = a.run.wallets.filter((w) => w.stopFollowing).length;
              return (
                <tr
                  key={a.run.runId}
                  className={`border-b border-neutral-900 ${
                    a.valid ? "" : "opacity-50"
                  }`}
                >
                  <td className="py-2 pr-4 text-neutral-500 font-mono tabular">
                    {new Date(a.run.timestamp * 1000).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-4 text-neutral-200 font-mono">
                    {a.run.runId.slice(0, 20)}…
                  </td>
                  <td className="py-2 pr-4 text-neutral-300 font-mono tabular">
                    {a.run.wallets.length}
                  </td>
                  <td className="py-2 pr-4 text-emerald-400 font-mono tabular">
                    {eligible}
                  </td>
                  <td className="py-2 pr-4 text-rose-400 font-mono tabular">
                    {stop}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {a.valid ? (
                      <span className="text-emerald-400">valid</span>
                    ) : (
                      <span className="text-rose-400" title={a.reason || ""}>
                        invalid: {a.reason?.slice(0, 20)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
