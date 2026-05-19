import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: "../.env" });

const chainId = Number(process.env.ARC_CHAIN_ID || "5042002");

const accounts = [
  process.env.ALPHA_PRIVATE_KEY,
  process.env.BETA_PRIVATE_KEY,
  process.env.GAMMA_PRIVATE_KEY,
  process.env.VALIDATOR_PRIVATE_KEY,
].filter((k): k is string => Boolean(k && k !== "0x"));

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "",
      chainId,
      accounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
