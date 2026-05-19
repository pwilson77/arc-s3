import Link from "next/link";

const LINKS: { href: string; label: string }[] = [
  { href: "/agents", label: "agents" },
  { href: "/network", label: "network" },
  { href: "/traces", label: "traces" },
  { href: "/docs/agents", label: "docs" },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-6 text-xs font-mono uppercase tracking-wider">
      {LINKS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="text-neutral-400 hover:text-neutral-100 transition-colors"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
