"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatUnits, isAddress, parseUnits } from "viem";
import StoryReplay from "./story-replay";
const BASESCAN = "https://basescan.org";

// Demo defaults (Base mainnet deployments in this repo).
const DEFAULT_VAULT = "0x943b828468509765654EA502803DF7F0b21637c6";
const DEFAULT_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_AGENT_WALLET = "0x7C00B7060Fe24F6A4E32F56ade0b91675B9D81C9";
const DEFAULT_PAYEE = "0x42444551e2b5FEb7A7c2eE4dA38993381B08Bc6d";
const DEFAULT_WETH = "0x4200000000000000000000000000000000000006";
const DEFAULT_CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const NON_ALLOWLISTED_PAYEE_PRESET = "0x000000000000000000000000000000000000dEaD";
const PROOF_CACHE_KEY_VERSION = "v2";
const CRE_GAS_LIMIT = "500000";
const PROOF_FETCH_TIMEOUT_MS = 45_000;

type Proof = {
  updatedAtMs: number;
  vault: {
    address: string;
    owner: string;
    executor?: string;
    paused: boolean;
    nonce: bigint;
    payeeAllowed: boolean;
    borrowTokenAllowed: boolean;
  };
  vaultPolicy?: {
    minHealthFactor: bigint;
    cooldownSeconds: bigint;
    maxBorrowPerTx: bigint;
    maxBorrowPerDay: bigint;
    dailyBorrowed: bigint;
    lastExecutionAt: bigint;
  };
  receiver: { address: string; forwarder?: string };
  oracle: {
    address: string;
    baseCurrencyUnit: bigint;
    baseDecimals: number;
  };
  aave: {
    pool: string;
    userAccountData: {
      totalCollateralBase: bigint;
      totalDebtBase: bigint;
      healthFactor: bigint;
    };
  };
  usdc: {
    address: string;
    symbol: string;
    decimals: number;
    payeeBalance: bigint;
    vaultDebt: bigint;
    priceBase: bigint;
    payeeValueBase: bigint;
    vaultDebtValueBase: bigint;
    vaultWalletValueBase: bigint;
    ownerWalletValueBase: bigint;
  };
  collaterals: Array<{
    address: string;
    symbol: string;
    decimals: number;
    aTokenAddress: string;
    aTokenBalance: bigint;
    priceBase: bigint;
    valueBase: bigint;
  }>;
  wallet: {
    vault: {
      usdc: bigint;
      weth: bigint;
      cbbtc: bigint;
    };
    owner: {
      usdc: bigint;
      weth: bigint;
      cbbtc: bigint;
    };
    payee: {
      usdc: bigint;
      weth: bigint;
      cbbtc: bigint;
    };
  };
  walletValues?: {
    owner: { usdcValueBase: bigint; wethValueBase: bigint; cbbtcValueBase: bigint; totalValueBase: bigint };
    vault: { usdcValueBase: bigint; wethValueBase: bigint; cbbtcValueBase: bigint; totalValueBase: bigint };
    payee: { usdcValueBase: bigint; wethValueBase: bigint; cbbtcValueBase: bigint; totalValueBase: bigint };
  };
  lastBorrowAndPay?: {
    txHash: string;
    blockNumber: bigint;
    nonce: bigint;
    borrowAmount: bigint;
    payee: string;
  };
  lastReceiverReport?: {
    txHash: string;
    blockNumber: bigint;
    planNonce: bigint;
    borrowAmount: bigint;
    payee: string;
  };
  lastSupply?: {
    txHash: string;
    blockNumber: bigint;
  };
};

// Prevent runtime crashes when something (our code or a library) calls JSON.stringify on
// objects containing BigInt values. This is safe in a demo app and keeps Next dev overlay
// from blowing up mid-run.
if (typeof BigInt !== "undefined" && typeof (BigInt.prototype as any).toJSON !== "function") {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

function shortHex(hex?: string, left = 6, right = 4) {
  if (!hex) return "";
  if (hex.length <= left + right) return hex;
  return `${hex.slice(0, left)}...${hex.slice(-right)}`;
}

function parseUsdcHumanToUnits(v: string): string | null {
  // Accept both "." and "," decimals (locale-friendly).
  const s = v.trim().replaceAll(",", ".");
  // Keep it strict to avoid accidental "1e6" style inputs.
  if (!/^[0-9]+(\.[0-9]{0,6})?$/.test(s)) return null;
  try {
    const units = parseUnits(s as `${number}`, 6);
    if (units <= 0n) return "0";
    return units.toString();
  } catch {
    return null;
  }
}

function formatUsdBase(v: bigint, baseDecimals = 8) {
  const s = formatUnits(v, Number(baseDecimals));
  const [i, f = ""] = s.split(".");
  return `${i}.${(f + "00").slice(0, 2)}`;
}

function baseDecimalsFromUnit(unit: bigint): number {
  const s = unit.toString();
  return Math.max(0, s.length - 1);
}

function formatToken(v: bigint, decimals: number, maxFrac = 6) {
  const s = formatUnits(v, Number(decimals));
  const [i, fRaw = ""] = s.split(".");
  const f = fRaw.slice(0, maxFrac).replace(/0+$/, "");
  return f.length ? `${i}.${f}` : i;
}

function toBigIntOrZero(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return 0n;
      return BigInt(Math.trunc(v));
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (/^-?\d+$/.test(s)) return BigInt(s);
    }
  } catch {
    // ignore
  }
  return 0n;
}

function valueBaseFromRaw(rawAmount: any, priceBase: any, tokenDecimals: any): bigint {
  const amount = toBigIntOrZero(rawAmount);
  const price = toBigIntOrZero(priceBase);
  const dec = toBigIntOrZero(tokenDecimals);
  if (dec < 0n) return 0n;
  const scale = 10n ** dec;
  if (scale === 0n) return 0n;
  return (amount * price) / scale;
}

function formatUsdOrDash(valueBase: bigint, baseDecimals: number, amountRaw?: bigint) {
  // If we have a non-zero token balance but cannot compute a USD value (usually a price/oracle issue),
  // show a dash instead of misleading "$0.00".
  if (amountRaw != null && amountRaw > 0n && valueBase === 0n) return "—";
  return formatUsdBase(valueBase, baseDecimals);
}

function reviveBigInts(v: any): any {
  if (Array.isArray(v)) return v.map(reviveBigInts);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = reviveBigInts(val);
    return out;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) return BigInt(s);
  }
  return v;
}

function stringifyBigInts(v: any): string {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
}

function extractRunnerTxHash(run: any, label: string): string | null {
  if (!run) return null;
  const out = `${String(run.stdout || "")}\n${String(run.stderr || "")}`;
  const re = new RegExp(`\\\\[${label}\\\\]\\\\s*tx:\\\\s*(0x[0-9a-fA-F]{64})`);
  const m = out.match(re);
  return m?.[1] ?? null;
}

function getATokenBalanceFromProof(p: any, assetAddr: string): bigint | null {
  const cols = p?.collaterals;
  if (!Array.isArray(cols)) return null;
  const needle = assetAddr.toLowerCase();
  for (const c of cols) {
    if (String((c as any)?.address || "").toLowerCase() === needle) {
      return toBigIntOrZero((c as any)?.aTokenBalance);
    }
  }
  // If the token isn't present in the collaterals list, treat as 0 rather than "unknown".
  return 0n;
}

function DemoRouter() {
  const params = useSearchParams();
  const isLive = params.has("live");
  return isLive ? <LiveDemo /> : <StoryReplay />;
}

export default function DemoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <DemoRouter />
    </Suspense>
  );
}

function LiveDemo() {
  const [payee, setPayee] = useState(DEFAULT_PAYEE);
  const [amountUsdc, setAmountUsdc] = useState("1.00");
  const [depositUsdc, setDepositUsdc] = useState("5.00");
  const [depositMode, setDepositMode] = useState<"eth_btc" | "usdc">("usdc");
  const [presetId, setPresetId] = useState<"happy" | "non_allowlisted" | "borrow_too_much" | "simulate_only">("happy");
  const [broadcast, setBroadcast] = useState(true);
  const [copied, setCopied] = useState<null | "agent" | "debug" | "error">(null);
  const [confirmRunOpen, setConfirmRunOpen] = useState(false);

  const [running, setRunning] = useState(false);
  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [runNowMs, setRunNowMs] = useState<number>(Date.now());
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0); // 0 Agent, 1 Deposit, 2 CRE, 3 Onchain, 4 Payee
  const [error, setError] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [splitDone, setSplitDone] = useState(false);
  const [payLanded, setPayLanded] = useState(false);

  const [plan, setPlan] = useState<any | null>(null);
  const [agentReqBody, setAgentReqBody] = useState<any | null>(null);
  const [creTriggerBody, setCreTriggerBody] = useState<any | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [baseline, setBaseline] = useState<Proof | null>(null);
  const [creRun, setCreRun] = useState<any | null>(null);
  const [depositRun, setDepositRun] = useState<any | null>(null);
  const [resetRun, setResetRun] = useState<any | null>(null);
  const [swapRun, setSwapRun] = useState<any | null>(null);
  const [finished, setFinished] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const agentAnchorRef = useRef<HTMLDivElement | null>(null);
  const treasuryInAnchorRef = useRef<HTMLDivElement | null>(null);
  const treasuryCollateralAnchorRef = useRef<HTMLDivElement | null>(null);
  const treasuryDebtAnchorRef = useRef<HTMLDivElement | null>(null);
  const payeeAnchorRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const [anchors, setAnchors] = useState<{
    agent: { x: number; y: number };
    treasuryIn: { x: number; y: number };
    collateral: { x: number; y: number };
    debt: { x: number; y: number };
    payee: { x: number; y: number };
  } | null>(null);

  const amountUnits = useMemo(() => parseUsdcHumanToUnits(amountUsdc), [amountUsdc]);
  const depositUnits = useMemo(() => parseUsdcHumanToUnits(depositUsdc), [depositUsdc]);
  const validPayee = isAddress(payee);
  const isSwapDeposit = depositMode === "eth_btc";
  const canRun =
    validPayee && amountUnits != null && amountUnits !== "0" && depositUnits != null && depositUnits !== "0";
  const runDisabledReason = !validPayee
    ? "Enter a valid payee address"
    : amountUnits == null
      ? "Enter a valid borrow amount (USDC)"
      : amountUnits === "0"
        ? "Borrow amount must be > 0"
        : depositUnits == null
          ? "Enter a valid deposit amount (USDC)"
          : depositUnits === "0"
            ? "Deposit amount must be > 0"
            : "";
  // Keep the Run button clickable even when inputs are invalid so the user gets
  // immediate feedback instead of a "dead" UI.
  const runDisabled = running;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRunNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!error) return;
    // Make failures obvious: scroll the error box into view when a run stops.
    const t = setTimeout(() => {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => clearTimeout(t);
  }, [error]);

  async function refreshProof() {
    const payeeAddr = payee.trim();
    if (!isAddress(payeeAddr)) throw new Error("Invalid payee address");

    setProofLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROOF_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/proof?payee=${encodeURIComponent(payeeAddr)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load proof");
      const p = reviveBigInts(json.proof) as Proof;
      setProof(p);
      // Don't clear a run error just because the proof refreshed (the refresh is often triggered
      // by `running` flipping false). Only clear proof-loading errors.
      setError((prev) => {
        if (!prev) return prev;
        if (prev.startsWith("Failed to load onchain proof:")) return null;
        if (prev.startsWith("Failed to load proof:")) return null;
        return prev;
      });

      try {
        localStorage.setItem(`ctb.demo.proof.${PROOF_CACHE_KEY_VERSION}.${payeeAddr.toLowerCase()}`, stringifyBigInts(p));
      } catch {
        // Ignore localStorage failures (private mode, quota, etc).
      }
      return p;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`Onchain proof request timed out after ${Math.round(PROOF_FETCH_TIMEOUT_MS / 1000)}s`);
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      setProofLoading(false);
    }
  }

  useEffect(() => {
    // Best-effort cached payee+proof for demo stability (so a refresh doesn't blank the screen).
    let initialPayee = DEFAULT_PAYEE;
    try {
      const savedPayee = (localStorage.getItem("ctb.demo.payee") || "").trim();
      if (savedPayee && isAddress(savedPayee)) {
        initialPayee = savedPayee;
        setPayee(savedPayee);
      }
    } catch {
      // Ignore localStorage failures.
    }

    // Clear stale localStorage values so defaults always apply.
    try {
      localStorage.removeItem("ctb.demo.depositUsdc");
      localStorage.removeItem("ctb.demo.borrowUsdc");
      localStorage.removeItem("ctb.demo.depositMode");
    } catch {
      // Ignore localStorage failures.
    }

    try {
      const cached = localStorage.getItem(`ctb.demo.proof.${PROOF_CACHE_KEY_VERSION}.${initialPayee.toLowerCase()}`);
      if (cached) setProof(reviveBigInts(JSON.parse(cached)) as Proof);
    } catch {
      // Ignore cache parse issues.
    }
  }, []);

  useEffect(() => {
    const payeeAddr = payee.trim();
    if (!isAddress(payeeAddr)) return;

    try {
      localStorage.setItem("ctb.demo.payee", payeeAddr);
    } catch {
      // Ignore localStorage failures.
    }

    // Debounced refresh so typing doesn't spam.
    if (running) return;
    const t = setTimeout(() => {
      void refreshProof().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Failed to load onchain proof: ${msg}`);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [payee, running]);

  function applyPreset(id: "happy" | "non_allowlisted" | "borrow_too_much" | "simulate_only") {
    setPresetId(id);
    if (id === "happy") {
      setPayee(DEFAULT_PAYEE);
      setDepositUsdc("5.00");
      setDepositMode("usdc");
      setAmountUsdc("1.00");
      setBroadcast(true);
      return;
    }
    if (id === "non_allowlisted") {
      setPayee(NON_ALLOWLISTED_PAYEE_PRESET);
      setDepositUsdc("10.00");
      // Avoid swaps in failure presets; fewer moving parts.
      setDepositMode("usdc");
      setAmountUsdc("4.00");
      setBroadcast(true);
      return;
    }
    if (id === "borrow_too_much") {
      setPayee(DEFAULT_PAYEE);
      setDepositUsdc("10.00");
      setDepositMode("usdc");
      // Default vault limit is 100 USDC/tx; 150 should fail the onchain guard.
      setAmountUsdc("150.00");
      setBroadcast(true);
      return;
    }
    // simulate_only
    setPayee(DEFAULT_PAYEE);
    setDepositUsdc("10.00");
    setDepositMode("usdc");
    setAmountUsdc("4.00");
    setBroadcast(false);
  }

  useEffect(() => {
    if (!running) return;
    // Phase 1: show USDC moving in, then land as Aave collateral.
    if (phase === 1) {
      setSplitDone(false);
      const t = setTimeout(() => setSplitDone(true), 900);
      return () => clearTimeout(t);
    }
    // Phase 3: borrowed USDC lands in payee.
    if (phase === 3) {
      const t = setTimeout(() => setPayLanded(true), 850);
      return () => clearTimeout(t);
    }
  }, [running, phase]);

  useEffect(() => {
    // Compute absolute anchor positions for smooth token movement.
    const compute = () => {
      const board = boardRef.current;
      if (!board) return;
      const boardRect = board.getBoundingClientRect();

      const get = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - boardRect.left, y: r.top + r.height / 2 - boardRect.top };
      };

      const agent = get(agentAnchorRef.current);
      const treasuryIn = get(treasuryInAnchorRef.current);
      const collateral = get(treasuryCollateralAnchorRef.current);
      const debt = get(treasuryDebtAnchorRef.current);
      const payee = get(payeeAnchorRef.current);
      if (!agent || !treasuryIn || !collateral || !debt || !payee) return;
      setAnchors({ agent, treasuryIn, collateral, debt, payee });
    };

    const t = setTimeout(compute, 0);
    window.addEventListener("resize", compute);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", compute);
    };
  }, [payee, proof, baseline, running, splitDone, finished]);

  async function runDemo() {
    if (running) return;
    const payeeAddr = payee.trim();
    if (!isAddress(payeeAddr)) {
      setError("Enter a valid payee address");
      return;
    }
    if (!amountUnits || amountUnits === "0") {
      setError("Enter a valid borrow amount (USDC)");
      return;
    }
    if (!depositUnits || depositUnits === "0") {
      setError("Enter a valid deposit amount (USDC)");
      return;
    }
    const runDepositMode: "eth_btc" | "usdc" = depositMode;

    setConfirmRunOpen(false);

    setRunStartedAtMs(Date.now());
    setRunning(true);
    setError(null);
    setPlan(null);
    setAgentReqBody(null);
    setCreTriggerBody(null);
    setCreRun(null);
    setDepositRun(null);
    setResetRun(null);
    setSwapRun(null);
    setFinished(false);
    setPhase(0);
    setSplitDone(false);
    setPayLanded(false);
    try {
      const baselineProof = await refreshProof();
      setBaseline(baselineProof);

      // 1) Agent plan (HTTP integration used by the CRE workflow)
      const reqBody = {
        spendRequest: {
          borrowAsset: DEFAULT_USDC,
          borrowAmount: amountUnits!,
          payee: payeeAddr
        },
        treasuryPlan: {
          depositUsdc: depositUnits,
          depositHuman: depositUsdc,
          depositMode
        },
        vault: {
          address: DEFAULT_VAULT,
          currentNonce: baselineProof.vault.nonce.toString()
        }
      };
      setAgentReqBody(reqBody);

      const agentRes = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody)
      });
      const agentJson = await agentRes.json();
      if (!agentRes.ok) throw new Error(agentJson?.error || "Agent request failed");
      setPlan(agentJson);
      setPhase(1);

      // 2) Deposit + supply. Optionally swap USDC -> WETH/cbBTC 50/50 before supplying.
      const depRes = await fetch("/api/demo/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmMainnet: true,
          depositMode: runDepositMode,
          depositAmount: depositUnits!,
          ...(runDepositMode === "eth_btc" ? { allocEthBps: 5000, allocBtcBps: 5000 } : {})
        })
      });
      const depJson = await depRes.json();
      // Always keep the runner output for debugging (even on failure).
      setDepositRun(depJson);
      if (!depRes.ok || !depJson?.ok) {
        const summary = depJson?.summary || depJson?.error || "Deposit failed";
        throw new Error(`Deposit failed: ${summary}`);
      }

      // Poll proof until we observe the expected Aave collateral changed for this deposit mode.
      {
        const start = Date.now();
        const timeoutMs = 90_000;
        for (;;) {
          const p = await refreshProof();
          const depositObserved =
            runDepositMode === "usdc"
              ? (() => {
                  const beforeAUsdc = getATokenBalanceFromProof(baselineProof, DEFAULT_USDC);
                  const afterAUsdc = getATokenBalanceFromProof(p, DEFAULT_USDC);
                  if (beforeAUsdc != null && afterAUsdc != null) return afterAUsdc > beforeAUsdc;
                  const before = toBigIntOrZero(baselineProof?.aave?.userAccountData?.totalCollateralBase);
                  const after = toBigIntOrZero(p?.aave?.userAccountData?.totalCollateralBase);
                  return after > before;
                })()
              : (() => {
                  // eth_btc mode must show BOTH aWETH and acbBTC increasing (50/50 collateral proof).
                  const beforeAWeth = getATokenBalanceFromProof(baselineProof, DEFAULT_WETH);
                  const afterAWeth = getATokenBalanceFromProof(p, DEFAULT_WETH);
                  const beforeABtc = getATokenBalanceFromProof(baselineProof, DEFAULT_CBBTC);
                  const afterABtc = getATokenBalanceFromProof(p, DEFAULT_CBBTC);
                  if (beforeAWeth == null || afterAWeth == null || beforeABtc == null || afterABtc == null) return false;
                  return afterAWeth > beforeAWeth && afterABtc > beforeABtc;
                })();
          if (depositObserved) break;
          if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for Aave collateral to update after deposit");
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      setPhase(2);

      // 3) CRE broadcast (runs the same `cre workflow simulate --broadcast` you would run in a terminal)
      const triggerBody = { payee: payeeAddr, borrowAmount: amountUnits, depositAmount: depositUnits, broadcast };
      setCreTriggerBody(triggerBody);
      const creRes = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(triggerBody)
      });
      const creJson = await creRes.json();
      // Always keep the CRE output for debugging (even on failure).
      setCreRun(creJson);
      if (!creRes.ok) {
        const tail = (creJson?.stderr || creJson?.stdout || "").toString().slice(-800);
        const summary = creJson?.error || "CRE run failed";
        throw new Error(`${summary}${tail ? ` (output tail: ${tail.split("\n")[0]})` : ""}`);
      }
      setPhase(3);

      // 4) Onchain confirmation (poll until vault nonce increments)
      const start = Date.now();
      const timeoutMs = 120_000;
      for (;;) {
        const p = await refreshProof();
        if (p.vault.nonce > baselineProof.vault.nonce) break;
        if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for onchain confirmation");
        await new Promise((r) => setTimeout(r, 1000));
      }

      setPhase(4);

      // 5) Payee confirmation (poll until destination balance increases)
      {
        const start2 = Date.now();
        const timeoutMs2 = 60_000;
        for (;;) {
          const p = await refreshProof();
          if (p.usdc.payeeBalance > baselineProof.usdc.payeeBalance) break;
          if (Date.now() - start2 > timeoutMs2) throw new Error("Timed out waiting for payee balance to update");
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      setFinished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function toggleRunConfirm() {
    if (running) return;
    if (!canRun) {
      setConfirmRunOpen(false);
      setError(runDisabledReason || "Enter valid inputs");
      return;
    }
    setError(null);
    setConfirmRunOpen((v) => !v);
  }

  const [resetting, setResetting] = useState(false);
  const [swapping, setSwapping] = useState(false);

  async function swapCollateralToUsdc() {
    if (swapping || resetting || running) return;

    const ok = window.confirm(
      "Swap any WETH/cbBTC in the agent wallet back to USDC on Base mainnet?\n\nThis will send real swap transactions using your local private key + spend gas."
    );
    if (!ok) return;

    setSwapping(true);
    setError(null);
    setSwapRun(null);
    try {
      const swapRes = await fetch("/api/demo/swap-to-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmMainnet: true })
      });
      const swapJson = await swapRes.json();
      // Always keep runner output for debugging (even on failure).
      setSwapRun(swapJson);
      if (!swapRes.ok || !swapJson?.ok) {
        const summary = swapJson?.summary || swapJson?.error || "Swap failed";
        throw new Error(`Swap failed: ${summary}`);
      }
      await refreshProof();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwapping(false);
    }
  }

  async function resetToUsdc() {
    // Local/dev helper: unwinds Aave position and converts collateral back to USDC so the demo can be re-run.
    if (resetting || running) return;

    const ok = window.confirm(
      "Repay + Export USDC on Base mainnet?\n\nThis will send real transactions to:\n1) repay USDC debt\n2) withdraw all Aave collateral to the agent wallet\n3) swap withdrawn WETH/cbBTC back to USDC\n4) leave USDC in the agent wallet\n\nOnly do this if you understand it uses your local private key + spends gas."
    );
    if (!ok) return;

    setResetting(true);
    setError(null);
    setResetRun(null);
    setSwapRun(null);
    try {
      const withdrawTo = (proof as any)?.vault?.owner ?? DEFAULT_AGENT_WALLET;
      const res = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmMainnet: true, withdrawTo })
      });
      const json = await res.json();
      // Always keep runner output for debugging (even on failure).
      setResetRun(json);
      if (!res.ok || !json?.ok) {
        const summary = json?.summary || json?.error || "Reset failed";
        throw new Error(`Reset failed: ${summary}`);
      }

      // Run an immediate wallet-level unwind step so any non-USDC collateral
      // already in the agent wallet gets swapped back to USDC too.
      const sweepRes = await fetch("/api/demo/swap-to-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmMainnet: true })
      });
      const sweepJson = await sweepRes.json();
      setSwapRun(sweepJson);
      if (!sweepRes.ok || !sweepJson?.ok) {
        const summary = sweepJson?.summary || sweepJson?.error || "Wallet sweep failed";
        throw new Error(`Reset succeeded, but final wallet sweep failed: ${summary}`);
      }

      await refreshProof();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  const deltaPayee = baseline && proof ? proof.usdc.payeeBalance - baseline.usdc.payeeBalance : null;
  const deltaDebt = baseline && proof ? proof.usdc.vaultDebt - baseline.usdc.vaultDebt : null;
  const fmtSigned = (v: bigint, decimals: number) => {
    const sign = v < 0n ? "-" : "+";
    const abs = v < 0n ? -v : v;
    return `${sign}${formatUnits(abs, decimals)}`;
  };

  async function copy(text: string, which: "agent" | "debug" | "error") {
    const value = text.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for older browsers / stricter permissions.
      // Some modern browsers disable `document.execCommand`, so guard it to avoid runtime crashes.
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        if (typeof document.execCommand === "function") document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // No-op: worst case we just don't copy.
      }
    }
    setCopied(which);
    window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1100);
  }

  function buildDebugClipboardText() {
    const payload = {
      ts: new Date().toISOString(),
      page: "/demo",
      inputs: {
        payee,
        depositUsdc,
        depositMode,
        borrowUsdc: amountUsdc,
        broadcast,
        presetId,
        depositUnits,
        borrowUnits: amountUnits
      },
      state: {
        running,
        phase,
        finished,
        error
      },
      contracts: {
        vault: DEFAULT_VAULT,
        usdc: DEFAULT_USDC,
        weth: DEFAULT_WETH,
        cbbtc: DEFAULT_CBBTC,
        agentWalletDefault: DEFAULT_AGENT_WALLET
      },
      proof: proof
        ? {
            updatedAtMs: proof.updatedAtMs,
            vault: {
              address: proof.vault.address,
              owner: proof.vault.owner,
              executor: (proof as any)?.vault?.executor ?? null,
              nonce: proof.vault.nonce.toString(),
              paused: proof.vault.paused
            },
            vaultPolicy: (proof as any)?.vaultPolicy ?? null,
            receiver: (proof as any)?.receiver ?? null,
            aave: {
              pool: proof.aave.pool,
              userAccountData: {
                totalCollateralBase: proof.aave.userAccountData.totalCollateralBase.toString(),
                totalDebtBase: proof.aave.userAccountData.totalDebtBase.toString(),
                healthFactor: proof.aave.userAccountData.healthFactor.toString()
              }
            },
            wallet: {
              owner: {
                usdc: proof.wallet.owner.usdc.toString(),
                weth: proof.wallet.owner.weth.toString(),
                cbbtc: proof.wallet.owner.cbbtc.toString()
              },
              vault: {
                usdc: proof.wallet.vault.usdc.toString(),
                weth: proof.wallet.vault.weth.toString(),
                cbbtc: proof.wallet.vault.cbbtc.toString()
              },
              payee: {
                usdc: proof.wallet.payee.usdc.toString(),
                weth: proof.wallet.payee.weth.toString(),
                cbbtc: proof.wallet.payee.cbbtc.toString()
              }
            },
            lastBorrowAndPay: proof.lastBorrowAndPay
              ? {
                  txHash: proof.lastBorrowAndPay.txHash,
                  blockNumber: proof.lastBorrowAndPay.blockNumber.toString(),
                  nonce: proof.lastBorrowAndPay.nonce.toString(),
                  borrowAmount: proof.lastBorrowAndPay.borrowAmount.toString(),
                  payee: proof.lastBorrowAndPay.payee
                }
              : null
          }
        : null,
      runs: {
        agentReqBody,
        creTriggerBody,
        depositRun,
        creRun,
        resetRun,
        swapRun
      }
    };

    // Use our BigInt-safe stringify to avoid clipboard copy crashes during demo debugging.
    return stringifyBigInts(payload);
  }

  async function copyDebug() {
    await copy(buildDebugClipboardText(), "debug");
  }

  async function copyError() {
    if (!error) return;
    await copy(error, "error");
  }

  const stepLabel = (() => {
    if (!running && !finished) return "Ready";
    if (error) return "Error";
    if (phase === 0) return "AI agent is proposing a plan";
    if (phase === 1) return isSwapDeposit ? "Onchain: swapping USDC → WETH/cbBTC and supplying to Aave" : "Onchain: supplying USDC collateral to Aave";
    if (phase === 2) return "CRE is verifying + orchestrating borrow-to-pay";
    if (phase === 3) return "Onchain: waiting for transaction confirmation";
    return "Done: payee received USDC";
  })();

  const elapsedLabel = (() => {
    if (!running || runStartedAtMs == null) return "";
    const s = Math.max(0, Math.floor((runNowMs - runStartedAtMs) / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  })();

  const agentOk = !!plan;
  const observedDepositMode = (() => {
    const m = String((depositRun as any)?.depositMode || "").trim().toLowerCase();
    if (m === "usdc" || m === "eth_btc") return m as "usdc" | "eth_btc";
    return depositMode;
  })();
  const depositOk = (() => {
    if (!baseline || !proof) return false;
    if (observedDepositMode === "usdc") {
      const beforeAUsdc = getATokenBalanceFromProof(baseline, DEFAULT_USDC);
      const afterAUsdc = getATokenBalanceFromProof(proof, DEFAULT_USDC);
      if (beforeAUsdc != null && afterAUsdc != null) return afterAUsdc > beforeAUsdc;
      return (
        toBigIntOrZero((proof as any)?.aave?.userAccountData?.totalCollateralBase) >
        toBigIntOrZero((baseline as any)?.aave?.userAccountData?.totalCollateralBase)
      );
    }
    // eth_btc mode must show BOTH aWETH and acbBTC increasing.
    const beforeAWeth = getATokenBalanceFromProof(baseline, DEFAULT_WETH);
    const afterAWeth = getATokenBalanceFromProof(proof, DEFAULT_WETH);
    const beforeABtc = getATokenBalanceFromProof(baseline, DEFAULT_CBBTC);
    const afterABtc = getATokenBalanceFromProof(proof, DEFAULT_CBBTC);
    if (beforeAWeth == null || afterAWeth == null || beforeABtc == null || afterABtc == null) return false;
    return afterAWeth > beforeAWeth && afterABtc > beforeABtc;
  })();
  const creOk = !!creRun?.ok;
  const onchainOk = !!(baseline && proof && proof.vault.nonce > baseline.vault.nonce);
  const payeeOk = !!(baseline && proof && proof.usdc.payeeBalance > baseline.usdc.payeeBalance);

  const depositSupplyTx = useMemo(() => extractRunnerTxHash(depositRun, "supply"), [depositRun]);

  const posNow = useMemo(() => {
    if (!proof || !Array.isArray((proof as any).collaterals)) return null;
    const aUsdc = proof.collaterals.find((c) => String((c as any)?.address || "").toLowerCase() === DEFAULT_USDC.toLowerCase());
    const aWeth = proof.collaterals.find((c) => String((c as any)?.address || "").toLowerCase() === DEFAULT_WETH.toLowerCase());
    const aCbbtc = proof.collaterals.find((c) => String((c as any)?.address || "").toLowerCase() === DEFAULT_CBBTC.toLowerCase());
    return { aUsdc, aWeth, aCbbtc };
  }, [proof]);

  const ownerAssetsNow = useMemo(() => {
    if (!proof) return null;
    const weth = proof.collaterals.find((c) => String((c as any)?.address || "").toLowerCase() === DEFAULT_WETH.toLowerCase());
    const cbbtc = proof.collaterals.find((c) => String((c as any)?.address || "").toLowerCase() === DEFAULT_CBBTC.toLowerCase());
    return { weth, cbbtc };
  }, [proof]);

  const wethPriceBase = useMemo(() => toBigIntOrZero((ownerAssetsNow as any)?.weth?.priceBase), [ownerAssetsNow]);
  const cbbtcPriceBase = useMemo(() => toBigIntOrZero((ownerAssetsNow as any)?.cbbtc?.priceBase), [ownerAssetsNow]);

  // Dev/hot-reload hardening: in Next dev, state can survive HMR even when we change shapes.
  // These derived values prevent render-time crashes and keep the demo screen visible.
  const proofBaseCurrencyUnit = toBigIntOrZero((proof as any)?.oracle?.baseCurrencyUnit);
  const proofBaseDecimals = (() => {
    // Most reliable: derive from BASE_CURRENCY_UNIT.
    if (proofBaseCurrencyUnit > 0n) return baseDecimalsFromUnit(proofBaseCurrencyUnit);
    const raw = (proof as any)?.oracle?.baseDecimals;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 36) return Math.trunc(raw);
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n <= 36) return Math.trunc(n);
    }
    return 8;
  })();
  const proofUsdcDecimals = (proof as any)?.usdc?.decimals ?? 6;
  const proofUsdcSymbol = (proof as any)?.usdc?.symbol ?? "USDC";
  const proofPayeeUsdc = (proof as any)?.wallet?.payee?.usdc ?? (proof as any)?.usdc?.payeeBalance ?? 0n;
  const proofAgentWalletAddr = String((proof as any)?.vault?.owner ?? DEFAULT_AGENT_WALLET);
  const proofAgentWalletUsdc = (proof as any)?.wallet?.owner?.usdc ?? 0n;
  const proofAgentWalletWeth = (proof as any)?.wallet?.owner?.weth ?? 0n;
  const proofAgentWalletCbbtc = (proof as any)?.wallet?.owner?.cbbtc ?? 0n;
  const proofCollBase = toBigIntOrZero((proof as any)?.aave?.userAccountData?.totalCollateralBase);
  const proofDebtBase = toBigIntOrZero((proof as any)?.aave?.userAccountData?.totalDebtBase);
  const proofHf = toBigIntOrZero((proof as any)?.aave?.userAccountData?.healthFactor);
  const proofDebtValueBase = toBigIntOrZero((proof as any)?.usdc?.vaultDebtValueBase);
  const proofPayeeValueBase = toBigIntOrZero((proof as any)?.usdc?.payeeValueBase);
  const proofUsdcPriceBase = toBigIntOrZero((proof as any)?.usdc?.priceBase);
  const proofVaultWalletUsdc = toBigIntOrZero((proof as any)?.wallet?.vault?.usdc);
  const proofVaultWalletWeth = toBigIntOrZero((proof as any)?.wallet?.vault?.weth);
  const proofVaultWalletCbbtc = toBigIntOrZero((proof as any)?.wallet?.vault?.cbbtc);
  const proofVaultWalletValueBase = toBigIntOrZero((proof as any)?.usdc?.vaultWalletValueBase);
  const proofOwnerUsdcValueBase = toBigIntOrZero((proof as any)?.walletValues?.owner?.usdcValueBase);
  const proofOwnerTotalValueBase = toBigIntOrZero((proof as any)?.walletValues?.owner?.totalValueBase);
  const proofOwnerWethValueBase = toBigIntOrZero((proof as any)?.walletValues?.owner?.wethValueBase);
  const proofOwnerCbbtcValueBase = toBigIntOrZero((proof as any)?.walletValues?.owner?.cbbtcValueBase);
  const proofPayeeTotalValueBase = toBigIntOrZero((proof as any)?.walletValues?.payee?.totalValueBase);

  // If the oracle price is missing in the proof payload (RPC flake / old cached proof),
  // still show a sensible USD estimate for USDC (treat as $1.00 in oracle base units).
  const safeUsdcPriceBase = proofUsdcPriceBase > 0n ? proofUsdcPriceBase : proofBaseCurrencyUnit;

  const computedOwnerUsdcValueBase = proof ? valueBaseFromRaw(proofAgentWalletUsdc, safeUsdcPriceBase, proofUsdcDecimals) : 0n;
  const computedOwnerWethValueBase =
    proof && ownerAssetsNow?.weth ? valueBaseFromRaw(proofAgentWalletWeth, wethPriceBase, ownerAssetsNow.weth.decimals) : 0n;
  const computedOwnerCbbtcValueBase =
    proof && ownerAssetsNow?.cbbtc ? valueBaseFromRaw(proofAgentWalletCbbtc, cbbtcPriceBase, ownerAssetsNow.cbbtc.decimals) : 0n;
  const computedOwnerTotalValueBase = computedOwnerUsdcValueBase + computedOwnerWethValueBase + computedOwnerCbbtcValueBase;
  const computedPayeeUsdcValueBase = proof ? valueBaseFromRaw(proofPayeeUsdc, safeUsdcPriceBase, proofUsdcDecimals) : 0n;
  const computedDebtValueBase = proof ? valueBaseFromRaw((proof as any)?.usdc?.vaultDebt ?? 0n, safeUsdcPriceBase, proofUsdcDecimals) : 0n;

  // Prefer server-computed values when present and non-zero, but fall back to
  // client-side compute if cached/proof values are missing or parsed incorrectly.
  const displayOwnerUsdcValueBase = proofOwnerUsdcValueBase > 0n ? proofOwnerUsdcValueBase : computedOwnerUsdcValueBase;
  const displayOwnerWethValueBase = proofOwnerWethValueBase > 0n ? proofOwnerWethValueBase : computedOwnerWethValueBase;
  const displayOwnerCbbtcValueBase = proofOwnerCbbtcValueBase > 0n ? proofOwnerCbbtcValueBase : computedOwnerCbbtcValueBase;
  const displayOwnerTotalValueBase = proofOwnerTotalValueBase > 0n ? proofOwnerTotalValueBase : computedOwnerTotalValueBase;
  const displayPayeeUsdcValueBase = proofPayeeValueBase > 0n ? proofPayeeValueBase : computedPayeeUsdcValueBase;
  const displayDebtValueBase = proofDebtValueBase > 0n ? proofDebtValueBase : computedDebtValueBase;
  const displayPayeeTotalValueBase = proofPayeeTotalValueBase > 0n ? proofPayeeTotalValueBase : displayPayeeUsdcValueBase;

  const baselineBaseDecimals = (baseline as any)?.oracle?.baseDecimals ?? proofBaseDecimals;
  const baselineUsdcDecimals = (baseline as any)?.usdc?.decimals ?? proofUsdcDecimals;

  const visualActive = running || finished;
  const missing = proofLoading ? "Loading…" : "—";
  const ownerHasAnyAsset =
    proofAgentWalletUsdc > 0n || proofAgentWalletWeth > 0n || proofAgentWalletCbbtc > 0n;

  const traceExpectedNonce = baseline ? baseline.vault.nonce + 1n : null;
  const traceRequestedBorrow = amountUnits && /^[0-9]+$/.test(amountUnits) ? BigInt(amountUnits) : null;
  const tracePlanBorrow = plan?.borrowAmount && /^[0-9]+$/.test(String(plan.borrowAmount)) ? BigInt(String(plan.borrowAmount)) : null;
  const tracePlanPayee = typeof plan?.payee === "string" ? plan.payee : null;
  const tracePlanBorrowAsset = typeof plan?.borrowAsset === "string" ? plan.borrowAsset : null;
  const tracePlanMatchesPayee = tracePlanPayee ? tracePlanPayee.toLowerCase() === payee.trim().toLowerCase() : null;
  const tracePlanMatchesBorrowAsset = tracePlanBorrowAsset ? tracePlanBorrowAsset.toLowerCase() === DEFAULT_USDC.toLowerCase() : null;
  const tracePlanNotEscalated =
    tracePlanBorrow != null && traceRequestedBorrow != null ? tracePlanBorrow <= traceRequestedBorrow : null;
  const traceVaultPausedOk = baseline ? !baseline.vault.paused : null;
  const traceCreChecksOk =
    traceVaultPausedOk != null &&
    tracePlanMatchesPayee != null &&
    tracePlanMatchesBorrowAsset != null &&
    tracePlanNotEscalated != null
      ? traceVaultPausedOk && tracePlanMatchesPayee && tracePlanMatchesBorrowAsset && tracePlanNotEscalated
      : null;
  const failedPhase = !running && !!error ? phase : null;
  const stepTriggerDone = !!creTriggerBody;
  const stepAgentDone = !!plan;
  const stepVerificationDone = traceCreChecksOk === true;
  const stepWriteDone = !!creRun && (creRun?.ok || (!broadcast && !creRun?.error));
  const stepOnchainDone = !broadcast ? true : onchainOk;
  const stepTriggerFail = failedPhase != null && failedPhase >= 2 && !stepTriggerDone;
  const stepAgentFail = failedPhase === 0 && !stepAgentDone;
  const stepVerificationFail = traceCreChecksOk === false || (failedPhase === 2 && !stepVerificationDone);
  const stepWriteFail = !!creRun && !creRun?.ok;
  const stepOnchainFail = broadcast && failedPhase != null && failedPhase >= 3 && !stepOnchainDone;

  const vaultPolicy = (proof as any)?.vaultPolicy as
    | {
        minHealthFactor: bigint;
        cooldownSeconds: bigint;
        maxBorrowPerTx: bigint;
        maxBorrowPerDay: bigint;
        dailyBorrowed: bigint;
        lastExecutionAt: bigint;
      }
    | null
    | undefined;

  const receiverForwarder = String((proof as any)?.receiver?.forwarder || "");

  const creDurationMs =
    creRun && typeof creRun.startedAtMs === "number" && typeof creRun.finishedAtMs === "number"
      ? Math.max(0, creRun.finishedAtMs - creRun.startedAtMs)
      : null;

  const creDidBroadcast = broadcast;
  const receiverTxHash = (proof as any)?.lastReceiverReport?.txHash || null;
  const receiverReportPlanNonce = (proof as any)?.lastReceiverReport?.planNonce as bigint | null | undefined;
  const receiverReportBorrowAmount = (proof as any)?.lastReceiverReport?.borrowAmount as bigint | null | undefined;
  const receiverReportPayee = (proof as any)?.lastReceiverReport?.payee as string | null | undefined;
  const receiverReportNonceOk =
    traceExpectedNonce != null && receiverReportPlanNonce != null ? receiverReportPlanNonce === traceExpectedNonce : null;
  const receiverReportPayeeOk = receiverReportPayee ? receiverReportPayee.toLowerCase() === payee.trim().toLowerCase() : null;
  const receiverReportBorrowOk =
    traceRequestedBorrow != null && receiverReportBorrowAmount != null ? receiverReportBorrowAmount === traceRequestedBorrow : null;

  return (
    <div className="min-h-screen flex flex-col justify-center">
      <main className="mx-auto max-w-5xl w-full px-5 py-8">
        {/* ── Header bar ── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`h-2 w-2 rounded-full ${running ? "bg-accent animate-pulse" : "bg-accent2"}`} />
            <h1 className="text-lg font-semibold text-text-primary tracking-tight">Agent Treasury Demo</h1>
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">Base Mainnet</span>
          </div>
          <div className="flex items-center gap-3">
            {elapsedLabel ? <span className="text-[11px] text-text-tertiary font-mono">{elapsedLabel}</span> : null}
            <button onClick={() => void refreshProof().catch((e) => setError(e instanceof Error ? e.message : String(e)))} disabled={running || proofLoading} className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-40">
              {proofLoading ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={() => void resetToUsdc()} disabled={running || proofLoading || resetting} className="inline-flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber/10 px-3 py-1 text-[11px] font-medium text-amber hover:bg-amber/20 transition-colors disabled:opacity-40" title="Repay all debt, withdraw collateral, reset to USDC — lets you run the demo again from scratch">
              <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3" stroke="currentColor" strokeWidth="1.5"><path d="M2 8a6 6 0 0 1 10.3-4.2M14 8a6 6 0 0 1-10.3 4.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 2v2.5h-2.5M4 14v-2.5h2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {resetting ? "Resetting…" : "Reset Position"}
            </button>
          </div>
        </div>

        {/* ── Controls card ── */}
        <div className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm p-4 mb-4">
          {/* Row 1: Payee + numeric inputs */}
          <div className="flex gap-3 items-end mb-3">
            <div className={`miniField flex-1 min-w-0 ${!validPayee ? "invalid" : ""}`}>
              <div className="miniLabel">Payee address</div>
              <div className="miniRow">
                <input className="miniInput mono" style={{ fontSize: "12px" }} inputMode="text" placeholder={DEFAULT_PAYEE} value={payee} onChange={(e) => setPayee(e.target.value)} disabled={running || confirmRunOpen} aria-label="Payee address" />
              </div>
            </div>
            <div className={`miniField shrink-0 ${depositUnits == null || depositUnits === "0" ? "invalid" : ""}`} style={{ width: "110px" }}>
              <div className="miniLabel">Deposit</div>
              <div className="miniRow">
                <input className="miniInput" inputMode="decimal" placeholder="10" value={depositUsdc} onChange={(e) => setDepositUsdc(e.target.value)} disabled={running || confirmRunOpen} aria-label="Deposit" />
                <span className="miniUnit">USDC</span>
              </div>
            </div>
            <div className={`miniField shrink-0 ${amountUnits == null || amountUnits === "0" ? "invalid" : ""}`} style={{ width: "110px" }}>
              <div className="miniLabel">Borrow</div>
              <div className="miniRow">
                <input className="miniInput" inputMode="decimal" placeholder="1" value={amountUsdc} onChange={(e) => setAmountUsdc(e.target.value)} disabled={running || confirmRunOpen} aria-label="Borrow" />
                <span className="miniUnit">USDC</span>
              </div>
            </div>
          </div>

          {/* Row 2: Run button + progress */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleRunConfirm}
              disabled={runDisabled}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-2 text-xs font-semibold transition-all shrink-0 ${
                confirmRunOpen && !running
                  ? "bg-accent text-background shadow-lg shadow-accent/20"
                  : "bg-accent/90 text-background hover:bg-accent hover:shadow-lg hover:shadow-accent/20"
              } ${!canRun && !running ? "opacity-50" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
              title={!canRun ? runDisabledReason : "Run borrow-to-spend workflow"}
            >
              {running ? "Running…" : confirmRunOpen ? "Confirm" : "Run Demo"}
              {!running && (
                <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>

            {/* Progress steps — pushed right */}
            <div className="flex items-center gap-1.5 ml-auto">
              {[
                { label: "Agent", ok: agentOk, active: running && phase === 0, fail: failedPhase === 0 && !agentOk },
                { label: "Deposit", ok: depositOk, active: running && phase === 1, fail: failedPhase === 1 && !depositOk },
                { label: "CRE", ok: creOk, active: running && phase === 2, fail: failedPhase === 2 && !creOk },
                { label: "Onchain", ok: onchainOk, active: running && phase === 3, fail: failedPhase === 3 && !onchainOk },
                { label: "Paid", ok: payeeOk, active: running && phase === 4, fail: failedPhase === 4 && !payeeOk },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  {i > 0 && <div className={`w-3 h-px ${s.ok || (i > 0 && [agentOk, depositOk, creOk, onchainOk][i - 1]) ? "bg-accent2/40" : "bg-border"}`} />}
                  <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all ${
                    s.fail ? "border-red/40 bg-red/10 text-red" :
                    s.ok ? "border-accent2/30 bg-accent2/10 text-accent2" :
                    s.active ? "border-accent/40 bg-accent/10 text-accent" :
                    "border-border bg-surface text-text-tertiary"
                  }`}>
                    {s.ok ? (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : s.fail ? (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : s.active ? (
                      <span className="h-1 w-1 rounded-full bg-accent animate-pulse" />
                    ) : null}
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Confirmation dialog ── */}
        {confirmRunOpen && !running ? (
          <div role="dialog" aria-modal="true" onClick={() => setConfirmRunOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/60 backdrop-blur-md">
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md p-5 rounded-2xl border border-border-strong bg-surface shadow-2xl">
              <p className="text-sm font-medium text-text-primary mb-2">Run real Base mainnet transactions?</p>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Deposit <span className="font-mono">{depositUsdc}</span> USDC → borrow <span className="font-mono">{amountUsdc}</span> USDC → pay <span className="font-mono">{shortHex(payee, 6, 4)}</span>
              </p>
              <div className="flex gap-3">
                <button type="button" className="copyBtn" onClick={() => setConfirmRunOpen(false)} style={{ padding: "8px 14px" }}>Cancel</button>
                <button type="button" onClick={() => void runDemo()} disabled={!canRun} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Error ── */}
        {error ? (
          <div ref={errorRef} className="rounded-xl border border-red/30 bg-red/[0.06] px-4 py-2.5 mb-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-primary truncate">{error.split("\n")[0]}</p>
              <div className="flex gap-2 shrink-0">
                <button type="button" className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors" onClick={() => void copyError()}>{copied === "error" ? "Copied" : "Copy"}</button>
                <button type="button" className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors" onClick={() => void copyDebug()}>{copied === "debug" ? "Copied" : "Debug"}</button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Success ── */}
        {finished && proof && baseline ? (
          <div className="rounded-xl border border-accent2/30 bg-accent2/[0.06] px-4 py-2.5 mb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-medium text-text-primary">Payment confirmed on-chain</p>
              <div className="flex gap-2">
                <span className="pill">Payee <span className="mono">{deltaPayee != null ? fmtSigned(deltaPayee, proofUsdcDecimals) : "—"}</span></span>
                {proof.lastBorrowAndPay ? (
                  <a href={`${BASESCAN}/tx/${proof.lastBorrowAndPay.txHash}`} target="_blank" rel="noreferrer" className="pill">
                    Tx <span className="mono">{shortHex(proof.lastBorrowAndPay.txHash, 8, 6)}</span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Visual board ── */}
        <div ref={boardRef} className="demoBoard">
          <div className="demoBoardGrid">
            {/* Agent Wallet */}
            <div className="demoBox">
              <div className="demoBoxTitle">
                <span>Agent Wallet</span>
                <span className="demoBoxAddr mono">{shortHex(proofAgentWalletAddr || DEFAULT_AGENT_WALLET, 6, 4)}</span>
              </div>
              <div className="demoKV" ref={agentAnchorRef}>
                <span className="demoK">USDC</span>
                <span className="demoV mono">{proof ? `$${formatUsdOrDash(displayOwnerUsdcValueBase, proofBaseDecimals, proofAgentWalletUsdc)}` : missing}</span>
              </div>
              <div className="demoKV">
                <span className="demoK">Total</span>
                <span className="demoV mono">{proof ? `$${formatUsdBase(displayOwnerTotalValueBase, proofBaseDecimals)}` : missing}</span>
              </div>
            </div>

            <div className="demoArrow" aria-hidden="true">→</div>

            {/* Treasury */}
            <div className="demoBox">
              <div className="demoBoxTitle">
                <span>Treasury</span>
                <span className="demoBoxAddr">Aave V3</span>
              </div>
              <div className="demoInAnchor" ref={treasuryInAnchorRef} aria-hidden="true" />
              <div className="demoKV" ref={treasuryCollateralAnchorRef}>
                <span className="demoK">Collateral</span>
                <span className="demoV mono">{proof ? `$${formatUsdBase(proofCollBase, proofBaseDecimals)}` : missing}</span>
              </div>
              <div className="demoKV" ref={treasuryDebtAnchorRef}>
                <span className="demoK">Debt</span>
                <span className="demoV mono">
                  {proof ? `$${formatUsdBase(proofDebtBase, proofBaseDecimals)}` : missing}
                  {baseline && proof && deltaDebt != null ? <span className="demoDelta"> {fmtSigned(deltaDebt, proofUsdcDecimals)}</span> : null}
                </span>
              </div>
              <div className="demoKV">
                <span className="demoK">Health</span>
                <span className="demoV mono">{proof ? (proofDebtBase === 0n ? "∞" : formatToken(proofHf, 18, 2)) : missing}</span>
              </div>
            </div>

            <div className="demoArrow" aria-hidden="true">→</div>

            {/* Payee */}
            <div className="demoBox">
              <div className="demoBoxTitle">
                <span>Service Provider</span>
                <span className="demoBoxAddr mono">{shortHex(payee, 6, 4)}</span>
              </div>
              <div className="demoKV" ref={payeeAnchorRef}>
                <span className="demoK">USDC</span>
                <span className="demoV mono">
                  {proof ? `$${formatUsdBase(displayPayeeUsdcValueBase, proofBaseDecimals)}` : missing}
                  {baseline && proof && deltaPayee != null ? <span className="demoDelta"> {fmtSigned(deltaPayee, proofUsdcDecimals)}</span> : null}
                </span>
              </div>
            </div>
          </div>

          {/* Token animation overlay */}
          {anchors ? (
            <>
              {isSwapDeposit ? (
                <>
                  <div aria-hidden="true" className="demoToken demoTokenUsdc" style={{ left: (phase >= 1 ? anchors.treasuryIn : anchors.agent).x, top: (phase >= 1 ? anchors.treasuryIn : anchors.agent).y, opacity: visualActive && (phase === 0 || (phase >= 1 && !splitDone)) ? 1 : 0, transform: `translate(-50%, -50%) scale(${splitDone ? 0.98 : 1})`, animation: splitDone ? "demoTokenPop 420ms ease-out both" : undefined }}>U</div>
                  <div aria-hidden="true" className="demoToken demoTokenEth" style={{ left: (splitDone ? anchors.collateral.x - 14 : anchors.treasuryIn.x), top: (splitDone ? anchors.collateral.y : anchors.treasuryIn.y), opacity: visualActive && phase >= 1 && splitDone ? 1 : 0, animation: splitDone ? "demoTokenPop 420ms ease-out both" : undefined }}>E</div>
                  <div aria-hidden="true" className="demoToken demoTokenBtc" style={{ left: (splitDone ? anchors.collateral.x + 14 : anchors.treasuryIn.x), top: (splitDone ? anchors.collateral.y : anchors.treasuryIn.y), opacity: visualActive && phase >= 1 && splitDone ? 1 : 0, animation: splitDone ? "demoTokenPop 420ms ease-out both" : undefined }}>B</div>
                </>
              ) : (
                <div aria-hidden="true" className="demoToken demoTokenUsdc" style={{ left: (phase >= 1 ? (splitDone ? anchors.collateral : anchors.treasuryIn) : anchors.agent).x, top: (phase >= 1 ? (splitDone ? anchors.collateral : anchors.treasuryIn) : anchors.agent).y, opacity: visualActive ? 1 : 0, transform: `translate(-50%, -50%) scale(${splitDone ? 1.05 : 1})`, animation: splitDone ? "demoTokenPop 420ms ease-out both" : undefined }}>U</div>
              )}
              <div aria-hidden="true" className={`demoToken demoTokenPay ${payLanded ? "demoTokenPop" : ""}`} style={{ left: (phase >= 3 ? anchors.payee : anchors.debt).x, top: (phase >= 3 ? anchors.payee : anchors.debt).y, opacity: visualActive && phase >= 2 ? 1 : 0, animation: payLanded ? "demoTokenPop 420ms ease-out both" : undefined }}>$</div>
            </>
          ) : null}
        </div>

        {/* ── Tx links ── */}
        {(proof?.lastBorrowAndPay || proof?.lastReceiverReport || depositSupplyTx || proof?.lastSupply) ? (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {(depositSupplyTx || proof?.lastSupply?.txHash) ? <a href={`${BASESCAN}/tx/${depositSupplyTx || proof?.lastSupply?.txHash}`} target="_blank" rel="noreferrer" className="pill">Deposit tx <span className="mono">{shortHex(depositSupplyTx || proof?.lastSupply?.txHash, 8, 6)}</span></a> : null}
            {proof?.lastReceiverReport ? <a href={`${BASESCAN}/tx/${proof.lastReceiverReport.txHash}`} target="_blank" rel="noreferrer" className="pill">CRE tx <span className="mono">{shortHex(proof.lastReceiverReport.txHash, 8, 6)}</span></a> : null}
            {proof?.lastBorrowAndPay ? <a href={`${BASESCAN}/tx/${proof.lastBorrowAndPay.txHash}`} target="_blank" rel="noreferrer" className="pill">Borrow tx <span className="mono">{shortHex(proof.lastBorrowAndPay.txHash, 8, 6)}</span></a> : null}
          </div>
        ) : null}

        {/* ── Execution Trace (collapsed) ── */}
        <details className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm mt-3">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors">
            Execution Trace
          </summary>
          <div className="px-3 pb-3">
            <div className="trace">
              <div className={`traceStep ${running && phase === 2 ? "traceStepActive" : ""} ${stepTriggerDone ? "traceStepDone" : ""} ${stepTriggerFail ? "traceStepFail" : ""}`}>
                <div className="traceHead"><div className="traceTitle"><span className="traceNum">1</span> Trigger</div><span className={`pill ${creTriggerBody ? "pillOk" : ""}`}>{creTriggerBody ? "OK" : "—"}</span></div>
                <div className="traceBody"><pre className="tracePre mono">{creTriggerBody ? JSON.stringify(creTriggerBody, null, 2) : "n/a"}</pre></div>
              </div>

              <div className={`traceStep ${running && phase === 0 ? "traceStepActive" : ""} ${stepAgentDone ? "traceStepDone" : ""} ${stepAgentFail ? "traceStepFail" : ""}`}>
                <div className="traceHead"><div className="traceTitle"><span className="traceNum">2</span> Agent Plan</div><span className={`pill ${plan ? "pillOk" : ""}`}>{plan ? "OK" : "—"}</span></div>
                <div className="traceBody">
                  <div className="traceTwoCol">
                    <div><div className="traceSubhead">Request</div><pre className="tracePre mono">{agentReqBody ? JSON.stringify(agentReqBody, null, 2) : "n/a"}</pre></div>
                    <div><div className="traceSubhead">Response <span className="traceBadge">Untrusted</span></div><pre className="tracePre mono">{plan ? JSON.stringify(plan, null, 2) : "n/a"}</pre></div>
                  </div>
                </div>
              </div>

              <div className={`traceStep ${running && phase === 2 ? "traceStepActive" : ""} ${stepVerificationDone ? "traceStepDone" : ""} ${stepVerificationFail ? "traceStepFail" : ""}`}>
                <div className="traceHead"><div className="traceTitle"><span className="traceNum">3</span> CRE Verification</div><span className={`pill ${traceCreChecksOk ? "pillOk" : ""}`}>{traceCreChecksOk == null ? "—" : traceCreChecksOk ? "PASS" : "FAIL"}</span></div>
                <div className="traceBody">
                  <div className="traceChecks">
                    <div className={`traceCheck ${traceVaultPausedOk === false ? "traceCheckBad" : ""}`}><span>vault.paused == false</span><span className="mono">{traceVaultPausedOk == null ? "n/a" : String(traceVaultPausedOk)}</span></div>
                    <div className={`traceCheck ${tracePlanMatchesPayee === false ? "traceCheckBad" : ""}`}><span>payee matches</span><span className="mono">{tracePlanMatchesPayee == null ? "n/a" : String(tracePlanMatchesPayee)}</span></div>
                    <div className={`traceCheck ${tracePlanMatchesBorrowAsset === false ? "traceCheckBad" : ""}`}><span>asset matches</span><span className="mono">{tracePlanMatchesBorrowAsset == null ? "n/a" : String(tracePlanMatchesBorrowAsset)}</span></div>
                    <div className={`traceCheck ${tracePlanNotEscalated === false ? "traceCheckBad" : ""}`}><span>amount not escalated</span><span className="mono">{tracePlanNotEscalated == null ? "n/a" : String(tracePlanNotEscalated)}</span></div>
                  </div>
                </div>
              </div>

              <div className={`traceStep ${running && (phase === 2 || phase === 3) ? "traceStepActive" : ""} ${stepWriteDone ? "traceStepDone" : ""} ${stepWriteFail ? "traceStepFail" : ""}`}>
                <div className="traceHead"><div className="traceTitle"><span className="traceNum">4</span> CRE Write</div><span className={`pill ${creRun?.ok ? "pillOk" : ""}`}>{creRun?.ok ? "OK" : creRun ? "FAIL" : "—"}</span></div>
                <div className="traceBody">
                  <div className="traceChecks">
                    <div className="traceCheck"><span>duration</span><span className="mono">{creDurationMs != null ? `${Math.round(creDurationMs / 1000)}s` : "n/a"}</span></div>
                    <div className="traceCheck"><span>report tx</span><span className="mono">{creDidBroadcast ? (receiverTxHash ? <a href={`${BASESCAN}/tx/${receiverTxHash}`} target="_blank" rel="noreferrer">{shortHex(receiverTxHash, 8, 6)}</a> : "pending") : "sim only"}</span></div>
                  </div>
                </div>
              </div>

              <div className={`traceStep ${running && (phase === 3 || phase === 4) ? "traceStepActive" : ""} ${stepOnchainDone ? "traceStepDone" : ""} ${stepOnchainFail ? "traceStepFail" : ""}`}>
                <div className="traceHead"><div className="traceTitle"><span className="traceNum">5</span> Vault Execution</div><span className={`pill ${onchainOk ? "pillOk" : ""}`}>{creDidBroadcast ? (onchainOk ? "OK" : creRun ? "WAIT" : "—") : "skipped"}</span></div>
                <div className="traceBody">
                  <div className="traceChecks">
                    <div className="traceCheck"><span>nonce</span><span className="mono">{baseline && proof ? `${baseline.vault.nonce.toString()} → ${proof.vault.nonce.toString()}` : "n/a"}</span></div>
                    <div className="traceCheck"><span>payee delta</span><span className="mono">{deltaPayee != null ? fmtSigned(deltaPayee, proofUsdcDecimals) : "n/a"}</span></div>
                    <div className="traceCheck"><span>debt delta</span><span className="mono">{deltaDebt != null ? fmtSigned(deltaDebt, proofUsdcDecimals) : "n/a"}</span></div>
                    <div className="traceCheck"><span>borrow tx</span><span className="mono">{proof?.lastBorrowAndPay?.txHash ? <a href={`${BASESCAN}/tx/${proof.lastBorrowAndPay.txHash}`} target="_blank" rel="noreferrer">{shortHex(proof.lastBorrowAndPay.txHash, 8, 6)}</a> : "n/a"}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>

        {/* ── Raw logs (collapsed) ── */}
        <details className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm mt-2">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors">
            Raw Logs
          </summary>
          <div suppressHydrationWarning className="px-3 pb-3 grid gap-3">
            {[
              { title: "Agent", data: plan ? JSON.stringify(plan, (_k: string, v: unknown) => (typeof v === "bigint" ? (v as bigint).toString() : v), 2) : "n/a" },
              { title: "Deposit", data: depositRun ? String(depositRun?.stderr || depositRun?.stdout || "").slice(-2400) : "n/a" },
              { title: "CRE", data: creRun ? String(creRun?.stderr || creRun?.stdout || "").slice(-2400) : "n/a" },
              { title: "Reset", data: resetRun ? String(resetRun?.stderr || resetRun?.stdout || "").slice(-2400) : "n/a" },
            ].map((log) => (
              <div key={log.title}>
                <div className="text-xs text-text-secondary mb-1.5">{log.title}</div>
                <pre className="tracePre mono">{log.data}</pre>
              </div>
            ))}
          </div>
        </details>
      </main>

      {/* Footer */}
      <footer className="py-3 text-center">
        <p className="text-[10px] text-text-tertiary/50">Agent Treasury — CRE Hackathon 2026 · Base · Aave V3</p>
      </footer>
    </div>
  );
}
