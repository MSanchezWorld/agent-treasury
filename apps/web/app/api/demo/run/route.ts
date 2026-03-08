import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";

function isAddress(addr: unknown): addr is string {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function toUIntString(v: unknown): string | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return null;
    return String(v);
  }
  if (typeof v === "string" && /^[0-9]+$/.test(v)) return v;
  return null;
}

function findRepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "cre", "project.yaml");
    if (fs.existsSync(candidate)) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function loadDotEnvFile(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    out[key] = val;
  }
  return out;
}

function patchAgentUrlInConfig(repoRoot: string, currentOrigin: string) {
  const configPath = path.join(repoRoot, "cre/workflows/borrowbot-borrow-and-pay/config.mainnet.json");
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw);
    const desired = `${currentOrigin}/api/agent/plan`;
    if (cfg.agentUrl !== desired) {
      cfg.agentUrl = desired;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
    }
  } catch { /* best-effort */ }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as any;
    const payee = body?.payee;
    const borrowAmount = toUIntString(body?.borrowAmount);
    const depositAmount = body?.depositAmount == null ? null : toUIntString(body?.depositAmount);
    const broadcast = body?.broadcast !== false;

    if (!isAddress(payee)) {
      return NextResponse.json({ error: "Invalid payee" }, { status: 400 });
    }
    if (!borrowAmount || borrowAmount === "0") {
      return NextResponse.json({ error: "Invalid borrowAmount" }, { status: 400 });
    }

    // Check if CRE binary is available (only works locally, not on Vercel)
    const creBin = process.env.CRE_BIN?.trim() || path.join(os.homedir(), ".cre", "bin", "cre");
    const repoRoot = findRepoRoot();

    if (!fs.existsSync(creBin) || !repoRoot) {
      return NextResponse.json({
        ok: false,
        error: "CRE verification required",
        message: "Borrow & Pay requires Chainlink CRE's decentralized verification — the vault only accepts DON-signed reports. This is the core security model: no single party (including the server) can bypass CRE consensus. Clone the repo to run the full flow locally.",
        proofTxHash: "0xb562a020d9a7574c1192a420cc827ead56045a9f6a95a566657898b6ae143dab",
        proofUrl: "https://basescan.org/tx/0xb562a020d9a7574c1192a420cc827ead56045a9f6a95a566657898b6ae143dab",
      }, { status: 501 });
    }

    // Local mode: run CRE CLI as before
    const httpPayload = JSON.stringify({ payee, borrowAmount, depositAmount });
    const reqUrl = new URL(req.url);
    const currentOrigin = `${reqUrl.protocol}//${reqUrl.host}`;
    patchAgentUrlInConfig(repoRoot, currentOrigin);

    const args = [
      "workflow", "simulate",
      "./workflows/borrowbot-borrow-and-pay",
      "-R", "./cre",
      "-T", "mainnet-settings",
      ...(broadcast ? ["--broadcast"] : []),
      "--non-interactive",
      "--trigger-index", "0",
      "--http-payload", httpPayload
    ];

    const repoEnv = loadDotEnvFile(path.join(repoRoot, ".env"));
    const env = { ...process.env, ...repoEnv };

    const startedAtMs = Date.now();
    const child = spawn(creBin, args, { cwd: repoRoot, env });

    const MAX = 24_000;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > MAX) stdout = stdout.slice(-MAX);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > MAX) stderr = stderr.slice(-MAX);
    });

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    const finishedAtMs = Date.now();
    const ok = exitCode === 0;
    return NextResponse.json({ ok, startedAtMs, finishedAtMs, exitCode, stdout, stderr }, { status: ok ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
