import { NextResponse } from "next/server";
import { requireSharedSecret } from "../../_auth";

export const runtime = "nodejs";

function isAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isUIntString(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]+$/.test(v);
}

// Agent decision logic — evaluates spend requests instead of blindly echoing them.
// CRE + on-chain vault enforce hard safety constraints; the agent applies soft economic reasoning.
export async function POST(req: Request) {
  try {
    const authErr = requireSharedSecret(req, {
      envVar: "AGENT_PLAN_SECRET",
      headerName: "x-agent-secret",
      allowInDevWithoutSecret: true
    });
    if (authErr) return authErr;

    const input = (await req.json()) as any;
    const spendRequest = input?.spendRequest;
    const vault = input?.vault;

    const borrowAsset = spendRequest?.borrowAsset;
    const borrowAmount = String(spendRequest?.borrowAmount ?? "");
    const payee = spendRequest?.payee;

    if (!isAddress(borrowAsset)) {
      return NextResponse.json({ error: "Invalid spendRequest.borrowAsset" }, { status: 400 });
    }
    if (!isAddress(payee)) {
      return NextResponse.json({ error: "Invalid spendRequest.payee" }, { status: 400 });
    }
    if (!isUIntString(borrowAmount) || borrowAmount === "0") {
      return NextResponse.json({ error: "Invalid spendRequest.borrowAmount" }, { status: 400 });
    }

    const currentNonce = String(vault?.currentNonce ?? "");
    if (currentNonce && !isUIntString(currentNonce)) {
      return NextResponse.json({ error: "Invalid vault.currentNonce" }, { status: 400 });
    }

    // ── Agent Decision Logic ──
    const borrowAmountBig = BigInt(borrowAmount);
    const USDC_DECIMALS = 6;
    const borrowUsd = Number(borrowAmountBig) / 10 ** USDC_DECIMALS;

    // Policy: agent-level spend limits (softer than on-chain caps)
    const AGENT_MAX_PER_TX_USD = 50;
    const AGENT_PREFERRED_MAX_USD = 10;
    const MIN_SPEND_USD = 0.01;

    // 1) Reject dust — not worth the gas
    if (borrowUsd < MIN_SPEND_USD) {
      return NextResponse.json(
        { error: `Amount $${borrowUsd.toFixed(2)} is below agent minimum ($${MIN_SPEND_USD}). Not worth the gas cost.` },
        { status: 400 }
      );
    }

    // 2) Hard reject above agent max
    if (borrowUsd > AGENT_MAX_PER_TX_USD) {
      return NextResponse.json(
        { error: `Amount $${borrowUsd.toFixed(2)} exceeds agent limit ($${AGENT_MAX_PER_TX_USD}). Split into smaller spends.` },
        { status: 400 }
      );
    }

    // 3) Adjust: if above preferred max, cap it (agent is conservative)
    let approvedAmount = borrowAmount;
    let adjusted = false;
    if (borrowUsd > AGENT_PREFERRED_MAX_USD) {
      const cappedBig = BigInt(AGENT_PREFERRED_MAX_USD * 10 ** USDC_DECIMALS);
      approvedAmount = cappedBig.toString();
      adjusted = true;
    }

    // 4) Build reasoning
    const reasons: string[] = [];
    if (adjusted) {
      reasons.push(`Reduced from $${borrowUsd.toFixed(2)} to $${AGENT_PREFERRED_MAX_USD.toFixed(2)} — agent prefers smaller, frequent spends over large single borrows`);
    } else {
      reasons.push(`Amount $${borrowUsd.toFixed(2)} is within acceptable range`);
    }
    reasons.push(`Payee ${payee.slice(0, 8)}…${payee.slice(-4)} will receive funds`);
    if (currentNonce) {
      reasons.push(`Vault nonce ${currentNonce} — execution #${BigInt(currentNonce) + 1n}`);
    }
    reasons.push("Hard safety enforced by CRE consensus + 12 on-chain vault checks");

    const plan = {
      borrowAsset,
      borrowAmount: approvedAmount,
      payee,
      reasoning: reasons,
      decision: adjusted ? "approved_adjusted" : "approved",
      requestedAmount: borrowAmount,
      approvedAmount,
      confidence: adjusted ? 0.75 : 0.95
    };

    return NextResponse.json(plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Internal error", message: msg }, { status: 500 });
  }
}
