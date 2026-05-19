export type CalibrationSnapshot = {
  sampleSize: number;
  meanConfidenceBps: number;
  hitRateBps: number;
  calibrationGapBps: number;
};

export type WorkerAggregateMetrics = {
  totalSettled: number;
  validSettled: number;
  invalidSettled: number;
  slashRateBps: number;
  meanScore: number;
  scoreDriftBps: number;
  calibration: CalibrationSnapshot;
};

export type MetricsEvent = {
  timestamp: string;
  taskId: string;
  worker: string;
  valid: boolean;
  score: string;
  confidenceBps: number;
  expectedValueBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
};

export type WorkerSnapshot = {
  worker: string;
  latest: MetricsEvent;
  events: MetricsEvent[];
};

export type Rfb6Allocation = {
  worker: string;
  eligible: boolean;
  status: "eligible" | "gated";
  rawScore: number;
  weightBps: number;
  meanRecentEvBps: number;
  reasons: string[];
  aggregate: WorkerAggregateMetrics;
};

export type Rfb6RunEvent = {
  runId: string;
  timestamp: string;
  sourceMetricsFile: string;
  sourceEventCount: number;
  sourceLatestTimestamp: string;
  workers: Rfb6Allocation[];
};
