"use client";
import { useState, useMemo } from "react";
import type { ExecutorIntentEvent } from "@/lib/rfb6-copytrade";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ellipsis(text: string, maxLen: number = 24): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function polymarketUrl(wallet: string): string {
  return `https://polymarket.com/user/${wallet.toLowerCase()}`;
}

function intentChip(event: ExecutorIntentEvent) {
  if (event.firewall.decision === "rejected") {
    return (
      <span className="text-rose-400 font-mono text-xs">
        rejected: {event.firewall.reason}
      </span>
    );
  }
  const colors: Record<ExecutorIntentEvent["action"], string> = {
    open: "text-emerald-400",
    resize: "text-sky-400",
    unwind: "text-amber-400",
    skip: "text-neutral-500",
  };
  return (
    <span className={`${colors[event.action]} font-mono text-xs`}>
      {event.action}
    </span>
  );
}

function feeCell(event: ExecutorIntentEvent) {
  const payload = event.intent.payload as Record<string, unknown>;
  const pubFeeBps = Number(payload.publisherFeeBps ?? 0);
  const payment6 = BigInt((payload.paymentUsdc6 as string | undefined) ?? "0");
  if (payment6 === 0n) {
    return <span className="text-neutral-600">—</span>;
  }
  const pubFee6 = (payment6 * BigInt(pubFeeBps)) / 10_000n;
  const pubFeeDisplay = (Number(pubFee6) / 1_000_000).toFixed(4);
  return (
    <span>
      <span className="text-emerald-400">{pubFeeBps} bps</span>
      <span className="text-neutral-500"> · </span>
      <span className="text-neutral-300">{pubFeeDisplay} USDC</span>
    </span>
  );
}

export function IntentStreamClient({
  events,
}: {
  events: ExecutorIntentEvent[];
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<
    "all" | "open" | "resize" | "unwind" | "skip"
  >("all");
  const [firewallFilter, setFirewallFilter] = useState<
    "all" | "approved" | "rejected"
  >("all");

  const itemsPerPage = 10;

  // Apply filters
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (firewallFilter === "approved" && e.firewall.decision !== "approved")
        return false;
      if (firewallFilter === "rejected" && e.firewall.decision !== "rejected")
        return false;
      return true;
    });
  }, [actionFilter, firewallFilter, events]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const paged = filtered.slice(startIdx, startIdx + itemsPerPage);

  return (
    <div className="space-y-4">
      {/* Filter Controls */}
      <div className="border border-neutral-800 rounded p-3 bg-neutral-900/30 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <label className="text-neutral-400 block mb-1">Action</label>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resize">Resize</option>
            <option value="unwind">Unwind</option>
            <option value="skip">Skip</option>
          </select>
        </div>
        <div>
          <label className="text-neutral-400 block mb-1">Firewall</label>
          <select
            value={firewallFilter}
            onChange={(e) => {
              setFirewallFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
          >
            <option value="all">All</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="md:col-span-2 flex items-end">
          <div className="text-neutral-500">
            {filtered.length} of {events.length} events
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">time</th>
              <th className="py-2 pr-4 font-normal">wallet</th>
              <th className="py-2 pr-4 font-normal">action</th>
              <th className="py-2 pr-4 font-normal">weight Δ</th>
              <th className="py-2 pr-4 font-normal">notional Δ</th>
              <th className="py-2 pr-4 font-normal">fees (pub/val)</th>
              <th className="py-2 pr-4 font-normal">firewall</th>
              <th className="py-2 pr-4 font-normal">on-chain</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, idx) => (
              <tr
                key={`${e.runId}-${e.wallet}-${idx}`}
                className="border-b border-neutral-900 align-top hover:bg-neutral-900/30 transition"
              >
                <td className="py-2 pr-4 text-neutral-500 font-mono tabular whitespace-nowrap">
                  {new Date(e.observedAt).toLocaleTimeString()}
                </td>
                <td className="py-2 pr-4 text-neutral-200 font-mono">
                  <a
                    href={polymarketUrl(e.wallet)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-400 hover:underline"
                    title={e.wallet}
                  >
                    {e.userName ? `${ellipsis(e.userName, 12)} · ` : ""}
                    {shortAddr(e.wallet)}
                  </a>
                </td>
                <td className="py-2 pr-4">{intentChip(e)}</td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular whitespace-nowrap">
                  {formatBps(e.fromWeightBps)} → {formatBps(e.toWeightBps)}
                </td>
                <td className="py-2 pr-4 text-neutral-300 font-mono tabular whitespace-nowrap">
                  {e.notionalUsdc >= 0 ? "+" : ""}
                  {e.notionalUsdc.toLocaleString()} USDC
                </td>
                <td className="py-2 pr-4 font-mono text-neutral-300 tabular">
                  {feeCell(e)}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {e.firewall.decision === "approved" ? (
                    <span className="text-emerald-400">approved</span>
                  ) : (
                    <span
                      className="text-rose-400 max-w-xs"
                      title={e.firewall.reason}
                    >
                      {ellipsis(e.firewall.reason, 20)}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 font-mono text-xs max-w-xs">
                  {!e.onchain ? (
                    <span className="text-neutral-600">—</span>
                  ) : e.onchain.status === "submitted" ? (
                    <span className="text-emerald-400">
                      tx {e.onchain.txHash.slice(0, 10)}…
                      {e.onchain.taskId && (
                        <>
                          {" "}
                          <span className="text-neutral-500">
                            task {e.onchain.taskId.slice(0, 10)}…
                          </span>
                        </>
                      )}
                    </span>
                  ) : e.onchain.status === "error" ? (
                    <span className="text-rose-400" title={e.onchain.error}>
                      err: {ellipsis(e.onchain.error, 20)}
                    </span>
                  ) : (
                    <span className="text-neutral-500" title={e.onchain.reason}>
                      skip: {ellipsis(e.onchain.reason, 15)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs font-mono text-neutral-500 p-3 border border-neutral-800 rounded bg-neutral-900/30">
          <div>
            Page {currentPage} of {totalPages} ({filtered.length} results)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-neutral-700 rounded hover:border-neutral-500 disabled:opacity-50"
            >
              ← Prev
            </button>
            <button
              onClick={() =>
                setCurrentPage(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-neutral-700 rounded hover:border-neutral-500 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
