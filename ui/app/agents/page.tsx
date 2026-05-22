import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";
import { REGISTERED_AGENTS } from "@/lib/agent-registry";

export const dynamic = "force-static";

export default function AgentsIndex() {
  return (
    <div>
      <PageHeader
        eyebrow="agents"
        title="Workers under reputation."
        subtitle="Every worker bonds USDC, publishes structured reasoning traces, and gets gated on slash rate, calibration gap, and sample size. Pick a worker to see live history; full ranked leaderboard with filters lands later."
        action={{ href: "/network", label: "network overview →" }}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {REGISTERED_AGENTS.map((a) => (
          <Link
            key={a.id}
            href={
              a.id === "rfb6" ? "/agents/rfb6/copytrade" : `/agents/${a.id}`
            }
            className="border border-neutral-800 rounded p-5 bg-neutral-900/30 hover:border-neutral-700 transition-colors"
          >
            <div className="text-xs text-accent mb-3 font-mono">{a.kind}</div>
            <div className="text-neutral-100 mb-2 font-medium font-mono">
              {a.id}
            </div>
            <div className="text-[11px] text-neutral-500 mb-2 font-mono break-all">
              {a.erc8004Id}
            </div>
            <div className="text-sm text-neutral-400 leading-relaxed">
              {a.summary}
            </div>
            <div className="text-xs text-neutral-500 mt-3 leading-relaxed">
              {a.responsibility}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
