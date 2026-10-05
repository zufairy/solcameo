# Agent Economic Layer — Design

**Date:** 2026-06-03
**Status:** Draft for review
**Author:** zufairy (design via brainstorming)

**Scope:** The complete money flow for Vello agents — how investors invest, how the builder pays to mint, how the agent micro-pays Vello for every service it uses, how investors exit with profit, how the agent wallet is debited, and what happens when it runs out. Defines a single authoritative **agent economic account** (the "spine") that every flow reads and writes.

**Supersedes:** the `INVESTOR 50% / BUILDER 45% / PROTOCOL 5%` payout in
`2026-06-03-autonomous-agent-economy-loop-design.md`. Under this design, agent
earnings are **retained in escrow** (raising NAV) instead of being split out.
The autonomy loop, heartbeat, and `programs/vello-escrow` from that doc remain
the substrate this builds on.

---

## 1. Goals & success criteria

A minted agent is a self-funding micro-business with tradeable equity:

1. **Builder** pays a mint fee to Vello and receives a founder share allocation.
2. **Investors** deposit USDC and receive shares priced at the agent's current NAV (net asset value). Max **10%** of shares per investor.
3. The **agent earns** (campaign payouts, trading PnL, content rewards) — 100% flows into its escrow, raising NAV for all holders.
4. The **agent pays Vello** for each paid service it consumes (render, image-gen, LLM, posting, transcription) via a metered tab, settled on-chain in batches.
5. **Investors exit** anytime by redeeming shares for `shares × NAV` in USDC (minus a 2% exit fee that stays in escrow). No buyer needed; one investor's exit never harms the others' NAV.
6. The agent **can never go below zero**: if it can't cover a service, the service is denied and the agent is flagged `needs_funding` until topped up.

**Done when (per sub-project):** a minted agent has an economic account; an investor can buy and redeem shares at NAV with the exit fee applied; service calls are metered, gated, and batch-settled to the treasury; earnings raise NAV; and an agent with insufficient funds is suspended rather than going negative — all proven on **devnet** before any mainnet flip.

---

## 2. Locked design decisions

| Area | Decision |
|---|---|
| **Custody** | **Phased.** Phase 1: operator-custodial (platform holds the agent escrow key, encrypted at rest). Phase 2: migrate to PDA escrow program + locked upgrade authority (trustless). |
| **Exit / profit** | Vault / NAV redemption. Exit = burn shares → `shares × NAV` USDC. |
| **Exit fee** | 2% of gross redemption, **stays in escrow** (rewards remaining holders). Configurable; can be re-routed to treasury by changing one constant. |
| **Buy cap** | A single wallet may hold at most **10% of the agent's planned share supply** (`plannedSupply`, default 1,000,000 → 100,000 shares). Fixed denominator so bootstrapping works (the first buyer can take up to 10%, not 100%). |
| **Service billing** | Metered tab: each paid call logs a priced usage event off-chain; a keeper batch-settles the accrued tab on-chain (escrow → treasury) on a threshold or schedule. |
| **Insolvency** | Gate-and-suspend, no debt. Escrow can never be negative. |
| **Builder reward** | **15% of the agent's earnings**, minted as founder shares as the agent earns. **Zero founder shares at genesis** — investor principal is never diluted. Builder then profits via NAV like any holder. |
| **Vello revenue** | Mint fee + settled service tab **only**. No cut of agent earnings. |
| **Earnings** | Each earnings credit raises escrow (NAV ↑). The builder's 15% is taken **only from earnings**: on each credit, founder shares worth 15% of that credit are minted to the builder; the remaining ~85% accrues to existing holders. Investor principal (deposits) is never touched. |
| **Currency** | USDC for the economy (escrow, shares, NAV, fees). Mint fee denominated in USDC (was 0.5 SOL). |
| **Disclosure** | Phase-1 UI must state plainly that funds are operator-custodial (operator can move them). |

---

## 3. Actors & access model

| Actor | Can do | Cannot do |
|---|---|---|
| **Escrow** (Phase 1: platform-held wallet; Phase 2: program PDA) | Hold all USDC; source of truth for cash | — |
| **Keeper signer** (platform) | `settle_fee` up to the reported tab, rate-limited | (Phase 2) redeem, drain, or move funds anywhere but treasury-for-fees |
| **Operator / Vello admin** | Phase 1: full signing (custodial). Phase 2: run keeper, read mirrors | Phase 2: unilaterally seize agent funds |
| **Builder** | `deposit`, `redeem` own shares | Touch other holders' shares |
| **Investor** | `deposit`, `redeem` own shares | Exceed 10% holding; touch escrow directly |

**Honest custody statement:** In **Phase 1 the operator can take the funds** because the operator holds the keys. This is acceptable on devnet and for early testing; it is a custodial arrangement that **must be disclosed** to investors and re-evaluated (against securities / money-transmission / KYC-AML obligations) **before mainnet with real user funds**. Phase 2 (PDA + locked upgrade authority) is what makes "operator can't take it" provable.

---

## 4. The spine — Agent Economic Account (sub-project 1)

### 4.1 On-chain (cash custody)

- **Phase 1:** the agent's existing dedicated wallet holds USDC. **Fix now:** encrypt
  `agentWalletSecret` at rest using the existing `lib/server/walletCrypto.ts`
  `encryptWalletSecret()` / `decryptWalletSecret()` (today it is stored as plaintext
  base64). Wire `WALLET_ENCRYPTION_KEY` into the signing runtime.
- **Phase 2 (migration target):** extend `programs/vello-escrow` so the agent's
  USDC lives in a program-owned escrow PDA with instructions:
  `deposit` (→ authorize share mint), `redeem` (only the share-owner; burns shares),
  `settle_fee` (keeper-only, capped to reported tab, rate-limited),
  `credit_earnings` (deposit-like, no shares). The program rejects any debit that
  would take escrow below zero. Upgrade authority locked (or multisig+timelock).

### 4.2 Off-chain (authoritative accounting — Convex)

- **`agentAccount`** (one per agent): `mintAddress`, `sharesOutstanding`,
  `escrowUsdc` (mirror of on-chain), `liquidUsdc` (escrow not deployed in open
  positions), `unsettledTabUsdc`, `status` (`active | needs_funding | suspended`),
  `seedSharePrice`, `plannedSupply` (fixed buy-cap denominator, default
  `INITIAL_SHARE_SUPPLY`), `updatedAt`. `navPerShare` is derived, not stored.
- **`shareLedger`** (extends existing `investments`): `mintAddress`, `wallet`,
  `kind` (`buy | redeem | founder`), `shares` (signed), `navPerShare`,
  `usdcAmount`, `exitFeeUsdc?`, `txSignature`, `at`.
- **`usageLedger`** (new): `mintAddress`, `service`, `qty`, `unitPriceUsdc`,
  `costUsdc`, `settledBatchId?`, `at`.
- **`feeSettlements`** (new): `mintAddress`, `amountUsdc`, `coversUsageIds[]`,
  `txSignature`, `at`.

### 4.3 Invariants (enforced in code; Phase 2 also on-chain)

1. `navPerShare = (escrowUsdc − unsettledTabUsdc) / sharesOutstanding`; if `sharesOutstanding = 0`, NAV = `seedSharePrice` (default `$1.00`).
2. A paid service runs only if `(escrowUsdc − unsettledTabUsdc) ≥ price`. Else → `needs_funding`, autonomous paid actions pause.
3. A single wallet's holding may never exceed `BUY_CAP_PCT × plannedSupply` (default `0.10 × 1,000,000 = 100,000` shares) after a buy.
4. A redemption may never pull `escrowUsdc` below `unsettledTabUsdc` (Vello's owed fees are protected first).
5. On-chain escrow is source of truth for **cash**; Convex is source of truth for **shares + what's owed**. They reconcile on every on-chain settlement.

---

## 5. Money-in flows

### 5.1 Mint (builder → Vello) — sub-project 5
- Builder pays the mint fee (USDC) to treasury; mint route verifies the on-chain tx (extends current `app/api/nft/mint/route.ts`).
- Mint seeds an **empty** `agentAccount`: `sharesOutstanding = 0`, `escrowUsdc = 0`, `plannedSupply = INITIAL_SHARE_SUPPLY`, `status = active`. **No founder shares are minted at genesis** — an empty pool is seed-priced at `seedSharePrice` so the first investor buys at $1.00 and owns up to the 10% cap.
- Replaces the plaintext keypair with the encrypted-at-rest custodial key (Phase 1).

### 5.2 Investor buy — sub-project 2
- Investor sends USDC → escrow.
- `sharesMinted = depositUsdc / navPerShare`. Reject if it would push the wallet over `BUY_CAP_PCT × plannedSupply` (invariant 3) — suggest the max allowed amount instead.
- `sharesOutstanding += sharesMinted`; `escrowUsdc += depositUsdc`; `shareLedger` `buy` row.
- The influencer doc's `availableShares` / `sharePrice` become **derived** from the account (no longer hand-set).

### 5.3 Earnings in — sub-project 4
- All agent income routes into escrow (no 50/45/5 payout): campaign/submission payouts (`distribute-earnings` flips from "split out" to `credit_earnings`), trading realized PnL (settles back into escrow), content rewards.
- `credit_earnings(amount)`: `escrowUsdc += amount`. Then take the builder's cut **from this earnings only**: mint founder shares worth `FOUNDER_PCT × amount` to the builder (the agent's `creatorWallet`) at the post-credit NAV — i.e. `founderShares = (FOUNDER_PCT × amount) / navPerShare(afterCredit)`, written as a `founder` `shareLedger` row. Net effect: existing holders' NAV rises by ~85% of the earnings, the builder receives ~15% as new shares, and **no deposit/principal is diluted** (founder shares are created only against newly-earned value).

---

## 6. Money-out flows

### 6.1 Service metering + batch settlement — sub-project 3
- **Price book** `SERVICE_PRICES` (single config module): `render`, `image_gen`,
  `llm_message`, `social_post`, `transcription`, etc.
- A **`meter(service, qty)`** helper wraps each paid route (`video/render-step`,
  `generate-nft-images`, `agents/chat`, `social/post`, `transcribe-video`, …):
  gate-check (invariant 2) → if OK, write `usageLedger` + `unsettledTabUsdc += price`; else deny + `needs_funding`.
- **Keeper cron** (Convex scheduled): when `unsettledTabUsdc ≥ SETTLE_THRESHOLD` (e.g. $5) **or** daily, perform one `settle_fee` debit (escrow → treasury), write `feeSettlements`, mark covered `usageLedger` rows, zero the covered tab. This is the only action the keeper signer may take in Phase 2.

### 6.2 Redeem / exit — sub-project 2
- Holder redeems `sharesToBurn` (must own them):
  - `gross = sharesToBurn × navPerShare`
  - `exitFee = gross × EXIT_FEE_PCT` (default `0.02`) — **stays in escrow**
  - `payout = gross − exitFee` → sent to holder's wallet in USDC
  - `sharesOutstanding −= sharesToBurn`; `escrowUsdc −= payout` (fee remains, NAV ticks up for stayers)
  - `shareLedger` `redeem` row with `exitFeeUsdc`
- **Liquidity rule (mechanical, not a churn control):** pay from `liquidUsdc` immediately; if liquid is short (trader capital in open positions), pay the liquid portion now and settle the remainder as the keeper frees capital (position close / next earnings). Influencer agents are always liquid.
- Partial exits allowed. Builder founder shares redeem identically.
- Guard: redemption blocked if it would breach invariant 4.

---

## 7. Insolvency / gating — sub-project 3
- Pre-check in `meter()`: `(escrowUsdc − unsettledTabUsdc) < price` → deny the service, set `status = needs_funding`, pause autonomous paid actions, notify builder + investors to top up.
- Escrow ≥ 0 always (Phase 2: on-chain; Phase 1: enforced in the debit path). "Negative" is structurally impossible — a drained agent parks in `needs_funding`.
- A deposit or earnings credit that lifts spendable above the tab flips `status` back to `active`; autonomy resumes.

---

## 8. Worked example (sanity)

Agent: 1,000,000 shares, escrow $100,000 → NAV $0.10.
- Investor buys 10% = 100,000 shares for $10,000.
- Agent earns; escrow → $150,000 → NAV $0.15.
- Investor redeems all: gross $15,000, 2% fee $300 stays, **payout $14,700**. Profit +$4,700.
- After: 900,000 shares, escrow $135,300 → NAV **$0.1503** (ticked up from the retained fee). No other holder is harmed.
- If the agent had lost money (escrow $80,000 → NAV $0.08), redeem gross $8,000, fee $160, payout $7,840 — a real loss. The vault does not guarantee gains.

---

## 9. Revenue model
- **Vello earns:** mint fee (one-off, USDC) + settled service tab (ongoing).
- **Vello does not earn:** any cut of agent earnings or NAV.
- **Builder earns:** NAV appreciation on 15% founder shares.
- **Investor earns:** NAV appreciation on purchased shares.

---

## 10. Build sequencing (each its own spec → plan → build → devnet test)

1. **Spine** (this section 4): encrypt key at rest; `agentAccount` + `shareLedger` + `usageLedger` + `feeSettlements`; NAV/invariants; reconciliation. *Foundation for all others.*
2. **Invest & exit** (§5.2, §6.2): deposit→mint at NAV with 10% cap; redeem with 2% fee + liquidity rule.
3. **Service metering + keeper settlement** (§6.1, §7): price book, `meter()` wrappers, gate-and-suspend, batch settlement cron.
4. **Earnings-in migration** (§5.3): flip `distribute-earnings` and trader PnL to `credit_earnings`; retire 50/45/5.
5. **Mint + founder shares** (§5.1): USDC mint fee, founder allocation, escrow creation.
6. **Phase-2 trustless migration** (§4.1): PDA escrow instructions + locked authority. *Gated behind mainnet readiness.*

---

## 11. Mainnet readiness gate (do not skip)

Before any mainnet flip with real user funds:
1. All flows proven on **devnet** with automated tests (buy, earn, meter, settle, redeem, suspend, reconcile).
2. `WALLET_ENCRYPTION_KEY` configured; **no** plaintext secrets in the DB.
3. Idempotency + replay protection on every on-chain money-move (reuse the `processedSignatures` pattern).
4. Reconciliation job: Convex mirrors vs on-chain balances must match within tolerance; alert on drift.
5. **Legal/compliance review** of the custodial + share-offering model (securities, money transmission, KYC/AML). This is a business gate, flagged here so it is not forgotten.
6. (Recommended) external review/audit of any program code that moves real funds, especially before Phase 2.
7. **Verified entry points for money mutations.** `buyShares`/`redeemShares`/`markRedeemPaid` are currently public Convex mutations (consistent with the existing `influencers.invest` / `recordDeposit` pattern) whose safety relies on their calling route having verified the on-chain deposit/transfer. Before mainnet, move them behind a verified entry point — `internalMutation` invoked only from a verifying Convex action, or a shared-secret guard — so a client cannot mint/redeem shares (or stamp a payout signature) without a real, verified on-chain movement.
8. **Redeem idempotency.** `redeem-shares` burns shares then transfers; a client that retries a `502` (transfer-failed) POST would call `redeemShares` again and burn a second time. Add an idempotency key (client request id) consumed inside `redeemShares`, the way `consumeSignature` guards buys. Until then, the devnet operating rule is: do not retry a `502` redeem — reconcile the pending row (empty `txSignature`) and retry only the transfer.
9. **Mirror reconciliation wired to run.** `economyReconcile.checkAccount` exists but must be scheduled (cron) and extended to compare `escrowUsdc`/`liquidUsdc` against the real on-chain ATA balance, alerting on drift, before real funds accumulate.

---

## 12. Non-goals (this design)
- Secondary peer-to-peer share trading / order book (exit is via NAV redemption only).
- Lockup, daily redemption cap, formal redemption queue (explicitly declined; only the mechanical liquid-first settlement is kept).
- Fiat on/off-ramp.
- The autonomy/heartbeat loop itself (covered by `2026-06-03-autonomous-agent-economy-loop-design.md`; this design changes only where its earnings go).

---

## 13. Open questions / risks
- **Securities/compliance** (§11.5) — the biggest real-world risk; out of scope to solve in code but blocks mainnet.
- **NAV manipulation** — first-deposit seed price and rounding need care so early buyers can't be diluted/inflated; define share decimals and rounding direction (round shares **down** on buy, payout **down** on redeem — favors the pool).
- **Trader liquidity** — define `liquidUsdc` precisely from open-position accounting before sub-project 2 ships.
- **Phase-1 custodial trust** — disclosed, but real; minimize the window before Phase 2 for any agent holding meaningful funds.
