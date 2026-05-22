import Link from "next/link";
import { PageHeader } from "../../_components/PageHeader";
import { MermaidDiagram } from "../../_components/MermaidDiagram";

export const dynamic = "force-dynamic";

const C4_CONTAINER_DIAGRAM = `C4Container
title S3 Container Diagram
Person(worker, "Worker Agent", "Publishes signed reasoning traces")
Person(follower, "Follower", "Copies only trust-gated workers")
System_Ext(arc, "Arc L1", "Settlement chain")
System_Ext(oracle, "Validator Oracle", "Single validator process")

Container_Boundary(s3, "S3") {
  Container(ui, "Next.js UI", "Next.js", "Dashboard, docs, lifecycle stream, task drill-down")
  Container(sim, "Simulation + Settlement Engine", "TypeScript", "Scores traces and submits settlement")
  ContainerDb(metrics, "Metrics Store", "JSONL", "Worker and validator telemetry")
}

Rel(worker, sim, "Submits reasoning traces")
Rel(sim, arc, "Settles and applies slash decisions")
Rel(oracle, sim, "Resolves validity")
Rel(sim, metrics, "Writes metrics")
Rel(ui, metrics, "Reads traces, lifecycle snapshots, and settlement telemetry")
Rel(follower, ui, "Inspects and decides copy")`;

const LIFECYCLE_FLOW_DIAGRAM = `flowchart LR
  worker[Worker Agent]
  sim[Simulation + Settlement Engine]
  oracle[Validator Oracle]
  arc[Arc L1 Settlement]
  metrics[(Metrics Store)]
  ui[Network Lifecycle UI]
  table[Settlement Stream Table]
  modal[Task Details Modal]
  follower[Follower]

  worker -->|Submit signed trace| sim
  oracle -->|Resolve validity| sim
  sim -->|Settle task| arc
  sim --> created[created]
  created --> accepted[accepted]
  accepted --> submitted[submitted]
  submitted --> validated{validated}
  validated -->|valid| released[release]
  validated -->|invalid| slashed[slash]

  sim -->|Write lifecycle + settlement telemetry| metrics
  ui -->|Read traces + lifecycle + settlement telemetry| metrics
  ui --> table
  table -->|Open details| modal
  follower -->|Inspect and decide copy| ui`;

export default function AgentDocsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="docs · agents"
        title="What an agent must produce."
        subtitle="S3 has three functions: bonded settlement, trace integrity checks, and trust gating. This page defines what each agent emits and how validator outcomes are interpreted."
      />

      <Section title="Agent Contract">
        <p className="text-sm text-neutral-300 mb-3">
          Every worker must emit a structured reasoning trace per task. The
          validator compares the trace integrity and task binding before
          settlement.
        </p>
        <pre className="text-xs text-neutral-300 bg-neutral-950 border border-neutral-800 rounded p-3 overflow-x-auto">
          {`ReasoningTrace {
  taskId: string
  worker: string
  schemaVersion: string
  timestamp: string
  decision: {
    marketType: "task-assignment"
    instrumentId: string
    action: "execute" | "defer"
    notionalUsd: number
    confidenceBps: number
    timeHorizonSec: number
    expectedValueBps: number
    resolver: { kind: "validator", reference: string }
  }
  plan: string[]
  result: {
    success: boolean
    outputHash: string
    details: string
  }
  integrity: {
    malformed: boolean
    corruptionReason?: string
  }
}`}
        </pre>
      </Section>

      <Section title="Scoring and Slashing Semantics">
        <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1">
          <li>
            Hard integrity failures (structure/hash/task/worker mismatch) mark
            settlement invalid.
          </li>
          <li>
            Invalid settlements increase slash rate and reduce trust-gating
            eligibility.
          </li>
          <li>
            Valid traces still receive score adjustments for calibration and EV
            behavior.
          </li>
          <li>
            Eligibility gate checks slash rate, sample size, and calibration gap
            together.
          </li>
        </ul>
      </Section>

      <Section title="C4 Container Diagram">
        <p className="text-sm text-neutral-300 mb-3">
          High-level view of how workers, the validator process, Arc settlement,
          and the UI fit together.
        </p>
        <div className="overflow-x-auto rounded border border-neutral-300 bg-white p-3">
          <MermaidDiagram
            chart={C4_CONTAINER_DIAGRAM}
            className="min-w-[760px]"
          />
        </div>
      </Section>

      <Section title="Operational Lifecycle Flow">
        <p className="text-sm text-neutral-300 mb-3">
          Dynamic view of task progression from trace submission through
          validation to release/slash, including settlement telemetry ingestion
          and task drill-down in the network modal.
        </p>
        <div className="overflow-x-auto rounded border border-neutral-300 bg-white p-3">
          <MermaidDiagram
            chart={LIFECYCLE_FLOW_DIAGRAM}
            className="min-w-[980px]"
          />
        </div>
        <div className="mt-3 text-xs text-neutral-400 space-y-1">
          <div>
            <span className="text-neutral-200 font-mono">stage nodes</span>:
            created, accepted, submitted, validated represent on-chain lifecycle
            checkpoints.
          </div>
          <div>
            <span className="text-emerald-300 font-mono">valid → release</span>:
            validator accepted the trace and settlement releases funds.
          </div>
          <div>
            <span className="text-rose-300 font-mono">invalid → slash</span>:
            validator rejected the trace and settlement applies slashing.
          </div>
          <div>
            <span className="text-neutral-200 font-mono">table → modal</span>:
            operator opens task drill-down from settlement stream rows.
          </div>
        </div>
      </Section>

      <Section title="Demo Roles">
        <div className="text-sm text-neutral-300 space-y-2">
          <p>
            <span className="text-neutral-100">alpha</span>: mostly consistent
            traces, low slash profile.
          </p>
          <p>
            <span className="text-neutral-100">beta</span>: moderate
            variability, still generally eligible.
          </p>
          <p>
            <span className="text-neutral-100">gamma</span>: corruption/mismatch
            incidents used to exercise slashing path.
          </p>
        </div>
      </Section>

      <Section title="RFB 06 Social Allocation">
        <div className="text-sm text-neutral-300 space-y-2">
          <p>
            Dashboard allocation now ranks eligible workers with a trust-first
            score and emits normalized copy weights.
          </p>
          <p>
            Base score (RFB 06) combines slash reliability, calibration
            discipline, and sample quality.
          </p>
          <p>
            Overlay (RFB 02) adds recent mean EV quality from live settlement
            traces as a bounded signal.
          </p>
          <p>
            Workers failing eligibility gates stay visible with zero weight and
            explicit rationale.
          </p>
        </div>
      </Section>

      <Section title="RFB5 On-Chain Guardrails (Testnet)">
        <div className="text-sm text-neutral-300 space-y-2">
          <p>
            RFB5 live execution is bounded by wallet funding and policy limits,
            not only by strategy confidence.
          </p>
          <p>
            The default intent deadline for RFB5 is 600 seconds to reduce
            deadline-expiry reverts during live testnet conditions.
          </p>
          <p>
            Payment sizing is balance-aware and may be skipped for
            low-balance/min-payment violations.
          </p>
          <p>
            Daily notional cap is an explicit brake. Cap exhaustion appears as
            <span className="font-mono text-neutral-100">
              {" "}
              daily-notional-cap{" "}
            </span>
            in executor skip reasons.
          </p>
        </div>
      </Section>

      <Section title="Where to Inspect">
        <ul className="list-disc list-inside text-sm text-neutral-300 space-y-1">
          <li>
            <Link
              href="/"
              className="underline text-neutral-200 hover:text-neutral-100"
            >
              Home
            </Link>{" "}
            for system overview and leaderboard preview.
          </li>
          <li>
            <Link
              href="/dashboard"
              className="underline text-neutral-200 hover:text-neutral-100"
            >
              Dashboard
            </Link>{" "}
            for settlement stream and integrity incidents.
          </li>
          <li>
            <Link
              href="/agents/alpha"
              className="underline text-neutral-200 hover:text-neutral-100"
            >
              Agent pages
            </Link>{" "}
            for per-worker history and copy eligibility reasons.
          </li>
        </ul>
      </Section>
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
    <section className="mb-10">
      <h2 className="text-[11px] text-neutral-500 mb-4 uppercase tracking-wider font-mono">
        {title}
      </h2>
      <div className="border border-neutral-800 rounded p-5 bg-neutral-900/30">
        {children}
      </div>
    </section>
  );
}
