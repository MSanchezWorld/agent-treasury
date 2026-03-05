import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import path from "node:path";
import dotenv from "dotenv";

// Minimal config; networks/rpc URLs should be provided via env in real use.
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config(); // fallback to CWD .env if present

// Prefer drpc for demo reliability; Base's official endpoint can rate limit / have DNS issues in some environments.
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://base.drpc.org";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: { enabled: true, runs: 10000 }
    }
  },
  networks: {
    base: {
      url: BASE_RPC_URL,
      chainId: 8453,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : []
    }
  }
};

export default config;
