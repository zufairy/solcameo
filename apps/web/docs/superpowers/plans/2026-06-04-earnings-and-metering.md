# Earnings-in + Service Metering — Implementation Plan (sub-projects 3 & 4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Complete the agent economy's two remaining flows: (4) agent earnings raise NAV and mint the builder's 15%-of-earnings founder shares; (3) the agent pays Vello per service via a metered tab that gate-and-suspends and batch-settles to the treasury.

**Spec:** `docs/superpowers/specs/2026-06-03-agent-economic-layer-design.md` §5.3 (earnings), §6.1 + §7 (metering/insolvency).

**Depends on:** spine + SP2 + SP5 (committed).

---

## Sub-project 4 — Earnings in (escrow + founder shares)

### Task 4.1: founder-share math in `lib/economy/nav.ts`
`founderSharesForEarnings({ amount, navAfterEscrow, founderPct? })` = `floorTo((founderPct ?? FOUNDER_PCT) * amount / navAfterEscrow, SHARE_DECIMALS)`. Throws if navAfterEscrow ≤ 0. Tests for the formula.

### Task 4.2: `convex/earnings.ts` — `creditEarnings` mutation
Credits escrow and mints the builder's founder shares from the earnings only. Tested.

### Task 4.3: flip `distribute-earnings` to credit escrow
Replace the 50/45/5 payout with a single `creditEarnings` call (escrow + founder), retiring the split. Typecheck + note.

---

## Sub-project 3 — Service metering + keeper settlement

### Task 3.1: `lib/economy/servicePrices.ts` — price book
`SERVICE_PRICES` (USDC) for `render`, `image_gen`, `llm_message`, `social_post`, `transcription`; `priceFor(service, qty)`. Tests.

### Task 3.2: `convex/usage.ts` — `recordUsage` mutation (gate + tab)
Gate on spendable ≥ cost; if ok append `usageLedger` + `unsettledTabUsdc += cost`; else set `status = needs_funding` and throw. Re-activate from `needs_funding` when spendable recovers (on a later successful gate). Tested.

### Task 3.3: `convex/usage.ts` — `settleTab` mutation + `markSettlementPaid`
Sum unsettled usage; insert `feeSettlements` (pending), mark those usage rows `settledBatchId`, decrement escrow + liquid by the amount. `markSettlementPaid` stamps the on-chain txSignature. Tested. (The actual escrow→treasury transfer + a keeper cron are integration follow-ups, documented.)

Full per-route `meter()` wrapping of every paid route and the on-chain settlement transfer are integration rollout — out of scope for the accounting core here, flagged in the report.
