import { readAllEvents } from "@/lib/metrics";
import { readLatestTracesByTaskId } from "@/lib/traces";
import { readLifecycleEvents } from "@/lib/lifecycle";
import { NetworkClient } from "./NetworkClient";

export const dynamic = "force-dynamic";
export const revalidate = 5;

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => resolve(fallback), timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } catch {
    return fallback;
  }
}

export default async function NetworkIndex() {
  const [events, latestTraces, lifecycleEvents] = await Promise.all([
    withTimeout(readAllEvents(), 2500, []),
    withTimeout(readLatestTracesByTaskId(), 10000, []),
    withTimeout(readLifecycleEvents(), 12000, []),
  ]);

  return (
    <NetworkClient
      events={events}
      latestTraces={latestTraces}
      lifecycleEvents={lifecycleEvents}
    />
  );
}
