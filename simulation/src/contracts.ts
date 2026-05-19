import { Contract, type TransactionReceipt } from "ethers";
import { config } from "./config.js";
import {
  erc20Abi,
  escrowCourthouseAbi,
  intentFirewallAbi,
  reputationRegistryAbi,
} from "./abi.js";
import type { AgentContext } from "./context.js";

export function escrowAs(
  ctx: AgentContext,
  signerKey: "alpha" | "beta" | "gamma" | "validator",
): Contract {
  return new Contract(
    config.S3_ESCROW_COURTHOUSE,
    escrowCourthouseAbi,
    ctx[signerKey],
  );
}

export function reputationAs(
  ctx: AgentContext,
  signerKey: "validator",
): Contract {
  return new Contract(
    config.S3_REPUTATION_REGISTRY,
    reputationRegistryAbi,
    ctx[signerKey],
  );
}

export function usdcAs(
  ctx: AgentContext,
  signerKey: "alpha" | "beta" | "gamma",
): Contract {
  return new Contract(config.USDC_ADDRESS, erc20Abi, ctx[signerKey]);
}

export function firewallAs(
  ctx: AgentContext,
  signerKey: "alpha" | "beta" | "gamma",
): Contract {
  return new Contract(config.S3_INTENT_FIREWALL, intentFirewallAbi, ctx[signerKey]);
}

export async function executeCourthouseIntent(
  ctx: AgentContext,
  signerKey: "alpha" | "beta" | "gamma",
  callData: string,
): Promise<TransactionReceipt> {
  const firewall = firewallAs(ctx, signerKey);
  const tx = await firewall.executeIntent(
    config.S3_ESCROW_COURTHOUSE,
    0,
    config.INTENT_QUOTED_SLIPPAGE_BPS,
    config.INTENT_DEFAULT_GAS_LIMIT,
    Math.floor(Date.now() / 1000) + config.INTENT_DEFAULT_DEADLINE_SECONDS,
    callData,
  );
  return tx.wait();
}
