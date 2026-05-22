export default function LoadingAgentsPage() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 rounded bg-neutral-800" />
      <div className="h-4 w-[32rem] max-w-full rounded bg-neutral-900" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="h-48 rounded border border-neutral-800 bg-neutral-900/30" />
        <div className="h-48 rounded border border-neutral-800 bg-neutral-900/30" />
        <div className="h-48 rounded border border-neutral-800 bg-neutral-900/30" />
      </div>
    </div>
  );
}
