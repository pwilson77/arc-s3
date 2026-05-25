"use client";

import { useMemo, useState } from "react";
import type { Rfb5Decision } from "@/lib/rfb5-agent";

type Status = "all" | "profitable" | "stale" | "below-edge";

function statusOf(d: Rfb5Decision): Exclude<Status, "all"> {
  if (d.profitable) return "profitable";
  if (d.staleQuote) return "stale";
  return "below-edge";
}

export function OpportunitiesTable({
  decisions,
  runId,
  pageSize = 25,
  initialQuery = "",
}: {
  decisions: Rfb5Decision[];
  runId: string;
  pageSize?: number;
  initialQuery?: string;
}) {
  const [status, setStatus] = useState<Status>("all");
  const [sport, setSport] = useState<string>("all");
  const [minNetEdgePct, setMinNetEdgePct] = useState<string>("");
  const [query, setQuery] = useState<string>(initialQuery);
  const [page, setPage] = useState<number>(1);

  const sports = useMemo(() => {
    const set = new Set<string>();
    for (const d of decisions) set.add(d.sport);
    return ["all", ...Array.from(set).sort()];
  }, [decisions]);

  const filtered = useMemo(() => {
    const minBps =
      minNetEdgePct.trim() === ""
        ? null
        : Math.round(Number(minNetEdgePct) * 100);
    const q = query.trim().toLowerCase();
    return decisions
      .filter((d) => {
        if (status !== "all" && statusOf(d) !== status) return false;
        if (sport !== "all" && d.sport !== sport) return false;
        if (minBps !== null && !Number.isNaN(minBps) && d.netEdgeBps < minBps)
          return false;
        if (q) {
          const hay = `${d.eventLabel} ${d.yesLeg.venue} ${d.noLeg.venue} ${d.sport}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.profitable !== b.profitable) return a.profitable ? -1 : 1;
        return (b.netEdgeBps ?? 0) - (a.netEdgeBps ?? 0);
      });
  }, [decisions, status, sport, minNetEdgePct, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const onFilterChange = () => setPage(1);

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-2 text-xs font-mono">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px]">
            status
          </span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              onFilterChange();
            }}
            className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
          >
            <option value="all">all</option>
            <option value="profitable">profitable</option>
            <option value="stale">stale</option>
            <option value="below-edge">below-edge</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px]">
            sport
          </span>
          <select
            value={sport}
            onChange={(e) => {
              setSport(e.target.value);
              onFilterChange();
            }}
            className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
          >
            {sports.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px]">
            min net edge (%)
          </span>
          <input
            type="number"
            step="0.01"
            value={minNetEdgePct}
            onChange={(e) => {
              setMinNetEdgePct(e.target.value);
              onFilterChange();
            }}
            placeholder="e.g. 0.50"
            className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500 uppercase tracking-wider text-[10px]">
            search event / venue
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onFilterChange();
            }}
            placeholder="Knicks, polymarket, NBA…"
            className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
          />
        </label>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
            <th className="py-2 pr-4 font-normal">event</th>
            <th className="py-2 pr-4 font-normal">YES venue</th>
            <th className="py-2 pr-4 font-normal">NO venue</th>
            <th className="py-2 pr-4 font-normal">gross edge</th>
            <th className="py-2 pr-4 font-normal">costs</th>
            <th className="py-2 pr-4 font-normal">net edge</th>
            <th className="py-2 pr-4 font-normal">size</th>
            <th className="py-2 pr-4 font-normal">status</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-6 text-center text-neutral-500 text-xs">
                no opportunities match the current filters.
              </td>
            </tr>
          ) : (
            pageRows.map((d) => (
              <tr
                key={`${runId}-${d.eventKey}`}
                className="border-b border-neutral-900"
              >
                <td className="py-3 pr-4 text-neutral-200">
                  <div className="text-neutral-100">{d.eventLabel}</div>
                  <div className="text-[11px] text-neutral-500 font-mono uppercase">
                    {d.sport}
                  </div>
                </td>
                <td className="py-3 pr-4 text-neutral-300 font-mono text-xs">
                  {d.yesLeg.venue}
                  <div className="text-neutral-500">
                    {(d.yesLeg.priceBps / 100).toFixed(2)}%
                  </div>
                </td>
                <td className="py-3 pr-4 text-neutral-300 font-mono text-xs">
                  {d.noLeg.venue}
                  <div className="text-neutral-500">
                    {(d.noLeg.priceBps / 100).toFixed(2)}%
                  </div>
                </td>
                <td className="py-3 pr-4 text-neutral-200 font-mono tabular">
                  {(d.grossEdgeBps / 100).toFixed(2)}%
                </td>
                <td className="py-3 pr-4 text-neutral-500 font-mono tabular">
                  {(d.totalCostsBps / 100).toFixed(2)}%
                </td>
                <td
                  className={`py-3 pr-4 font-mono tabular ${
                    d.netEdgeBps > 0 ? "text-emerald-300" : "text-neutral-500"
                  }`}
                >
                  {(d.netEdgeBps / 100).toFixed(2)}%
                </td>
                <td className="py-3 pr-4 text-neutral-300 font-mono tabular">
                  ${(d.recommendedSizeUsd ?? 0).toFixed(2)}
                </td>
                <td className="py-3 pr-4 font-mono uppercase text-xs">
                  {d.profitable ? (
                    <span className="text-emerald-400">profitable</span>
                  ) : d.staleQuote ? (
                    <span className="text-amber-400">stale</span>
                  ) : (
                    <span className="text-neutral-500">below-edge</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-neutral-500">
        <div>
          showing {filtered.length === 0 ? 0 : start + 1}–
          {Math.min(start + pageSize, filtered.length)} of {filtered.length}{" "}
          (filtered from {decisions.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="border border-neutral-800 rounded px-2 py-1 text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-900"
          >
            ← prev
          </button>
          <span className="text-neutral-400">
            page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="border border-neutral-800 rounded px-2 py-1 text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-900"
          >
            next →
          </button>
        </div>
      </div>
    </div>
  );
}
