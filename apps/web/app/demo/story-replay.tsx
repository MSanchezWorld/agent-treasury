"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

const DEFAULT_PAYEE = "0x42444551e2b5FEb7A7c2eE4dA38993381B08Bc6d";
const DEFAULT_VAULT = "0x943b828468509765654EA502803DF7F0b21637c6";
const BASESCAN = "https://basescan.org";

const STORY = {
  deposit: 5,
  borrow: 1,
  payee: "0x4244...Bc6d",
  collateralUsd: 4.98,
  debtUsd: 1.0,
  healthFactor: "3.89",
  yieldBps: 3,
};

// 0=idle, 1=plan, 2=deposit, 3=yield, 4=verify, 5=pay, 6=result
type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PHASE_DURATION: Record<Phase, number> = {
  0: 0,
  1: 0, // waits for approve
  2: 3200,
  3: 2800,
  4: 3200,
  5: 3000,
  6: 0,
};

const NARRATION: Record<Phase, string> = {
  0: "",
  1: "Your agent wants to make a payment. Review the spend plan.",
  2: "Agent deposits $5 USDC into the treasury, supplied to Aave V3 as collateral.",
  3: "Collateral earns yield automatically. The treasury grows while the agent operates.",
  4: "CRE's decentralized network independently verifies the plan you approved.",
  5: "Verified. Vault borrows $1 USDC from Aave and pays the service provider.",
  6: "Done. Your agent earns, borrows, and pays — and you control every spend.",
};

const PHASE_LABELS: Record<Phase, string> = {
  0: "Start",
  1: "Plan",
  2: "Deposit",
  3: "Yield",
  4: "Verify",
  5: "Pay",
  6: "Result",
};

function shortHex(hex: string, left = 6, right = 4) {
  if (hex.length <= left + right) return hex;
  return `${hex.slice(0, left)}...${hex.slice(-right)}`;
}

type ProofData = {
  collateralUsd: string;
  debtUsd: string;
  healthFactor: string;
  depositTxHash: string | null;
  borrowTxHash: string | null;
  creTxHash: string | null;
  vaultAddress: string;
  nonce: string;
  payeeBalance: string;
  collaterals: { symbol: string; valueUsd: string }[];
};

const CHECK_ITEMS = [
  "Payee is on the allowlist",
  "Amount within daily limit",
  "Nonce matches vault state",
  "Health factor stays safe",
];

export default function StoryReplay() {
  const [phase, setPhase] = useState<Phase>(0);
  const [playing, setPlaying] = useState(false);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [proofLoading, setProofLoading] = useState(false);

  const [collateralDisplay, setCollateralDisplay] = useState(0);
  const [debtDisplay, setDebtDisplay] = useState(0);
  const [yieldTick, setYieldTick] = useState(0);
  const [checkMarks, setCheckMarks] = useState(0);

  // Live deposit
  const [depositing, setDepositing] = useState(false);
  const [depositStep, setDepositStep] = useState<string | null>(null);
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yieldRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-advance (skip 0, 1 which wait for user, and 6 which stays)
  useEffect(() => {
    if (!playing) return;
    if (phase === 0 || phase === 1 || phase === 6) return;
    const dur = PHASE_DURATION[phase];
    if (dur <= 0) return;
    timerRef.current = setTimeout(() => {
      setPhase((p) => (p < 6 ? ((p + 1) as Phase) : p));
    }, dur);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, playing]);

  // Phase 2: animate collateral
  useEffect(() => {
    if (phase < 2) { setCollateralDisplay(0); return; }
    if (phase > 2) return;
    let frame: number;
    const start = performance.now();
    const duration = 2200;
    const target = STORY.collateralUsd;
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCollateralDisplay(parseFloat((target * eased).toFixed(2)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  // Phase 3: yield
  useEffect(() => {
    if (phase !== 3) { if (yieldRef.current) clearInterval(yieldRef.current); return; }
    setYieldTick(0);
    let count = 0;
    yieldRef.current = setInterval(() => {
      count++;
      setYieldTick(count);
      setCollateralDisplay((prev) => parseFloat((prev + 0.01).toFixed(2)));
    }, 400);
    return () => { if (yieldRef.current) clearInterval(yieldRef.current); };
  }, [phase]);

  // Phase 4: staggered checks
  useEffect(() => {
    if (phase !== 4) { if (phase < 4) setCheckMarks(0); return; }
    setCheckMarks(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= 4; i++) {
      timers.push(setTimeout(() => setCheckMarks(i), i * 650));
    }
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // Phase 5: animate debt
  useEffect(() => {
    if (phase < 5) { setDebtDisplay(0); return; }
    if (phase > 5) return;
    let frame: number;
    const start = performance.now();
    const duration = 1500;
    const target = STORY.debtUsd;
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDebtDisplay(parseFloat((target * eased).toFixed(2)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  // Phase 6: fetch proof
  useEffect(() => {
    if (phase !== 6) return;
    let cancelled = false;
    setProofLoading(true);
    fetch(`/api/proof?payee=${encodeURIComponent(DEFAULT_PAYEE)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.ok && json?.proof) {
          const p = json.proof;
          const baseDec = p?.oracle?.baseDecimals ?? 8;
          const collBase = BigInt(p?.aave?.userAccountData?.totalCollateralBase ?? "0");
          const debtBase = BigInt(p?.aave?.userAccountData?.totalDebtBase ?? "0");
          const hf = BigInt(p?.aave?.userAccountData?.healthFactor ?? "0");
          const fmt = (v: bigint, dec: number) => (Number(v) / 10 ** dec).toFixed(2);
          const collaterals: { symbol: string; valueUsd: string }[] = [];
          if (Array.isArray(p?.collaterals)) {
            for (const c of p.collaterals) {
              const val = BigInt(c?.valueBase ?? "0");
              if (val > 0n) collaterals.push({ symbol: c?.symbol ?? "?", valueUsd: fmt(val, baseDec) });
            }
          }
          setProof({
            collateralUsd: fmt(collBase, baseDec),
            debtUsd: fmt(debtBase, baseDec),
            healthFactor: debtBase === 0n ? "∞" : (Number(hf) / 1e18).toFixed(2),
            depositTxHash: p?.lastSupply?.txHash ?? null,
            borrowTxHash: p?.lastBorrowAndPay?.txHash ?? null,
            creTxHash: p?.lastReceiverReport?.txHash ?? null,
            vaultAddress: p?.vault?.address ?? DEFAULT_VAULT,
            nonce: String(p?.vault?.nonce ?? "—"),
            payeeBalance: fmt(
              BigInt(p?.usdc?.payeeValueBase ?? p?.usdc?.payeeBalance ?? "0"),
              p?.usdc?.payeeValueBase ? baseDec : (p?.usdc?.decimals ?? 6),
            ),
            collaterals,
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProofLoading(false); });
    return () => { cancelled = true; };
  }, [phase]);

  const startReplay = useCallback(() => {
    setPhase(1);
    setPlaying(true);
    setProof(null);
    setCollateralDisplay(0);
    setDebtDisplay(0);
    setYieldTick(0);
    setCheckMarks(0);
  }, []);

  const resetReplay = useCallback(() => {
    setPhase(0);
    setPlaying(false);
    setProof(null);
    setCollateralDisplay(0);
    setDebtDisplay(0);
    setYieldTick(0);
    setCheckMarks(0);
  }, []);

  const fundTreasuryLive = useCallback(async () => {
    if (depositing) return;
    setDepositing(true);
    setDepositTx(null);
    setDepositError(null);
    setDepositStep("Connecting to Base mainnet…");
    try {
      // Show progress steps while the API call runs
      const stepTimer1 = setTimeout(() => setDepositStep("Approving USDC to vault…"), 2000);
      const stepTimer2 = setTimeout(() => setDepositStep("Supplying $" + STORY.deposit + " USDC to Aave V3…"), 6000);
      const stepTimer3 = setTimeout(() => setDepositStep("Waiting for on-chain confirmation…"), 12000);

      const res = await fetch("/api/demo/deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depositAmount: String(STORY.deposit * 1_000_000) }),
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Deposit failed");
      }
      setDepositStep("Confirmed! $" + json.depositUsd + " USDC deposited on Base.");
      setDepositTx(json.supplyTxHash);
    } catch (e) {
      setDepositStep(null);
      setDepositError(e instanceof Error ? e.message : String(e));
    } finally {
      setDepositing(false);
    }
  }, [depositing]);

  const approveSpend = useCallback(() => {
    setPhase(2); // approved → start execution
  }, []);

  const jumpToPhase = useCallback((p: Phase) => {
    if (p === 0) { resetReplay(); return; }
    setPhase(p);
    setPlaying(p > 1 && p < 6);
    if (p >= 2) setCollateralDisplay(STORY.collateralUsd);
    if (p >= 5) setDebtDisplay(STORY.debtUsd);
    if (p >= 4) setCheckMarks(4);
  }, [resetReplay]);

  // Display values
  const collateral = phase >= 2 ? `$${collateralDisplay.toFixed(2)}` : "—";
  const debt = phase >= 5 ? `$${debtDisplay.toFixed(2)}` : "$0.00";
  const hf = phase >= 5 ? STORY.healthFactor : phase >= 2 ? "∞" : "—";
  const agentUsdc = phase >= 2 ? "$0.00" : "$5.00";

  const finalCollateral = proof ? `$${proof.collateralUsd}` : collateral;
  const finalDebt = proof ? `$${proof.debtUsd}` : debt;
  const finalHf = proof ? proof.healthFactor : hf;

  const showCollateral = phase === 6 ? finalCollateral : collateral;
  const showDebt = phase === 6 ? finalDebt : debt;
  const showHf = phase === 6 ? finalHf : hf;

  const showBoard = phase >= 2;

  // --- Phase 0: centered start screen ---
  if (phase === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-5">
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="h-2 w-2 rounded-full bg-accent2" />
            <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
              Agent Treasury Demo
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary tracking-tight leading-tight mb-3">
            Hold assets. Earn yield.<br />Borrow to spend.
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed mb-8">
            The wealthy never sell — they borrow against what they own.
            Watch an AI agent do the same, and <span className="text-accent font-medium">you approve every spend</span>.
          </p>

          <button
            onClick={startReplay}
            className="inline-flex items-center gap-3 rounded-full bg-accent px-8 py-3 text-sm font-semibold text-background hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20 transition-all cursor-pointer"
          >
            Watch the Story
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
              <path d="M5 3l8 5-8 5V3z" fill="currentColor" />
            </svg>
          </button>

          <div className="mt-4">
            <button
              onClick={fundTreasuryLive}
              disabled={depositing}
              className="inline-flex items-center gap-2 rounded-full border border-accent2/30 bg-accent2/10 px-6 py-2.5 text-sm font-medium text-accent2 hover:bg-accent2/20 hover:border-accent2/50 transition-all cursor-pointer disabled:opacity-50"
            >
              {depositing ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-accent2 animate-pulse" />
                  Depositing ${STORY.deposit} USDC on Base…
                </>
              ) : (
                <>
                  Fund Treasury Live — ${STORY.deposit} USDC
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </>
              )}
            </button>
          </div>

          {(depositing || depositStep) && !depositTx && !depositError && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2 animate-pulse" />
              <p className="text-[11px] text-text-secondary">{depositStep}</p>
            </div>
          )}

          {depositTx && (
            <div className="mt-3 space-y-1">
              <p className="text-[11px] text-accent2 font-medium">{depositStep}</p>
              <a
                href={`${BASESCAN}/tx/${depositTx}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-accent2 hover:underline"
              >
                <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                View on Basescan →
              </a>
            </div>
          )}

          {depositError && (
            <p className="mt-3 text-[11px] text-red-400">{depositError}</p>
          )}

          <div className="mt-4">
            <a
              href="https://github.com/MSanchezWorld/agent-treasury"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Clone the repo to run the full CRE flow locally →
            </a>
          </div>
        </div>
      </div>
    );
  }

  // --- Phase 1: spend plan (centered, no board yet) ---
  if (phase === 1) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-full max-w-md px-5">
          {/* Narration */}
          <div className="rounded-xl border-l-2 border-accent/60 bg-surface/60 backdrop-blur-sm px-4 py-3 mb-5">
            <p className="text-sm text-text-secondary leading-relaxed">{NARRATION[1]}</p>
          </div>

          {/* Spend plan card */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45 }}
            className="rounded-2xl border-2 border-accent/40 bg-surface/90 backdrop-blur-md px-5 py-5 shadow-lg shadow-accent/5"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent/15 border border-accent/25">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-accent">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">Spend Plan</p>
                <p className="text-[11px] text-text-tertiary">Your agent is requesting approval</p>
              </div>
            </div>

            <div className="rounded-xl bg-black/20 border border-border/50 p-4 mb-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Action</span>
                <span className="text-sm text-text-primary font-medium">Deposit, Borrow &amp; Pay</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Deposit</span>
                <span className="text-sm text-text-primary font-semibold mono">${STORY.deposit}.00 USDC</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Borrow</span>
                <span className="text-sm text-text-primary font-semibold mono">${STORY.borrow}.00 USDC</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Pay to</span>
                <span className="text-sm text-text-primary mono">{STORY.payee}</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Reason</span>
                <span className="text-sm text-text-primary">Service provider payment</span>
              </div>
              <div className="h-px bg-border/30" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-text-tertiary uppercase tracking-wider">Source</span>
                <span className="text-sm text-text-primary">Borrow against collateral</span>
              </div>
            </div>

            <div className="rounded-lg bg-accent2/[0.08] border border-accent2/20 px-3 py-2 mb-4">
              <p className="text-[11px] text-accent2 leading-relaxed">
                The agent cannot move funds without your approval. After you approve, CRE&apos;s decentralized network will independently verify the plan before execution.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={approveSpend}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20 transition-all cursor-pointer"
              >
                <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
                  <path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Approve Spend
              </button>
              <button
                onClick={resetReplay}
                className="rounded-xl border border-border px-4 py-2.5 text-sm text-text-tertiary hover:text-text-secondary hover:border-border-strong transition-all cursor-pointer"
              >
                Reject
              </button>
            </div>
          </motion.div>

          {/* Phase dots */}
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {([0, 1, 2, 3, 4, 5, 6] as Phase[]).map((p) => (
              <button
                key={p}
                onClick={() => jumpToPhase(p)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all cursor-pointer ${
                  p === phase
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : p < phase
                      ? "border-accent2/30 bg-accent2/10 text-accent2"
                      : "border-border bg-surface text-text-tertiary hover:border-border-strong"
                }`}
              >
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Phases 2-6: board view ---
  return (
    <div className="min-h-screen flex flex-col justify-center">
      <main className="mx-auto w-full max-w-5xl px-5 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`h-2 w-2 rounded-full ${playing ? "bg-accent animate-pulse" : "bg-accent2"}`} />
            <h1 className="text-lg font-semibold text-text-primary tracking-tight">Agent Treasury Demo</h1>
          </div>
          <a
            href="https://github.com/MSanchezWorld/agent-treasury"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            GitHub →
          </a>
        </div>

        {/* Narration */}
        <div className="rounded-xl border-l-2 border-accent/60 bg-surface/60 backdrop-blur-sm px-4 py-3 mb-4">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-text-secondary leading-relaxed"
            >
              {NARRATION[phase]}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Board */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="demoBoard"
        >
          <div className="demoBoardGrid">
            {/* Agent Wallet */}
            <div className="demoBox">
              <div className="demoBoxTitle">
                <span>Agent Wallet</span>
                <span className="demoBoxAddr mono">0x7C00...81C9</span>
              </div>
              <div className="demoKV">
                <span className="demoK">USDC</span>
                <motion.span
                  className="demoV mono"
                  key={`agent-${phase >= 2 ? "sent" : "full"}`}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  {agentUsdc}
                </motion.span>
              </div>
            </div>

            <div className="demoArrow" aria-hidden="true">
              {phase === 2 ? (
                <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>→</motion.span>
              ) : "→"}
            </div>

            {/* Treasury */}
            <div className="demoBox" style={{ position: "relative" }}>
              <div className="demoBoxTitle">
                <span>Treasury</span>
                <span className="demoBoxAddr">Aave V3</span>
              </div>
              <div className="demoKV">
                <span className="demoK">Collateral</span>
                <span className="demoV mono">
                  {showCollateral}
                  {phase === 3 && (
                    <motion.span
                      className="demoDelta"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      {" "}+yield
                    </motion.span>
                  )}
                </span>
              </div>
              <div className="demoKV">
                <span className="demoK">Debt</span>
                <span className="demoV mono">{showDebt}</span>
              </div>
              <div className="demoKV">
                <span className="demoK">Health</span>
                <span className="demoV mono">{showHf}</span>
              </div>

              {/* CRE overlay — phase 4 */}
              <AnimatePresence>
                {phase === 4 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 rounded-2xl bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2 p-4"
                  >
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="text-accent text-2xl mb-1"
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                        <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.25C16.6 21.15 20 16.25 20 11V6l-8-4z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
                        <text x="12" y="15" textAnchor="middle" fill="currentColor" fontSize="8" fontWeight="bold">CRE</text>
                      </svg>
                    </motion.div>
                    <p className="text-[10px] text-text-tertiary mb-1">Decentralized verification</p>
                    <div className="w-full space-y-1.5">
                      {CHECK_ITEMS.map((item, i) => (
                        <motion.div
                          key={item}
                          initial={{ opacity: 0, x: -10 }}
                          animate={i < checkMarks ? { opacity: 1, x: 0 } : { opacity: 0.3, x: -10 }}
                          transition={{ duration: 0.3 }}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span className={`flex items-center justify-center w-4 h-4 rounded-full border shrink-0 ${
                            i < checkMarks ? "border-accent2 bg-accent2/20 text-accent2" : "border-border text-text-tertiary"
                          }`}>
                            {i < checkMarks && (
                              <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
                                <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className={i < checkMarks ? "text-text-primary" : "text-text-tertiary"}>{item}</span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="demoArrow" aria-hidden="true">
              {phase >= 5 ? (
                <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>→</motion.span>
              ) : "→"}
            </div>

            {/* Service Provider */}
            <div className="demoBox">
              <div className="demoBoxTitle">
                <span>Service Provider</span>
                <span className="demoBoxAddr mono">{STORY.payee}</span>
              </div>
              <div className="demoKV">
                <span className="demoK">USDC</span>
                <motion.span
                  className="demoV mono"
                  animate={{ color: phase >= 5 ? "rgba(124, 255, 171, 0.86)" : "inherit" }}
                  transition={{ duration: 0.6 }}
                >
                  {phase >= 5 ? (
                    <>+${STORY.borrow}.00{phase === 6 && proof && <span className="text-text-secondary ml-1 text-[11px]">(live: ${proof.payeeBalance})</span>}</>
                  ) : "—"}
                </motion.span>
              </div>
            </div>
          </div>

          {/* Token animations */}
          <AnimatePresence>
            {phase === 2 && (
              <motion.div className="demoToken demoTokenUsdc" initial={{ left: "12%", top: "50%", opacity: 1 }} animate={{ left: "50%", top: "50%", opacity: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} aria-hidden="true">U</motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {(phase === 2 || phase === 3) && (
              <>
                <motion.div className="demoToken demoTokenEth" initial={{ left: "50%", top: "50%", opacity: 0, scale: 0 }} animate={{ left: "44%", top: "45%", opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, delay: 1.4 }} aria-hidden="true">E</motion.div>
                <motion.div className="demoToken demoTokenBtc" initial={{ left: "50%", top: "50%", opacity: 0, scale: 0 }} animate={{ left: "56%", top: "45%", opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, delay: 1.6 }} aria-hidden="true">B</motion.div>
              </>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {phase === 5 && (
              <motion.div className="demoToken demoTokenPay" initial={{ left: "50%", top: "60%", opacity: 1 }} animate={{ left: "88%", top: "50%", opacity: 1 }} transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }} aria-hidden="true">$</motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {phase === 3 && (
              <motion.div className="absolute inset-0 rounded-2xl pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.15, 0] }} transition={{ duration: 2, repeat: Infinity }} style={{ background: "radial-gradient(circle at 50% 50%, rgba(124, 255, 171, 0.15), transparent 70%)" }} aria-hidden="true" />
            )}
          </AnimatePresence>
        </motion.div>

        {/* Phase 6: proof */}
        <AnimatePresence>
          {phase === 6 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="rounded-xl border border-accent2/30 bg-accent2/[0.06] px-4 py-3 mt-3"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary mb-2">Treasury is live on Base mainnet</p>
                  {proofLoading ? (
                    <p className="text-[11px] text-text-tertiary">Loading on-chain proof...</p>
                  ) : proof ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <a href={`${BASESCAN}/address/${proof.vaultAddress}`} target="_blank" rel="noreferrer" className="pill">
                          Vault <span className="mono">{shortHex(proof.vaultAddress, 6, 4)}</span>
                        </a>
                        <span className="pill">Nonce <span className="mono">{proof.nonce}</span></span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className="pill">Collateral <span className="mono">${proof.collateralUsd}</span></span>
                        {proof.collaterals.map((c) => (
                          <span key={c.symbol} className="pill">{c.symbol} <span className="mono">${c.valueUsd}</span></span>
                        ))}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <span className="pill">Debt <span className="mono">${proof.debtUsd}</span></span>
                        <span className="pill">HF <span className="mono">{proof.healthFactor}</span></span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {proof.depositTxHash && (
                          <a href={`${BASESCAN}/tx/${proof.depositTxHash}`} target="_blank" rel="noreferrer" className="pill">
                            Deposit tx <span className="mono">{shortHex(proof.depositTxHash, 8, 6)}</span>
                          </a>
                        )}
                        {proof.creTxHash && (
                          <a href={`${BASESCAN}/tx/${proof.creTxHash}`} target="_blank" rel="noreferrer" className="pill">
                            CRE tx <span className="mono">{shortHex(proof.creTxHash, 8, 6)}</span>
                          </a>
                        )}
                        {proof.borrowTxHash && (
                          <a href={`${BASESCAN}/tx/${proof.borrowTxHash}`} target="_blank" rel="noreferrer" className="pill">
                            Borrow tx <span className="mono">{shortHex(proof.borrowTxHash, 8, 6)}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-tertiary">Proof unavailable — the vault data could not be fetched.</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={fundTreasuryLive}
                    disabled={depositing}
                    className="inline-flex items-center gap-2 rounded-full bg-accent2 px-5 py-2 text-xs font-semibold text-background hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {depositing ? "Depositing…" : `Fund Treasury — $${STORY.deposit}`}
                  </button>
                  {depositTx && (
                    <a href={`${BASESCAN}/tx/${depositTx}`} target="_blank" rel="noreferrer" className="text-[10px] text-accent2 hover:underline text-center">
                      View deposit tx →
                    </a>
                  )}
                  <a href="https://github.com/MSanchezWorld/agent-treasury" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-xs font-semibold text-background hover:bg-accent-hover transition-colors">
                    View on GitHub
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5"><path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {([0, 1, 2, 3, 4, 5, 6] as Phase[]).map((p) => (
              <button
                key={p}
                onClick={() => jumpToPhase(p)}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all cursor-pointer ${
                  p === phase
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : p < phase
                      ? "border-accent2/30 bg-accent2/10 text-accent2"
                      : "border-border bg-surface text-text-tertiary hover:border-border-strong"
                }`}
              >
                {p < phase && (
                  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                )}
                {p === phase && playing && <span className="h-1 w-1 rounded-full bg-accent animate-pulse" />}
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
          {phase === 6 && (
            <button onClick={resetReplay} className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">
              Replay
            </button>
          )}
        </div>
      </main>

      <footer className="py-3 text-center">
        <p className="text-[10px] text-text-tertiary/50">Agent Treasury — CRE Hackathon 2026 · Base · Aave V3</p>
      </footer>
    </div>
  );
}
