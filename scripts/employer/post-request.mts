// Employer request CLI: sign + upload an employer-request artifact to Pinata.
//
// Usage:
//   npx tsx scripts/employer/post-request.ts \
//     --employer alpha \
//     --kind sports-bet \
//     --budget 100 \
//     --bond-bps 2500 \
//     --publisher-fee-bps 1000 \
//     --min-edge-bps 50 \
//     --ttl 3600
//
// Environment:
//   PINATA_JWT, PINATA_NETWORK (public|private)
//   ALPHA_PRIVATE_KEY (or EMPLOYER_PRIVATE_KEY)
//
// The signing wallet's address is embedded as `employer.wallet`. The matcher
// service will read these from Pinata under category="employer-request".

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

type Args = {
  employer: string;
  kind: EmployerKind;
  budgetUsd: number;
  bondBps: number;
  publisherFeeBps: number;
  minEdgeBps?: number;
  minWeightBps?: number;
  sport?: string;
  ttlSeconds: number;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(`--${flag}`);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const employer = (get("employer") ?? "alpha").toLowerCase();
  const kind = (get("kind") ?? "sports-bet") as EmployerKind;
  if (kind !== "sports-bet" && kind !== "copy-trade") {
    throw new Error(`invalid --kind ${kind}`);
  }
  const budgetUsd = Number(get("budget") ?? "100");
  const bondBps = Number(get("bond-bps") ?? "2500");
  const publisherFeeBps = Number(get("publisher-fee-bps") ?? "1000");
  const minEdgeBpsRaw = get("min-edge-bps");
  const minWeightBpsRaw = get("min-weight-bps");
  const sport = get("sport");
  const ttlSeconds = Number(get("ttl") ?? "3600");
  return {
    employer,
    kind,
    budgetUsd,
    bondBps,
    publisherFeeBps,
    minEdgeBps: minEdgeBpsRaw ? Number(minEdgeBpsRaw) : undefined,
    minWeightBps: minWeightBpsRaw ? Number(minWeightBpsRaw) : undefined,
    sport,
    ttlSeconds,
  };
}

function resolveEmployerKey(name: string): string {
  const envName = `${name.toUpperCase()}_PRIVATE_KEY`;
  const direct = process.env[envName];
  if (direct) return direct;
  const generic = process.env.EMPLOYER_PRIVATE_KEY;
  if (generic) return generic;
  throw new Error(
    `no private key found: set ${envName} or EMPLOYER_PRIVATE_KEY`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is required");
  const network = (process.env.PINATA_NETWORK ?? "public") as
    | "public"
    | "private";

  const signer = new Wallet(resolveEmployerKey(args.employer));

  const filter: EmployerRequestBase["filter"] = {};
  if (args.kind === "sports-bet") {
    if (args.minEdgeBps !== undefined) filter.minNetEdgeBps = args.minEdgeBps;
    if (args.sport) filter.sport = args.sport;
  } else {
    if (args.minWeightBps !== undefined)
      filter.minWeightBps = args.minWeightBps;
  }

  const base: EmployerRequestBase = {
    version: "employer-request/v1",
    requestId: randomUUID(),
    employer: { id: args.employer, wallet: signer.address },
    kind: args.kind,
    filter,
    budgetUsdc6: BigInt(Math.round(args.budgetUsd * 1_000_000)).toString(),
    bondBps: args.bondBps,
    publisherFeeBps: args.publisherFeeBps,
    validUntil: new Date(Date.now() + args.ttlSeconds * 1000).toISOString(),
    nonce: randomUUID(),
  };

  const signed = await signEmployerRequest(base, signer);
  const result = await replaceLatestArtifact({
    jwt,
    network,
    category: "employer-request",
    identityKey: `${base.employer.id}:${base.requestId}`,
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
    JSON.stringify(
      {
        ok: true,
        requestId: base.requestId,
        employer: base.employer,
        kind: base.kind,
        budgetUsd: args.budgetUsd,
        validUntil: base.validUntil,
        cid: result.cid,
        ipfsURI: result.ipfsURI,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[employer:post] error:", err);
  process.exit(1);
});
