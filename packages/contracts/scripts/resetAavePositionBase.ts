import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { formatUnits } from "ethers";

// Base mainnet defaults.
const DEFAULT_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_WETH_BASE = "0x4200000000000000000000000000000000000006";
const DEFAULT_CBBTC_BASE = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";

// Uniswap Permit2 is deployed at the same address on many chains (including Base).
// SwapRouter02 uses Permit2 to pull ERC20s, so approvals must target Permit2.
const DEFAULT_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// Uniswap V3 (Base mainnet).
// - Factory: https://basescan.org/address/0x33128a8fc17869897dce68ed026d694621f6fdfd
// - SwapRouter02: https://basescan.org/address/0x2626664c2603336E57B271c5C0b26F421741e481
// - QuoterV2: https://basescan.org/address/0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a
const DEFAULT_UNIV3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const DEFAULT_UNIV3_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const DEFAULT_UNIV3_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT48 = (1n << 48n) - 1n;

let LAST_STAGE = "init";

function optionalEnv(name: string, fallback: string) {
  return (process.env[name]?.trim() || fallback).trim();
}

function normalizeAddress(addr: string) {
  const a = addr.trim();
  try {
    return ethers.getAddress(a);
  } catch {
    return ethers.getAddress(a.toLowerCase());
  }
}

function getVaultAddressFromCreConfig(): string | null {
  const creConfigPath = path.join(__dirname, "../../../cre/workflows/borrowbot-borrow-and-pay/config.mainnet.json");
  if (!fs.existsSync(creConfigPath)) return null;

  const cfg = JSON.parse(fs.readFileSync(creConfigPath, "utf-8")) as Record<string, unknown>;
  const vault = String(cfg.vaultAddress || "").trim();
  if (!vault || vault === "0x0000000000000000000000000000000000000000") return null;
  return vault;
}

function formatTokenAmount(raw: bigint, decimals: number) {
  // Keep it short and human-friendly for hackathon demos.
  const s = formatUnits(raw, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, 6).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

function summarizeError(err: any): string {
  const parts: string[] = [];
  const push = (v: any) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s && !parts.includes(s)) parts.push(s);
  };

  push(err?.shortMessage);
  push(err?.reason);
  push(err?.message);
  push(err?.error?.message);
  push(err?.info?.error?.message);
  push(err?.info?.error?.data?.message);

  const code = err?.code;
  if (typeof code === "string" || typeof code === "number") parts.push(`code=${String(code)}`);
  const action = err?.action;
  if (typeof action === "string") parts.push(`action=${action}`);

  return parts.filter(Boolean).join(" | ") || "Unknown error (no message fields found)";
}

async function ensureHasCode(label: string, address: string) {
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`${label} not deployed at ${address}. Set env to override.`);
  }
}

async function quoteExactInputSingle({
  quoter,
  tokenIn,
  tokenOut,
  fee,
  amountIn
}: {
  quoter: any;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: bigint;
}): Promise<bigint> {
  // Try Quoter V1 signature first.
  try {
    const out = (await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0)) as bigint;
    return out;
  } catch {
    // Try Quoter V2 signature (struct + multi-return).
  }
  const res = (await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0
  })) as unknown as [bigint, bigint, number, bigint];
  return res[0];
}

async function pickBestFee({
  factory,
  quoter,
  tokenIn,
  tokenOut,
  amountIn
}: {
  factory: any;
  quoter: any;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
}): Promise<{ fee: number; amountOut: bigint }> {
  const feeTiers = [100, 500, 3000, 10000];

  let bestFee: number | null = null;
  let bestOut = 0n;
  let hadGetPoolError = false;

  for (const fee of feeTiers) {
    let pool: string;
    try {
      pool = (await factory.getPool(tokenIn, tokenOut, fee)) as string;
    } catch {
      hadGetPoolError = true;
      continue;
    }
    if (!pool || pool === ethers.ZeroAddress) continue;

    try {
      const out = await quoteExactInputSingle({ quoter, tokenIn, tokenOut, fee, amountIn });
      if (out > bestOut) {
        bestOut = out;
        bestFee = fee;
      }
    } catch {
      // Skip broken fee tiers.
    }
  }

  if (bestFee == null) {
    if (hadGetPoolError) {
      throw new Error(
        `Failed to query Uniswap V3 pools (RPC returned invalid data). Try again or set BASE_RPC_URL to a more reliable endpoint.`
      );
    }
    throw new Error(`No Uniswap V3 pool found for tokenIn=${tokenIn} tokenOut=${tokenOut}`);
  }

  return { fee: bestFee, amountOut: bestOut };
}

async function main() {
  const vaultAddress = (process.env.VAULT_ADDRESS?.trim() || getVaultAddressFromCreConfig() || "").trim();
  if (!vaultAddress) throw new Error("Missing VAULT_ADDRESS and no vaultAddress found in CRE config");

  const usdc = normalizeAddress(optionalEnv("BORROW_TOKEN_ADDRESS", optionalEnv("USDC_ADDRESS", DEFAULT_USDC_BASE)));
  const weth = normalizeAddress(optionalEnv("WETH_ADDRESS", DEFAULT_WETH_BASE));
  const cbbtc = normalizeAddress(optionalEnv("CBBTC_ADDRESS", DEFAULT_CBBTC_BASE));

  const [signer] = await ethers.getSigners();
  const managedSigner = new ethers.NonceManager(signer);

  const withdrawTo = normalizeAddress(optionalEnv("WITHDRAW_TO", signer.address));
  const confirm = (process.env.CONFIRM_MAINNET || "").trim().toUpperCase() === "YES";
  const slippageBps = Number(optionalEnv("SLIPPAGE_BPS", "200"));
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 500) {
    throw new Error("SLIPPAGE_BPS must be between 0 and 500");
  }

  console.log("Network: base (8453)");
  console.log("Signer:", signer.address);
  console.log("Vault:", normalizeAddress(vaultAddress));
  console.log("Withdraw to:", withdrawTo);
  console.log("Confirm:", confirm ? "YES (will send txs)" : "NO (dry run)");
  console.log("Slippage:", `${slippageBps} bps`);
  console.log("");

  const vault = await ethers.getContractAt(
    [
      "function owner() external view returns (address)",
      "function paused() external view returns (bool)",
      "function aaveAddressesProvider() external view returns (address)",
      "function repayDebt(address asset, uint256 amount) external",
      "function withdrawCollateral(address asset, uint256 amount, address to) external"
    ],
    normalizeAddress(vaultAddress),
    managedSigner
  );

  const [owner, paused] = await Promise.all([vault.owner(), vault.paused()]);
  console.log("Vault owner:", owner);
  if (normalizeAddress(owner) !== normalizeAddress(signer.address)) {
    throw new Error(`Signer is not vault owner. signer=${signer.address} owner=${owner}`);
  }
  if (paused) {
    throw new Error("Vault is paused; unpause before resetting position.");
  }

  const addressesProviderAddr = await vault.aaveAddressesProvider();
  const addressesProvider = await ethers.getContractAt(
    ["function getPool() external view returns (address)"],
    addressesProviderAddr,
    managedSigner
  );
  const poolAddr = await addressesProvider.getPool();

  const pool = await ethers.getContractAt(
    [
      "function getUserAccountData(address user) external view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
      "function getReserveData(address asset) external view returns (tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))"
    ],
    poolAddr,
    managedSigner
  );

  // Gas sanity check (most "nothing happened" failures are simply no ETH for gas).
  try {
    const nativeBal = (await ethers.provider.getBalance(signer.address)) as bigint;
    console.log(`ETH (gas): ${formatUnits(nativeBal, 18)} ETH`);
    if (confirm && nativeBal < 50_000_000_000_000n) {
      throw new Error("Insufficient ETH for gas. Fund the signer with a small amount of Base ETH and retry.");
    }
    console.log("");
  } catch {
    // ignore
  }

  const usdcToken = await ethers.getContractAt(
    [
      "function balanceOf(address a) external view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function transfer(address to, uint256 amount) external returns (bool)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)"
    ],
    usdc,
    managedSigner
  );
  const [usdcDecimals, usdcSymbol] = await Promise.all([usdcToken.decimals(), usdcToken.symbol()]);
  const erc20Abi = [
    "function balanceOf(address a) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)"
  ];
  const tokenWeth = await ethers.getContractAt(erc20Abi, weth, managedSigner);
  const tokenCbbtc = await ethers.getContractAt(erc20Abi, cbbtc, managedSigner);
  const [wethDecimals, wethSymbol] = await Promise.all([tokenWeth.decimals(), tokenWeth.symbol()]);
  const [btcDecimals, btcSymbol] = await Promise.all([tokenCbbtc.decimals(), tokenCbbtc.symbol()]);
  const maxRepayChunkRaw = (() => {
    const s = optionalEnv("MAX_REPAY_CHUNK_RAW", "1000000"); // 1 USDC default (6 decimals)
    if (!/^[0-9]+$/.test(s) || s === "0") throw new Error("MAX_REPAY_CHUNK_RAW must be a positive integer");
    return BigInt(s);
  })();

  async function getReserveAddrs(asset: string) {
    const rd = await pool.getReserveData(normalizeAddress(asset));
    // Tuple layout: ... aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress, ...
    const aTokenAddress = rd[8] as string;
    const variableDebtTokenAddress = rd[10] as string;
    return { aTokenAddress, variableDebtTokenAddress };
  }

  const usdcReserve = await getReserveAddrs(usdc);
  const debtToken = await ethers.getContractAt(
    ["function balanceOf(address a) external view returns (uint256)"],
    usdcReserve.variableDebtTokenAddress,
    managedSigner
  );

  async function readDebt(): Promise<bigint> {
    return (await debtToken.balanceOf(normalizeAddress(vaultAddress))) as bigint;
  }

  async function readATokenBalance(asset: string): Promise<{ aToken: string; balance: bigint }> {
    const { aTokenAddress } = await getReserveAddrs(asset);
    const aToken = await ethers.getContractAt(["function balanceOf(address a) external view returns (uint256)"], aTokenAddress, managedSigner);
    const bal = (await aToken.balanceOf(normalizeAddress(vaultAddress))) as bigint;
    return { aToken: aTokenAddress, balance: bal };
  }

  const [uadBefore, debtBefore, usdcBalSigner, aUsdc, aWeth, aBtc] = await Promise.all([
    pool.getUserAccountData(normalizeAddress(vaultAddress)),
    readDebt(),
    usdcToken.balanceOf(signer.address),
    readATokenBalance(usdc),
    readATokenBalance(weth),
    readATokenBalance(cbbtc)
  ]);

  console.log("Aave userAccountData (before):");
  console.log("- totalCollateralBase:", uadBefore[0].toString());
  console.log("- totalDebtBase:", uadBefore[1].toString());
  console.log("- healthFactor:", uadBefore[5].toString());
  console.log("");
  console.log(`USDC debt (before): ${formatTokenAmount(debtBefore, Number(usdcDecimals))} ${usdcSymbol} (${debtBefore.toString()} raw)`);
  console.log(`Signer USDC balance: ${formatTokenAmount(usdcBalSigner as bigint, Number(usdcDecimals))} ${usdcSymbol}`);
  console.log("");
  console.log("Collateral aToken balances (before):");
  console.log(`- aUSDC:  ${aUsdc.balance.toString()} (aToken=${aUsdc.aToken})`);
  console.log(`- aWETH:  ${aWeth.balance.toString()} (aToken=${aWeth.aToken})`);
  console.log(`- acbBTC: ${aBtc.balance.toString()} (aToken=${aBtc.aToken})`);
  console.log("");

  if (!confirm) {
    console.log("Dry run complete.");
    console.log('To execute on Base mainnet, re-run with: CONFIRM_MAINNET="YES"');
    console.log('Optional: set WITHDRAW_TO="0x..." to override destination (defaults to signer).');
    return;
  }

  // ---- If we don't have enough USDC to repay, withdraw/sell a small amount of collateral to top up ----
  const permit2Addr = normalizeAddress(optionalEnv("PERMIT2_ADDRESS", DEFAULT_PERMIT2));
  const factoryAddr = normalizeAddress(optionalEnv("UNIV3_FACTORY_ADDRESS", DEFAULT_UNIV3_FACTORY));
  const routerAddr = normalizeAddress(optionalEnv("UNIV3_ROUTER_ADDRESS", DEFAULT_UNIV3_ROUTER));
  const quoterAddr = normalizeAddress(optionalEnv("UNIV3_QUOTER_ADDRESS", DEFAULT_UNIV3_QUOTER));

  const factory = await ethers.getContractAt(
    ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)"],
    factoryAddr,
    managedSigner
  );

  const quoter = await ethers.getContractAt(
    [
      "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
      "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
    ],
    quoterAddr,
    managedSigner
  );

  const routerNoDeadline = await ethers.getContractAt(
    [
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
    ],
    routerAddr,
    managedSigner
  );
  const routerWithDeadline = await ethers.getContractAt(
    [
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
    ],
    routerAddr,
    managedSigner
  );

  async function exactInputSingleCompat(paramsNoDeadline: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    amountIn: bigint;
    amountOutMinimum: bigint;
    sqrtPriceLimitX96: number;
  }) {
    try {
      return await routerNoDeadline.exactInputSingle(paramsNoDeadline);
    } catch (e1) {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      try {
        return await routerWithDeadline.exactInputSingle({ ...paramsNoDeadline, deadline });
      } catch (e2) {
        throw new Error(
          `SwapRouter exactInputSingle failed (noDeadline: ${summarizeError(e1)}; withDeadline: ${summarizeError(e2)})`
        );
      }
    }
  }

  const permit2 = await ethers.getContractAt(
    [
      "function allowance(address user,address token,address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
      "function approve(address token,address spender,uint160 amount,uint48 expiration) external"
    ],
    permit2Addr,
    managedSigner
  );

  async function ensurePermit2Allowance(token: string, spender: string, needed: bigint, label: string) {
    const [amount, expiration] = (await permit2.allowance(signer.address, token, spender)) as unknown as [bigint, bigint, bigint];
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (amount >= needed && expiration > now) return;
    const tx = await permit2.approve(token, spender, MAX_UINT160, MAX_UINT48);
    console.log(`[approve] ${label}:`, tx.hash);
    await tx.wait();
  }

  async function swapExact({
    tokenInAddr,
    tokenOutAddr,
    tokenInContract,
    tokenInSym,
    tokenOutSym,
    tokenInDec,
    tokenOutDec,
    amountIn
  }: {
    tokenInAddr: string;
    tokenOutAddr: string;
    tokenInContract: any;
    tokenInSym: string;
    tokenOutSym: string;
    tokenInDec: number;
    tokenOutDec: number;
    amountIn: bigint;
  }) {
    if (amountIn === 0n) return;
    LAST_STAGE = `swap:${tokenInSym}->${tokenOutSym}`;

    console.log(`[swap] ${tokenInSym} -> ${tokenOutSym}`);
    console.log(`- amountIn:  ${formatTokenAmount(amountIn, tokenInDec)} ${tokenInSym}`);

    const { fee, amountOut: quotedOut } = await pickBestFee({
      factory,
      quoter,
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      amountIn
    });
    console.log(`- best fee:  ${fee}`);
    console.log(`- quote out: ${formatTokenAmount(quotedOut, tokenOutDec)} ${tokenOutSym}`);

    // Robustly support both Router02 payment modes:
    // - direct ERC20 allowance to router
    // - Permit2 ERC20 allowance to Permit2 + Permit2 internal allowance to router
    const allowanceRouter = (await tokenInContract.allowance(signer.address, routerAddr)) as bigint;
    if (allowanceRouter < amountIn) {
      const tx1 = await tokenInContract.approve(routerAddr, amountIn);
      console.log(`[approve] ${tokenInSym} (Router):`, tx1.hash);
      await tx1.wait();
    }

    const allowancePermit2 = (await tokenInContract.allowance(signer.address, permit2Addr)) as bigint;
    if (allowancePermit2 < amountIn) {
      const tx2 = await tokenInContract.approve(permit2Addr, MAX_UINT256);
      console.log(`[approve] ${tokenInSym} (Permit2):`, tx2.hash);
      await tx2.wait();
    }

    await ensurePermit2Allowance(tokenInAddr, routerAddr, amountIn, `${tokenInSym} (Permit2->Router)`);

    const paramsSim = {
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      fee,
      recipient: signer.address,
      amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0
    };

    let simOut: bigint | null = null;
    try {
      simOut = (await routerNoDeadline.exactInputSingle.staticCall(paramsSim)) as bigint;
    } catch (e1) {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      try {
        simOut = (await routerWithDeadline.exactInputSingle.staticCall({ ...paramsSim, deadline })) as bigint;
      } catch (e2) {
        throw new Error(`SwapRouter staticCall failed (noDeadline: ${summarizeError(e1)}; withDeadline: ${summarizeError(e2)})`);
      }
    }

    const outForMin = simOut != null && simOut > 0n ? simOut : quotedOut;
    const minOut = (outForMin * BigInt(10_000 - Math.trunc(slippageBps))) / 10_000n;
    console.log(`- sim out:   ${formatTokenAmount(outForMin, tokenOutDec)} ${tokenOutSym}`);
    console.log(`- min out:   ${formatTokenAmount(minOut, tokenOutDec)} ${tokenOutSym}`);

    const tx = await exactInputSingleCompat({
      tokenIn: tokenInAddr,
      tokenOut: tokenOutAddr,
      fee,
      recipient: signer.address,
      amountIn,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0
    });
    console.log("[swap] tx:", tx.hash);
    await tx.wait();
  }

  async function topUpUsdcForRepay(targetUsdc: bigint) {
    LAST_STAGE = "topup";
    if (targetUsdc <= 0n) return;

    // Conservative buffer for interest accrual while we transact (0.5% + 0.01 USDC).
    const buffer = (targetUsdc * 50n) / 10_000n + 10_000n;
    const desired = targetUsdc + buffer;

    // 1) Prefer withdrawing USDC collateral first (cheapest, no swaps).
    try {
      const a = await readATokenBalance(usdc);
      if (a.balance > 0n) {
        const withdrawAmt = a.balance < desired ? a.balance : desired;
        console.log(`[withdraw] ${usdcSymbol}: withdrawing ${formatTokenAmount(withdrawAmt, Number(usdcDecimals))} to repay debt...`);
        const tx = await vault.withdrawCollateral(usdc, withdrawAmt, signer.address);
        console.log(`[withdraw] ${usdcSymbol} tx:`, tx.hash);
        await tx.wait();
      }
    } catch (e) {
      console.log(`[topup] USDC collateral withdraw failed (${summarizeError(e)}). Will try selling other collateral.`);
    }

    // If we have enough USDC now, stop.
    {
      const bal = (await usdcToken.balanceOf(signer.address)) as bigint;
      if (bal >= desired) return;
    }

    // Preflight Uniswap contracts only if we need to sell collateral.
    await Promise.all([
      ensureHasCode("UniswapV3Factory", factoryAddr),
      ensureHasCode("Permit2", permit2Addr),
      ensureHasCode("UniswapV3Router", routerAddr),
      ensureHasCode("UniswapV3Quoter", quoterAddr)
    ]);

    // Helper: withdraw `amount` of collateral to signer and return delta balance.
    async function withdrawDelta(tokenContract: any, assetAddr: string, amount: bigint, label: string): Promise<bigint> {
      const before = (await tokenContract.balanceOf(signer.address)) as bigint;
      console.log(`[withdraw] ${label}: withdrawing ${formatTokenAmount(amount, label === usdcSymbol ? Number(usdcDecimals) : label === wethSymbol ? Number(wethDecimals) : Number(btcDecimals))}...`);
      const tx = await vault.withdrawCollateral(assetAddr, amount, signer.address);
      console.log(`[withdraw] ${label} tx:`, tx.hash);
      await tx.wait();
      const after = (await tokenContract.balanceOf(signer.address)) as bigint;
      return after > before ? after - before : 0n;
    }

    // 2) Sell WETH collateral to USDC if available.
    try {
      const aW = await readATokenBalance(weth);
      if (aW.balance > 0n) {
        const got = await withdrawDelta(tokenWeth, weth, aW.balance, wethSymbol);
        if (got > 0n) {
          await swapExact({
            tokenInAddr: weth,
            tokenOutAddr: usdc,
            tokenInContract: tokenWeth,
            tokenInSym: wethSymbol,
            tokenOutSym: usdcSymbol,
            tokenInDec: Number(wethDecimals),
            tokenOutDec: Number(usdcDecimals),
            amountIn: got
          });
        }
      }
    } catch (e) {
      console.log(`[topup] WETH sell skipped (${summarizeError(e)})`);
    }

    // 3) Sell cbBTC collateral to USDC if available (fallback cbBTC->WETH->USDC).
    try {
      const aB = await readATokenBalance(cbbtc);
      if (aB.balance > 0n) {
        const gotBtc = await withdrawDelta(tokenCbbtc, cbbtc, aB.balance, btcSymbol);
        if (gotBtc > 0n) {
          // Try direct cbBTC->USDC first.
          try {
            await swapExact({
              tokenInAddr: cbbtc,
              tokenOutAddr: usdc,
              tokenInContract: tokenCbbtc,
              tokenInSym: btcSymbol,
              tokenOutSym: usdcSymbol,
              tokenInDec: Number(btcDecimals),
              tokenOutDec: Number(usdcDecimals),
              amountIn: gotBtc
            });
          } catch (e1) {
            console.log(`[swap] ${btcSymbol} -> ${usdcSymbol} failed (${summarizeError(e1)}). Trying ${btcSymbol} -> ${wethSymbol} -> ${usdcSymbol}...`);
            const wethBefore = (await tokenWeth.balanceOf(signer.address)) as bigint;
            await swapExact({
              tokenInAddr: cbbtc,
              tokenOutAddr: weth,
              tokenInContract: tokenCbbtc,
              tokenInSym: btcSymbol,
              tokenOutSym: wethSymbol,
              tokenInDec: Number(btcDecimals),
              tokenOutDec: Number(wethDecimals),
              amountIn: gotBtc
            });
            const wethAfter = (await tokenWeth.balanceOf(signer.address)) as bigint;
            const gotWeth = wethAfter > wethBefore ? wethAfter - wethBefore : 0n;
            if (gotWeth > 0n) {
              await swapExact({
                tokenInAddr: weth,
                tokenOutAddr: usdc,
                tokenInContract: tokenWeth,
                tokenInSym: wethSymbol,
                tokenOutSym: usdcSymbol,
                tokenInDec: Number(wethDecimals),
                tokenOutDec: Number(usdcDecimals),
                amountIn: gotWeth
              });
            }
          }
        }
      }
    } catch (e) {
      console.log(`[topup] cbBTC sell skipped (${summarizeError(e)})`);
    }

    // 4) Last resort: swap signer ETH -> WETH -> USDC to cover the debt.
    //    This handles the Aave edge case where withdrawing same-token collateral
    //    (USDC collateral + USDC debt) triggers an arithmetic panic (0x11).
    {
      const bal = (await usdcToken.balanceOf(signer.address)) as bigint;
      if (bal < desired) {
        const nativeBal = (await ethers.provider.getBalance(signer.address)) as bigint;
        // Reserve 0.0003 ETH for gas, use the rest (up to 0.001 ETH) for the swap.
        const gasReserve = 300_000_000_000_000n; // 0.0003 ETH
        const maxSwap = 1_000_000_000_000_000n; // 0.001 ETH
        const available = nativeBal > gasReserve ? nativeBal - gasReserve : 0n;
        const wrapAmt = available > maxSwap ? maxSwap : available;

        if (wrapAmt > 0n) {
          console.log(`[topup] Swapping ${formatTokenAmount(wrapAmt, 18)} ETH -> WETH -> USDC as last resort...`);

          await Promise.all([
            ensureHasCode("UniswapV3Factory", factoryAddr),
            ensureHasCode("Permit2", permit2Addr),
            ensureHasCode("UniswapV3Router", routerAddr),
            ensureHasCode("UniswapV3Quoter", quoterAddr)
          ]);

          // Wrap ETH via WETH deposit() — need a fresh contract instance with the payable ABI.
          const wethPayable = await ethers.getContractAt(
            ["function deposit() external payable"],
            weth,
            managedSigner
          );
          const wrapTx = await wethPayable.deposit({ value: wrapAmt });
          console.log(`[topup] wrap tx:`, wrapTx.hash);
          await wrapTx.wait();

          const wethBal = (await tokenWeth.balanceOf(signer.address)) as bigint;
          if (wethBal > 0n) {
            await swapExact({
              tokenInAddr: weth,
              tokenOutAddr: usdc,
              tokenInContract: tokenWeth,
              tokenInSym: wethSymbol,
              tokenOutSym: usdcSymbol,
              tokenInDec: Number(wethDecimals),
              tokenOutDec: Number(usdcDecimals),
              amountIn: wethBal
            });
          }
        }
      }
    }
  }

  // ---- Repay USDC variable debt, using collateral to top up if needed ----
  for (let i = 0; i < 20; i++) {
    const d = await readDebt();
    if (d === 0n) break;

    const bal = (await usdcToken.balanceOf(signer.address)) as bigint;
    if (bal === 0n) {
      await topUpUsdcForRepay(d);
      continue;
    }

    const repayCapUnchunked = bal < d ? bal : d;
    const repayCap = repayCapUnchunked > maxRepayChunkRaw ? maxRepayChunkRaw : repayCapUnchunked;
    console.log(
      `[repay] Iteration ${i + 1}: debt=${formatTokenAmount(d, Number(usdcDecimals))} ${usdcSymbol}, ` +
        `wallet=${formatTokenAmount(bal, Number(usdcDecimals))} ${usdcSymbol}, ` +
        `chunk=${formatTokenAmount(repayCap, Number(usdcDecimals))} ${usdcSymbol} (maxChunkRaw=${maxRepayChunkRaw.toString()})`
    );

    const tx1 = await usdcToken.approve(normalizeAddress(vaultAddress), repayCap);
    console.log("[repay] approve tx:", tx1.hash);
    await tx1.wait();

    // Aave/Base edge case: exact full repay can sometimes revert with arithmetic panic (0x11).
    // Try exact first, then slightly smaller fallback amounts.
    const attempts: bigint[] = [];
    attempts.push(repayCap);
    if (bal >= d && d > 1n) attempts.push(d - 1n);
    if (repayCap > 1n) attempts.push(repayCap - 1n);

    const seen = new Set<string>();
    let repaid = false;
    for (const candidate of attempts) {
      if (candidate <= 0n) continue;
      const key = candidate.toString();
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const tx2 = await vault.repayDebt(usdc, candidate);
        console.log(
          `[repay] repayDebt tx (${formatTokenAmount(candidate, Number(usdcDecimals))} ${usdcSymbol}):`,
          tx2.hash
        );
        await tx2.wait();
        repaid = true;
        break;
      } catch (e) {
        console.log(
          `[repay] repay attempt ${formatTokenAmount(candidate, Number(usdcDecimals))} ${usdcSymbol} failed: ${summarizeError(e)}`
        );
      }
    }

    if (!repaid) {
      // Likely stale RPC read — wallet reported a balance it doesn't actually have.
      // Fall back to topUp (swap ETH or withdraw collateral) instead of throwing.
      console.log(`[repay] All repay attempts failed (possible stale RPC read). Trying topUp...`);
      await topUpUsdcForRepay(d);
    }
  }

  const debtAfterRepay = await readDebt();
  if (debtAfterRepay !== 0n) {
    const bal = (await usdcToken.balanceOf(signer.address)) as bigint;
    throw new Error(
      `Debt not fully repaid. remaining=${formatTokenAmount(debtAfterRepay, Number(usdcDecimals))} ${usdcSymbol} ` +
        `(wallet=${formatTokenAmount(bal, Number(usdcDecimals))} ${usdcSymbol})`
    );
  }
  console.log("[repay] Debt cleared.");

  // ---- Withdraw all collateral back to wallet, then swap any non-USDC back to USDC ----
  // This makes the demo repeatable: after "Reset to USDC", the agent wallet holds (mostly) USDC and
  // the Aave position is cleared (no debt, no collateral).
  async function withdrawAllDelta(assetAddr: string, token: any, label: string): Promise<bigint> {
    const { aToken, balance } = await readATokenBalance(assetAddr);
    if (balance === 0n) {
      console.log(`[withdraw] ${label}: no aToken balance (aToken=${aToken}), skipping.`);
      return 0n;
    }
    const before = (await token.balanceOf(signer.address)) as bigint;
    console.log(`[withdraw] ${label}: withdrawing all collateral to wallet (balance=${balance.toString()})...`);
    // Try exact balance first, then balance-1 (Aave rounding), then type(uint256).max sentinel.
    let tx: any;
    const MAX_UINT256 = (1n << 256n) - 1n;
    const attempts: [string, bigint][] = [["exact", balance], ["balance-1", balance > 1n ? balance - 1n : balance], ["max", MAX_UINT256]];
    for (const [desc, amt] of attempts) {
      try {
        tx = await vault.withdrawCollateral(assetAddr, amt, signer.address, { gasLimit: 500_000 });
        console.log(`[withdraw] ${label} (${desc}) tx:`, tx.hash);
        break;
      } catch (e: any) {
        console.log(`[withdraw] ${label} (${desc}) failed: ${e?.shortMessage || e?.reason || e?.message || "unknown"}`);
        tx = null;
      }
    }
    if (!tx) throw new Error(`Failed to withdraw ${label} collateral after all attempts`);
    console.log(`[withdraw] ${label} tx:`, tx.hash);
    await tx.wait();
    const after = (await token.balanceOf(signer.address)) as bigint;
    return after > before ? after - before : 0n;
  }

  async function unwindToUsdc(tag: string) {
    // 1) Withdraw USDC collateral (no swap needed).
    await withdrawAllDelta(usdc, usdcToken, usdcSymbol);

    // 2) Withdraw WETH/cbBTC collateral and swap all to USDC.
    const gotWeth = await withdrawAllDelta(weth, tokenWeth, wethSymbol);
    const gotBtc = await withdrawAllDelta(cbbtc, tokenCbbtc, btcSymbol);
    void gotWeth;
    void gotBtc;

    // Swap all wallet holdings (not only what was withdrawn in this run).
    const [walletWethBeforeSwap, walletBtcBeforeSwap] = await Promise.all([
      tokenWeth.balanceOf(signer.address) as Promise<bigint>,
      tokenCbbtc.balanceOf(signer.address) as Promise<bigint>
    ]);
    await Promise.all([
      ensureHasCode("UniswapV3Factory", factoryAddr),
      ensureHasCode("Permit2", permit2Addr),
      ensureHasCode("UniswapV3Router", routerAddr),
      ensureHasCode("UniswapV3Quoter", quoterAddr)
    ]);

    // 3) Swap cbBTC to USDC (fallback cbBTC->WETH->USDC).
    // Do this before WETH so any cbBTC->WETH fallback gets swept by the WETH swap.
    if (walletBtcBeforeSwap > 0n) {
      try {
        await swapExact({
          tokenInAddr: cbbtc,
          tokenOutAddr: usdc,
          tokenInContract: tokenCbbtc,
          tokenInSym: btcSymbol,
          tokenOutSym: usdcSymbol,
          tokenInDec: Number(btcDecimals),
          tokenOutDec: Number(usdcDecimals),
          amountIn: walletBtcBeforeSwap
        });
      } catch (e1) {
        console.log(`[swap] ${btcSymbol} -> ${usdcSymbol} failed (${summarizeError(e1)}). Trying ${btcSymbol} -> ${wethSymbol} -> ${usdcSymbol}...`);
        const wethBefore = (await tokenWeth.balanceOf(signer.address)) as bigint;
        await swapExact({
          tokenInAddr: cbbtc,
          tokenOutAddr: weth,
          tokenInContract: tokenCbbtc,
          tokenInSym: btcSymbol,
          tokenOutSym: wethSymbol,
          tokenInDec: Number(btcDecimals),
          tokenOutDec: Number(wethDecimals),
          amountIn: walletBtcBeforeSwap
        });
        const wethAfter = (await tokenWeth.balanceOf(signer.address)) as bigint;
        const gotWeth2 = wethAfter > wethBefore ? wethAfter - wethBefore : 0n;
        if (gotWeth2 > 0n) {
          await swapExact({
            tokenInAddr: weth,
            tokenOutAddr: usdc,
            tokenInContract: tokenWeth,
            tokenInSym: wethSymbol,
            tokenOutSym: usdcSymbol,
            tokenInDec: Number(wethDecimals),
            tokenOutDec: Number(usdcDecimals),
            amountIn: gotWeth2
          });
        }
      }
    }

    // 4) Swap WETH balance to USDC.
    const walletWethAfterBtcSwap = (await tokenWeth.balanceOf(signer.address)) as bigint;
    if (walletWethAfterBtcSwap > 0n) {
      await swapExact({
        tokenInAddr: weth,
        tokenOutAddr: usdc,
        tokenInContract: tokenWeth,
        tokenInSym: wethSymbol,
        tokenOutSym: usdcSymbol,
        tokenInDec: Number(wethDecimals),
        tokenOutDec: Number(usdcDecimals),
        amountIn: walletWethAfterBtcSwap
      });
    }

    // Optional: move all USDC to a different destination wallet.
    if (normalizeAddress(withdrawTo) !== normalizeAddress(signer.address)) {
      const usdcBal = (await usdcToken.balanceOf(signer.address)) as bigint;
      if (usdcBal > 0n) {
        const tx = await usdcToken.transfer(withdrawTo, usdcBal);
        console.log(`[transfer] ${usdcSymbol} -> ${withdrawTo}:`, tx.hash);
        await tx.wait();
      }
    }
    console.log(`[unwind] ${tag}: done.`);
  }

  await unwindToUsdc("post-repay");

  const [uadAfter, debtFinal, aUsdcAfter, aWethAfter, aBtcAfter] = await Promise.all([
    pool.getUserAccountData(normalizeAddress(vaultAddress)),
    readDebt(),
    readATokenBalance(usdc),
    readATokenBalance(weth),
    readATokenBalance(cbbtc)
  ]);

  console.log("");
  console.log("Aave userAccountData (after):");
  console.log("- totalCollateralBase:", uadAfter[0].toString());
  console.log("- totalDebtBase:", uadAfter[1].toString());
  console.log("- healthFactor:", uadAfter[5].toString());
  console.log("");
  console.log(`USDC debt (after): ${formatTokenAmount(debtFinal, Number(usdcDecimals))} ${usdcSymbol} (${debtFinal.toString()} raw)`);
  console.log("Collateral aToken balances (after):");
  console.log(`- aUSDC:  ${aUsdcAfter.balance.toString()} (aToken=${aUsdcAfter.aToken})`);
  console.log(`- aWETH:  ${aWethAfter.balance.toString()} (aToken=${aWethAfter.aToken})`);
  console.log(`- acbBTC: ${aBtcAfter.balance.toString()} (aToken=${aBtcAfter.aToken})`);
  console.log("");
  console.log("Reset complete.");
}

main().catch((err) => {
  console.error(err);
  console.error(`[error summary] stage=${LAST_STAGE}: ${summarizeError(err)}`);
  process.exitCode = 1;
});
