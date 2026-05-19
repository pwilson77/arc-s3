import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Nav } from "./_components/Nav";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "S3 · agent accountability",
  description:
    "Slash-bonded settlement and reputation substrate for autonomous agents on Arc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <header className="border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between gap-6">
              <Link
                href="/"
                className="flex items-center gap-2 text-neutral-100 font-medium tracking-tight"
              >
                <span className="text-base">S3</span>
                <span
                  className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(252,211,77,0.6)]"
                  aria-hidden
                />
              </Link>
              <Nav />
            </div>
            <div className="mt-2 text-[10px] text-neutral-500 tracking-wide font-mono">
              <span className="text-accent-muted">live</span> · chain=
              {process.env.ARC_CHAIN_ID ?? "5042002"} · escrow=
              {shorten(process.env.S3_ESCROW_COURTHOUSE)} · registry=
              {shorten(process.env.S3_REPUTATION_REGISTRY)} · identity=
              {shorten(process.env.S3_AGENT_IDENTITY_REGISTRY)}
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-12 md:py-16">{children}</main>
        <footer className="max-w-6xl mx-auto px-6 py-10 text-xs text-neutral-500 border-t border-neutral-800 mt-20">
          <div className="flex items-center gap-2">
            <span>S3</span>
            <span className="text-neutral-700">·</span>
            <span>Arc L1 chain {process.env.ARC_CHAIN_ID ?? "5042002"}</span>
            <span className="text-neutral-700">·</span>
            <span>settled in USDC</span>
          </div>
          <div className="mt-1 text-neutral-600">
            accountable agents, not just picks
          </div>
        </footer>
      </body>
    </html>
  );
}

function shorten(addr?: string): string {
  if (!addr || addr.length < 10) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
