import {
  EVMClient,
  HTTPCapability,
  HTTPClient,
  Runner,
  consensusIdenticalAggregation,
  decodeJson,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  json,
  ok
} from "@chainlink/cre-sdk";
import {
  bytesToHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  parseAbiParameters
} from "viem";
import { z } from "zod";

const ConfigSchema = z.object({
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  receiverAddress: z.string(),
  vaultAddress: z.string(),
  borrowAsset: z.string(),
  planTtlSeconds: z.number().int().positive().default(300),
  gasLimit: z.string().min(1),
  agentUrl: z.string().default(""),
  agentSecret: z.string().default("")
});

type Config = z.infer<typeof ConfigSchema>;

// Minimal ABI for EVM reads.
const BorrowVaultAbi = [
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }]
  }
] as const;

const SpendRequestSchema = z.object({
  // Optional: override borrow asset; defaults to config.borrowAsset (USDC).
  borrowAsset: z.string().optional(),
  // Prefer providing borrowAmount as integer string in token units (e.g. USDC has 6 decimals).
  borrowAmount: z.union([z.string(), z.number()]),
  // Optional: UI-only "treasury deposit" amount in integer token units.
  // This does not affect onchain behavior in this MVP, but is passed into the agent input for decision context
  // and shown in CRE logs for demo transparency.
  depositAmount: z.union([z.string(), z.number()]).optional(),
  payee: z.string(),
  // Optional: if provided, overrides vaultNonce+1.
  planNonce: z.union([z.string(), z.number()]).optional()
});

type SpendRequest = z.infer<typeof SpendRequestSchema>;

type AgentPlan = {
  borrowAsset: string;
  borrowAmount: string;
  payee: string;
  // Optional: workflow will fill if missing.
  planNonce?: string;
  // Optional: workflow will fill if missing.
  planExpiresAt?: string;
};

function toBigInt(v: string | number) {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) throw new Error("Invalid number");
    return BigInt(v);
  }
  if (!/^[0-9]+$/.test(v)) throw new Error("Invalid numeric string");
  return BigInt(v);
}

function base64Json(obj: unknown) {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(obj));
  // Note: CRE HTTP capability expects body as base64.
  const hex = bytesToHex(bodyBytes);
  return hexToBase64(hex);
}

function validateAddress(label: string, addr: string) {
  if (!isAddress(addr)) throw new Error(`${label} is not a valid address: ${addr}`);
}

function validateConfig(cfg: Config) {
  validateAddress("receiverAddress", cfg.receiverAddress);
  validateAddress("vaultAddress", cfg.vaultAddress);
  validateAddress("borrowAsset", cfg.borrowAsset);
}

function decodeSpendRequest(payload: HTTPCapability.Payload): SpendRequest {
  const request = decodeJson(payload.input) as unknown;
  return SpendRequestSchema.parse(request);
}

function fetchAgentPlan(
  sendRequester: HTTPClient.SendRequester,
  agentUrl: string,
  input: unknown,
  agentSecret: string
): AgentPlan {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (agentSecret.trim()) headers["x-agent-secret"] = agentSecret.trim();

  const response = sendRequester
    .sendRequest({
    url: agentUrl,
    method: "POST",
    headers,
    body: base64Json(input)
  })
    .result();

  if (!ok(response)) {
    // `ok()` covers HTTP 2xx responses. For debugging, return status code too.
    throw new Error(`Agent request failed: statusCode=${response.statusCode}`);
  }

  return json(response) as AgentPlan;
}

function encodePlanReport(plan: {
  borrowAsset: string;
  borrowAmount: bigint;
  payee: string;
  planExpiresAt: bigint;
  planNonce: bigint;
}) {
  return encodeAbiParameters(
    parseAbiParameters("address borrowAsset, uint256 borrowAmount, address payee, uint256 planExpiresAt, uint256 planNonce"),
    [plan.borrowAsset as `0x${string}`, plan.borrowAmount, plan.payee as `0x${string}`, plan.planExpiresAt, plan.planNonce]
  );
}

const httpTrigger = new HTTPCapability().trigger({
  // For deployed workflows, use `authorizedKeys` to require signed requests.
  // For local simulation, this can remain empty.
  authorizedKeys: []
});

const httpClient = new HTTPClient();

function initWorkflow(cfg: Config) {
  validateConfig(cfg);

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: cfg.chainSelectorName,
    isTestnet: cfg.isTestnet
  });
  if (!network) throw new Error("Network not found for config.chainSelectorName");

  const evmClient = new EVMClient(network.chainSelector.selector);

  return [
    handler(httpTrigger, async (runtime, payload) => {
      const spendReq = decodeSpendRequest(payload);

      const borrowAsset = (spendReq.borrowAsset ?? cfg.borrowAsset).trim();
      const payee = spendReq.payee.trim();
      validateAddress("borrowAsset", borrowAsset);
      validateAddress("payee", payee);

      const requestedBorrowAmount = toBigInt(spendReq.borrowAmount);
      if (requestedBorrowAmount <= 0n) throw new Error("borrowAmount must be > 0");

      const requestedDepositAmount = spendReq.depositAmount != null ? toBigInt(spendReq.depositAmount) : 0n;

      // EVM reads: vault.nonce() and vault.paused() — issue both before calling .result()
      // so the CRE runtime can batch them into a single round-trip.
      const nonceCallData = encodeFunctionData({ abi: BorrowVaultAbi, functionName: "nonce" });
      const pausedCallData = encodeFunctionData({ abi: BorrowVaultAbi, functionName: "paused" });

      const nonceDeferred = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: "0x0000000000000000000000000000000000000000",
            to: cfg.vaultAddress,
            data: nonceCallData
          })
        });
      const pausedDeferred = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: "0x0000000000000000000000000000000000000000",
            to: cfg.vaultAddress,
            data: pausedCallData
          })
        });

      const nonceResp = nonceDeferred.result();
      const pausedResp = pausedDeferred.result();

      const currentNonce = decodeFunctionResult({
        abi: BorrowVaultAbi,
        functionName: "nonce",
        data: bytesToHex(nonceResp.data)
      }) as bigint;
      const paused = decodeFunctionResult({
        abi: BorrowVaultAbi,
        functionName: "paused",
        data: bytesToHex(pausedResp.data)
      }) as boolean;

      if (paused) throw new Error("Vault is paused");

      const nextNonce = currentNonce + 1n;
      const planNonce = spendReq.planNonce ? toBigInt(spendReq.planNonce) : nextNonce;
      if (planNonce !== nextNonce) {
        throw new Error(`Invalid planNonce: expected ${nextNonce.toString()} got ${planNonce.toString()}`);
      }

      const now = runtime.now();
      const planExpiresAt = BigInt(Math.floor(now.getTime() / 1000) + cfg.planTtlSeconds);

      // Plan assembly: call external agent (preferred for hackathon), or deterministic default plan.
      let plan: AgentPlan;
      if (cfg.agentUrl && cfg.agentUrl.trim().length > 0) {
        const agentInput = {
          spendRequest: {
            borrowAsset,
            borrowAmount: requestedBorrowAmount.toString(),
            payee
          },
          treasuryPlan: {
            depositUsdc: requestedDepositAmount.toString()
          },
          vault: {
            address: cfg.vaultAddress,
            currentNonce: currentNonce.toString()
          }
        };

        plan = httpClient
          .sendRequest(runtime, fetchAgentPlan, consensusIdenticalAggregation<AgentPlan>())(
            cfg.agentUrl.trim(),
            agentInput,
            cfg.agentSecret
          )
          .result();
      } else {
        plan = {
          borrowAsset,
          borrowAmount: requestedBorrowAmount.toString(),
          payee
        };
      }

      // Final validation (do not trust the agent).
      validateAddress("plan.borrowAsset", plan.borrowAsset);
      validateAddress("plan.payee", plan.payee);

      const planBorrowAmount = toBigInt(plan.borrowAmount);
      if (planBorrowAmount <= 0n) throw new Error("plan.borrowAmount must be > 0");

      // Agent must not escalate spend beyond the requested amount.
      if (planBorrowAmount > requestedBorrowAmount) {
        throw new Error(`plan.borrowAmount too high: requested=${requestedBorrowAmount} got=${planBorrowAmount}`);
      }
      if (plan.borrowAsset.toLowerCase() !== borrowAsset.toLowerCase()) {
        throw new Error("plan.borrowAsset mismatch");
      }
      if (plan.payee.toLowerCase() !== payee.toLowerCase()) {
        throw new Error("plan.payee mismatch");
      }

      const reportHex = encodePlanReport({
        borrowAsset: plan.borrowAsset,
        borrowAmount: planBorrowAmount,
        payee: plan.payee,
        planExpiresAt,
        planNonce
      });

      const report = runtime
        .report({
          encoderName: "evm",
          encodedPayload: hexToBase64(reportHex),
          signingAlgo: "ecdsa",
          hashingAlgo: "keccak256"
        })
        .result();

      const writeRes = evmClient
        .writeReport(runtime, {
          receiver: cfg.receiverAddress,
          report,
          gasConfig: {
            gasLimit: cfg.gasLimit
          }
        })
        .result();

      runtime.log(`writeReport txStatus=${writeRes.txStatus} receiver=${cfg.receiverAddress}`);

      return {
        statusCode: 200,
        body: `OK txStatus=${writeRes.txStatus}`
      };
    })
  ];
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema: ConfigSchema });
  await runner.run(initWorkflow);
}
