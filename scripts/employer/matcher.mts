// Employer-request matcher.
//
// Polls Pinata for `employer-request` artifacts, pairs each open request with
// a candidate from the latest rfb5 / rfb6 publisher run, and creates a task
// on-chain funded by the employer's wallet. Each fulfilled request is recorded
// in a local state file so it is not double-spent.
//
// This is the consumer side of the marketplace model. The producer side is
// `scripts/employer/post-request.ts`. The on-chain submission is delegated to
// `publishTasksOnChain` from `@arc-s3/agent-shared`, so the matcher does not
// duplicate Courthouse / firewall logic.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as dotenv from "dotenv";
import { Wallet, getAddress } from "ethers";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), ".env.local"), override: true });

import {
  employerRequestSchema,
  fileStateStore,
  listPinataFilesByCategory,
  publishTasksOnChain,
  verifyEmployerRequest,
  isRequestExpired,
  type EmployerRequest,
  type PublishCandidate,
  type PublishHooks,
  type PinataFileRecord,
} from "../../agents/shared/src/index.js";

type ArbDecision = {
  eventKey: string;
  eventLabel: string;
  sport: string;
  netEdgeBps: number;
  recommendedSizeUsd: number;
  profitable: boolean;
};

type Rfb5Run = {
  runId: string;
  publisher: { erc8004Id: string; wallet: string };
  decisions: ArbDecision[];
};

type Rfb6Allocation = {
  worker: string;
  weightBps: number;
  eligible: boolean;
  status: string;
};

type Rfb6Run = {
  runId: string;
  publisher: { erc8004Id: string; wallet: string };
  workers: Rfb6Allocation[];
};

type MatcherState = {
  fulfilledRequestIds: string[];
};

const STATE_FILE = resolve(
  process.env.EMPLOYER_MATCHER_STATE_FILE ??
    "./simulation/data/employer/matcher-state.json",
);

const GATEWAY = (
  process.env.IPFS_GATEWAY_BASE_URL ?? "https://gateway.pinata.cloud/ipfs"
).replace(/\/+$/, "");
const PINATA_NETWORK = (process.env.PINATA_NETWORK ?? "public") as
  | "public"
  | "private";
const PINATA_JWT = process.env.PINATA_JWT ?? "";
const POLL_MS = Number(process.env.EMPLOYER_MATCHER_POLL_MS ?? "15000");
const ONCE = process.argv.includes("--once");
const REQUEST_ID_FILTER = process.env.EMPLOYER_MATCHER_REQUEST_ID ?? null;

const ARC_RPC_URL = mustEnv("ARC_RPC_URL");
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? "5042002");
const USDC_ADDRESS = mustEnv("USDC_ADDRESS");
const S3_INTENT_FIREWALL = mustEnv("S3_INTENT_FIREWALL");
const S3_ESCROW_COURTHOUSE = mustEnv("S3_ESCROW_COURTHOUSE");
const BETA_PRIVATE_KEY = mustEnv("BETA_PRIVATE_KEY");
const GAMMA_PRIVATE_KEY = mustEnv("GAMMA_PRIVATE_KEY");

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

async function loadState(): Promise<MatcherState> {
  if (!existsSync(STATE_FILE)) return { fulfilledRequestIds: [] };
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as MatcherState;
    return {
      fulfilledRequestIds: Array.isArray(parsed.fulfilledRequestIds)
        ? parsed.fulfilledRequestIds
        : [],
    };
  } catch {
    return { fulfilledRequestIds: [] };
  }
}

async function saveState(state: MatcherState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function fetchJson<T>(cid: string): Promise<T> {
  const clean = cid.replace(/^ipfs:\/\//, "").replace(/^\/+/, "");
  const url = `${GATEWAY}/${clean}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`gateway fetch failed ${res.status} for ${cid}`);
  }
  return (await res.json()) as T;
}

async function loadEmployerRequests(): Promise<EmployerRequest[]> {
  const records: PinataFileRecord[] = await listPinataFilesByCategory({
    jwt: PINATA_JWT,
    network: PINATA_NETWORK,
    category: "employer-request",
    max: 50,
  });
  const out: EmployerRequest[] = [];
  for (const rec of records) {
    try {
      const raw = await fetchJson<unknown>(rec.cid);
      const parsed = employerRequestSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[matcher] skip malformed employer-request cid=${rec.cid} reason=${
            parsed.error.issues[0]?.message ?? "schema"
          }`,
        );
        continue;
      }
      if (REQUEST_ID_FILTER && parsed.data.requestId !== REQUEST_ID_FILTER) {
        continue;
      }
      out.push(parsed.data);
    } catch (err) {
      console.warn(
        `[matcher] failed to load employer-request ${rec.id}:`,
        (err as Error).message,
      );
    }
  }
  return out;
}

async function loadLatestRun<T>(category: string): Promise<T | null> {
  const records = await listPinataFilesByCategory({
    jwt: PINATA_JWT,
    network: PINATA_NETWORK,
    category,
    max: 1,
  });
  if (records.length === 0) return null;
  try {
    return await fetchJson<T>(records[0].cid);
  } catch (err) {
    console.warn(
      `[matcher] failed to load latest ${category}:`,
      (err as Error).message,
    );
    return null;
  }
}

function pickWorker(eventKey: string, beta: string, gamma: string): string {
  let hash = 0;
  for (let i = 0; i < eventKey.length; i += 1) {
    hash = (hash * 31 + eventKey.charCodeAt(i)) >>> 0;
  }
  return hash % 2 === 0 ? beta : gamma;
}

function matchSportsBet(
  req: EmployerRequest,
  run: Rfb5Run,
  workers: { beta: string; gamma: string },
): PublishCandidate | null {
  const minEdge = req.filter.minNetEdgeBps ?? 0;
  const sport = req.filter.sport?.toLowerCase();
  const eligible = run.decisions
    .filter((d) => d.profitable)
    .filter((d) => d.netEdgeBps >= minEdge)
    .filter((d) => (sport ? d.sport.toLowerCase() === sport : true))
    .sort((a, b) => b.netEdgeBps - a.netEdgeBps);
  const decision = eligible[0];
  if (!decision) return null;
  return {
    candidateId: `${req.requestId}:${decision.eventKey}`,
    candidateLabel: `${req.employer.id}/${decision.eventLabel}`,
    workerAddress: pickWorker(decision.eventKey, workers.beta, workers.gamma),
    recommendedSizeUsd: decision.recommendedSizeUsd,
    extras: {
      employerRequestId: req.requestId,
      employerId: req.employer.id,
      netEdgeBps: decision.netEdgeBps,
      eventKey: decision.eventKey,
    },
    keyvalues: {
      employerRequestId: req.requestId,
      eventKey: decision.eventKey,
    },
  };
}

function matchCopyTrade(
  req: EmployerRequest,
  run: Rfb6Run,
  workers: { beta: string; gamma: string },
): PublishCandidate | null {
  const minWeight = req.filter.minWeightBps ?? 0;
  const allow = (req.filter.workerAllowlist ?? ["beta", "gamma"]).map((s) =>
    s.toLowerCase(),
  );
  const eligible = run.workers
    .filter((w) => w.eligible)
    .filter((w) => w.weightBps >= minWeight)
    .filter((w) => allow.includes(w.worker.toLowerCase()))
    .sort((a, b) => b.weightBps - a.weightBps);
  const alloc = eligible[0];
  if (!alloc) return null;
  const key = alloc.worker.toLowerCase();
  const workerAddress =
    key === "beta" ? workers.beta : key === "gamma" ? workers.gamma : null;
  if (!workerAddress) return null;
  // Convert budget (USDC6) to a USD notional for the publisher's sizing.
  const budgetUsd = Number(BigInt(req.budgetUsdc6)) / 1_000_000;
  return {
    candidateId: `${req.requestId}:${alloc.worker}`,
    candidateLabel: `${req.employer.id}/${alloc.worker}@${(
      alloc.weightBps / 100
    ).toFixed(2)}%`,
    workerAddress,
    recommendedSizeUsd: budgetUsd,
    extras: {
      employerRequestId: req.requestId,
      employerId: req.employer.id,
      weightBps: alloc.weightBps,
      worker: alloc.worker,
    },
    keyvalues: {
      employerRequestId: req.requestId,
      worker: alloc.worker,
    },
  };
}

function resolveEmployerPrivateKey(employerId: string): string | null {
  const envName = `${employerId.toUpperCase()}_PRIVATE_KEY`;
  return process.env[envName] ?? process.env.EMPLOYER_PRIVATE_KEY ?? null;
}

async function fulfill(
  req: EmployerRequest,
  candidate: PublishCandidate,
  publisher: { erc8004Id: string; wallet: string },
): Promise<boolean> {
  const employerKey = resolveEmployerPrivateKey(req.employer.id);
  if (!employerKey) {
    console.warn(
      `[matcher] skip request=${req.requestId} employer=${req.employer.id} reason=no-private-key`,
    );
    return false;
  }
  const employerWallet = new Wallet(employerKey).address;
  if (getAddress(employerWallet) !== getAddress(req.employer.wallet)) {
    console.warn(
      `[matcher] skip request=${req.requestId} reason=wallet-key-mismatch signer=${employerWallet} expected=${req.employer.wallet}`,
    );
    return false;
  }

  const budgetUsdc6 = BigInt(req.budgetUsdc6);
  const maxTotalCommitUsdc6 = BigInt(
    process.env.EMPLOYER_MAX_TOTAL_COMMIT_USDC6 ?? "2000000",
  );
  // Enforce a hard per-task spend ceiling, including payment + bond.
  // totalCommit = payment + payment*bondBps/10000
  const maxPaymentByCommitUsdc6 =
    (maxTotalCommitUsdc6 * 10_000n) / (10_000n + BigInt(req.bondBps));
  const maxPaymentUsdc6 =
    budgetUsdc6 < maxPaymentByCommitUsdc6
      ? budgetUsdc6
      : maxPaymentByCommitUsdc6;
  const minPaymentUsdc6 = BigInt(
    process.env.EMPLOYER_MIN_PAYMENT_USDC6 ?? "100000000",
  );
  const dailyCapUsdc6 = BigInt(
    process.env.EMPLOYER_DAILY_NOTIONAL_CAP_USDC6 ??
      (budgetUsdc6 * 100n).toString(),
  );

  const stateFile = resolve(
    `./simulation/data/employer/publisher-state-${req.employer.id}.json`,
  );

  const hooks: PublishHooks = {
    agentId: `employer-${req.employer.id}`,
    runId: `${req.requestId}-${Date.now()}`,
    publisher,
    candidates: [candidate],
    policy: {
      dryRun: process.env.EMPLOYER_DRY_RUN === "true",
      maxTasksPerRun: 1,
      sizeScale: 1,
      minPaymentUsdc6,
      maxPaymentUsdc6,
      dailyNotionalCapUsdc6: dailyCapUsdc6,
      bondBps: req.bondBps,
      publisherFeeBps: req.publisherFeeBps,
      quotedSlippageBps: Number(process.env.INTENT_QUOTED_SLIPPAGE_BPS ?? "50"),
      defaultGasLimit: Number(
        process.env.INTENT_DEFAULT_GAS_LIMIT ??
          process.env.DEFAULT_GAS_LIMIT ??
          "800000",
      ),
      defaultDeadlineSeconds: Number(
        process.env.INTENT_DEFAULT_DEADLINE_SECONDS ?? "120",
      ),
    },
    runtime: {
      rpcUrl: ARC_RPC_URL,
      chainId: ARC_CHAIN_ID,
      usdcAddress: USDC_ADDRESS,
      firewallAddress: S3_INTENT_FIREWALL,
      courthouseAddress: S3_ESCROW_COURTHOUSE,
      followerPrivateKey: employerKey,
    },
    ipfs: {
      enabled: process.env.PINATA_UPLOAD_ENABLED !== "false",
      jwt: PINATA_JWT,
      network: PINATA_NETWORK,
      eventCategory: "employer-executor-event",
    },
    state: fileStateStore(stateFile),
  };

  const result = await publishTasksOnChain(hooks);
  console.log(
    `[matcher] request=${req.requestId} employer=${req.employer.id} candidate=${
      candidate.candidateId
    } result=${JSON.stringify(result)}`,
  );
  return result.submitted > 0;
}

async function tick(): Promise<void> {
  const state = await loadState();
  const fulfilled = new Set(state.fulfilledRequestIds);

  const requests = await loadEmployerRequests();
  if (requests.length === 0) {
    console.log(`[matcher] no employer requests on Pinata`);
    return;
  }

  const beta = new Wallet(BETA_PRIVATE_KEY).address;
  const gamma = new Wallet(GAMMA_PRIVATE_KEY).address;

  let rfb5Run: Rfb5Run | null = null;
  let rfb6Run: Rfb6Run | null = null;

  for (const req of requests) {
    if (fulfilled.has(req.requestId)) continue;
    if (isRequestExpired(req)) continue;
    const verification = verifyEmployerRequest(req);
    if (!verification.valid) {
      const reason = "reason" in verification ? verification.reason : "invalid";
      console.warn(
        `[matcher] skip request=${req.requestId} reason=invalid signature: ${reason}`,
      );
      continue;
    }

    let candidate: PublishCandidate | null = null;
    let publisher: { erc8004Id: string; wallet: string } | null = null;

    if (req.kind === "sports-bet") {
      if (!rfb5Run) rfb5Run = await loadLatestRun<Rfb5Run>("rfb5-run");
      if (!rfb5Run) {
        console.log(`[matcher] no rfb5-run available; skip sports-bet`);
        continue;
      }
      candidate = matchSportsBet(req, rfb5Run, { beta, gamma });
      publisher = rfb5Run.publisher;
    } else if (req.kind === "copy-trade") {
      if (!rfb6Run) rfb6Run = await loadLatestRun<Rfb6Run>("rfb6-run");
      if (!rfb6Run) {
        console.log(`[matcher] no rfb6-run available; skip copy-trade`);
        continue;
      }
      candidate = matchCopyTrade(req, rfb6Run, { beta, gamma });
      publisher = rfb6Run.publisher;
    }

    if (!candidate || !publisher) {
      console.log(
        `[matcher] no candidate matched request=${req.requestId} kind=${req.kind}`,
      );
      continue;
    }

    try {
      const ok = await fulfill(req, candidate, {
        erc8004Id: publisher.erc8004Id,
        wallet: getAddress(publisher.wallet),
      });
      if (ok) {
        fulfilled.add(req.requestId);
        state.fulfilledRequestIds = Array.from(fulfilled);
        await saveState(state);
      }
    } catch (err) {
      console.error(
        `[matcher] fulfill failed request=${req.requestId}:`,
        (err as Error).message,
      );
    }
  }
}

async function main(): Promise<void> {
  if (!PINATA_JWT) throw new Error("PINATA_JWT is required");
  console.log(
    `[matcher] starting once=${ONCE} pollMs=${POLL_MS} requestId=${
      REQUEST_ID_FILTER ?? "any"
    } gateway=${GATEWAY}`,
  );
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[matcher] tick error:`, err);
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error("[matcher] fatal:", err);
  process.exit(1);
});
