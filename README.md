# Agent Treasury — Self-Sustaining AI Agent Treasuries

**AI agents that hold crypto, earn yield, and borrow to spend — forever.**

Agent Treasury uses [Chainlink CRE](https://chain.link/cre) and [Aave V3](https://aave.com/) on Base to give AI agents their own self-sustaining treasuries. An agent deposits BTC & ETH, earns yield automatically, and borrows USDC to pay for what it needs — compute, data, APIs, other agents. Revenue goes back into the treasury. The cycle repeats. The agent never sells, never stops.

**Live on Base mainnet.**

> The wealthy never sell — they borrow against what they own. Agent Treasury brings that model to AI agents.

---

## The Cycle

```
     Deposit BTC/ETH/USDC
              |
              v
    +-------------------+
    |  Agent Treasury    |  <-- Collateral earns yield on Aave V3
    |  (BorrowVault)     |
    +-------------------+
              |
        Borrow USDC
              |
              v
    +-------------------+
    |  Pay for Services  |  <-- Compute, data, APIs, other agents
    +-------------------+
              |
        Earn Revenue
              |
              v
    +-------------------+
    |  Deposit Back      |  <-- Treasury grows, cycle repeats
    +-------------------+
```

1. **Deposit** — Agent deposits USDC into its BorrowVault, supplied to Aave V3 as collateral (optionally swap into WETH + cbBTC for diversified yield).
2. **Earn** — Collateral earns yield automatically. The treasury grows while the agent operates.
3. **Propose** — Agent submits a spend plan: how much USDC to borrow, who to pay. Owner approves.
4. **Verify** — CRE's decentralized DON independently verifies the plan. All nodes must reach consensus.
5. **Pay** — BorrowVault borrows USDC from Aave and sends it directly to the payee. 12 on-chain safety checks enforced.
6. **Repeat** — Agent earns revenue, deposits it back. Assets appreciate. The cycle runs forever.

---

## Architecture

```
 Agent Request           Chainlink CRE DON              Base Mainnet
      |                        |                             |
      v                        v                             v
 +---------+    +----------+    +--------------+    +------------+
 | Agent   | -> | CRE      | -> | Receiver     | -> | Borrow     |
 | Server  |    | Verify   |    | Decode DON   |    | Vault      |
 | /plan   |    | + Sign   |    | Report       |    | 12 Checks  |
 +---------+    +----------+    +--------------+    +------------+
                                                          |
                                                    Aave V3 Borrow
                                                          |
                                                          v
                                                    +-----------+
                                                    | Payee     |
                                                    | Gets USDC |
                                                    +-----------+
```

**Flow:** HTTP trigger -> CRE workflow reads vault state (batched) -> agent proposes spend plan -> DON nodes verify + reach consensus -> signed report on-chain -> BorrowBotReceiver decodes -> BorrowVault enforces 12 checks -> Aave V3 borrow -> USDC to payee.

---

## 12 On-Chain Safety Checks

Every borrow passes through all of these — enforced in the BorrowVault contract:

| # | Check | What It Does |
|---|-------|--------------|
| 1 | Not paused | Owner can freeze the vault instantly |
| 2 | Executor only | Only the CRE Receiver contract can trigger borrows |
| 3 | Borrow token allowlisted | Only approved tokens (USDC) can be borrowed |
| 4 | Payee allowlisted | Only approved recipients can receive funds |
| 5 | Amount > 0 | No empty borrows |
| 6 | Plan not expired | Plans expire after 5 minutes — no stale executions |
| 7 | Nonce check | Monotonic nonce prevents replay attacks |
| 8 | Cooldown | Configurable delay between executions |
| 9 | Per-tx cap | Max $100 per borrow — no outsized risk |
| 10 | Daily cap | Max $200 per day — hard-limited on-chain |
| 11 | Health factor >= 1.6x | Post-borrow check — vault always holds 60% more collateral than debt |
| 12 | Reentrancy guard | Prevents reentrancy attacks |

---

## Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| BorrowVault | [`0x943b828468509765654EA502803DF7F0b21637c6`](https://basescan.org/address/0x943b828468509765654EA502803DF7F0b21637c6) |
| BorrowBotReceiver | [`0x889ad605dE1BB47d4Dd932D25924dDF53b99a279`](https://basescan.org/address/0x889ad605dE1BB47d4Dd932D25924dDF53b99a279) |
| USDC (Base) | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |

---

## Project Structure

```
agent-treasury/
  apps/
    web/          # Next.js marketing site + interactive demo
    agent/        # HTTP agent server (CRE calls /plan for spend proposals)
  packages/
    contracts/    # Solidity: BorrowVault, BorrowBotReceiver, Aave interfaces
  cre/
    workflows/    # Chainlink CRE workflow (TypeScript -> WASM)
    project.yaml  # CRE RPC configuration
```

---

## Quick Start

```bash
# Install
git clone https://github.com/MSanchezWorld/agent-treasury.git
cd agent-treasury
yarn install

# Configure
cp .env.example .env
# Edit .env with your keys

# Compile contracts
yarn contracts:compile

# Deploy to Base mainnet
yarn contracts:deploy:base
yarn contracts:configure:base

# Deposit collateral
yarn contracts:deposit:base

# Start agent server (terminal 1)
yarn agent:dev

# Start marketing site (terminal 2)
yarn web:dev
```

### CRE Workflow

Compile TypeScript to WASM:
```bash
cd cre/workflows/borrowbot-borrow-and-pay
bun --bun node_modules/@chainlink/cre-sdk-javy-plugin/bin/setup.ts
```

Simulate with broadcast:
```bash
~/.cre/bin/cre workflow simulate ./workflows/borrowbot-borrow-and-pay \
  -R ./cre \
  -T mainnet-settings \
  --broadcast \
  --non-interactive \
  --trigger-index 0 \
  --http-payload '{"payee":"0x...","amount":"1000000"}'
```

---

## Chainlink CRE Integration

All files that use Chainlink CRE:

| File | Role |
|------|------|
| [`cre/project.yaml`](cre/project.yaml) | CRE project config + RPC targets |
| [`cre/workflows/borrowbot-borrow-and-pay/main.ts`](cre/workflows/borrowbot-borrow-and-pay/main.ts) | **Core workflow**: HTTP trigger, batched EVM reads, agent call, EVM writeReport |
| [`cre/workflows/borrowbot-borrow-and-pay/workflow.yaml`](cre/workflows/borrowbot-borrow-and-pay/workflow.yaml) | Workflow target mapping (triggers, actions, consensus) |
| [`cre/workflows/borrowbot-borrow-and-pay/config.mainnet.json`](cre/workflows/borrowbot-borrow-and-pay/config.mainnet.json) | Runtime config (contract addresses, gas limit, agent URL) |
| [`packages/contracts/contracts/BorrowBotReceiver.sol`](packages/contracts/contracts/BorrowBotReceiver.sol) | On-chain CRE receiver — validates DON signature, decodes report, calls vault |
| [`packages/contracts/contracts/cre/ReceiverTemplate.sol`](packages/contracts/contracts/cre/ReceiverTemplate.sol) | CRE forwarder validation + metadata decoding base contract |
| [`packages/contracts/contracts/cre/IReceiver.sol`](packages/contracts/contracts/cre/IReceiver.sol) | CRE receiver interface |
| [`packages/contracts/scripts/deployBorrowBotBase.ts`](packages/contracts/scripts/deployBorrowBotBase.ts) | Deployment script — configures CRE forwarder address |
| [`packages/contracts/scripts/configureBorrowBotBase.ts`](packages/contracts/scripts/configureBorrowBotBase.ts) | Post-deploy config — sets executor (CRE receiver) on vault |
| [`apps/agent/server.mjs`](apps/agent/server.mjs) | Agent HTTP server — CRE workflow calls `/plan` for spend proposals |

---

## Gas Optimizations

- **Immutable pool address** — Aave pool cached as `immutable` in constructor, saving an external call per function
- **Single HF check** — Post-borrow health factor check only (pre-borrow is redundant since borrowing can only lower HF)
- **forceApprove** — Single-call approve with fallback for USDT-like tokens
- **Batched EVM reads** — CRE workflow issues nonce + paused reads before resolving, enabling single round-trip
- **Optimizer runs: 10,000** — Optimized for runtime gas over deployment gas
- **Gas limit: 500k** — Reduced from 1.4M after optimization

---

## Scripts Reference

| Command | What It Does |
|---------|-------------|
| `yarn contracts:deploy:base` | Deploy BorrowVault + BorrowBotReceiver |
| `yarn contracts:configure:base` | Configure allowlists, policy, executor |
| `yarn contracts:deposit:base` | Deposit USDC as collateral |
| `yarn contracts:deposit-swap:base` | Deposit USDC, swap to WETH+cbBTC |
| `yarn contracts:repay:base` | Repay borrow debt |
| `yarn contracts:withdraw:base` | Withdraw collateral |
| `yarn contracts:reset-aave:base` | Full reset (repay all + withdraw all) |
| `yarn contracts:swap-to-usdc:base` | Swap collateral back to USDC |

---

## What's Next: x402 Payments

Today the agent pays an allowlisted address directly. With [x402](https://www.x402.org/), any HTTP service can require payment via the standard 402 status code. The agent borrows USDC from its treasury and pays per-request — no accounts, no API keys, no invoices. Just money over HTTP, verified by Chainlink CRE.

---

## Tech Stack

- **Solidity** — BorrowVault + BorrowBotReceiver (Aave V3)
- **Chainlink CRE** — Decentralized workflow execution (TypeScript -> WASM)
- **Aave V3** — Lending + borrowing on Base
- **Base** — L2, ~2s blocks, low gas
- **Next.js 15** — Marketing site + demo
- **Hardhat** — Contract compilation + deployment
- **viem** — TypeScript Ethereum library

---

## License

MIT

---

Built by Miguel Sanchez
