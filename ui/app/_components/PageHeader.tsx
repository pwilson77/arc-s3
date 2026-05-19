import Link from "next/link";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-12">
      <div className="text-[11px] text-accent mb-4 uppercase tracking-[0.18em] font-mono">
        {eyebrow}
      </div>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <h1 className="text-3xl md:text-4xl text-neutral-50 leading-[1.1] tracking-tight max-w-3xl">
          {title}
        </h1>
        {action && (
          <Link
            href={action.href}
            className="px-3 py-1.5 rounded border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100 text-xs whitespace-nowrap"
          >
            {action.label}
          </Link>
        )}
      </div>
      {subtitle && (
        <p className="text-base text-neutral-400 mt-4 max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}
