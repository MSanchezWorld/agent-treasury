AGENT TREASURY — DEMO VIDEO SCRIPT

Lines with arrows and ALL CAPS are NEW or CHANGED.
Everything else is your original script.

------------------------------------------------------------

SCENE 1 — COLD OPEN
[0:00 - 0:30]

"AI agents are about to become the biggest economic spenders in history."

"Not because they're reckless — because there will be billions of them, paying for compute, data, APIs, other agents. Every task costs money."

"But right now, they drain a pre-funded wallet to zero and stop. That's not intelligence. That's a vending machine."


------------------------------------------------------------

SCENE 2 — THE VISION / ANALOGY
[0:30 - 1:00]

"Think about how the wealthiest people in the world stay wealthy. They don't sell their assets to pay their bills. They hold Bitcoin, real estate, equities — things that appreciate — and they borrow against those assets to fund their lives. The assets keep growing. The cycle never breaks."

"The wealthy never sell. They borrow against what they own."

"Agent Treasury brings that same model to AI agents."


------------------------------------------------------------

SCENE 3 — SOLUTION + PROCESS OVERVIEW
[1:00 - 1:35]

"Here's how the cycle works. An agent deposits BTC, ETH, or USDC into its BorrowVault — supplied directly to Aave V3 as collateral. That collateral earns yield automatically. The treasury grows while the agent operates. No action needed."

"When the agent needs to spend, it proposes a spend plan — how much USDC to borrow, and who to pay. You review it and approve. The agent cannot move funds without human sign-off."

"Then Chainlink CRE takes over. A decentralized network of nodes independently verifies the plan. All nodes must reach consensus. No single point of trust. The signed report hits on-chain, 12 safety checks fire, Aave issues the debt, and USDC goes directly to the payee."

"Revenue comes back in. The treasury grows. The cycle repeats. The agent never sells, never stops."


------------------------------------------------------------

SCENE 4 — LIVE DEMO
[1:35 - 3:10]

"Let me show you end to end."

"Here's the Agent Treasury dashboard. You can see the vault — USDC deposited as collateral on Aave, currently earning yield. Health factor is sitting above 1.6x, which means we're holding 60% more collateral than debt at all times."

(Trigger the spend flow)

"I'm triggering a spend. The agent is proposing to borrow $1 USDC to a payee address. I've approved the plan."

vvv CHANGED — old said "vault nonce, paused state, current debt position" vvv
"Watch — the CRE workflow fires. It batches the on-chain reads — VAULT NONCE AND PAUSED STATE — single round-trip."
^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^

"It calls the agent's plan endpoint. Agent responds with the verified spend plan."

vvv CHANGED — old said "Allowlisted payee, amount within limits, correct nonce, safe health factor" vvv
"Now the DON — Chainlink's decentralized oracle network — verifies across multiple nodes. THE AGENT CAN'T ESCALATE THE AMOUNT, THE PAYEE AND ASSET MUST MATCH, AND THE NONCE MUST BE CORRECT. All nodes agree."
^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^

"Consensus reached. Signed report hits the BorrowBotReceiver on Base. 12 on-chain safety checks fire — allowlists, replay protection, expiry, cooldown, per-tx cap, daily cap, post-borrow health factor guard."

"All 12 pass. Aave issues variable-rate USDC debt. Payee balance just went up. Collateral is still in Aave, still earning yield. Vault nonce incremented — execution confirmed on-chain. The treasury is intact."

vvv NEW LINE vvv
"AND HERE'S WHAT MATTERS — THE DEPOSIT WENT STRAIGHT TO AAVE, NO PERMISSION NEEDED. BUT THE BORROW? THAT'S LOCKED. ONLY CHAINLINK CRE'S SIGNED CONSENSUS REPORT CAN TRIGGER IT. NOT THE SERVER. NOT EVEN THE WALLET OWNER. THAT'S THE WHOLE POINT."
^^^ ^^^ ^^^ ^^^

vvv NEW LINE — say as you click into Basescan vvv
"AND HERE'S THE PROOF."
^^^ ^^^ ^^^ ^^^

(Screen: click into Basescan tx 0xb562...3dab, show Success status, scroll to show USDC transfer to payee)

vvv NEW LINE — say while showing the Basescan transaction vvv
"THIS IS BASESCAN — BASE MAINNET'S BLOCK EXPLORER. THIS TRANSACTION IS A REAL BORROW-AND-PAY EXECUTION FROM THE VAULT. YOU CAN SEE THE CRE RECEIVER CALLED THE VAULT, AAVE ISSUED THE DEBT, AND ONE DOLLAR USDC WENT DIRECTLY TO THE PAYEE. SIX OF THESE EXECUTED SUCCESSFULLY. EVERY ONE VERIFIED BY CRE CONSENSUS."
^^^ ^^^ ^^^ ^^^


------------------------------------------------------------

SCENE 5 — SECURITY LAYERS
[3:10 - 3:40]

"Security is three layers deep — not one."

"The CRE workflow verifies the vault state, validates addresses, confirms the agent can't escalate the borrow amount, and requires DON consensus."

"The BorrowVault enforces 12 checks in Solidity — nonce, cooldown, caps, and a post-borrow health factor check that will literally revert the transaction if the collateral ratio drops below 1.6x."

"And underneath everything, Aave V3's own LTV and liquidation thresholds are enforced at the protocol level. The agent cannot over-leverage. It's protected by math and code, not promises."

vvv NEW LINE vvv
"IN PRODUCTION, THIS RUNS ON CHAINLINK'S DON — THEIR DECENTRALIZED ORACLE NETWORK — VERIFYING EVERY SPEND AUTOMATICALLY. WHAT YOU'RE SEEING IS THE SAME WORKFLOW, SAME CONTRACTS, SAME CHECKS. PRODUCTION-READY ARCHITECTURE ON PRE-RELEASE INFRASTRUCTURE."
^^^ ^^^ ^^^ ^^^


------------------------------------------------------------

SCENE 6 — CLI SIMULATION
[3:40 - 4:05]

"You can also run this entirely from the command line. One CRE CLI simulate command — you can watch the nodes process the trigger, the agent respond with the spend plan, consensus form, and the transaction fire. The full flow, end to end, no UI required."


------------------------------------------------------------

SCENE 7 — VISION + CLOSE
[4:05 - 4:35]

"Here's where this goes. Today — agents deposit, earn yield, borrow to pay allowlisted services, verified by CRE every time."

"Next: auto-spend below a threshold, no approval needed. Owner approval only for large or unusual spends. And x402 — instead of a pre-approved address, the agent pays any HTTP service that returns a 402. No accounts. No invoices. No API keys. Just money over HTTP, verified by Chainlink CRE."

"The endgame: the agent holds BTC and ETH. The assets appreciate. It borrows USDC to operate. It earns revenue and deposits it back. The treasury grows. The cycle runs forever."

"AI agents are going to be the biggest economic spenders in history. Agent Treasury makes sure they're also the smartest."

"Agent Treasury. Chainlink CRE. Aave V3. Live on Base."
