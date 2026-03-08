import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export const runtime = "nodejs";
export const maxDuration = 60;

// Simple in-memory rate limit: one deposit per 2 minutes
let lastDepositAtMs = 0;
const DEPOSIT_COOLDOWN_MS = 120_000;
// Hard cap: only allow deposits up to $5 (5_000_000 USDC units)
const MAX_DEPOSIT_UNITS = 5_000_000n;

const VAULT = "0x943b828468509765654EA502803DF7F0b21637c6" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const RPC_CANDIDATES = [
  "https://mainnet.base.org",
  "https://base.drpc.org",
  "https://base-rpc.publicnode.com",
];

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
]);

const vaultAbi = parseAbi([
  "function supplyCollateral(address asset, uint256 amount) external",
  "function owner() external view returns (address)",
]);

function toUIntString(v: unknown): string | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return null;
    return String(v);
  }
  if (typeof v === "string" && /^[0-9]+$/.test(v.trim())) return v.trim();
  return null;
}

export async function POST(req: Request) {
  try {
    const pk = (process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "").trim();
    if (!pk) {
      return NextResponse.json(
        { ok: false, error: "Server not configured: missing PRIVATE_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json()) as any;
    const depositAmount = toUIntString(body?.depositAmount);
    if (!depositAmount || depositAmount === "0") {
      return NextResponse.json(
        { ok: false, error: "Invalid depositAmount (expected integer string in USDC units, e.g. '5000000' for $5)" },
        { status: 400 }
      );
    }

    const amount = BigInt(depositAmount);

    // Rate limit
    const now = Date.now();
    if (now - lastDepositAtMs < DEPOSIT_COOLDOWN_MS) {
      const waitSec = Math.ceil((DEPOSIT_COOLDOWN_MS - (now - lastDepositAtMs)) / 1000);
      return NextResponse.json(
        { ok: false, error: `Rate limited — try again in ${waitSec}s` },
        { status: 429 }
      );
    }

    // Cap deposit size
    if (amount > MAX_DEPOSIT_UNITS) {
      return NextResponse.json(
        { ok: false, error: `Demo deposits capped at $${Number(MAX_DEPOSIT_UNITS) / 1e6}` },
        { status: 400 }
      );
    }

    const account = privateKeyToAccount(pk.startsWith("0x") ? pk as `0x${string}` : `0x${pk}`);

    // Try RPC candidates until one works
    const rpcUrl = process.env.BASE_RPC_URL_OVERRIDE?.trim() || RPC_CANDIDATES[0]!;

    const publicClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(rpcUrl),
    });

    // Verify this account is the vault owner
    const owner = await publicClient.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "owner",
    });

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: `Signer ${account.address} is not the vault owner (${owner})` },
        { status: 403 }
      );
    }

    // Check USDC balance
    const balance = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    if (balance < amount) {
      const needed = Number(amount) / 1e6;
      const have = Number(balance) / 1e6;
      return NextResponse.json(
        { ok: false, error: `Insufficient USDC: need $${needed.toFixed(2)}, have $${have.toFixed(2)}` },
        { status: 400 }
      );
    }

    // 1) Approve USDC to vault (if needed)
    let approveTxHash: Hash | null = null;
    const currentAllowance = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, VAULT],
    });

    if (currentAllowance < amount) {
      approveTxHash = await walletClient.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [VAULT, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    }

    // 2) Supply collateral to vault (vault calls Aave pool.supply internally)
    const supplyTxHash = await walletClient.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "supplyCollateral",
      args: [USDC, amount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: supplyTxHash });
    lastDepositAtMs = Date.now();

    return NextResponse.json({
      ok: true,
      depositAmount,
      depositUsd: (Number(amount) / 1e6).toFixed(2),
      approveTxHash,
      supplyTxHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
