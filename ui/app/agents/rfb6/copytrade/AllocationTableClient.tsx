"use client";
import { useState, useMemo, Fragment } from "react";
import type {
  CopyTradeWalletEntry,
  ActivePosition,
} from "@/lib/rfb6-copytrade";

export type WalletWithPositions = CopyTradeWalletEntry & {
  activePositions?: ActivePosition[];
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ellipsis(text: string, maxLen: number = 24): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
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

function polymarketUrl(wallet: string, userName: string | null): string {
  // Use username if available, otherwise fall back to wallet address
  if (userName) {
    return `https://polymarket.com/@${userName.toLowerCase()}`;
  }
  // For wallet-only lookups, direct to Polymarket with address in URL
  return `https://polymarket.com/?address=${wallet.toLowerCase()}`;
}

function statusChip(w: CopyTradeWalletEntry) {
  if (w.stopFollowing) {
    return (
      <span className="text-rose-400 font-mono text-xs">stop-following</span>
    );
  }
  if (!w.eligible) {
    return <span className="text-amber-400 font-mono text-xs">ineligible</span>;
  }
  if (w.weightBps > 0) {
    return <span className="text-emerald-400 font-mono text-xs">eligible</span>;
  }
  return (
    <span className="text-neutral-500 font-mono text-xs">unallocated</span>
  );
}

export function AllocationTableClient({
  wallets,
  initialWalletQuery = "",
}: {
  wallets: WalletWithPositions[];
  initialWalletQuery?: string;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "eligible" | "ineligible" | "stop-following"
  >("all");
  const [roiMin, setRoiMin] = useState<number | null>(null);
  const [roiMax, setRoiMax] = useState<number | null>(null);
  const [winMin, setWinMin] = useState<number | null>(null);
  const [activeMax, setActiveMax] = useState<number | null>(null);
  const [walletQuery, setWalletQuery] = useState<string>(initialWalletQuery);
  const [expandedWallets, setExpandedWallets] = useState<
    Record<string, boolean>
  >({});

  const toggleExpand = (wallet: string) => {
    setExpandedWallets((prev) => ({
      ...prev,
      [wallet]: !prev[wallet],
    }));
  };

  const itemsPerPage = 10;

  // Apply filters
  const filtered = useMemo(() => {
    const q = walletQuery.trim().toLowerCase();
    return wallets.filter((w) => {
      if (q) {
        const hay = `${w.wallet} ${w.userName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      // Status filter
      if (statusFilter === "eligible" && (!w.eligible || w.stopFollowing))
        return false;
      if (statusFilter === "ineligible" && w.eligible && !w.stopFollowing)
        return false;
      if (statusFilter === "stop-following" && !w.stopFollowing) return false;

      // ROI filter
      if (roiMin !== null && w.metrics.realizedRoi < roiMin) return false;
      if (roiMax !== null && w.metrics.realizedRoi > roiMax) return false;

      // Win rate filter
      if (winMin !== null && w.metrics.winRate < winMin) return false;

      // Active days filter
      if (activeMax !== null && w.metrics.activeDays > activeMax) return false;

      return true;
    });
  }, [walletQuery, statusFilter, roiMin, roiMax, winMin, activeMax, wallets]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const paged = filtered.slice(startIdx, startIdx + itemsPerPage);

  return (
    <div className="space-y-4">
      {/* Filter Controls */}
      <div className="border border-neutral-800 rounded p-4 bg-neutral-900/30 space-y-4">
        <h3 className="text-xs font-mono text-neutral-500 uppercase">
          Filters
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              Wallet / User
            </label>
            <input
              type="text"
              placeholder="0x..., username"
              value={walletQuery}
              onChange={(e) => {
                setWalletQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            >
              <option value="all">All</option>
              <option value="eligible">Eligible</option>
              <option value="ineligible">Ineligible</option>
              <option value="stop-following">Stop Following</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              ROI Min (%)
            </label>
            <input
              type="number"
              step="1"
              placeholder="—"
              value={roiMin !== null ? (roiMin * 100).toFixed(0) : ""}
              onChange={(e) => {
                setRoiMin(
                  e.target.value ? parseFloat(e.target.value) / 100 : null,
                );
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              ROI Max (%)
            </label>
            <input
              type="number"
              step="1"
              placeholder="—"
              value={roiMax !== null ? (roiMax * 100).toFixed(0) : ""}
              onChange={(e) => {
                setRoiMax(
                  e.target.value ? parseFloat(e.target.value) / 100 : null,
                );
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              Win Rate Min (%)
            </label>
            <input
              type="number"
              step="5"
              placeholder="—"
              value={winMin !== null ? (winMin * 100).toFixed(0) : ""}
              onChange={(e) => {
                setWinMin(
                  e.target.value ? parseFloat(e.target.value) / 100 : null,
                );
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">
              Active Max (days)
            </label>
            <input
              type="number"
              step="1"
              placeholder="—"
              value={activeMax !== null ? activeMax : ""}
              onChange={(e) => {
                setActiveMax(e.target.value ? parseInt(e.target.value) : null);
                setCurrentPage(1);
              }}
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-100"
            />
          </div>
        </div>
        <div className="text-xs text-neutral-500">
          {filtered.length} of {wallets.length} wallets
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">wallet</th>
              <th className="py-2 pr-4 font-normal">status</th>
              <th className="py-2 pr-4 font-normal">weight</th>
              <th className="py-2 pr-4 font-normal">score</th>
              <th className="py-2 pr-4 font-normal text-emerald-400">
                total pnl %
              </th>
              <th className="py-2 pr-4 font-normal">win</th>
              <th className="py-2 pr-4 font-normal">payoff</th>
              <th className="py-2 pr-4 font-normal">drawdown</th>
              <th className="py-2 pr-4 font-normal">trades</th>
              <th className="py-2 pr-4 font-normal">active</th>
              <th className="py-2 pr-4 font-normal">reasons</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((w) => {
              const isExpanded = !!expandedWallets[w.wallet];
              const hasPositions =
                w.activePositions && w.activePositions.length > 0;
              return (
                <Fragment key={w.wallet}>
                  <tr className="border-b border-neutral-900 hover:bg-neutral-900/30 transition">
                    <td className="py-3 pr-4 font-mono text-neutral-100">
                      <div className="flex items-center gap-2">
                        <a
                          href={polymarketUrl(w.wallet, w.userName)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-400 hover:underline"
                          title={`${w.userName ? w.userName + " · " : ""}${
                            w.wallet
                          }`}
                        >
                          {w.userName ? (
                            <span>
                              {ellipsis(w.userName, 16)}{" "}
                              <span className="text-neutral-500">
                                {shortAddr(w.wallet)}
                              </span>
                            </span>
                          ) : (
                            shortAddr(w.wallet)
                          )}
                        </a>
                        {hasPositions && (
                          <button
                            onClick={() => toggleExpand(w.wallet)}
                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider transition ${
                              isExpanded
                                ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800"
                                : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700"
                            }`}
                          >
                            {w.activePositions!.length} active
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4">{statusChip(w)}</td>
                    <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                      {formatBps(w.weightBps)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                      {w.rawScore.toFixed(3)}
                    </td>
                    <td
                      className={`py-3 pr-4 font-mono tabular font-bold ${
                        w.metrics.realizedRoi >= 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }`}
                    >
                      {formatPct(w.metrics.realizedRoi)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                      {formatPct(w.metrics.winRate)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                      {w.metrics.payoffRatio.toFixed(2)}
                    </td>
                    <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                      {formatPct(w.metrics.drawdownShare)}
                    </td>
                    <td
                      className="py-3 pr-4 text-neutral-300 font-mono tabular text-xs"
                      title={`Last trade: ${tradeAge(
                        w.metrics.lastTradeAt,
                      )} ago`}
                    >
                      {w.metrics.totalTrades}{" "}
                      <span className="text-neutral-500 text-[10px]">
                        ({tradeAge(w.metrics.lastTradeAt)})
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-neutral-300 font-mono tabular">
                      {w.metrics.activeDays}d
                    </td>
                    <td className="py-3 pr-4 text-neutral-500 text-xs max-w-xs">
                      <span
                        title={[...w.reasons, ...w.degradationReasons].join(
                          "; ",
                        )}
                      >
                        {ellipsis(
                          [...w.reasons, ...w.degradationReasons].join("; ") ||
                            "—",
                          30,
                        )}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && hasPositions && (
                    <tr className="bg-neutral-950/80 border-b border-neutral-900">
                      <td colSpan={11} className="py-4 px-6 font-mono text-xs">
                        <div className="space-y-3">
                          <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                            Active Polymarket Positions
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {w.activePositions!.map((pos, idx) => (
                              <div
                                key={idx}
                                className="border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900/80 hover:border-neutral-700 p-3 rounded flex justify-between items-center transition"
                              >
                                <div className="flex-1 min-w-0 mr-4">
                                  <a
                                    href={
                                      pos.eventSlug
                                        ? `https://polymarket.com/event/${pos.eventSlug}`
                                        : `https://polymarket.com/market/${pos.slug}`
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-neutral-200 hover:text-blue-400 hover:underline font-semibold block truncate"
                                    title={pos.title}
                                  >
                                    {pos.title}
                                  </a>
                                  <div className="text-[10px] text-neutral-400 mt-1">
                                    Outcome:{" "}
                                    <span className="text-blue-400 font-semibold">
                                      {pos.outcome}
                                    </span>{" "}
                                    · Size:{" "}
                                    {pos.size.toLocaleString(undefined, {
                                      maximumFractionDigits: 1,
                                    })}
                                  </div>
                                </div>
                                <div className="text-right whitespace-nowrap">
                                  <div className="text-emerald-400 font-bold">
                                    $
                                    {pos.currentValue.toLocaleString(
                                      undefined,
                                      {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      },
                                    )}
                                  </div>
                                  <div className="text-[10px] text-neutral-500 mt-0.5">
                                    avg: {(pos.avgPrice * 100).toFixed(0)}¢ ·
                                    cur: {(pos.curPrice * 100).toFixed(0)}¢
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
