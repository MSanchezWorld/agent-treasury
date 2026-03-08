import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || "8787");
const PLAN_SECRET = (process.env.AGENT_PLAN_SECRET || "").trim();

function isAddress(addr) {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isUIntString(v) {
  return typeof v === "string" && /^[0-9]+$/.test(v);
}

async function readJson(req, { maxBytes = 1024 * 1024 } = {}) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) throw new Error("Missing JSON body");
  return JSON.parse(raw);
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function unauthorized(res, message) {
  json(res, 401, { error: message });
}

function safeEqual(left, right) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function getHeader(req, headerName) {
  const raw = req.headers[headerName];
  if (Array.isArray(raw)) return (raw[0] || "").trim();
  return String(raw || "").trim();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return json(res, 200, { ok: true, name: "borrowbot-agent" });
    }

    if (req.method === "POST" && req.url === "/plan") {
      if (PLAN_SECRET) {
        const provided = getHeader(req, "x-agent-secret");
        if (!provided) return unauthorized(res, "Missing x-agent-secret");
        if (!safeEqual(provided, PLAN_SECRET)) return unauthorized(res, "Invalid x-agent-secret");
      }

      const input = await readJson(req);

      const spendRequest = input?.spendRequest;
      const vault = input?.vault;

      const borrowAsset = spendRequest?.borrowAsset;
      const borrowAmount = String(spendRequest?.borrowAmount ?? "");
      const payee = spendRequest?.payee;

      if (!isAddress(borrowAsset)) return badRequest(res, "Invalid spendRequest.borrowAsset");
      if (!isAddress(payee)) return badRequest(res, "Invalid spendRequest.payee");
      if (!isUIntString(borrowAmount) || borrowAmount === "0") return badRequest(res, "Invalid spendRequest.borrowAmount");

      const currentNonce = String(vault?.currentNonce ?? "");
      if (currentNonce && !isUIntString(currentNonce)) return badRequest(res, "Invalid vault.currentNonce");

      // ── Agent Decision Logic ──
      // The agent evaluates the spend request and decides whether to approve,
      // adjust, or reject. CRE + on-chain vault enforce hard safety constraints;
      // the agent applies soft economic reasoning on top.

      const borrowAmountBig = BigInt(borrowAmount);
      const USDC_DECIMALS = 6;
      const borrowUsd = Number(borrowAmountBig) / 10 ** USDC_DECIMALS;

      // Policy: agent-level spend limits (softer than on-chain caps)
      const AGENT_MAX_PER_TX_USD = 50;    // agent won't propose > $50 per tx
      const AGENT_PREFERRED_MAX_USD = 10;  // above this, agent reduces amount
      const MIN_SPEND_USD = 0.01;          // reject dust spends

      // 1) Reject dust — not worth the gas
      if (borrowUsd < MIN_SPEND_USD) {
        console.log(`[agent] REJECT: amount $${borrowUsd} below minimum $${MIN_SPEND_USD}`);
        return badRequest(res, `Amount $${borrowUsd.toFixed(2)} is below agent minimum ($${MIN_SPEND_USD}). Not worth the gas cost.`);
      }

      // 2) Hard reject above agent max
      if (borrowUsd > AGENT_MAX_PER_TX_USD) {
        console.log(`[agent] REJECT: amount $${borrowUsd} exceeds agent max $${AGENT_MAX_PER_TX_USD}`);
        return badRequest(res, `Amount $${borrowUsd.toFixed(2)} exceeds agent limit ($${AGENT_MAX_PER_TX_USD}). Split into smaller spends.`);
      }

      // 3) Adjust: if above preferred max, cap it (agent is conservative)
      let approvedAmount = borrowAmount;
      let adjusted = false;
      if (borrowUsd > AGENT_PREFERRED_MAX_USD) {
        const cappedBig = BigInt(AGENT_PREFERRED_MAX_USD * 10 ** USDC_DECIMALS);
        approvedAmount = cappedBig.toString();
        adjusted = true;
        console.log(`[agent] ADJUST: $${borrowUsd} → $${AGENT_PREFERRED_MAX_USD} (conservative cap)`);
      }

      // 4) Build reasoning
      const reasons = [];
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

      console.log("[agent] plan", JSON.stringify(plan, null, 2));
      return json(res, 200, plan);
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[agent] error", err);
    json(res, 500, { error: "Internal error" });
  }
});

server.listen(PORT, HOST, () => {
  if (!PLAN_SECRET) {
    console.warn("[agent] AGENT_PLAN_SECRET is not set; /plan is unauthenticated");
  }
  console.log(`[agent] listening on http://${HOST}:${PORT}`);
});
