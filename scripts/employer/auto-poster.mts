// Periodically posts signed employer-request artifacts so the matcher has work
// to do in the marketplace-only pipeline.
//
// Posts on a loop:
//   - alpha  : sports-bet  ($100, min-edge-bps 50)
//   - delta  : copy-trade  ($100, min-weight-bps 100)
//
// Tunables via env:
//   EMPLOYER_AUTO_POST_INTERVAL_MS (default 60000)
//   EMPLOYER_AUTO_POST_TTL_SECONDS (default 900)
//   EMPLOYER_AUTO_POST_BUDGET_USD  (default 100)
//
// Each loop replaces the prior request for the same (employer, kind) pair via
// Pinata's replaceLatestArtifact with retain=5.

import { Wallet } from "ethers";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), ".env.local"), override: true });

import {
  signEmployerRequest,
  type EmployerKind,
  type EmployerRequestBase,
} from "../../agents/shared/src/employer-request.js";
import { replaceLatestArtifact } from "../../agents/shared/src/ipfs.js";

type Job = {
  employerId: string;
  kind: EmployerKind;
  privateKey: string;
  filter: EmployerRequestBase["filter"];
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function resolveEmployerKey(name: string): string | undefined {
  return process.env[`${name.toUpperCase()}_PRIVATE_KEY`];
}

async function postOne(
  job: Job,
  budgetUsd: number,
  ttlSeconds: number,
  jwt: string,
  network: "public" | "private",
): Promise<void> {
  const signer = new Wallet(job.privateKey);
  const base: EmployerRequestBase = {
    version: "employer-request/v1",
    requestId: randomUUID(),
    employer: { id: job.employerId, wallet: signer.address },
    kind: job.kind,
    filter: job.filter,
    budgetUsdc6: BigInt(Math.round(budgetUsd * 1_000_000)).toString(),
    bondBps: 2500,
    publisherFeeBps: 1000,
    validUntil: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    nonce: randomUUID(),
  };
  const signed = await signEmployerRequest(base, signer);
  const result = await replaceLatestArtifact({
    jwt,
    network,
    category: "employer-request",
    identityKey: `${base.employer.id}:${base.kind}`,
    runId: base.requestId,
    payload: JSON.stringify(signed),
    keyvalues: {
      employerId: base.employer.id,
      employerWallet: base.employer.wallet,
      kind: base.kind,
      requestId: base.requestId,
      validUntil: base.validUntil,
    },
    retain: 5,
  });
  console.log(
    `[employer:auto] posted ${base.employer.id}/${base.kind} request=${base.requestId} cid=${result.cid} validUntil=${base.validUntil}`,
  );
}

async function main(): Promise<void> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is required");
  const network = (process.env.PINATA_NETWORK ?? "public") as
    | "public"
    | "private";
  const intervalMs = envInt("EMPLOYER_AUTO_POST_INTERVAL_MS", 60000);
  const ttlSeconds = envInt("EMPLOYER_AUTO_POST_TTL_SECONDS", 900);
  const budgetUsd = envInt("EMPLOYER_AUTO_POST_BUDGET_USD", 100);

  const jobs: Job[] = [];
  const alphaKey = resolveEmployerKey("alpha");
  if (alphaKey) {
    jobs.push({
      employerId: "alpha",
      kind: "sports-bet",
      privateKey: alphaKey,
      filter: { minNetEdgeBps: 50 },
    });
  } else {
    console.warn("[employer:auto] ALPHA_PRIVATE_KEY missing, skipping alpha");
  }
  const deltaKey = resolveEmployerKey("delta");
  if (deltaKey) {
    jobs.push({
      employerId: "delta",
      kind: "copy-trade",
      privateKey: deltaKey,
      filter: { minWeightBps: 100 },
    });
  } else {
    console.warn("[employer:auto] DELTA_PRIVATE_KEY missing, skipping delta");
  }
  if (jobs.length === 0) throw new Error("no employer keys configured");

  console.log(
    `[employer:auto] starting jobs=${jobs.length} intervalMs=${intervalMs} ttlSec=${ttlSeconds} budgetUsd=${budgetUsd}`,
  );

  const tick = async (): Promise<void> => {
    for (const job of jobs) {
      try {
        await postOne(job, budgetUsd, ttlSeconds, jwt, network);
      } catch (err) {
        console.error(
          `[employer:auto] post failed employer=${job.employerId} kind=${job.kind}:`,
          err,
        );
      }
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
}

main().catch((err) => {
  console.error("[employer:auto] fatal:", err);
  process.exit(1);
});
