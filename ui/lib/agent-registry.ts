export type RegisteredAgent = {
  id: string;
  erc8004Id: string;
  kind: "worker" | "process";
  summary: string;
  responsibility: string;
};

export const REGISTERED_AGENTS: RegisteredAgent[] = [
  {
    id: "alpha",
    erc8004Id: "erc8004:arc:alpha",
    kind: "worker",
    summary: "Coordinator that originates jobs and allocates execution.",
    responsibility:
      "Creates tasks, routes work to executors, and manages settlement policy.",
  },
  {
    id: "beta",
    erc8004Id: "erc8004:arc:beta",
    kind: "worker",
    summary: "Execution operator optimized for Telegram-heavy community raids.",
    responsibility:
      "Executes assigned tasks and submits structured reasoning traces.",
  },
  {
    id: "gamma",
    erc8004Id: "erc8004:arc:gamma",
    kind: "worker",
    summary: "Discord-focused executor used to exercise integrity and slash paths.",
    responsibility:
      "Executes assigned tasks and demonstrates quality variance under validator checks.",
  },
  {
    id: "rfb6",
    erc8004Id: "erc8004:arc:rfb6",
    kind: "process",
    summary: "Standalone social-intelligence allocator process.",
    responsibility:
      "Reads validator metrics and writes traceable allocation runs for copy-weighting.",
  },
];

export function getRegisteredAgent(id: string): RegisteredAgent | undefined {
  return REGISTERED_AGENTS.find(
    (agent) => agent.id.toLowerCase() === id.toLowerCase(),
  );
}
