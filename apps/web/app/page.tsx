"use client";

import Link from "next/link";
/* ──────────────────────── Data ──────────────────────── */

const FLOW_STEPS = [
  {
    num: "01",
    title: "Fund the Agent Treasury",
    subtitle: "On-chain (Base)",
    color: "accent" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
      </svg>
    ),
    details: [
      "Agent deposits USDC into its BorrowVault — supplied directly to Aave V3 as collateral.",
      "Optionally swap into WETH + cbBTC for diversified, yield-earning collateral.",
      "The treasury grows while the agent operates. No action needed.",
    ],
    labels: ["BorrowVault", "Aave V3 Pool", "Yield-Earning"],
  },
  {
    num: "02",
    title: "Agent Proposes a Spend Plan",
    subtitle: "You approve",
    color: "accent2" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
      </svg>
    ),
    details: [
      "The agent needs to pay for a service — compute, APIs, infrastructure, another agent.",
      "It submits a spend plan: how much USDC to borrow, and who to pay.",
      "You review the plan and approve it. The agent cannot move funds without your approval.",
    ],
    labels: ["Spend Plan", "Owner Approval", "Human-in-the-Loop"],
  },
  {
    num: "03",
    title: "CRE Verifies the Plan",
    subtitle: "Chainlink DON",
    color: "purple" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
    details: [
      "After your approval, CRE's decentralized network independently verifies the plan.",
      "DON nodes check: allowlisted payee, amount within limits, correct nonce, safe health factor.",
      "All nodes must reach consensus. No single point of trust.",
      "DON signs the verified report and delivers it on-chain via the Keystone Forwarder.",
    ],
    labels: ["Decentralized Verification", "Consensus", "DON Signature"],
  },
  {
    num: "04",
    title: "Vault Executes Borrow + Pay",
    subtitle: "On-chain (Base)",
    color: "amber" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
      </svg>
    ),
    details: [
      "BorrowBotReceiver verifies the DON signature and decodes the verified plan.",
      "BorrowVault enforces 12 on-chain safety checks: allowlists, nonce, expiry, cooldown, limits.",
      "Health factor verified after borrow — the treasury stays safe.",
      "Aave V3 issues variable-rate USDC debt. USDC goes directly to the payee.",
    ],
    labels: ["12 Safety Checks", "Aave Borrow", "Post-Borrow HF Guard", "Pay Payee"],
  },
  {
    num: "05",
    title: "Service Provider Gets Paid",
    subtitle: "Confirmed on-chain",
    color: "accent2" as const,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
    details: [
      "USDC arrives at the payee wallet — verifiable on Basescan.",
      "Vault nonce increments, proving execution completed.",
      "Collateral stays in Aave earning yield — the agent never sold its assets.",
    ],
    labels: ["USDC Received", "Nonce Updated", "Treasury Intact"],
  },
];

const SAFETY_LAYERS = [
  {
    layer: "CRE Workflow",
    color: "purple" as const,
    checks: [
      "Vault not paused (on-chain read)",
      "Valid addresses for asset + payee",
      "Agent cannot escalate borrow amount",
      "Asset and payee must match request",
      "DON consensus on agent response",
    ],
  },
  {
    layer: "BorrowVault",
    color: "amber" as const,
    checks: [
      "Only executor (Receiver) can call",
      "Borrow token + payee allowlisted",
      "Nonce replay protection",
      "Plan not expired (< 5 min)",
      "Cooldown between executions (configurable)",
      "Per-tx cap ($100) + daily cap ($200)",
      "Health factor ≥ 1.6 post-borrow",
    ],
  },
  {
    layer: "Aave V3",
    color: "accent" as const,
    checks: [
      "LTV + liquidation threshold enforced",
      "Collateral must support borrow",
      "Variable-rate debt tracked on-chain",
    ],
  },
];

const CONTRACTS = [
  { name: "BorrowVault", addr: "0x943b82…37c6", role: "Holds collateral, borrows, pays" },
  { name: "BorrowBotReceiver", addr: "0x889ad6…a279", role: "CRE entry point on-chain" },
  { name: "Aave V3 Pool", addr: "Base mainnet", role: "Lending + borrowing" },
  { name: "USDC", addr: "0x8335…02913", role: "Borrow + collateral token" },
  { name: "WETH / cbBTC", addr: "Base mainnet", role: "Optional collateral assets" },
];

/* ──────────────────────── Color helpers ──────────────────────── */

const colorMap = {
  accent: {
    text: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/20",
    glow: "shadow-accent/20",
    dot: "bg-accent",
    line: "from-accent/40",
  },
  accent2: {
    text: "text-accent2",
    bg: "bg-accent2/10",
    border: "border-accent2/20",
    glow: "shadow-accent2/20",
    dot: "bg-accent2",
    line: "from-accent2/40",
  },
  purple: {
    text: "text-purple",
    bg: "bg-purple/10",
    border: "border-purple/20",
    glow: "shadow-purple/20",
    dot: "bg-purple",
    line: "from-purple/40",
  },
  amber: {
    text: "text-amber",
    bg: "bg-amber/10",
    border: "border-amber/20",
    glow: "shadow-amber/20",
    dot: "bg-amber",
    line: "from-amber/40",
  },
};

/* ──────────────────────── Components ──────────────────────── */

function StepCard({
  step,
  index,
}: {
  step: (typeof FLOW_STEPS)[number];
  index: number;
}) {
  const c = colorMap[step.color];
  const isLast = index === FLOW_STEPS.length - 1;

  return (
    <div className="relative flex gap-6 md:gap-8">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center">
        <div
          className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-xl border ${c.border} ${c.bg} ${c.text} shadow-lg ${c.glow}`}
        >
          {step.icon}
        </div>
        {!isLast && (
          <div className={`w-px flex-1 bg-gradient-to-b ${c.line} to-transparent min-h-8`} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-12">
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`font-mono text-xs ${c.text} opacity-60`}>{step.num}</span>
          <h3 className="text-lg font-semibold text-text-primary">{step.title}</h3>
        </div>
        <p className={`text-xs font-medium uppercase tracking-widest ${c.text} opacity-70 mb-4`}>
          {step.subtitle}
        </p>

        <div className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm p-5">
          <ul className="space-y-2 mb-4">
            {step.details.map((d, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-text-secondary leading-relaxed">
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${c.dot} shrink-0 opacity-60`} />
                {d}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {step.labels.map((l) => (
              <span
                key={l}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${c.bg} ${c.text} border ${c.border}`}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SafetySection() {
  return (
    <section className="mt-32">
      <div className="text-center mb-12">
        <p className="text-amber text-xs font-medium tracking-widest uppercase mb-2">Layered Security</p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Three Layers of Safety Checks
        </h2>
        <p className="text-text-secondary text-sm mt-3 max-w-lg mx-auto">
          Every borrow passes through CRE validation, vault enforcement, and Aave protocol checks — no single point of trust.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", alignItems: "stretch" }}>
        {SAFETY_LAYERS.map((layer) => {
          const c = colorMap[layer.color];
          return (
            <div
              key={layer.layer}
              className="rounded-xl border border-border bg-surface/60 backdrop-blur-sm p-6 flex flex-col items-center text-center"
            >
              <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${c.bg} ${c.text} border ${c.border} mb-5`}>
                {layer.layer}
              </div>
              <ul className="space-y-2.5 w-full">
                {layer.checks.map((check) => (
                  <li key={check} className="flex items-start gap-2.5 text-[13px] text-text-secondary text-left">
                    <svg viewBox="0 0 16 16" fill="none" className={`w-4 h-4 ${c.text} shrink-0 mt-0.5`}>
                      <path d="M6 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {check}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ArchitectureDiagram() {
  return (
    <section className="mt-32">
      <div className="text-center mb-12">
        <p className="text-accent text-xs font-medium tracking-widest uppercase mb-2">Architecture</p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">How the Pieces Connect</h2>
      </div>

      {/* Flow diagram */}
      <div className="max-w-4xl mx-auto rounded-2xl border border-border bg-surface/40 backdrop-blur-sm p-6 sm:p-10">
        {/* Horizontal flow for md+, vertical for mobile */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
          {[
            { label: "AI Agent", sub: "Spend request", color: "accent" as const },
            { label: "Agent Plan", sub: "Propose spend", color: "accent" as const },
            { label: "CRE DON", sub: "Validate + sign", color: "purple" as const },
            { label: "Receiver", sub: "Decode report", color: "amber" as const },
            { label: "Treasury", sub: "12 checks + borrow", color: "amber" as const },
            { label: "Service", sub: "USDC received", color: "accent2" as const },
          ].map((node, i, arr) => {
            const c = colorMap[node.color];
            return (
              <div key={node.label} className="flex items-center gap-2 md:gap-2">
                <div className={`flex flex-col items-center text-center`}>
                  <div
                    className={`h-14 w-14 rounded-xl border ${c.border} ${c.bg} flex items-center justify-center ${c.text}`}
                  >
                    <span className="text-[11px] font-bold">{node.label.slice(0, 3).toUpperCase()}</span>
                  </div>
                  <span className="text-xs font-medium text-text-primary mt-1.5">{node.label}</span>
                  <span className="text-[10px] text-text-tertiary">{node.sub}</span>
                </div>
                {i < arr.length - 1 && (
                  <svg viewBox="0 0 24 12" className="w-6 h-3 text-text-tertiary hidden md:block shrink-0">
                    <path d="M0 6h20m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-[11px] text-text-tertiary uppercase tracking-widest mb-3">Key Contracts</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CONTRACTS.map((c) => (
              <div key={c.name} className="flex items-start gap-2.5">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-text-tertiary shrink-0" />
                <div>
                  <span className="text-xs font-medium text-text-primary">{c.name}</span>
                  <span className="text-[10px] text-text-tertiary ml-1.5 font-mono">{c.addr}</span>
                  <p className="text-[11px] text-text-tertiary">{c.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────── Page ──────────────────────── */

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* ─── Hero ─── */}
      <header className="relative overflow-hidden">
        {/* Gradient orbs */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-accent/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute -top-20 left-1/3 h-[300px] w-[400px] rounded-full bg-purple/[0.06] blur-3xl" />

        <div className="relative mx-auto max-w-3xl px-6 pt-24 pb-16 text-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 backdrop-blur-sm px-4 py-1.5 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-accent2 animate-pulse" />
              <span className="text-xs font-medium text-text-secondary">Chainlink CRE Hackathon 2026</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-5">
              Self-Sustaining
              <br />
              <span className="bg-gradient-to-r from-accent via-purple to-accent2 bg-clip-text text-transparent">
                Agent Treasuries.
              </span>
            </h1>

            <p className="text-text-secondary text-base sm:text-lg max-w-xl mx-auto leading-relaxed mb-8">
              AI agents hold BTC &amp; ETH. The assets appreciate and earn yield.
              The agent borrows USDC to pay for what it needs — compute, data, other agents.
              Revenue goes back into the treasury. The cycle repeats. The agent never sells, never stops.
            </p>

            <div className="flex items-center justify-center gap-4">
              <Link
                href="/demo"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-background transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20"
              >
                Try the Demo
                <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                  <path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <a
                href="#process"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("process")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-border-strong hover:text-text-primary"
              >
                View Process
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Demo Video ─── */}
      <section className="mx-auto max-w-4xl px-6 pb-14" style={{ paddingTop: 0, marginTop: "-10px" }}>
        <div className="rounded-2xl border border-border bg-surface/40 backdrop-blur-sm overflow-hidden">
          <div className="aspect-video">
            <iframe
              src="https://www.youtube-nocookie.com/embed/bk0eFZd68bg?rel=0&modestbranding=1&showinfo=0"
              title="Agent Treasury Demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        </div>
      </section>

      {/* ─── Process Timeline ─── */}
      <main className="mx-auto max-w-5xl px-6" id="process" style={{ scrollMarginTop: "3rem" }}>
        <div className="mb-12 text-center">
          <p className="text-accent text-xs font-medium tracking-widest uppercase mb-2">The Process</p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            How It Works
          </h2>
          <p className="text-text-secondary text-sm mt-3 max-w-lg mx-auto">
            Deposit. Earn yield. Borrow to spend. Earn revenue. Deposit again. The treasury grows with every cycle.
          </p>
        </div>

        {/* Timeline */}
        <div className="ml-0 sm:ml-4">
          {FLOW_STEPS.map((step, i) => (
            <StepCard key={step.num} step={step} index={i} />
          ))}
        </div>

        {/* Safety Checks */}
        <SafetySection />

        {/* Architecture */}
        <ArchitectureDiagram />

        {/* Liquidation Risk */}
        <section className="mt-32">
          <div className="max-w-3xl mx-auto rounded-2xl border border-amber/20 bg-amber/[0.04] backdrop-blur-sm p-6 sm:p-8">
            <div className="flex gap-4">
              <div className="shrink-0 mt-0.5">
                <div className="h-10 w-10 rounded-xl bg-amber/10 border border-amber/20 flex items-center justify-center text-amber">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary mb-1">
                  &ldquo;What about liquidation?&rdquo;
                </h3>
                <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
                  When you borrow against crypto, there&rsquo;s always a risk: if the price drops too far, the protocol sells your collateral to cover the debt.
                  Agent Treasury prevents this by keeping borrows small relative to what&rsquo;s in the vault.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Safety Buffer", value: "1.6x", detail: "The vault always holds 60% more collateral than it owes — enforced on every borrow" },
                    { label: "Max per Spend", value: "$100", detail: "The agent can only borrow up to $100 at a time — no large, risky borrows" },
                    { label: "Max per Day", value: "$200", detail: "Even with multiple spends, total borrowing is capped at $200 per day" },
                  ].map((guard) => (
                    <div key={guard.label} className="rounded-lg border border-amber/15 bg-amber/[0.03] px-3 py-2.5">
                      <p className="text-[11px] text-text-tertiary uppercase tracking-wider">{guard.label}</p>
                      <p className="text-lg font-bold text-amber mt-0.5">{guard.value}</p>
                      <p className="text-[12px] text-text-tertiary mt-1.5 leading-relaxed">{guard.detail}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] text-text-tertiary mt-3">
                  All limits are set by the vault owner and enforced on-chain. Advanced liquidation protection is on the roadmap.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Vision / What's Next */}
        <section className="mt-32">
          <div className="text-center mb-12">
            <p className="text-accent2 text-xs font-medium tracking-widest uppercase mb-2">The Vision</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Where This Is Going
            </h2>
            <p className="text-text-secondary text-sm mt-3 max-w-lg mx-auto">
              The wealthy never sell — they borrow against what they own.
              Agent Treasury brings that same model to AI agents, creating a self-sustaining cycle that runs forever.
            </p>
          </div>

          <div className="max-w-4xl mx-auto rounded-2xl border border-border bg-surface/40 backdrop-blur-sm p-6 sm:p-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  title: "Today",
                  color: "accent" as const,
                  tag: "Live on Base",
                  items: [
                    "Deposit BTC, ETH, or USDC as collateral",
                    "Earn yield on Aave V3 while holding",
                    "Borrow USDC to pay allowlisted services",
                    "CRE verifies every spend — 12 on-chain checks",
                  ],
                },
                {
                  title: "Next",
                  color: "purple" as const,
                  tag: "In Development",
                  items: [
                    "Auto-spend below a threshold — no approval needed",
                    "Owner approval only for large or unusual spends",
                    "x402 payments: borrow USDC, pay per HTTP request",
                    "Agents operate autonomously within guardrails",
                  ],
                },
                {
                  title: "The Endgame",
                  color: "accent2" as const,
                  tag: "Vision",
                  items: [
                    "Agent holds BTC + ETH — assets appreciate over time",
                    "Borrows USDC to operate: compute, data, services",
                    "Earns revenue → deposits back → treasury grows",
                    "The cycle repeats forever. Self-sustaining agents.",
                  ],
                },
              ].map((col) => {
                const c = colorMap[col.color];
                return (
                  <div key={col.title} className="flex flex-col">
                    <div className={`inline-flex self-start items-center rounded-full px-3 py-1 text-[11px] font-medium ${c.bg} ${c.text} border ${c.border} mb-4`}>
                      {col.tag}
                    </div>
                    <h3 className="text-base font-semibold text-text-primary mb-3">{col.title}</h3>
                    <ul className="space-y-2">
                      {col.items.map((item) => (
                        <li key={item} className="flex gap-2.5 text-[13px] text-text-secondary leading-relaxed">
                          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${c.dot} shrink-0 opacity-60`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-[13px] text-text-secondary leading-relaxed max-w-2xl">
                <span className="font-medium text-text-primary">Why x402?</span>{" "}
                Today the agent pays an allowlisted address. With{" "}
                <a href="https://www.x402.org/" target="_blank" rel="noreferrer" className="text-purple hover:underline">x402</a>,
                any HTTP service can require payment via the standard 402 status code.
                The agent borrows USDC from its treasury and pays per-request — no accounts, no API keys, no invoices.
                Just money over HTTP, verified by Chainlink CRE.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="mt-32 mb-24 text-center">
          <div className="rounded-2xl border border-border bg-surface/40 backdrop-blur-sm p-10 sm:p-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
              See it in Action
            </h2>
            <p className="text-text-secondary text-sm mb-8 max-w-md mx-auto">
              Approve a spend plan, watch CRE verify it, and see the payment execute on Base mainnet.
            </p>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-8 py-3 text-sm font-semibold text-background transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20"
            >
              Open Interactive Demo
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                <path d="M3 8h10m-4-4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border py-8 text-center">
        <p className="text-xs text-text-tertiary">
          Agent Treasury — Chainlink CRE Hackathon 2026 · Built on Base · Aave V3
        </p>
        <a href="https://github.com/MSanchezWorld/agent-treasury" target="_blank" rel="noreferrer" className="inline-block mt-3 text-text-tertiary/40 hover:text-text-secondary transition-colors">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" /></svg>
        </a>
      </footer>
    </div>
  );
}
