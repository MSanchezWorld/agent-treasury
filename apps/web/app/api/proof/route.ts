import { NextResponse } from "next/server";
import { base } from "viem/chains";
import { createPublicClient, http, isAddress, parseAbiItem } from "viem";

export const runtime = "nodejs";

const BASE_RPC_OVERRIDE = (process.env.BASE_RPC_URL_OVERRIDE || "").trim();
const PROOF_RPC_TIMEOUT_MS = Math.max(1_500, Number(process.env.PROOF_RPC_TIMEOUT_MS || 7_000) || 7_000);
const DEFAULT_BASE_MAINNET_RPCS = [
  // Prefer endpoints that tend to be less rate-limited for hackathon demos.
  "https://base.drpc.org",
  "https://base-rpc.publicnode.com",
  "https://base.publicnode.com",
  "https://mainnet.base.org"
];
// If an override is set, prefer it first but keep fallbacks (a single RPC can be flaky under load).
const BASE_MAINNET_RPCS = (BASE_RPC_OVERRIDE ? [BASE_RPC_OVERRIDE, ...DEFAULT_BASE_MAINNET_RPCS] : DEFAULT_BASE_MAINNET_RPCS).filter(
  (v, i, a) => a.indexOf(v) === i
);

// Demo defaults (Base mainnet deployments in this repo).
const DEFAULT_VAULT = "0x943b828468509765654EA502803DF7F0b21637c6";
const DEFAULT_RECEIVER = "0x889ad605dE1BB47d4Dd932D25924dDF53b99a279";
const DEFAULT_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_PAYEE = "0x42444551e2b5FEb7A7c2eE4dA38993381B08Bc6d";
const DEFAULT_WETH = "0x4200000000000000000000000000000000000006";
const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const BorrowVaultAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "executor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "aaveAddressesProvider", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minHealthFactor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cooldownSeconds", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxBorrowPerTx", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxBorrowPerDay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "dailyBorrowed", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastExecutionAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "approvedPayees",
    stateMutability: "view",
    inputs: [{ name: "payee", type: "address" }],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "approvedBorrowTokens",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "bool" }]
  }
] as const;

const ReceiverAbi = [
  { type: "function", name: "forwarder", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const PoolAddressesProviderAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getPriceOracle", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const PoolAbi = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentLiquidityRate2", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" }
        ]
      }
    ]
  }
] as const;

const PriceOracleAbi = [
  { type: "function", name: "BASE_CURRENCY_UNIT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getAssetPrice", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ type: "uint256" }] }
] as const;

const Erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }
] as const;

function baseDecimalsFromUnit(unit: bigint): number {
  const s = unit.toString();
  return Math.max(0, s.length - 1);
}

function powerOfTenExponent(v: bigint): number | null {
  // Expect a literal power of ten like 1, 10, 100, 1000... (Aave oracle base is typically 1e8).
  const s = v.toString();
  if (!/^1(0+)$/.test(s)) return null;
  return s.length - 1;
}

function isReasonableBaseCurrencyUnit(v: bigint): boolean {
  // For this hackathon demo we only accept "USD-like" base units (1e6..1e10).
  // If this is wrong, USD formatting will show $0.00 everywhere, so it's better to
  // fall back to another RPC.
  const exp = powerOfTenExponent(v);
  return exp != null && exp >= 6 && exp <= 10;
}

function acceptPriceInRange(min: bigint, max: bigint) {
  return (v: any) => typeof v === "bigint" && v >= min && v <= max;
}

function valueBaseFromRawAmount(rawAmount: bigint, priceBase: bigint, tokenDecimals: number): bigint {
  if (!Number.isFinite(tokenDecimals)) return 0n;
  const dec = Math.trunc(tokenDecimals);
  if (dec < 0 || dec > 36) return 0n;
  const scale = 10n ** BigInt(dec);
  if (scale === 0n) return 0n;
  return (rawAmount * priceBase) / scale;
}

function jsonSafe<T>(obj: T): any {
  // NextResponse.json cannot serialize bigint; convert them to string recursively.
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      return v;
    })
  );
}

const RPC_CLIENTS: Array<{ url: string; client: any }> = BASE_MAINNET_RPCS.map((url) => ({
  url,
  client: createPublicClient({ chain: base, transport: http(url, { timeout: PROOF_RPC_TIMEOUT_MS, retryCount: 0 }) })
}));

async function withRpcFallback(fn: (client: any) => Promise<any>, accept?: (v: any) => boolean): Promise<any> {
  let lastErr: unknown = null;
  if (!RPC_CLIENTS.length) throw new Error("No Base RPC endpoints configured");

  // Sticky preferred endpoint: if one RPC worked for a recent call, start there.
  if (!(globalThis as any).__ctbProofPreferredRpcUrl) {
    (globalThis as any).__ctbProofPreferredRpcUrl = RPC_CLIENTS[0]!.url;
  }
  const preferred = String((globalThis as any).__ctbProofPreferredRpcUrl || RPC_CLIENTS[0]!.url);
  const startIdx = Math.max(
    0,
    RPC_CLIENTS.findIndex((r) => r.url === preferred)
  );
  const ordered = [...RPC_CLIENTS.slice(startIdx), ...RPC_CLIENTS.slice(0, startIdx)];

  const errors: string[] = [];
  for (const { client, url } of ordered) {
    try {
      const v = await fn(client);
      if (accept && !accept(v)) {
        lastErr = new Error(`RPC ${url} returned an unacceptable response`);
        errors.push(`${url}: unacceptable response`);
        continue;
      }
      (globalThis as any).__ctbProofPreferredRpcUrl = url;
      return v;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${url}: ${msg.split("\n")[0]}`);
    }
  }
  const summary = errors.slice(0, 4).join(" | ");
  if (lastErr instanceof Error) {
    throw new Error(`RPC fallback exhausted (${summary || lastErr.message})`);
  }
  throw new Error(`RPC fallback exhausted (${summary || "unknown error"})`);
}

async function fetchProof(payee: `0x${string}`) {
  const vault = DEFAULT_VAULT as `0x${string}`;
  const receiver = DEFAULT_RECEIVER as `0x${string}`;
  const usdc = DEFAULT_USDC as `0x${string}`;
  // Include USDC so the demo can show USDC-only collateral deposits (reliable, no swaps).
  const collateralTokens = [DEFAULT_USDC, DEFAULT_WETH, DEFAULT_CBBTC] as const;

  const [
    owner,
    executor,
    paused,
    nonce,
    addressesProvider,
    payeeAllowed,
    borrowTokenAllowed,
    minHealthFactor,
    cooldownSeconds,
    maxBorrowPerTx,
    maxBorrowPerDay,
    dailyBorrowed,
    lastExecutionAt,
    receiverForwarder
  ] = await Promise.all([
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "owner" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "executor" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "paused" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "nonce" })),
    withRpcFallback(
      (c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "aaveAddressesProvider" }),
      (v) => String(v).toLowerCase() !== ZERO_ADDRESS
    ),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "approvedPayees", args: [payee] })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "approvedBorrowTokens", args: [usdc] })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "minHealthFactor" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "cooldownSeconds" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "maxBorrowPerTx" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "maxBorrowPerDay" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "dailyBorrowed" })),
    withRpcFallback((c) => c.readContract({ address: vault, abi: BorrowVaultAbi, functionName: "lastExecutionAt" })),
    withRpcFallback((c) => c.readContract({ address: receiver, abi: ReceiverAbi, functionName: "forwarder" }), (v) => String(v).toLowerCase() !== ZERO_ADDRESS)
  ]);

  // --- Round 2: pool + oracle + USDC metadata + all wallet balances (all independent) ---
  const [pool, priceOracle, usdcDecimals, usdcSymbol, payeeBalance,
    vaultUsdc, vaultWeth, vaultCbbtc, payeeWeth, payeeCbbtc] = await Promise.all([
    withRpcFallback((c) => c.readContract({ address: addressesProvider, abi: PoolAddressesProviderAbi, functionName: "getPool" }), (v) => String(v).toLowerCase() !== ZERO_ADDRESS),
    withRpcFallback(
      (c) => c.readContract({ address: addressesProvider, abi: PoolAddressesProviderAbi, functionName: "getPriceOracle" }),
      (v) => String(v).toLowerCase() !== ZERO_ADDRESS
    ),
    withRpcFallback((c) => c.readContract({ address: usdc, abi: Erc20Abi, functionName: "decimals" })),
    withRpcFallback((c) => c.readContract({ address: usdc, abi: Erc20Abi, functionName: "symbol" })),
    withRpcFallback((c) => c.readContract({ address: usdc, abi: Erc20Abi, functionName: "balanceOf", args: [payee] })),
    withRpcFallback((c) => c.readContract({ address: usdc, abi: Erc20Abi, functionName: "balanceOf", args: [vault] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_WETH as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [vault] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_CBBTC as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [vault] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_WETH as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [payee] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_CBBTC as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [payee] }))
  ]);
  const payeeUsdc = payeeBalance; // same value, avoid duplicate fetch

  // --- Round 3: things that depend on pool/oracle ---
  const [baseCurrencyUnit, userAccountDataRaw, usdcReserve] = await Promise.all([
    withRpcFallback(
      (c) => c.readContract({ address: priceOracle, abi: PriceOracleAbi, functionName: "BASE_CURRENCY_UNIT" }),
      (v) => typeof v === "bigint" && v > 0n && isReasonableBaseCurrencyUnit(v)
    ),
    withRpcFallback((c) => c.readContract({ address: pool, abi: PoolAbi, functionName: "getUserAccountData", args: [vault] })),
    withRpcFallback((c) => c.readContract({ address: pool, abi: PoolAbi, functionName: "getReserveData", args: [usdc] }))
  ]);
  const baseDecimals = baseDecimalsFromUnit(BigInt(baseCurrencyUnit));
  const userAccountData = { totalCollateralBase: userAccountDataRaw[0], totalDebtBase: userAccountDataRaw[1], healthFactor: userAccountDataRaw[5] };

  // --- Round 4: usdcPriceBase (needs baseCurrencyUnit) + vault debt (needs usdcReserve) ---
  const varDebtToken = usdcReserve.variableDebtTokenAddress;
  const [usdcPriceBase, vaultDebt] = await Promise.all([
    withRpcFallback((c) => c.readContract({ address: priceOracle, abi: PriceOracleAbi, functionName: "getAssetPrice", args: [usdc] }), acceptPriceInRange(BigInt(baseCurrencyUnit) / 2n, BigInt(baseCurrencyUnit) * 2n)),
    withRpcFallback((c) => c.readContract({ address: varDebtToken, abi: Erc20Abi, functionName: "balanceOf", args: [vault] }))
  ]);

  const usdcScale = 10n ** BigInt(Number(usdcDecimals));
  const payeeValueBase = (BigInt(payeeBalance) * BigInt(usdcPriceBase)) / usdcScale;
  const vaultDebtValueBase = (BigInt(vaultDebt) * BigInt(usdcPriceBase)) / usdcScale;
  const vaultWalletValueBase = (BigInt(vaultUsdc) * BigInt(usdcPriceBase)) / usdcScale;

  const [ownerUsdc, ownerWeth, ownerCbbtc] = await Promise.all([
    withRpcFallback((c) => c.readContract({ address: usdc, abi: Erc20Abi, functionName: "balanceOf", args: [owner] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_WETH as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [owner] })),
    withRpcFallback((c) => c.readContract({ address: DEFAULT_CBBTC as `0x${string}`, abi: Erc20Abi, functionName: "balanceOf", args: [owner] }))
  ]);
  const ownerWalletValueBase = (BigInt(ownerUsdc) * BigInt(usdcPriceBase)) / usdcScale;

  const collaterals = await Promise.all(
    collateralTokens.map(async (asset) => {
      const addr = asset as `0x${string}`;
      const isWeth = addr.toLowerCase() === DEFAULT_WETH.toLowerCase();
      const isCbbtc = addr.toLowerCase() === DEFAULT_CBBTC.toLowerCase();
      const minPrice = isWeth ? 100n * BigInt(baseCurrencyUnit) : isCbbtc ? 1_000n * BigInt(baseCurrencyUnit) : 1n;
      const maxPrice = isWeth ? 1_000_000n * BigInt(baseCurrencyUnit) : isCbbtc ? 10_000_000n * BigInt(baseCurrencyUnit) : (1n << 255n);

      const [decimals, symbol, reserve, priceBase] = await Promise.all([
        withRpcFallback((c) => c.readContract({ address: addr, abi: Erc20Abi, functionName: "decimals" })),
        withRpcFallback((c) => c.readContract({ address: addr, abi: Erc20Abi, functionName: "symbol" })),
        withRpcFallback((c) => c.readContract({ address: pool, abi: PoolAbi, functionName: "getReserveData", args: [addr] })),
        withRpcFallback((c) => c.readContract({ address: priceOracle, abi: PriceOracleAbi, functionName: "getAssetPrice", args: [addr] }), acceptPriceInRange(minPrice, maxPrice))
      ]);
      const aTokenAddress = reserve.aTokenAddress;
      const aTokenBalance = await withRpcFallback((c) => c.readContract({ address: aTokenAddress, abi: Erc20Abi, functionName: "balanceOf", args: [vault] }));
      const scale = 10n ** BigInt(Number(decimals));
      const valueBase = (BigInt(aTokenBalance) * BigInt(priceBase)) / scale;
      return {
        address: addr,
        symbol,
        decimals: Number(decimals),
        aTokenAddress,
        aTokenBalance,
        priceBase,
        valueBase
      };
    })
  );

  const wethMeta = collaterals.find((c) => c.address.toLowerCase() === DEFAULT_WETH.toLowerCase());
  const cbbtcMeta = collaterals.find((c) => c.address.toLowerCase() === DEFAULT_CBBTC.toLowerCase());
  const wethPriceBase = wethMeta?.priceBase ?? 0n;
  const cbbtcPriceBase = cbbtcMeta?.priceBase ?? 0n;

  const walletValues = {
    owner: {
      usdcValueBase: ownerWalletValueBase,
      wethValueBase: wethMeta ? valueBaseFromRawAmount(ownerWeth, wethPriceBase, wethMeta.decimals) : 0n,
      cbbtcValueBase: cbbtcMeta ? valueBaseFromRawAmount(ownerCbbtc, cbbtcPriceBase, cbbtcMeta.decimals) : 0n
    },
    vault: {
      usdcValueBase: vaultWalletValueBase,
      wethValueBase: wethMeta ? valueBaseFromRawAmount(vaultWeth, wethPriceBase, wethMeta.decimals) : 0n,
      cbbtcValueBase: cbbtcMeta ? valueBaseFromRawAmount(vaultCbbtc, cbbtcPriceBase, cbbtcMeta.decimals) : 0n
    },
    payee: {
      usdcValueBase: payeeValueBase,
      wethValueBase: wethMeta ? valueBaseFromRawAmount(payeeWeth, wethPriceBase, wethMeta.decimals) : 0n,
      cbbtcValueBase: cbbtcMeta ? valueBaseFromRawAmount(payeeCbbtc, cbbtcPriceBase, cbbtcMeta.decimals) : 0n
    }
  };

  const walletValuesWithTotals = {
    ...walletValues,
    owner: {
      ...walletValues.owner,
      totalValueBase: walletValues.owner.usdcValueBase + walletValues.owner.wethValueBase + walletValues.owner.cbbtcValueBase
    },
    vault: {
      ...walletValues.vault,
      totalValueBase: walletValues.vault.usdcValueBase + walletValues.vault.wethValueBase + walletValues.vault.cbbtcValueBase
    },
    payee: {
      ...walletValues.payee,
      totalValueBase: walletValues.payee.usdcValueBase + walletValues.payee.wethValueBase + walletValues.payee.cbbtcValueBase
    }
  };

  const blockNumber = await withRpcFallback((c) => c.getBlockNumber());
  const fromBlock = blockNumber > 9_000n ? blockNumber - 9_000n : 0n;

  const borrowEvent = parseAbiItem(
    "event BorrowAndPayExecuted(uint256 indexed nonce, address indexed borrowAsset, uint256 borrowAmount, address indexed payee, uint256 planExpiresAt)"
  );
  const receiverEvent = parseAbiItem(
    "event ReportProcessed(address indexed borrowAsset, uint256 borrowAmount, address indexed payee, uint256 planExpiresAt, uint256 planNonce)"
  );

  // Aave Supply event: emitted when collateral is supplied to the pool
  const supplyEvent = parseAbiItem(
    "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"
  );

  const [borrowLogs, receiverLogs, supplyLogs] = await Promise.all([
    withRpcFallback((c) => c.getLogs({ address: vault, event: borrowEvent, fromBlock, toBlock: "latest" })),
    withRpcFallback((c) => c.getLogs({ address: receiver, event: receiverEvent, fromBlock, toBlock: "latest" })),
    withRpcFallback((c) => c.getLogs({ address: pool, event: supplyEvent, args: { onBehalfOf: vault }, fromBlock, toBlock: "latest" })).catch(() => [] as any[])
  ]);

  const lastBorrow = [...borrowLogs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : Number(a.blockNumber - b.blockNumber)))
    .pop();

  const lastReceiver = [...receiverLogs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : Number(a.blockNumber - b.blockNumber)))
    .pop();

  const lastSupply = [...supplyLogs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? Number(a.logIndex) - Number(b.logIndex) : Number(a.blockNumber - b.blockNumber)))
    .pop();

  return {
    updatedAtMs: Date.now(),
    vault: { address: vault, owner, executor, paused, nonce, payeeAllowed, borrowTokenAllowed },
    vaultPolicy: { minHealthFactor, cooldownSeconds, maxBorrowPerTx, maxBorrowPerDay, dailyBorrowed, lastExecutionAt },
    receiver: { address: receiver, forwarder: receiverForwarder },
    oracle: { address: priceOracle, baseCurrencyUnit, baseDecimals },
    aave: { pool, userAccountData },
    usdc: {
      address: usdc,
      symbol: usdcSymbol,
      decimals: Number(usdcDecimals),
      payeeBalance,
      vaultDebt,
      priceBase: usdcPriceBase,
      payeeValueBase,
      vaultDebtValueBase,
      vaultWalletValueBase,
      ownerWalletValueBase
    },
    walletValues: walletValuesWithTotals,
    collaterals,
    wallet: {
      vault: { usdc: vaultUsdc, weth: vaultWeth, cbbtc: vaultCbbtc },
      owner: { usdc: ownerUsdc, weth: ownerWeth, cbbtc: ownerCbbtc },
      payee: { usdc: payeeUsdc, weth: payeeWeth, cbbtc: payeeCbbtc }
    },
    lastBorrowAndPay: lastBorrow
      ? (() => {
        const args = lastBorrow.args as unknown as { nonce: bigint; borrowAmount: bigint; payee: `0x${string}` };
          return { txHash: lastBorrow.transactionHash, blockNumber: lastBorrow.blockNumber, nonce: args.nonce, borrowAmount: args.borrowAmount, payee: args.payee };
        })()
      : undefined,
    lastReceiverReport: lastReceiver
      ? (() => {
          const args = lastReceiver.args as unknown as { planNonce: bigint; borrowAmount: bigint; payee: `0x${string}` };
          return { txHash: lastReceiver.transactionHash, blockNumber: lastReceiver.blockNumber, planNonce: args.planNonce, borrowAmount: args.borrowAmount, payee: args.payee };
        })()
      : undefined,
    lastSupply: lastSupply
      ? { txHash: lastSupply.transactionHash, blockNumber: lastSupply.blockNumber }
      : undefined
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const payeeRaw = (url.searchParams.get("payee") || DEFAULT_PAYEE).trim();
    if (!isAddress(payeeRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid payee" }, { status: 400 });
    }

    const proof = await fetchProof(payeeRaw as `0x${string}`);
    const preferredRpc = String((globalThis as any).__ctbProofPreferredRpcUrl || BASE_MAINNET_RPCS[0] || "");
    return NextResponse.json({ ok: true, proof: jsonSafe(proof), rpc: { preferred: preferredRpc, candidates: BASE_MAINNET_RPCS } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to load onchain proof from Base RPC fallback. ${msg}`,
        rpc: { candidates: BASE_MAINNET_RPCS }
      },
      { status: 500 }
    );
  }
}
