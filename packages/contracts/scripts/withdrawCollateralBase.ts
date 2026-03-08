import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { parseUnits } from "ethers";

const DEFAULT_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function optionalEnv(name: string, fallback: string) {
  return (process.env[name]?.trim() || fallback).trim();
}

function getVaultAddressFromCreConfig(): string | null {
  const creConfigPath = path.join(__dirname, "../../../cre/workflows/borrowbot-borrow-and-pay/config.mainnet.json");
  if (!fs.existsSync(creConfigPath)) return null;

  const cfg = JSON.parse(fs.readFileSync(creConfigPath, "utf-8")) as Record<string, unknown>;
  const vault = String(cfg.vaultAddress || "").trim();
  if (!vault || vault === "0x0000000000000000000000000000000000000000") return null;
  return vault;
}

function normalizeAddress(addr: string) {
  const a = addr.trim();
  try {
    return ethers.getAddress(a);
  } catch {
    return ethers.getAddress(a.toLowerCase());
  }
}

async function main() {
  const vaultAddress = (process.env.VAULT_ADDRESS?.trim() || getVaultAddressFromCreConfig() || "").trim();
  if (!vaultAddress) throw new Error("Missing VAULT_ADDRESS and no vaultAddress found in CRE config");

  const collateralToken = normalizeAddress(optionalEnv("COLLATERAL_TOKEN_ADDRESS", DEFAULT_USDC_BASE));
  const amountRaw = (process.env.WITHDRAW_AMOUNT || "").trim();
  const amountHuman = (process.env.WITHDRAW_AMOUNT_HUMAN || "").trim();
  if (!amountRaw && !amountHuman) {
    throw new Error("Missing WITHDRAW_AMOUNT (raw) or WITHDRAW_AMOUNT_HUMAN (decimal)");
  }

  const [signer] = await ethers.getSigners();
  const managedSigner = new ethers.NonceManager(signer);
  const to = optionalEnv("WITHDRAW_TO", signer.address);

  console.log("Signer:", signer.address);
  console.log("Vault:", vaultAddress);
  console.log("Collateral token:", collateralToken);
  console.log("To:", to);

  const erc20 = await ethers.getContractAt(
    ["function decimals() external view returns (uint8)", "function symbol() external view returns (string)"],
    collateralToken,
    managedSigner
  );

  const vault = await ethers.getContractAt(
    ["function withdrawCollateral(address asset, uint256 amount, address to) external"],
    normalizeAddress(vaultAddress),
    managedSigner
  );

  const [decimals, symbol] = await Promise.all([erc20.decimals(), erc20.symbol()]);
  const amount = amountRaw ? BigInt(amountRaw) : parseUnits(amountHuman, decimals);
  console.log(`Amount: ${amount.toString()} (raw)`);
  console.log(`Token: ${symbol} decimals=${decimals}`);

  const tx = await vault.withdrawCollateral(collateralToken, amount, to);
  console.log("withdrawCollateral tx:", tx.hash);
  await tx.wait();

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
