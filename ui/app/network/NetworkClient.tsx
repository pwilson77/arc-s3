"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../_components/PageHeader";
import { Modal } from "../_components/Modal";
import { type ReasoningTrace } from "@/lib/traces";
import { type MetricsEvent } from "@/lib/metrics";
import { type LifecycleEvent } from "@/lib/lifecycle";

// Utility functions (copy from page.tsx)
function shorten(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function formatUsdc6(value?: string): string {
  if (!value) return "$0.00";
  try {
    const raw = BigInt(value);
    const whole = raw / 1_000_000n;
    const fractional = raw % 1_000_000n;
    if (raw === 0n) return "$0.00";
    if (whole === 0n) {
      return `$0.${fractional.toString().padStart(6, "0").replace(/0+$/, "")}`;
    }
    const n = Number(raw) / 1_000_000;
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : `$${whole.toString()}`;
  } catch {
    return "$0.00";
  }
}
const ARC_EXPLORER_BASE_URL = (
  process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app"
).replace(/\/$/, "");

type LifecycleTx = {
  stage: string;
  timestamp: string | null;
  txHash: string | null;
  blockNumber: number | null;
};

function txExplorerHref(txHash: string): string {
  return `${ARC_EXPLORER_BASE_URL}/tx/${txHash}`;
}

function blockExplorerHref(blockNumber: number): string {
  return `${ARC_EXPLORER_BASE_URL}/block/${blockNumber}`;
}

function buildLatestEventByTask(
  events: MetricsEvent[],
): Map<string, MetricsEvent> {
  const latestByTask = new Map<string, MetricsEvent>();
  for (const event of events) {
    const existing = latestByTask.get(event.taskId);
    if (!existing) {
      latestByTask.set(event.taskId, event);
      continue;
    }
    if (
      new Date(event.timestamp).getTime() >=
      new Date(existing.timestamp).getTime()
    ) {
      latestByTask.set(event.taskId, event);
    }
  }
  return latestByTask;
}
function buildLatestLifecycleByTaskStage(
  events: LifecycleEvent[],
): Map<string, Map<string, LifecycleEvent>> {
  const byTask = new Map<string, Map<string, LifecycleEvent>>();
  for (const event of events) {
    const byStage =
      byTask.get(event.taskId) ?? new Map<string, LifecycleEvent>();
    const existing = byStage.get(event.stage);
    const eventTime = parseDate(event.blockTimestamp)?.getTime() ?? 0;
    const existingTime =
      parseDate(existing?.blockTimestamp ?? null)?.getTime() ?? 0;
    if (!existing || eventTime >= existingTime) {
      byStage.set(event.stage, event);
    }
    byTask.set(event.taskId, byStage);
  }
  return byTask;
}
function buildFailureBuckets(
  latestEventsByTask: Map<string, MetricsEvent>,
  tracesByTask: Map<string, ReasoningTrace>,
) {
  const counts = new Map<string, number>();
  for (const event of latestEventsByTask.values()) {
    if (event.valid) continue;
    const reasons =
      event.reasons.length === 0
        ? ["validator:integrity-failure"]
        : event.reasons;
    for (const reason of reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  for (const trace of tracesByTask.values()) {
    if (!trace.integrity.malformed) continue;
    const key = trace.integrity.corruptionReason
      ? `trace:${trace.integrity.corruptionReason}`
      : "trace:malformed";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function NetworkClient({
  events,
  latestTraces,
  lifecycleEvents,
}: {
  events: MetricsEvent[];
  latestTraces: ReasoningTrace[];
  lifecycleEvents: LifecycleEvent[];
}) {
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [modalTrace, setModalTrace] = useState<ReasoningTrace | null>(null);
  const [modalEconomics, setModalEconomics] = useState<{
    splitText: string;
    validationState: string;
    workerLabel: string;
    employerAddress: string | null;
    traceSource: string;
    reasons: string[];
    createdTimestamp: string | null;
    acceptedTimestamp: string | null;
    submittedTimestamp: string | null;
    validatedTimestamp: string | null;
    submitToValidateLatencySec: number | null;
    lifecycleTxs: LifecycleTx[];
    opportunitySeen: boolean;
    workerPickedUp: boolean;
    validatorSeen: boolean;
    settled: boolean;
    paymentUsdc6?: string;
    bondUsdc6?: string;
    workerPayoutUsdc6?: string;
    publisherPayoutUsdc6?: string;
    validatorPayoutUsdc6?: string;
    slashedBondUsdc6?: string;
  } | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [recencyFilter, setRecencyFilter] = useState<
    "15m" | "1h" | "24h" | "all"
  >("all");
  const [stateFilter, setStateFilter] = useState<
    "all" | "released" | "slashed" | "pending"
  >("all");
  const [sourceFilter, setSourceFilter] = useState<
    | "all"
    | "executor artifact"
    | "worker trace"
    | "metrics fallback"
    | "lifecycle only"
  >("all");
  const [taskQuery, setTaskQuery] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;
  useEffect(() => {
    setPage(0);
  }, [agentFilter, recencyFilter, stateFilter, sourceFilter, taskQuery]);
  const tracesByTask = new Map(
    latestTraces.map((trace) => [trace.taskId, trace]),
  );

  function openModal(row: {
    taskId: string;
    splitText: string;
    validationState: string;
    workerLabel: string;
    employerAddress: string | null;
    traceSource: string;
    reasons: string[];
    createdTimestamp: string | null;
    acceptedTimestamp: string | null;
    submittedTimestamp: string | null;
    validatedTimestamp: string | null;
    submitToValidateLatencySec: number | null;
    lifecycleTxs: LifecycleTx[];
    opportunitySeen: boolean;
    workerPickedUp: boolean;
    validatorSeen: boolean;
    settled: boolean;
    paymentUsdc6?: string;
    bondUsdc6?: string;
    workerPayoutUsdc6?: string;
    publisherPayoutUsdc6?: string;
    validatorPayoutUsdc6?: string;
    slashedBondUsdc6?: string;
  }) {
    setModalTaskId(row.taskId);
    setModalTrace(tracesByTask.get(row.taskId) ?? null);
    setModalEconomics({
      splitText: row.splitText,
      validationState: row.validationState,
      workerLabel: row.workerLabel,
      employerAddress: row.employerAddress,
      traceSource: row.traceSource,
      reasons: row.reasons,
      createdTimestamp: row.createdTimestamp,
      acceptedTimestamp: row.acceptedTimestamp,
      submittedTimestamp: row.submittedTimestamp,
      validatedTimestamp: row.validatedTimestamp,
      submitToValidateLatencySec: row.submitToValidateLatencySec,
      lifecycleTxs: row.lifecycleTxs,
      opportunitySeen: row.opportunitySeen,
      workerPickedUp: row.workerPickedUp,
      validatorSeen: row.validatorSeen,
      settled: row.settled,
      paymentUsdc6: row.paymentUsdc6,
      bondUsdc6: row.bondUsdc6,
      workerPayoutUsdc6: row.workerPayoutUsdc6,
      publisherPayoutUsdc6: row.publisherPayoutUsdc6,
      validatorPayoutUsdc6: row.validatorPayoutUsdc6,
      slashedBondUsdc6: row.slashedBondUsdc6,
    });
  }

  function closeModal() {
    setModalTaskId(null);
    setModalTrace(null);
    setModalEconomics(null);
  }

  if (
    events.length === 0 &&
    latestTraces.length === 0 &&
    lifecycleEvents.length === 0
  ) {
    return (
      <div>
        <PageHeader
          eyebrow="network"
          title="Lifecycle visibility is ready."
          subtitle="No lifecycle artifacts found yet. Run the simulation to populate stage, trace, and settlement events, then revisit this page for full-stage coverage."
        />
        <Link
          href="/dashboard"
          className="inline-block px-3 py-2 rounded border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 text-sm"
        >
          open dashboard
        </Link>
      </div>
    );
  }

  const latestEventsByTask = buildLatestEventByTask(events);
  const lifecycleByTaskStage = buildLatestLifecycleByTaskStage(lifecycleEvents);

  const taskIds = new Set<string>([
    ...latestEventsByTask.keys(),
    ...tracesByTask.keys(),
    ...lifecycleByTaskStage.keys(),
  ]);

  const rows = [...taskIds]
    .map((taskId) => {
      const event = latestEventsByTask.get(taskId);
      const trace = tracesByTask.get(taskId);
      const stageEvents = lifecycleByTaskStage.get(taskId);

      const createdTimestamp =
        stageEvents?.get("created")?.blockTimestamp ?? null;
      const acceptedTimestamp =
        stageEvents?.get("accepted")?.blockTimestamp ?? null;
      const submittedTimestamp =
        stageEvents?.get("submitted")?.blockTimestamp ?? null;
      const lifecycleValidatedTimestamp =
        stageEvents?.get("validated")?.blockTimestamp ?? null;
      const lifecycleTxs: LifecycleTx[] = [
        { stage: "created", event: stageEvents?.get("created") },
        { stage: "accepted", event: stageEvents?.get("accepted") },
        { stage: "submitted", event: stageEvents?.get("submitted") },
        { stage: "validated", event: stageEvents?.get("validated") },
      ].map(({ stage, event }) => ({
        stage,
        timestamp: event?.blockTimestamp ?? null,
        txHash: event?.txHash ?? null,
        blockNumber: event?.blockNumber ?? null,
      }));

      const traceTimestamp = trace?.timestamp ?? null;
      const validatedTimestamp =
        lifecycleValidatedTimestamp ?? event?.timestamp ?? null;

      const submittedTime = parseDate(submittedTimestamp ?? traceTimestamp);
      const validatedTime = parseDate(validatedTimestamp);

      const submitToValidateLatencySec =
        submittedTime && validatedTime
          ? Math.max(
              0,
              Math.round(
                (validatedTime.getTime() - submittedTime.getTime()) / 1000,
              ),
            )
          : null;

      const workerLabel = event?.worker ?? trace?.worker ?? "unknown";
      const traceWorker = trace?.worker ?? "—";
      const employerAddress = stageEvents?.get("created")?.actor ?? null;
      const traceSource = trace
        ? trace.schemaVersion === "artifact-executor/v1"
          ? "executor artifact"
          : "worker trace"
        : event
        ? "metrics fallback"
        : "lifecycle only";

      let validationState = "pending";
      const validatedEvent = stageEvents?.get("validated");
      if (validatedEvent) {
        validationState = validatedEvent.valid ? "released" : "slashed";
      } else if (event) {
        validationState = event.valid ? "released" : "slashed";
      }

      let splitText = "—";
      if (validatedEvent?.workerPayoutUsdc6) {
        if (validatedEvent.valid) {
          splitText = `worker ${formatUsdc6(
            validatedEvent.workerPayoutUsdc6,
          )} · publisher ${formatUsdc6(
            validatedEvent.publisherPayoutUsdc6,
          )} · validator ${formatUsdc6(validatedEvent.validatorPayoutUsdc6)}`;
        } else {
          splitText = `employer ${formatUsdc6(
            String(
              BigInt(validatedEvent.workerPayoutUsdc6 ?? "0") +
                BigInt(validatedEvent.slashedBondUsdc6 ?? "0"),
            ),
          )} (payment+bond)`;
        }
      }

      const opportunitySeen = Boolean(
        trace &&
          (trace.worker.toLowerCase().startsWith("rfb") ||
            trace.decision.resolver.reference.toLowerCase().includes("rfb")),
      );
      const workerPickedUp = acceptedTimestamp !== null;
      const validatorSeen = validatedTimestamp !== null;
      const settled =
        validationState === "released" || validationState === "slashed";
      const journeyReference = trace?.decision.resolver.reference ?? "no-run";
      const journeyCandidate = trace?.decision.instrumentId ?? taskId;
      const journeyKey = `${journeyReference}:${journeyCandidate}`;
      const journeyLabel = trace?.decision.instrumentId ?? shorten(taskId);

      return {
        taskId,
        workerLabel,
        traceWorker,
        traceSource,
        trace,
        employerAddress,
        createdTimestamp,
        acceptedTimestamp,
        submittedTimestamp,
        traceTimestamp,
        validatedTimestamp,
        validationState,
        reasons: validatedEvent?.reasons ?? event?.reasons ?? [],
        splitText,
        opportunitySeen,
        workerPickedUp,
        validatorSeen,
        settled,
        journeyKey,
        journeyLabel,
        journeyReference,
        paymentUsdc6: validatedEvent?.paymentUsdc6,
        bondUsdc6: validatedEvent?.bondUsdc6,
        workerPayoutUsdc6: validatedEvent?.workerPayoutUsdc6,
        publisherPayoutUsdc6: validatedEvent?.publisherPayoutUsdc6,
        validatorPayoutUsdc6: validatedEvent?.validatorPayoutUsdc6,
        slashedBondUsdc6: validatedEvent?.slashedBondUsdc6,
        submitToValidateLatencySec,
        lifecycleTxs,
      };
    })
    .sort((a, b) => {
      const aTime =
        parseDate(
          a.validatedTimestamp ??
            a.submittedTimestamp ??
            a.acceptedTimestamp ??
            a.createdTimestamp ??
            a.traceTimestamp,
        )?.getTime() ?? 0;
      const bTime =
        parseDate(
          b.validatedTimestamp ??
            b.submittedTimestamp ??
            b.acceptedTimestamp ??
            b.createdTimestamp ??
            b.traceTimestamp,
        )?.getTime() ?? 0;
      return bTime - aTime;
    });

  const totalTasks = rows.length;
  const createdCount = rows.filter(
    (row) => row.createdTimestamp !== null,
  ).length;
  const acceptedCount = rows.filter(
    (row) => row.acceptedTimestamp !== null,
  ).length;
  const submittedCount = rows.filter(
    (row) => row.submittedTimestamp !== null,
  ).length;
  const withTrace = rows.filter((row) => row.traceTimestamp !== null).length;
  const validated = rows.filter(
    (row) => row.validatedTimestamp !== null,
  ).length;
  const released = rows.filter(
    (row) => row.validationState === "released",
  ).length;
  const slashed = rows.filter(
    (row) => row.validationState === "slashed",
  ).length;
  const pendingValidation = rows.filter(
    (row) =>
      (row.submittedTimestamp !== null || row.traceTimestamp !== null) &&
      row.validatedTimestamp === null,
  ).length;
  const validatedWithoutTrace = rows.filter(
    (row) => row.validatedTimestamp !== null && row.traceTimestamp === null,
  ).length;
  const coverageWithExplicitStages = rows.filter(
    (row) =>
      row.createdTimestamp !== null &&
      row.acceptedTimestamp !== null &&
      row.submittedTimestamp !== null,
  ).length;

  const failureBuckets = buildFailureBuckets(latestEventsByTask, tracesByTask);
  const agentOptions = [...new Set(rows.map((row) => row.workerLabel))]
    .filter((worker) => worker && worker !== "unknown")
    .sort();
  const sourceOptions = [
    "executor artifact",
    "worker trace",
    "metrics fallback",
    "lifecycle only",
  ] as const;

  const recencyMs =
    recencyFilter === "15m"
      ? 15 * 60 * 1000
      : recencyFilter === "1h"
      ? 60 * 60 * 1000
      : recencyFilter === "24h"
      ? 24 * 60 * 60 * 1000
      : null;

  const cutoffMs = recencyMs === null ? null : Date.now() - recencyMs;

  const filteredRowsBase = rows.filter((row) => {
    if (agentFilter !== "all" && row.workerLabel !== agentFilter) return false;
    if (stateFilter !== "all" && row.validationState !== stateFilter)
      return false;
    if (
      taskQuery.trim().length > 0 &&
      !row.taskId.toLowerCase().includes(taskQuery.trim().toLowerCase())
    ) {
      return false;
    }
    if (cutoffMs !== null) {
      const referenceMs =
        parseDate(row.validatedTimestamp)?.getTime() ??
        parseDate(row.submittedTimestamp)?.getTime() ??
        parseDate(row.traceTimestamp)?.getTime() ??
        parseDate(row.acceptedTimestamp)?.getTime() ??
        parseDate(row.createdTimestamp)?.getTime() ??
        0;
      if (!referenceMs || referenceMs < cutoffMs) return false;
    }
    return true;
  });

  const filteredRows = filteredRowsBase.filter((row) => {
    if (sourceFilter !== "all" && row.traceSource !== sourceFilter)
      return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageStart = clampedPage * PAGE_SIZE;
  const recent = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div>
      <PageHeader
        eyebrow="network · lifecycle"
        title="Intent lifecycle across create, submit, validate, release/slash."
        subtitle="This page ties traces and validator settlement events into one operational lifecycle stream so stage transitions and failure modes are visible per task."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="observed tasks" value={String(totalTasks)} />
        <Stat label="released" value={String(released)} />
        <Stat label="slashed" value={String(slashed)} />
        <Stat label="awaiting validation" value={String(pendingValidation)} />
      </div>

      <section className="mb-8">
        <div className="border border-neutral-800 rounded-lg p-4 bg-neutral-900/30">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-mono text-neutral-400">
            <span className="text-neutral-500 uppercase tracking-wider">
              lifecycle
            </span>
            <span>
              created <span className="text-neutral-200">{createdCount}</span>
            </span>
            <span className="text-neutral-600">→</span>
            <span>
              accepted <span className="text-neutral-200">{acceptedCount}</span>
            </span>
            <span className="text-neutral-600">→</span>
            <span>
              submitted{" "}
              <span className="text-neutral-200">{submittedCount}</span>
            </span>
            <span className="text-neutral-600">→</span>
            <span>
              trace <span className="text-neutral-200">{withTrace}</span>
            </span>
            <span className="text-neutral-600">→</span>
            <span>
              validated <span className="text-neutral-200">{validated}</span>
            </span>
          </div>
          {failureBuckets.length > 0 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs font-mono text-rose-300/80 hover:text-rose-300">
                {failureBuckets.length} failure bucket
                {failureBuckets.length === 1 ? "" : "s"} · click to expand
              </summary>
              <ul className="mt-2 space-y-1 text-xs font-mono">
                {failureBuckets.map((bucket) => (
                  <li
                    key={bucket.key}
                    className="flex items-start gap-2 text-neutral-400"
                  >
                    <span className="text-rose-300 shrink-0">
                      ×{bucket.count}
                    </span>
                    <span className="break-all">{bucket.key}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          settlement stream (filtered recent tasks)
        </h2>
        <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/30 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-xs text-neutral-500 font-mono uppercase tracking-wider">
              agent
              <select
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 text-neutral-200 px-2 py-2 text-sm"
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
              >
                <option value="all">all agents</option>
                {agentOptions.map((worker) => (
                  <option key={worker} value={worker}>
                    {worker}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-500 font-mono uppercase tracking-wider">
              source
              <select
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 text-neutral-200 px-2 py-2 text-sm"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(
                    event.target.value as
                      | "all"
                      | "executor artifact"
                      | "worker trace"
                      | "metrics fallback"
                      | "lifecycle only",
                  )
                }
              >
                <option value="all">all sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-500 font-mono uppercase tracking-wider">
              recent settlements
              <select
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 text-neutral-200 px-2 py-2 text-sm"
                value={recencyFilter}
                onChange={(event) =>
                  setRecencyFilter(
                    event.target.value as "15m" | "1h" | "24h" | "all",
                  )
                }
              >
                <option value="15m">last 15 min</option>
                <option value="1h">last 1 hour</option>
                <option value="24h">last 24 hours</option>
                <option value="all">all</option>
              </select>
            </label>
            <label className="text-xs text-neutral-500 font-mono uppercase tracking-wider">
              settlement state
              <select
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 text-neutral-200 px-2 py-2 text-sm"
                value={stateFilter}
                onChange={(event) =>
                  setStateFilter(
                    event.target.value as
                      | "all"
                      | "released"
                      | "slashed"
                      | "pending",
                  )
                }
              >
                <option value="all">all states</option>
                <option value="released">released</option>
                <option value="slashed">slashed</option>
                <option value="pending">pending</option>
              </select>
            </label>
            <label className="text-xs text-neutral-500 font-mono uppercase tracking-wider">
              task contains
              <input
                className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 text-neutral-200 px-2 py-2 text-sm"
                placeholder="0x..."
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            showing {filteredRows.length === 0 ? 0 : pageStart + 1}
            {filteredRows.length === 0
              ? ""
              : `–${pageStart + recent.length}`}{" "}
            of {filteredRows.length} filtered settlements
          </div>
        </div>

        <div className="overflow-x-auto border border-neutral-900 rounded-lg">
          <table className="w-full text-xs min-w-[980px]">
            <thead>
              <tr className="text-left text-[11px] text-neutral-500 uppercase tracking-wider font-mono border-b border-neutral-800">
                <th className="py-2 px-3 font-normal">task</th>
                <th className="py-2 px-3 font-normal">worker</th>
                <th className="py-2 px-3 font-normal">validated</th>
                <th className="py-2 px-3 font-normal">state</th>
                <th
                  className="py-2 px-3 font-normal"
                  title="C=created, A=accepted, S=submitted, V=validated"
                >
                  lifecycle (C/A/S/V)
                </th>
                <th className="py-2 px-3 font-normal">submit→validate</th>
                <th className="py-2 px-3 font-normal">reason</th>
                <th className="py-2 px-3 font-normal">source</th>
                <th className="py-2 px-3 font-normal">evidence</th>
                <th className="py-2 px-3 font-normal text-right">
                  task details
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr
                  key={row.taskId}
                  className="border-b border-neutral-900 hover:bg-neutral-900/40 transition-colors"
                >
                  <td className="py-2 px-3">
                    <div className="font-mono text-neutral-200">
                      {shorten(row.taskId)}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono">
                      trace {shorten(row.traceWorker)}
                    </div>
                  </td>
                  <td
                    className="py-2 px-3 text-neutral-300 font-mono max-w-[180px] truncate"
                    title={row.workerLabel}
                  >
                    {row.workerLabel}
                  </td>
                  <td className="py-2 px-3 text-neutral-500 font-mono tabular">
                    {row.validatedTimestamp
                      ? new Date(row.validatedTimestamp).toLocaleTimeString()
                      : "—"}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={
                        row.validationState === "released"
                          ? "text-emerald-400 font-mono"
                          : row.validationState === "slashed"
                          ? "text-rose-400 font-mono"
                          : "text-neutral-500 font-mono"
                      }
                    >
                      {row.validationState}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <LifecycleBadges
                      created={row.createdTimestamp !== null}
                      accepted={row.acceptedTimestamp !== null}
                      submitted={
                        row.submittedTimestamp !== null ||
                        row.traceTimestamp !== null
                      }
                      validated={row.validatedTimestamp !== null}
                    />
                  </td>
                  <td className="py-2 px-3 text-neutral-300 font-mono tabular">
                    {row.submitToValidateLatencySec === null
                      ? "—"
                      : `${row.submitToValidateLatencySec}s`}
                  </td>
                  <td
                    className="py-2 px-3 text-neutral-500 max-w-[280px] truncate"
                    title={row.reasons.join(", ")}
                  >
                    {row.reasons.length > 0 ? row.reasons.join(", ") : "—"}
                  </td>
                  <td className="py-2 px-3 text-neutral-300 font-mono">
                    {row.traceSource}
                  </td>
                  <td className="py-2 px-3">
                    {row.trace ? (
                      <EvidenceLink
                        trace={row.trace}
                        taskId={row.taskId}
                        source={row.traceSource}
                      />
                    ) : (
                      <span className="text-neutral-500">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      className="px-2.5 py-1.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500 hover:bg-neutral-800 font-medium"
                      onClick={() => openModal(row)}
                      type="button"
                    >
                      Open details
                    </button>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="py-8 px-3 text-center text-neutral-500"
                  >
                    No settlements match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs font-mono text-neutral-500">
          <div>
            page {clampedPage + 1} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="px-3 py-1 border border-neutral-800 rounded text-neutral-300 hover:bg-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
              className="px-3 py-1 border border-neutral-800 rounded text-neutral-300 hover:bg-neutral-900 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              next
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] text-neutral-500 mb-3 uppercase tracking-wider font-mono">
          data quality notes
        </h2>
        <ul className="text-xs text-neutral-500 space-y-1">
          <li>
            create/accept/submit use explicit on-chain receipt timestamps when
            lifecycle events are present.
          </li>
          <li>
            validated falls back to metrics timestamp if lifecycle validated
            event is not present.
          </li>
          <li>validated-without-trace tasks: {validatedWithoutTrace}</li>
          <li>
            explicit stage coverage: {coverageWithExplicitStages}/{totalTasks}
          </li>
        </ul>
      </section>
      <Modal open={!!modalTaskId} onClose={closeModal}>
        {modalTaskId ? (
          <TaskModalContent
            taskId={modalTaskId}
            trace={modalTrace}
            economics={modalEconomics}
          />
        ) : null}
      </Modal>
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
function StageCard({
  label,
  count,
  note,
}: {
  label: string;
  count: number;
  note: string;
}) {
  return (
    <div className="border border-neutral-800 rounded p-4 bg-neutral-900/30">
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono mb-2">
        {label}
      </div>
      <div className="text-2xl text-neutral-50 font-mono mb-1">{count}</div>
      <div className="text-xs text-neutral-400">{note}</div>
    </div>
  );
}

function LifecycleBadges({
  created,
  accepted,
  submitted,
  validated,
}: {
  created: boolean;
  accepted: boolean;
  submitted: boolean;
  validated: boolean;
}) {
  const badges: Array<{ label: string; on: boolean }> = [
    { label: "C", on: created },
    { label: "A", on: accepted },
    { label: "S", on: submitted },
    { label: "V", on: validated },
  ];

  return (
    <div
      className="flex gap-1"
      title="C=created, A=accepted, S=submitted, V=validated"
    >
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={
            badge.on
              ? "px-1.5 py-0.5 rounded text-[10px] font-mono border border-emerald-800 text-emerald-300 bg-emerald-950/30"
              : "px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-800 text-neutral-500"
          }
          title={
            badge.label === "C"
              ? "created"
              : badge.label === "A"
              ? "accepted"
              : badge.label === "S"
              ? "submitted"
              : "validated"
          }
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function EvidenceLink({
  trace,
  taskId,
  source,
}: {
  trace: ReasoningTrace;
  taskId: string;
  source: string;
}) {
  if (
    source === "executor artifact" &&
    trace.schemaVersion === "artifact-executor/v1"
  ) {
    const ref = trace.decision.resolver.reference;
    const candidate = trace.decision.instrumentId;
    const lowerWorker = trace.worker.toLowerCase();

    if (lowerWorker === "rfb5") {
      return (
        <Link
          href={`/agents/rfb5?run=${encodeURIComponent(
            ref,
          )}&event=${encodeURIComponent(candidate)}`}
          className="text-neutral-200 hover:underline"
        >
          open rfb5 run
        </Link>
      );
    }

    if (lowerWorker === "rfb6") {
      return (
        <Link
          href={`/agents/rfb6?run=${encodeURIComponent(
            ref,
          )}&worker=${encodeURIComponent(candidate)}`}
          className="text-neutral-200 hover:underline"
        >
          open rfb6 run
        </Link>
      );
    }

    if (lowerWorker === "rfb6.copytrade") {
      return (
        <Link
          href={`/agents/rfb6/copytrade?run=${encodeURIComponent(
            ref,
          )}&wallet=${encodeURIComponent(candidate)}`}
          className="text-neutral-200 hover:underline"
        >
          open copytrade run
        </Link>
      );
    }
  }

  return (
    <Link
      href={`/traces/${encodeURIComponent(taskId)}`}
      className="text-neutral-200 hover:underline"
    >
      open trace
    </Link>
  );
}

function TaskModalContent({
  taskId,
  trace,
  economics,
}: {
  taskId: string;
  trace: ReasoningTrace | null;
  economics: {
    splitText: string;
    validationState: string;
    workerLabel: string;
    employerAddress: string | null;
    traceSource: string;
    reasons: string[];
    createdTimestamp: string | null;
    acceptedTimestamp: string | null;
    submittedTimestamp: string | null;
    validatedTimestamp: string | null;
    submitToValidateLatencySec: number | null;
    lifecycleTxs: LifecycleTx[];
    opportunitySeen: boolean;
    workerPickedUp: boolean;
    validatorSeen: boolean;
    settled: boolean;
    paymentUsdc6?: string;
    bondUsdc6?: string;
    workerPayoutUsdc6?: string;
    publisherPayoutUsdc6?: string;
    validatorPayoutUsdc6?: string;
    slashedBondUsdc6?: string;
  } | null;
}) {
  const [tab, setTab] = useState<
    "overview" | "pipeline" | "decision" | "plan" | "result" | "raw"
  >("overview");

  useEffect(() => {
    setTab("overview");
  }, [taskId]);

  const malformed = trace?.integrity.malformed ?? false;
  const hasTrace = Boolean(trace);
  const confidencePct = trace
    ? `${(trace.decision.confidenceBps / 100).toFixed(2)}%`
    : "—";
  const evPct = trace
    ? `${(trace.decision.expectedValueBps / 100).toFixed(2)}%`
    : "—";
  const totalNotionalText = trace
    ? `$${trace.decision.notionalUsd.toFixed(2)}`
    : "—";
  const totalEscrowUsdc6 =
    BigInt(economics?.paymentUsdc6 ?? "0") +
    BigInt(economics?.bondUsdc6 ?? "0");
  const settlementTotalOutUsdc6 =
    BigInt(economics?.workerPayoutUsdc6 ?? "0") +
    BigInt(economics?.publisherPayoutUsdc6 ?? "0") +
    BigInt(economics?.validatorPayoutUsdc6 ?? "0") +
    BigInt(economics?.slashedBondUsdc6 ?? "0");
  const profitableLabel =
    economics?.validationState === "released"
      ? "yes (validator released)"
      : economics?.validationState === "slashed"
      ? "no (validator slashed)"
      : trace && trace.decision.expectedValueBps > 0
      ? "likely yes (positive EV)"
      : "unclear";

  const lifecycleStages = [
    { label: "created", ts: economics?.createdTimestamp ?? null },
    { label: "accepted", ts: economics?.acceptedTimestamp ?? null },
    { label: "submitted", ts: economics?.submittedTimestamp ?? null },
    { label: "validated", ts: economics?.validatedTimestamp ?? null },
  ].filter((stage) => stage.ts);
  const lifecycleTxs = economics?.lifecycleTxs ?? [];

  const rawJson = useMemo(() => {
    return JSON.stringify(
      {
        taskId,
        settlement: economics,
        trace: trace ?? null,
      },
      null,
      2,
    );
  }, [taskId, economics, trace]);

  const tabs: Array<{
    key: "overview" | "pipeline" | "decision" | "plan" | "result" | "raw";
    label: string;
  }> = [
    { key: "overview", label: "Overview" },
    { key: "pipeline", label: "Pipeline" },
    { key: "decision", label: "Decision" },
    { key: "plan", label: "Plan" },
    { key: "result", label: "Result" },
    { key: "raw", label: "Raw" },
  ];

  return (
    <div className="p-6">
      <div className="sticky top-0 -mx-6 px-6 pb-4 bg-neutral-950/95 backdrop-blur border-b border-neutral-900 z-10 mb-4">
        <div className="pr-10">
          <div className="text-2xl font-semibold text-neutral-100 tracking-tight">
            Task {taskId.slice(0, 12)}…
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            worker{" "}
            <span className="text-neutral-300">
              {trace?.worker ?? economics?.workerLabel ?? "—"}
            </span>{" "}
            · schema {trace?.schemaVersion ?? "—"} ·{" "}
            {trace ? new Date(trace.timestamp).toLocaleString() : "—"}
          </div>
          {!hasTrace && (
            <div className="mt-2 text-xs text-amber-300 border border-amber-900 rounded p-2 bg-amber-950/20">
              Trace artifact unavailable for this task. Showing
              settlement/lifecycle-backed details.
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              label="action"
              value={trace?.decision.action ?? "—"}
              description="The worker's intended operation for this task (for example execute or defer)."
            />
            <Chip
              label="confidence"
              value={confidencePct}
              description="Model confidence in the decision. Higher means the worker is more certain."
            />
            <Chip
              label="EV"
              value={evPct}
              tone={
                trace
                  ? trace.decision.expectedValueBps >= 0
                    ? "good"
                    : "bad"
                  : "default"
              }
              description="Expected value estimate for this decision. Positive values are favorable."
            />
            <Chip
              label="success"
              value={trace ? String(trace.result.success) : "—"}
              tone={trace ? (trace.result.success ? "good" : "bad") : "default"}
              description="Whether task execution completed successfully before settlement."
            />
            <Chip
              label="state"
              value={economics?.validationState ?? "pending"}
              tone={
                economics?.validationState === "released"
                  ? "good"
                  : economics?.validationState === "slashed"
                  ? "bad"
                  : "default"
              }
              description="Settlement state from validator lifecycle events."
            />
            <Chip
              label="trace"
              value={
                hasTrace ? economics?.traceSource ?? "artifact" : "missing"
              }
              tone={hasTrace ? "good" : "bad"}
              description="Trace artifact availability and source lineage for this task."
            />
            <Chip
              label="integrity"
              value={malformed ? "malformed" : "clean"}
              tone={malformed ? "bad" : "good"}
              description="Trace validity check result. Clean means no structural or hash mismatch detected."
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={
                tab === item.key
                  ? "px-3 py-1.5 rounded border border-neutral-600 bg-neutral-800 text-neutral-100 text-xs font-medium"
                  : "px-3 py-1.5 rounded border border-neutral-800 bg-neutral-900/40 text-neutral-400 hover:text-neutral-200 text-xs"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {trace && malformed && (
        <div className="mb-4 text-xs text-rose-300 border border-rose-900 rounded p-3 bg-rose-950/30">
          Integrity failure: malformed trace
          {trace.integrity.corruptionReason
            ? ` (${trace.integrity.corruptionReason})`
            : ""}
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="border border-neutral-800 rounded-lg p-4 bg-gradient-to-br from-neutral-900/60 to-neutral-950/60">
            <div className="text-[10px] uppercase tracking-wider font-mono text-neutral-500 mb-2">
              what just happened
            </div>
            <div className="text-sm text-neutral-300 leading-relaxed">
              An <span className="text-blue-300">employer</span> paid USDC into
              escrow to have an agent do a job. A{" "}
              <span className="text-emerald-300">worker</span> accepted the
              task, ran its reasoning, and submitted a result. A{" "}
              <span className="text-fuchsia-300">validator</span> then{" "}
              {economics?.validationState === "released" ? (
                <>
                  <span className="text-emerald-300 font-medium">
                    released the payment
                  </span>{" "}
                  to the worker.
                </>
              ) : economics?.validationState === "slashed" ? (
                <>
                  <span className="text-rose-300 font-medium">
                    slashed the worker’s bond
                  </span>{" "}
                  and returned the employer’s payment.
                </>
              ) : (
                <>checks the result before releasing or slashing.</>
              )}
            </div>
            <div className="mt-2 text-xs text-neutral-500">
              The tabs above expose the same data the validator saw: the{" "}
              on-chain pipeline, the agent’s decision, its plan, the result, and
              the raw artifact.
            </div>
          </div>
          <Section title="what the employer wanted">
            <KV
              k="employer"
              v={
                economics?.employerAddress
                  ? `${economics.employerAddress.slice(
                      0,
                      10,
                    )}…${economics.employerAddress.slice(-6)}`
                  : "—"
              }
              mono
            />
            <KV k="job type" v={trace?.decision.marketType ?? "—"} />
            <KV k="requested action" v={trace?.decision.action ?? "—"} />
            <KV
              k="escrowed payment"
              v={
                economics?.paymentUsdc6
                  ? `${formatUsdc6(
                      economics.paymentUsdc6,
                    )} USDC (released to worker if valid, refunded if not)`
                  : "— (visible after settlement)"
              }
            />
            <KV
              k="worker bond"
              v={
                economics?.bondUsdc6
                  ? `${formatUsdc6(
                      economics.bondUsdc6,
                    )} USDC (slashed if the worker cheats)`
                  : "—"
              }
            />
            <KV
              k="deadline"
              v={
                trace
                  ? `${trace.decision.timeHorizonSec}s decision horizon`
                  : "—"
              }
            />
          </Section>
          <Section title="trade economics">
            <div className="text-xs text-neutral-500 mb-2">
              The money that moved on-chain for this task.
            </div>
            <KV k="total trade value" v={totalNotionalText} />
            <KV
              k="total escrow value"
              v={
                totalEscrowUsdc6 > 0n
                  ? formatUsdc6(totalEscrowUsdc6.toString())
                  : "—"
              }
            />
            <KV
              k="settlement split"
              v={
                economics?.splitText && economics.splitText !== "—"
                  ? economics.splitText
                  : "—"
              }
            />
            <KV
              k="settlement total out"
              v={
                settlementTotalOutUsdc6 > 0n
                  ? formatUsdc6(settlementTotalOutUsdc6.toString())
                  : "—"
              }
            />
            <KV k="profitable" v={profitableLabel} />
          </Section>
          <Section title="quick summary">
            <div className="text-xs text-neutral-500 mb-2">
              What the agent decided to do.
            </div>
            <KV k="market" v={trace?.decision.marketType ?? "—"} />
            <KV
              k="notional (USD)"
              v={trace ? String(trace.decision.notionalUsd) : "—"}
            />
            <KV
              k="horizon"
              v={trace ? `${trace.decision.timeHorizonSec}s` : "—"}
            />
            <KV k="steps" v={trace ? String(trace.plan.length) : "—"} />
            <KV
              k="resolver"
              v={
                trace
                  ? `${trace.decision.resolver.kind}:${trace.decision.resolver.reference}`
                  : "—"
              }
            />
          </Section>
          <Section title="result preview">
            <KV k="success" v={trace ? String(trace.result.success) : "—"} />
            <KV
              k="outputHash"
              v={trace ? formatHash(trace.result.outputHash) : "—"}
              mono
            />
            <KV
              k="details"
              v={trace?.result.details ?? "No trace found for this task."}
            />
          </Section>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="space-y-4">
          <Section title="task journey">
            <div className="text-xs text-neutral-500 mb-3">
              Read this top to bottom: employer posts work, a worker picks it
              up, the result lands on-chain, then the validator settles escrow.
            </div>
            <PipelineTimeline
              steps={[
                {
                  label: "Employer funded task",
                  state: economics?.createdTimestamp ? "complete" : "pending",
                  time: economics?.createdTimestamp ?? null,
                  detail: economics?.employerAddress
                    ? `created by ${shorten(economics.employerAddress)}`
                    : "waiting for created event",
                },
                {
                  label: "Worker accepted",
                  state: economics?.acceptedTimestamp ? "complete" : "pending",
                  time: economics?.acceptedTimestamp ?? null,
                  detail: economics?.workerPickedUp
                    ? `${
                        trace?.worker ?? economics?.workerLabel ?? "worker"
                      } locked bond and started work`
                    : "no worker pickup yet",
                },
                {
                  label: "Result submitted",
                  state: economics?.submittedTimestamp ? "complete" : "pending",
                  time: economics?.submittedTimestamp ?? null,
                  detail: hasTrace
                    ? `${
                        economics?.traceSource ?? "trace"
                      } attached for validator review`
                    : "waiting for trace or result artifact",
                },
                {
                  label: "Escrow settled",
                  state: economics?.settled
                    ? economics.validationState === "released"
                      ? "released"
                      : "slashed"
                    : "pending",
                  time: economics?.validatedTimestamp ?? null,
                  detail: economics?.settled
                    ? economics.splitText
                    : "validator has not settled yet",
                },
              ]}
            />
            <div className="mt-3 text-xs text-neutral-500">
              Submit → validate: {economics?.submitToValidateLatencySec ?? "—"}s
            </div>
          </Section>
          <Section title="evidence sources">
            <EvidenceSourceRow
              label="on-chain lifecycle"
              state={economics?.validationState ? "seen" : "missing"}
              detail="Courthouse events: created, accepted, submitted, validated. This is the source of the transaction links below."
            />
            <EvidenceSourceRow
              label="worker trace"
              state={
                economics?.traceSource === "worker trace" ? "seen" : "not used"
              }
              detail="A worker-authored reasoning artifact. Your last run used the rfb6 copytrade autopilot, so this is the main off-chain evidence."
            />
            <EvidenceSourceRow
              label="executor artifact"
              state={
                economics?.traceSource === "executor artifact"
                  ? "seen"
                  : "not linked"
              }
              detail="An earlier marketplace executor artifact. It is optional here; the autopilot submitted its own worker trace, so there may be no separate executor artifact for this task."
            />
            <EvidenceSourceRow
              label="rfb opportunity"
              state={economics?.opportunitySeen ? "seen" : "not linked"}
              detail={
                economics?.opportunitySeen
                  ? "Detected from the RFB worker/resolver attached to the trace."
                  : "No RFB run reference was attached to this task artifact. The on-chain lifecycle can still be complete."
              }
            />
          </Section>
          <Section title="blockchain transactions">
            <LifecycleTxLinks txs={lifecycleTxs} />
          </Section>
        </div>
      )}

      {tab === "decision" && (
        <Section title="decision">
          <KV k="market" v={trace?.decision.marketType ?? "settlement"} />
          <KV
            k="action"
            v={trace?.decision.action ?? economics?.validationState ?? "—"}
          />
          <KV
            k="notional (USD)"
            v={
              trace
                ? String(trace.decision.notionalUsd)
                : economics?.paymentUsdc6
                ? (Number(economics.paymentUsdc6) / 1_000_000).toFixed(2)
                : "—"
            }
          />
          <KV k="confidence" v={confidencePct} />
          <KV k="EV" v={evPct} />
          <KV
            k="horizon"
            v={trace ? `${trace.decision.timeHorizonSec}s` : "—"}
          />
          <KV
            k="resolver"
            v={
              trace
                ? `${trace.decision.resolver.kind}:${trace.decision.resolver.reference}`
                : economics?.traceSource ?? "—"
            }
          />
          <KV
            k="reasons"
            v={
              economics?.reasons && economics.reasons.length > 0
                ? economics.reasons.join(", ")
                : "—"
            }
          />
        </Section>
      )}

      {tab === "plan" && (
        <Section title="plan">
          {!trace || trace.plan.length === 0 ? (
            lifecycleStages.length === 0 ? (
              <div className="text-neutral-500 text-sm">— empty —</div>
            ) : (
              <ol className="list-decimal list-inside text-sm text-neutral-300 space-y-2">
                {lifecycleStages.map((stage, i) => (
                  <li key={i} className="font-mono break-all">
                    {stage.label} at{" "}
                    {new Date(String(stage.ts)).toLocaleString()}
                  </li>
                ))}
              </ol>
            )
          ) : (
            <ol className="list-decimal list-inside text-sm text-neutral-300 space-y-2">
              {trace.plan.map((step, i) => (
                <li key={i} className="font-mono break-all">
                  {step}
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}

      {tab === "result" && (
        <Section title="result">
          <KV
            k="success"
            v={
              trace
                ? String(trace.result.success)
                : economics?.validationState === "released"
                ? "true"
                : economics?.validationState === "slashed"
                ? "false"
                : "—"
            }
          />
          <KV k="outputHash" v={trace?.result.outputHash ?? "—"} mono />
          <KV
            k="details"
            v={
              trace?.result.details ??
              `${economics?.validationState ?? "pending"} via ${
                economics?.traceSource ?? "lifecycle"
              }`
            }
          />
          <KV
            k="settled at"
            v={
              economics?.validatedTimestamp
                ? new Date(economics.validatedTimestamp).toLocaleString()
                : "—"
            }
          />
          <KV
            k="submit→validate"
            v={
              economics?.submitToValidateLatencySec === null ||
              economics?.submitToValidateLatencySec === undefined
                ? "—"
                : `${economics.submitToValidateLatencySec}s`
            }
          />
        </Section>
      )}

      {tab === "raw" && (
        <Section title="raw trace">
          <pre className="text-xs text-neutral-300 bg-neutral-950 border border-neutral-800 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
            {rawJson}
          </pre>
        </Section>
      )}
    </div>
  );
}

function LifecycleTxLinks({ txs }: { txs: LifecycleTx[] }) {
  const seenTxs = txs.filter((tx) => tx.txHash);

  if (seenTxs.length === 0) {
    return (
      <div className="text-sm text-neutral-500">
        No lifecycle transaction receipts are available for this task yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {seenTxs.map((tx) => (
        <div
          key={`${tx.stage}:${tx.txHash}`}
          className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-2 text-sm"
        >
          <div className="text-neutral-500 font-mono text-xs uppercase tracking-wider">
            {tx.stage}
          </div>
          <div className="min-w-0">
            <a
              href={txExplorerHref(String(tx.txHash))}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-neutral-100 hover:underline break-all"
            >
              {formatHash(String(tx.txHash))}
            </a>
            <div className="text-xs text-neutral-500">
              {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "—"}
            </div>
          </div>
          {tx.blockNumber === null ? (
            <div className="text-xs text-neutral-500 font-mono">block —</div>
          ) : (
            <a
              href={blockExplorerHref(tx.blockNumber)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-400 hover:text-neutral-200 hover:underline font-mono"
            >
              block {tx.blockNumber}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function PipelineTimeline({
  steps,
}: {
  steps: Array<{
    label: string;
    state: "complete" | "released" | "slashed" | "pending";
    time: string | null;
    detail: string;
  }>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {steps.map((step, index) => {
        const complete = step.state !== "pending";
        const tone =
          step.state === "released"
            ? "border-emerald-800 bg-emerald-950/20 text-emerald-200"
            : step.state === "slashed"
            ? "border-rose-800 bg-rose-950/20 text-rose-200"
            : complete
            ? "border-neutral-700 bg-neutral-900/60 text-neutral-200"
            : "border-neutral-850 bg-neutral-950/40 text-neutral-500";
        return (
          <div key={step.label} className={`rounded border p-3 ${tone}`}>
            <div className="flex items-center gap-2">
              <div
                className={
                  complete
                    ? "h-6 w-6 rounded-full border border-current flex items-center justify-center text-[11px] font-mono"
                    : "h-6 w-6 rounded-full border border-neutral-800 flex items-center justify-center text-[11px] font-mono text-neutral-600"
                }
              >
                {index + 1}
              </div>
              <div className="text-sm font-medium">{step.label}</div>
            </div>
            <div className="mt-3 text-xs text-neutral-400 leading-relaxed">
              {step.detail}
            </div>
            <div className="mt-2 text-[11px] text-neutral-500 font-mono">
              {step.time ? new Date(step.time).toLocaleString() : "pending"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceSourceRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: "seen" | "missing" | "not used" | "not linked";
  detail: string;
}) {
  const good = state === "seen";
  return (
    <div className="grid grid-cols-1 md:grid-cols-[10rem_7rem_1fr] gap-2 py-2 border-b border-neutral-900 last:border-0 text-sm">
      <div className="text-neutral-500 font-mono text-xs uppercase tracking-wider">
        {label}
      </div>
      <div
        className={
          good
            ? "text-emerald-300 font-medium"
            : state === "missing"
            ? "text-amber-300 font-medium"
            : "text-neutral-400 font-medium"
        }
      >
        {state}
      </div>
      <div className="text-neutral-500 leading-relaxed">{detail}</div>
    </div>
  );
}

function formatHash(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 14)}…${value.slice(-8)}`;
}

function Chip({
  label,
  value,
  tone = "default",
  description,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
  description?: string;
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-900 text-emerald-300 bg-emerald-950/20"
      : tone === "bad"
      ? "border-rose-900 text-rose-300 bg-rose-950/20"
      : "border-neutral-800 text-neutral-300 bg-neutral-900/40";

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border text-[11px] ${toneClass}`}
      >
        <span className="uppercase tracking-wider text-neutral-500">
          {label}
        </span>
        <span className="font-mono">{value}</span>
      </div>
      {description ? (
        <div className="relative group/icon">
          <button
            type="button"
            className="h-4 w-4 rounded-full border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 inline-flex items-center justify-center"
            aria-label={`${label} info`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-2.5 w-2.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
          <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 rounded border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] text-neutral-200 opacity-0 shadow-lg transition-opacity duration-150 group-hover/icon:opacity-100 group-focus-within/icon:opacity-100 z-20">
            {description}
          </div>
        </div>
      ) : null}
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
    <section className="mb-4">
      <h2 className="text-[11px] text-neutral-500 mb-2 uppercase tracking-wider font-mono">
        {title}
      </h2>
      <div className="border border-neutral-800 rounded p-4 bg-neutral-900/30 space-y-2">
        {children}
      </div>
    </section>
  );
}
function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex text-sm gap-4">
      <div className="w-32 shrink-0 text-neutral-500 font-mono text-xs uppercase tracking-wider">
        {k}
      </div>
      <div
        className={
          mono
            ? "text-neutral-200 break-all font-mono"
            : "text-neutral-200 break-all"
        }
      >
        {v}
      </div>
    </div>
  );
}
