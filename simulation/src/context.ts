import { JsonRpcProvider, Wallet } from "ethers";
import { config } from "./config.js";

export type AgentContext = {
  provider: JsonRpcProvider;
  alpha: Wallet;
  beta: Wallet;
  gamma: Wallet;
  validator: Wallet;
};

export function createContext(): AgentContext {
  const provider = new JsonRpcProvider(
    config.ARC_RPC_URL,
    config.ARC_CHAIN_ID,
    {
      staticNetwork: true,
    },
  );

  return {
    provider,
    alpha: new Wallet(config.ALPHA_PRIVATE_KEY, provider),
    beta: new Wallet(config.BETA_PRIVATE_KEY, provider),
    gamma: new Wallet(config.GAMMA_PRIVATE_KEY, provider),
    validator: new Wallet(config.VALIDATOR_PRIVATE_KEY, provider),
  };
}
