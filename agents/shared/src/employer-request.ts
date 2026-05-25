// Employer-driven opportunity request published to IPFS (Pinata category
// "employer-request"). Posted by an employer (e.g. an alpha wallet) to declare
// demand. Matchers read these, pair them with a recommendation from rfb5/rfb6,
// and create the on-chain task funded by the employer.

import {
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";
import { z } from "zod";

export const employerKindSchema = z.enum(["sports-bet", "copy-trade"]);
export type EmployerKind = z.infer<typeof employerKindSchema>;

export const employerFilterSchema = z
  .object({
    sport: z.string().optional(),
    league: z.string().optional(),
    minNetEdgeBps: z.number().int().min(0).max(10_000).optional(),
    minWeightBps: z.number().int().min(0).max(10_000).optional(),
    workerAllowlist: z.array(z.string()).optional(),
    publisherAllowlist: z.array(z.string()).optional(),
  })
  .strict();

export type EmployerFilter = z.infer<typeof employerFilterSchema>;

export const employerRequestBaseSchema = z
  .object({
    version: z.literal("employer-request/v1"),
    requestId: z.string().min(1),
    employer: z
      .object({
        id: z.string().min(1),
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      })
      .strict(),
    kind: employerKindSchema,
    filter: employerFilterSchema,
    budgetUsdc6: z.string().regex(/^\d+$/),
    bondBps: z.number().int().min(0).max(10_000).default(2_500),
    publisherFeeBps: z.number().int().min(0).max(5_000).default(1_000),
    validUntil: z.string(),
    nonce: z.string().min(1),
  })
  .strict();

export type EmployerRequestBase = z.infer<typeof employerRequestBaseSchema>;

export const employerAttestationSchema = z
  .object({
    scheme: z.literal("eip191"),
    payloadHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  })
  .strict();

export type EmployerAttestation = z.infer<typeof employerAttestationSchema>;

export const employerRequestSchema = employerRequestBaseSchema.extend({
  attestation: employerAttestationSchema,
});

export type EmployerRequest = z.infer<typeof employerRequestSchema>;

export function payloadHashForEmployerRequest(
  base: EmployerRequestBase,
): string {
  const canonical = JSON.stringify(base);
  return keccak256(toUtf8Bytes(canonical));
}

export async function signEmployerRequest(
  base: EmployerRequestBase,
  signer: Wallet,
): Promise<EmployerRequest> {
  const employerAddress = getAddress(base.employer.wallet);
  if (getAddress(signer.address) !== employerAddress) {
    throw new Error(
      `employer wallet mismatch: signer=${signer.address} expected=${employerAddress}`,
    );
  }
  const payloadHash = payloadHashForEmployerRequest(base);
  const signature = await signer.signMessage(payloadHash);
  return {
    ...base,
    attestation: { scheme: "eip191", payloadHash, signature },
  };
}

export type EmployerVerification =
  | { valid: true }
  | { valid: false; reason: string };

export function verifyEmployerRequest(
  req: EmployerRequest,
): EmployerVerification {
  try {
    const parsed = employerRequestSchema.parse(req);
    const base: EmployerRequestBase = {
      version: parsed.version,
      requestId: parsed.requestId,
      employer: parsed.employer,
      kind: parsed.kind,
      filter: parsed.filter,
      budgetUsdc6: parsed.budgetUsdc6,
      bondBps: parsed.bondBps,
      publisherFeeBps: parsed.publisherFeeBps,
      validUntil: parsed.validUntil,
      nonce: parsed.nonce,
    };
    const expectedHash = payloadHashForEmployerRequest(base);
    if (expectedHash !== parsed.attestation.payloadHash) {
      return { valid: false, reason: "payload-hash-mismatch" };
    }
    const recovered = verifyMessage(
      parsed.attestation.payloadHash,
      parsed.attestation.signature,
    );
    if (getAddress(recovered) !== getAddress(parsed.employer.wallet)) {
      return { valid: false, reason: "signature-not-by-employer" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}

export function isRequestExpired(
  req: EmployerRequest,
  nowMs = Date.now(),
): boolean {
  const ts = Date.parse(req.validUntil);
  return Number.isFinite(ts) ? ts < nowMs : true;
}
