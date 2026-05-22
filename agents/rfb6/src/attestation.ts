import { getAddress, verifyMessage } from "ethers";
import type { Rfb6RunEvent } from "./types.js";
import { payloadHashForRun } from "./store.js";

export type AttestationVerdict = {
  valid: boolean;
  reason: string | null;
};

export function verifyRunAttestation(run: Rfb6RunEvent): AttestationVerdict {
  if (run.artifactVersion !== "rfb6.arc-s3/v1") {
    return { valid: false, reason: "unsupported artifact version" };
  }

  if (run.attestation.scheme !== "eip191") {
    return { valid: false, reason: "unsupported attestation scheme" };
  }

  const computed = payloadHashForRun(run);
  if (computed !== run.attestation.payloadHash) {
    return { valid: false, reason: "payload hash mismatch" };
  }

  try {
    const recovered = getAddress(
      verifyMessage(run.attestation.payloadHash, run.attestation.signature),
    );
    const claimed = getAddress(run.publisher.wallet);
    if (recovered !== claimed) {
      return { valid: false, reason: "signature wallet mismatch" };
    }
  } catch {
    return { valid: false, reason: "invalid signature" };
  }

  return { valid: true, reason: null };
}
