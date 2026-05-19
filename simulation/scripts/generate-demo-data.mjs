// Generates demo data for the S3 UI without requiring a live Arc deployment.
// Writes:
//   simulation/data/metrics/validator-metrics.jsonl  (one MetricsEvent per settlement)
//   simulation/data/traces/<taskId>-<worker>.json     (matching ReasoningTrace files)
//
// Usage: node simulation/scripts/generate-demo-data.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "data");
const METRICS_DIR = join(ROOT, "metrics");
const TRACES_DIR = join(ROOT, "traces");

// ---------------------------------------------------------------------------
// Story per agent: alpha=clean, beta=ok, gamma=getting slashed.
// ---------------------------------------------------------------------------
const PLAN = {
  alpha: {
    settlements: 24,
    slashEvery: 12, // ~8% slash rate -> eligible
    baseConfidence: 9100, // ≈ hit rate of 92% -> small calibration gap
    confidenceJitter: 250,
    horizonSec: 300,
    startScore: 0.91,
    drift: +0.04,
  },
  beta: {
    settlements: 16,
    slashEvery: 10, // ~6% slash rate -> eligible
    baseConfidence: 9200, // ≈ hit rate, slight overconfidence
    confidenceJitter: 300,
    horizonSec: 600,
    startScore: 0.86,
    drift: +0.02,
  },
  gamma: {
    settlements: 20,
    slashEvery: 3, // ~33% slash rate -> NOT eligible (slash + calib gap)
    baseConfidence: 9200, // overconfident vs ~67% hit rate -> ~25% calib gap
    confidenceJitter: 400,
    horizonSec: 180,
    startScore: 0.78,
    drift: -0.08,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const START_MS = Date.parse("2026-05-16T14:00:00Z");
const TICK_MS = 45_000; // 45s between settlements

function randId() {
  return "0x" + randomBytes(16).toString("hex");
}
function hashOf(s) {
  return "0x" + createHash("sha256").update(s).digest("hex");
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
function jitter(base, spread, seed) {
  // deterministic-ish jitter so reruns are stable
  const h = createHash("sha256").update(String(seed)).digest();
  const r = h.readUInt16BE(0) / 0xffff; // 0..1
  return Math.round(base + (r * 2 - 1) * spread);
}

function makeTrace({
  taskId,
  worker,
  ts,
  confidenceBps,
  evBps,
  horizonSec,
  valid,
}) {
  const malformed = !valid;
  const planSteps = [
    `survey-market:${worker}`,
    `score-candidates:n=${3 + (taskId.charCodeAt(4) % 5)}`,
    `commit:confidence=${confidenceBps}bps`,
  ];
  const resultDetails = valid
    ? `settled-on-arc taskId=${taskId.slice(0, 10)}…`
    : `integrity-failure taskId=${taskId.slice(0, 10)}…`;
  const outputHash = hashOf(`${taskId}|${worker}|${valid}`);
  return {
    taskId,
    worker,
    schemaVersion: "1.0.0",
    timestamp: new Date(ts).toISOString(),
    decision: {
      marketType: "task-assignment",
      instrumentId: `arc.task:${worker}`,
      action: "execute",
      notionalUsd: 250,
      confidenceBps,
      timeHorizonSec: horizonSec,
      expectedValueBps: evBps,
      resolver: { kind: "validator", reference: "S3EscrowCourthouse" },
    },
    plan: planSteps,
    result: {
      success: valid,
      outputHash,
      details: resultDetails,
    },
    integrity: malformed
      ? {
          malformed: true,
          corruptionReason:
            taskId.charCodeAt(5) % 2 === 0
              ? "hash-mismatch"
              : "worker-mismatch",
        }
      : { malformed: false },
  };
}

// rolling 20-event window calibration, mirroring simulation/src/metrics.ts behavior
function makeAggregate(history) {
  const total = history.length;
  const valid = history.filter((e) => e.valid).length;
  const invalid = total - valid;
  const slashRateBps = total === 0 ? 0 : Math.round((invalid / total) * 10_000);

  const sumScore = history.reduce((a, e) => a + Number(e.score), 0);
  const meanScore = total === 0 ? 0 : sumScore / total;

  const first = Number(history[0]?.score ?? 0);
  const last = Number(history[history.length - 1]?.score ?? 0);
  const scoreDriftBps =
    first === 0 ? 0 : Math.round(((last - first) / Math.abs(first)) * 10_000);

  const recent = history.slice(-20);
  const meanConfidenceBps = Math.round(
    recent.reduce((a, e) => a + e.confidenceBps, 0) / recent.length,
  );
  const hitRateBps = Math.round(
    (recent.filter((e) => e.valid).length / recent.length) * 10_000,
  );
  const calibrationGapBps = Math.abs(meanConfidenceBps - hitRateBps);

  return {
    totalSettled: total,
    validSettled: valid,
    invalidSettled: invalid,
    slashRateBps,
    meanScore: Math.round(meanScore * 1_000_000) / 1_000_000,
    scoreDriftBps,
    calibration: {
      sampleSize: recent.length,
      meanConfidenceBps,
      hitRateBps,
      calibrationGapBps,
    },
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(METRICS_DIR, { recursive: true });
  await mkdir(TRACES_DIR, { recursive: true });

  const lines = [];
  const traceWrites = [];

  // Interleave settlements across workers chronologically.
  /** @type {Array<{worker:string, idx:number, ts:number}>} */
  const queue = [];
  for (const worker of Object.keys(PLAN)) {
    const cfg = PLAN[worker];
    for (let i = 0; i < cfg.settlements; i++) {
      // stagger each worker so timestamps are interleaved naturally
      const ts =
        START_MS +
        i * TICK_MS +
        (worker === "alpha" ? 0 : worker === "beta" ? 15_000 : 30_000);
      queue.push({ worker, idx: i, ts });
    }
  }
  queue.sort((a, b) => a.ts - b.ts);

  const histories = { alpha: [], beta: [], gamma: [] };

  for (const item of queue) {
    const cfg = PLAN[item.worker];
    const isSlash = (item.idx + 1) % cfg.slashEvery === 0;
    const valid = !isSlash;

    const taskId = randId();
    const confidenceBps = clamp(
      jitter(
        cfg.baseConfidence,
        cfg.confidenceJitter,
        `${item.worker}-${item.idx}`,
      ),
      500,
      9900,
    );
    const evBps = valid
      ? jitter(180, 120, taskId + "ev")
      : -jitter(220, 180, taskId + "ev");
    const horizonSec = cfg.horizonSec;

    // score interpolates from startScore to startScore+drift, with small noise
    const t = item.idx / Math.max(1, cfg.settlements - 1);
    const baseScore = cfg.startScore + cfg.drift * t;
    const noise = jitter(0, 40, taskId + "n") / 10_000; // ±0.004
    const rawScore = clamp(baseScore + noise - (valid ? 0 : 0.07), 0, 1);
    const scoreScaled = BigInt(Math.round(rawScore * 1_000_000));

    const reasons = valid
      ? evBps < 0
        ? ["negative-ev-penalty"]
        : ["calibrated"]
      : [taskId.charCodeAt(5) % 2 === 0 ? "hash-mismatch" : "worker-mismatch"];

    histories[item.worker].push({
      valid,
      confidenceBps,
      score: scoreScaled.toString(),
    });

    const aggregate = makeAggregate(histories[item.worker]);

    /** @type {MetricsEvent} */
    const event = {
      timestamp: new Date(item.ts).toISOString(),
      taskId,
      worker: item.worker,
      valid,
      score: scoreScaled.toString(),
      confidenceBps,
      expectedValueBps: evBps,
      reasons,
      aggregate,
    };
    lines.push(JSON.stringify(event));

    const trace = makeTrace({
      taskId,
      worker: item.worker,
      ts: item.ts,
      confidenceBps,
      evBps,
      horizonSec,
      valid,
    });
    traceWrites.push(
      writeFile(
        join(TRACES_DIR, `${taskId}-${item.worker}.json`),
        JSON.stringify(trace, null, 2),
      ),
    );
  }

  await writeFile(
    join(METRICS_DIR, "validator-metrics.jsonl"),
    lines.join("\n") + "\n",
  );
  await Promise.all(traceWrites);

  console.log(
    `wrote ${lines.length} metric rows -> ${METRICS_DIR}/validator-metrics.jsonl`,
  );
  console.log(`wrote ${traceWrites.length} traces       -> ${TRACES_DIR}/`);
  const summary = Object.fromEntries(
    Object.entries(histories).map(([w, h]) => {
      const agg = makeAggregate(h);
      return [
        w,
        `n=${agg.totalSettled} slash=${(agg.slashRateBps / 100).toFixed(
          1,
        )}% calibGap=${(agg.calibration.calibrationGapBps / 100).toFixed(
          1,
        )}% meanScore=${agg.meanScore.toFixed(3)}`,
      ];
    }),
  );
  console.log("summary:", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
