import { readAllEvents } from "@/lib/metrics";
import { readLatestTracesByTaskId } from "@/lib/traces";
import { readLifecycleEvents } from "@/lib/lifecycle";
import { NetworkClient } from "./NetworkClient";

export const dynamic = "force-dynamic";
export const revalidate = 5;

export default async function NetworkIndex() {
  const [events, latestTraces, lifecycleEvents] = await Promise.all([
    readAllEvents(),
    readLatestTracesByTaskId(),
    readLifecycleEvents(),
  ]);

  return (
    <NetworkClient
      events={events}
      latestTraces={latestTraces}
      lifecycleEvents={lifecycleEvents}
    />
  );
}
