import Link from "next/link";
import { PageHeader } from "./_components/PageHeader";

export default function NotFound() {
  return (
    <div>
      <PageHeader
        eyebrow="404"
        title="Nothing here."
        subtitle="That path doesn't exist in S3 (yet). Jump back to the network overview or pick an agent."
      />
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/"
          className="px-4 py-2 rounded border border-neutral-700 text-neutral-100 hover:border-neutral-500"
        >
          home
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
        >
          network →
        </Link>
      </div>
    </div>
  );
}
