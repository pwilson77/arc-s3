export type TaskAssignment = {
  taskId: string;
  employer: string;
  worker: string;
  paymentAmount: bigint;
  bondAmount: bigint;
};

export type DecisionAction = "execute" | "defer";

export type DecisionContext = {
  marketType: "task-assignment";
  instrumentId: string;
  action: DecisionAction;
  notionalUsd: number;
  confidenceBps: number;
  timeHorizonSec: number;
  expectedValueBps: number;
  resolver: {
    kind: "validator";
    reference: string;
  };
};

export type ReasoningTrace = {
  taskId: string;
  worker: string;
  schemaVersion: string;
  timestamp: string;
  decision: DecisionContext;
  plan: string[];
  result: {
    success: boolean;
    outputHash: string;
    details: string;
  };
  integrity: {
    malformed: boolean;
    corruptionReason?: string;
  };
};
