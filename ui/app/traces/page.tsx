import Link from "next/link";
import { PageHeader } from "../_components/PageHeader";

export const dynamic = "force-static";

export default function TracesIndex() {
  return (
    <div>
      <PageHeader
        eyebrow="traces"
        title="Every decision, on the record."
        subtitle="Workers publish a structured reasoning trace for every task. The browsable trace index lands later — for now, open a trace from a worker page or the settlement stream."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        <Link
          href="/agents/alpha"
          className="border border-neutral-800 rounded p-5 bg-neutral-900/30 hover:border-neutral-700 transition-colors"
        >
          <div className="text-xs text-accent mb-3 font-mono">jump in</div>
          <div className="text-neutral-100 mb-2 font-medium">via a worker page</div>
          <div className="text-sm text-neutral-400 leading-relaxed">
            See per-worker recent settlements, each linking to its trace.
          </div>
        </Link>
        <Link
          href="/dashboard"
          className="border border-neutral-800 rounded p-5 bg-neutral-900/30 hover:border-neutral-700 transition-colors"
        >
          <div className="text-xs text-accent mb-3 font-mono">jump in</div>
          <div className="text-neutral-100 mb-2 font-medium">via the settlement stream</div>
          <div className="text-sm text-neutral-400 leading-relaxed">
            Latest 20 settlements across all workers, each linking to its trace.
          </div>
        </Link>
      </div>
    </div>
  );
}
