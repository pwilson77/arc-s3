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
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [recencyFilter, setRecencyFilter] = useState<
    "15m" | "1h" | "24h" | "all"
  >("1h");
  const [stateFilter, setStateFilter] = useState<
    "all" | "released" | "slashed" | "pending"
  >("all");
  const [taskQuery, setTaskQuery] = useState("");
  const tracesByTask = new Map(
    latestTraces.map((trace) => [trace.taskId, trace]),
  );

  function openModal(taskId: string) {
    setModalTaskId(taskId);
    setModalTrace(tracesByTask.get(taskId) ?? null);
  }

  function closeModal() {
    setModalTaskId(null);
    setModalTrace(null);
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

      const workerLabel = event?.worker ?? "unknown";
      const traceWorker = trace?.worker ?? "—";

      let validationState = "pending";
      const validatedEvent = stageEvents?.get("validated");
      if (validatedEvent) {
        validationState = validatedEvent.valid ? "released" : "slashed";
      } else if (event) {
        validationState = event.valid ? "released" : "slashed";
      }

      return {
        taskId,
        workerLabel,
        traceWorker,
        createdTimestamp,
        acceptedTimestamp,
        submittedTimestamp,
        traceTimestamp,
        validatedTimestamp,
        validationState,
        reasons: validatedEvent?.reasons ?? event?.reasons ?? [],
        submitToValidateLatencySec,
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
    (row) => row.submittedTimestamp !== null && row.validatedTimestamp === null,
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

  const recencyMs =
    recencyFilter === "15m"
      ? 15 * 60 * 1000
      : recencyFilter === "1h"
      ? 60 * 60 * 1000
      : recencyFilter === "24h"
      ? 24 * 60 * 60 * 1000
      : null;

  const cutoffMs = recencyMs === null ? null : Date.now() - recencyMs;

  const filteredRows = rows.filter((row) => {
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
      const settlementMs = parseDate(row.validatedTimestamp)?.getTime();
      if (!settlementMs || settlementMs < cutoffMs) return false;
    }
    return true;
  });

  const recent = filteredRows.slice(0, 40);

  return (
    <div>
      <PageHeader
        eyebrow="network · lifecycle"
        title="Intent lifecycle across create, submit, validate, release/slash."
        subtitle="This page ties traces and validator settlement events into one operational lifecycle stream so stage transitions and failure modes are visible per task."
      />

      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-10">
        <Stat label="observed tasks" value={String(totalTasks)} />
        <Stat label="created (explicit)" value={String(createdCount)} />
        <Stat label="accepted (explicit)" value={String(acceptedCount)} />
        <Stat label="submitted (explicit)" value={String(submittedCount)} />
        <Stat label="trace published" value={String(withTrace)} />
        <Stat label="validated" value={String(validated)} />
        <Stat label="released" value={String(released)} />
        <Stat label="slashed" value={String(slashed)} />
        <Stat label="awaiting validation" value={String(pendingValidation)} />
      </div>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          stage matrix
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <StageCard
            label="created"
            count={createdCount}
            note="Recorded from createTask transaction receipts."
          />
          <StageCard
            label="accepted"
            count={acceptedCount}
            note="Recorded from acceptTask transaction receipts."
          />
          <StageCard
            label="submitted"
            count={submittedCount}
            note="Recorded from submitTaskResult transaction receipts."
          />
          <StageCard
            label="validated"
            count={validated}
            note="Recorded from settleTask receipts (with fallback to metrics)."
          />
          <StageCard
            label="release/slash"
            count={released + slashed}
            note={`${released} released · ${slashed} slashed`}
          />
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          failure buckets
        </h2>
        {failureBuckets.length === 0 ? (
          <div className="text-xs text-neutral-500">
            no integrity or validation failures in this window.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {failureBuckets.map((bucket) => (
              <div
                key={bucket.key}
                className="border border-neutral-800 rounded p-4 bg-neutral-900/30"
              >
                <div className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-1">
                  reason
                </div>
                <div className="text-sm text-neutral-200 font-mono break-all mb-2">
                  {bucket.key}
                </div>
                <div className="text-xs text-rose-300 font-mono">
                  count {bucket.count}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-12">
        <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
          settlement stream (filtered recent tasks)
        </h2>
        <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900/30 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            showing {recent.length} of {filteredRows.length} filtered
            settlements
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
                <th className="py-2 px-3 font-normal">submit→validate</th>
                <th className="py-2 px-3 font-normal">reason</th>
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
                  <td className="py-2 px-3 text-neutral-300 font-mono">
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
                  <td className="py-2 px-3 text-right">
                    <button
                      className="px-2.5 py-1.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500 hover:bg-neutral-800 font-medium"
                      onClick={() => openModal(row.taskId)}
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
                    colSpan={7}
                    className="py-8 px-3 text-center text-neutral-500"
                  >
                    No settlements match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
          <TaskModalContent taskId={modalTaskId} trace={modalTrace} />
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
function TaskModalContent({
  taskId,
  trace,
}: {
  taskId: string;
  trace: ReasoningTrace | null;
}) {
  const [tab, setTab] = useState<
    "overview" | "decision" | "plan" | "result" | "raw"
  >("overview");

  useEffect(() => {
    setTab("overview");
  }, [taskId]);

  if (!trace) {
    return (
      <div className="p-6">
        <div className="text-lg font-mono text-neutral-200 mb-2">
          Task {taskId.slice(0, 12)}…
        </div>
        <div className="text-neutral-400 text-sm">
          No trace found for this task.
        </div>
      </div>
    );
  }

  const malformed = trace.integrity.malformed;
  const confidencePct = `${(trace.decision.confidenceBps / 100).toFixed(2)}%`;
  const evPct = `${(trace.decision.expectedValueBps / 100).toFixed(2)}%`;

  const rawJson = useMemo(() => {
    return JSON.stringify(trace, null, 2);
  }, [trace]);

  const tabs: Array<{
    key: "overview" | "decision" | "plan" | "result" | "raw";
    label: string;
  }> = [
    { key: "overview", label: "Overview" },
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
            worker <span className="text-neutral-300">{trace.worker}</span> ·
            schema {trace.schemaVersion} ·{" "}
            {new Date(trace.timestamp).toLocaleString()}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip
              label="action"
              value={trace.decision.action}
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
              tone={trace.decision.expectedValueBps >= 0 ? "good" : "bad"}
              description="Expected value estimate for this decision. Positive values are favorable."
            />
            <Chip
              label="success"
              value={String(trace.result.success)}
              tone={trace.result.success ? "good" : "bad"}
              description="Whether task execution completed successfully before settlement."
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

      {malformed && (
        <div className="mb-4 text-xs text-rose-300 border border-rose-900 rounded p-3 bg-rose-950/30">
          Integrity failure: malformed trace
          {trace.integrity.corruptionReason
            ? ` (${trace.integrity.corruptionReason})`
            : ""}
        </div>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <Section title="quick summary">
            <KV k="market" v={trace.decision.marketType} />
            <KV k="notional (USD)" v={String(trace.decision.notionalUsd)} />
            <KV k="horizon" v={`${trace.decision.timeHorizonSec}s`} />
            <KV k="steps" v={String(trace.plan.length)} />
            <KV
              k="resolver"
              v={`${trace.decision.resolver.kind}:${trace.decision.resolver.reference}`}
            />
          </Section>
          <Section title="result preview">
            <KV k="success" v={String(trace.result.success)} />
            <KV k="outputHash" v={formatHash(trace.result.outputHash)} mono />
            <KV k="details" v={trace.result.details} />
          </Section>
        </div>
      )}

      {tab === "decision" && (
        <Section title="decision">
          <KV k="market" v={trace.decision.marketType} />
          <KV k="action" v={trace.decision.action} />
          <KV k="notional (USD)" v={String(trace.decision.notionalUsd)} />
          <KV k="confidence" v={confidencePct} />
          <KV k="EV" v={evPct} />
          <KV k="horizon" v={`${trace.decision.timeHorizonSec}s`} />
          <KV
            k="resolver"
            v={`${trace.decision.resolver.kind}:${trace.decision.resolver.reference}`}
          />
        </Section>
      )}

      {tab === "plan" && (
        <Section title="plan">
          {trace.plan.length === 0 ? (
            <div className="text-neutral-500 text-sm">— empty —</div>
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
          <KV k="success" v={String(trace.result.success)} />
          <KV k="outputHash" v={trace.result.outputHash} mono />
          <KV k="details" v={trace.result.details} />
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
