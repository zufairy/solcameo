# Vello View-Delta Reward Payout Engine — Final Hardened Implementation Spec

**Date:** 2026-06-30 · **Status:** Implement-ready (Phase 0 ships today) · **Author:** lead eng
**Builds on:** the shipped content-reward view-sync MEASUREMENT layer (`contentRewardMeasurements` + `/api/oracle/measure-views`).
**Supersedes:** the 2026-06-30 draft spec. This version folds in the full adversarial review; where the draft and a finding conflict, the finding wins unless noted.

---

## 1. Summary

We add a **reward-on-view-delta** engine on top of the existing, money-decoupled view-sync layer. Today `/api/oracle/measure-views` re-reads each content-reward clip's live view count ≈3×/day and backfills the jobtepi display row — it computes no delta and pays nothing. This engine extends that worker so that, **for Vello/Ryze-operated campaigns only**, each sync computes the **confirmed view difference since the last paid sync**, multiplies it by a **scale-exact effective rate**, **debits a scaled-down RM treasury inside one serializable mutation**, and writes an auditable RM payout ledger. It is additive: the USDC rail, `submissions`, `distributions`, the on-chain claim keeper, and user-deposited campaigns are never touched. Everything runs on the **custodial Convex ledger** (the on-chain escrow rail is dead — §3) and is structured so on-chain USDC can REPLACE it later (§6, §12-Phase 3).

### 1.1 What is REAL vs ASPIRATIONAL in v1 (read this first — Finding 11)

> **v1 is a Convex integer ledger. There is NO blockchain, NO wallet, NO private keys, NO USDC, and NO automatic disbursement in v1.** The "treasury" is a single integer field `realBalanceSen` in a new Convex table. When a sync "pays," the engine **records an owed-RM obligation (an IOU) and decrements an accounting integer** — it does **not** move any real money on-chain or to a bank. Vello already holds the real RM ("the money is at me already"); actual cash reaches Mimie's agent team **out-of-band** (manual bank transfer), tracked by `markSettled` (Phase 2).
>
> Therefore, throughout this spec:
> - **"pay / debit the treasury"** = *record a debit against an off-system RM accounting balance and append an owed-RM ledger tranche.*
> - **"reward straight away"** = *accrue and record the owed delta on the next sync after the views have been confirmed-persistent (§4); the real cash payout is manual/out-of-band.*
> - The owner's **"link it to blockchain"** is **NOT satisfied in v1** and is explicitly deferred to Phase 3 (blocked on the dead escrow IDL — §3, §6).
>
> `realBalanceSen` is an **accounting cap, not a custody/solvency proof**. `fundingRef`/`realDepositedSen` are an **UNVERIFIED admin claim of funds**, not a verified balance. Admin-token or `INTERNAL_CRON_SECRET` compromise = **unbounded fake debt that can flow to real bank transfers** (mitigations: §10.4, Invariant I10).

---

## 2. Goals / Non-goals

**Goals**
- On each sync, accrue `reward = (Δ confirmed views / 1000) × effectiveRate` and record it as owed, drawn from a per-campaign scaled real treasury — with a **confirmation window** so transient/purged spikes are never paid (Finding 1).
- **Scale down coherently:** represent a large nominal budget (RM5000) with a small real pot (RM50) and a scale-exact effective rate (RM0.20/1k) such that **views-to-exhaust is identical** nominal vs real (§6, Invariant I5).
- Work **today** on the Convex custodial ledger; no dependency on the dead escrow IDL.
- Give the campaign owner a **first-class, engine-driven** view of real progress (RM paid, confirmed views rewarded, last-paid time, treasury status) that is provably equal to `scaleFactor × real spend` (Findings 2, 9, 13, 31, 35) — **not** the legacy raw-view-times-nominal-rate number.
- Admin (Mimie/Vello) controls: create/fund/scale/pause/seed/complete a treasury, Sync Now, see who is owed (paid-unsettled **and** accrued-unpaid), mark off-system settlements with a second approver.

**Non-goals**
- **User-deposited campaigns keep STRICT deposit enforcement.** This engine is a hard no-op for any campaign without an admin-created, owner-verified, allowlisted treasury (§8). It never alters the USDC rail (`campaigns.markVerified`, `computePayoutUsdc`, `getFundedByContentRewardId`), `submissions`, `distributions`, `earnings`, the fraud scorer config of `/api/oracle/run`, or the on-chain claim keeper.
- No RM↔USDC conversion is introduced or stored. The engine is **RM-native** (Finding 27 forbids smuggling an FX rate through the on-chain seam — see §6.4).
- No automatic cash disbursement. The engine **records** owed RM auditably; payout is out-of-band (§1.1).

---

## Adversarial hardening — decisions

Every **critical** and **high** finding and exactly how this spec resolves (or defers) it. Section references are to this spec.

| # | Sev | Issue (short) | Resolution in this spec | §|
|---|---|---|---|---|
| F1 | CRIT | Peak high-water + no maturation + no-clawback pays transient/purged spikes permanently | **Pay only `confirmedViews` = min over a trailing `confirmWindowHours` (default 24h) window**; high-water is taken on the *confirmed* series, so an unconfirmed spike is never accrued → no clawback needed. Per-sync view cap smooths bursts. | §4.2, §4.3 |
| F2 | CRIT | Real engine subtracts baseline; owner display doesn't → phantom 100% while pot pays 0 | **Owner-facing paidOut/progress is DRIVEN BY THE ENGINE**: `nominalPaidSen = scaleFactor × Σ paidSen`, `progress = nominalPaidSen / nominalBudgetSen`. Equal to `scaleFactor × real spend` by construction (Invariant I4). Legacy `views×nominalRate` path is overridden for treasury-backed campaigns. | §9 |
| F3 | CRIT | Pre-rounded `effectiveRate` rounds to 0 (silent non-pay) and breaks scale-invariance | **Never materialize a rounded rate.** Carry the rational `(nominalRateSenPer1k, scaleFactor)`; accrue with integer math `addSen = floor((Δviews × nominalRateSenPer1k + remainder)/(1000×scaleFactor))` carrying `remainder`. `effectiveRateMillisenPer1k` stored for DISPLAY only; **upsert rejects any config where it floors to 0**. | §4.3, §6 |
| F4 | CRIT | Owed-RM ledger is an unguarded real-money instruction: no audit, no clamp, no dual control, no proof-of-funds | **Mandatory** immutable `treasuryAudit` row on every create/topup/rate-edit/scale-edit/seed/settle; sanity clamps (scaleFactor≥1 ⇒ effective≤nominal; reject effective=0; per-sync caps); `fundingRef` required + labeled UNVERIFIED; **second-actor approval on `markSettled`** (Phase 2); explicit compromise caveat. | §10.4, I9, I10 |
| F5 | HIGH | Fraud soft-flags still return `approved` → bot syncs auto-paid at scaled pot size | **Money path treats ANY softFlag as non-payable**: `eligibleDecision` requires `decision==='approved' && softFlags.length===0`. Flagged rows set `heldForReview`, accrue nothing, wait for admin approval. Scale-aware **per-sync** and **per-day** view caps added. | §4.4, §8, §11 |
| F6 | HIGH | Rate increase retroactively repays ALL historical views | **Accrual is incremental**: each sync adds only `Δconfirmed × rateNow`; cumulative `accruedSen`/`rewardedViews` never recomputed against a new rate. A rate edit is genuinely prospective; a cut never erases already-accrued unpaid debt. | §4.3, §10.3 |
| F7 | HIGH | `peers:[]` + cross-platform = same clip billed N× | Money path **populates `peers`** with co-campaign submissions (enables duplicate hard-reject), **and** a per-`(contentRewardId, contentKey)` **lifetime-paid-views high-water** (`contentRewardPaidContent`) caps billable views so the same content can't be re-billed across submissions/platforms. | §4.5, §5.5, §8 |
| F8 | HIGH | Pure-fn signature invites reading balance/eligibility OUTSIDE the txn → lost-update overspend + double-rail | The mutation reads treasury balance, row accounting, funded-vault XOR, paid-content **all in-txn**. Worker passes ONLY `{id, measuredViews, decision, softFlags, contentKey, measuredAt}`. `computePostAccrual` returns *desired accrual*, never consumes a worker-supplied balance; the **campaign-batched mutation** owns allocation. Regression test asserts worker-supplied balance is impossible. | §4, §7.2, §12 |
| F9 | HIGH | Display backfill unconditional → owner sees climbing progress after pot is empty | Owner progress is engine-driven (F2), so it **plateaus** when `paidSen` stops; treasury `status` (`exhausted`/`paused`/`completed`) is shown as a badge. Raw view count may keep syncing for measurement but **does not drive progress**. | §9 |
| F10 | HIGH | One viral post drains the shared pot; `max_payout`/`flat_fee_bonus`/`min_payout` ignored | **Per-post accrual cap** `perPostMaxAccrualSen = floor(max_payout×100/scaleFactor)`; **campaign-level pro-rata** when balance < total owed (no single post monopolizes). `flat_fee_bonus`/`min_payout` **explicitly excluded** from real accrual and excluded from the engine-driven owner display (so no real-vs-display divergence). | §4.5, §4.6, §9 |
| F11 | HIGH | "Real treasury / blockchain / pay straight away" over-promises a DB integer | §1.1 "REAL vs ASPIRATIONAL" subsection added; wording corrected throughout; "link to blockchain" explicitly deferred to Phase 3. | §1.1, §6, §12 |
| F12 | HIGH | §6 on-chain "seam" contradicts §8 XOR; it's a REPLACEMENT, not a mirror | §6.4 reframes: turning on chain = create a **small real scaled USDC campaign on the EXISTING rail**, which flips `getFundedByContentRewardId` non-null and **retires** the RM engine for that campaign (the §8 XOR). No "mirror tranches." Hard prerequisites (regen/deploy IDL, init vaults) stated as **blocked/pending**. | §6.4, §8, §12 |
| F13 | HIGH | "Owner sees progress" is byte-identical whether or not the engine ever paid | Pre-existing nominal display is explicitly declared **NOT evidence the algo works**. A first-class **engine-driven** owner panel (real Δviews/paidSen, last-paid, status) is the only "it's working" signal; algo correctness verified via that panel + tests. "No UI change required" claim **retracted**. | §9, §12 |
| F14 | HIGH | Scope guard is one free-text UUID; the secondary funded-vault guard is inert in prod | `upsert` **captures and stores `operatorUserId = content_rewards.created_by`** and **refuses** unless it's on the `VELLO_OPERATED_CREATED_BY` allowlist (loud typed-confirm override, audited). Structural boundary, not admin discipline. | §8, §10.2 |
| F15 | HIGH | Eligibility is campaign-scoped, not submitter-scoped → external clippers paid from the pot | Treasury stores **`agentMints` allowlist**; money branch requires `row.mintAddress ∈ agentMints`. Non-allowlisted submissions measure-for-display, pay 0. | §8, §4.4 |
| F16 | HIGH | Nominal budget is never a payout clamp → debits past owner's 100% | Treasury tracks **`nominalPaidSen`**; `paySen ≤ floor(nominalBudgetSen/scaleFactor) − Σpaid`; at nominal exhaustion `status='completed'` and accrual stops. Eligibility also gated on Supabase `content_reward.status` (skip closed/paused). FLOOR everywhere. | §4.6, §8 |
| F17 | HIGH | First-sync baseline silently pays 0 for backlog (default) or instant-drains (`false`) | **Removed the per-sync pay-from-0 path entirely.** First reward sync ALWAYS baselines at the confirmed count and pays 0. Backlog is paid ONLY via an explicit, bounded, audited admin **`seedBacklog`** action (clamped to real balance + nominal remaining + lifetime high-water). Pre-treasury views being unpaid is documented for owner sign-off. | §4.2, §10.3 |
| F18 | HIGH | 30-day MAX_AGE stop forfeits the final accrual window and freezes the view count | **Treasury-backed rows are exempt from `MEASURE_MAX_AGE_DAYS`** while the treasury is `active`; they keep measuring + paying. When the treasury completes/exhausts, a final measure+pay runs before the row stops. Any residual unpaid is surfaced in the owed report, never silently dropped. | §4.7, §11 |

**Conflicts resolved (where two findings pulled opposite directions):**
- **F1 (confirmation lag) vs F35 (don't let display regress) vs F17 (baseline at peak):** unified — accrual uses a **confirmed, monotonic high-water** basis; owner display is engine-driven off that basis (monotonic); first sync baselines at the confirmed count. All three satisfied without clawback.
- **F3 (don't materialize rate) vs F16/F36 (FLOOR the rate):** F3 wins and subsumes them — no materialized rate at all; FLOOR is applied to the *accrual* via exact rational integer math.
- **F6/F32 (prospective/incremental) vs F3 (cumulative floor):** unified — **incremental** accrual with a **carried remainder** gives both prospective-rate semantics AND dust-exact totals.
- **F8 (read in-txn) vs F21 (single writer per treasury) vs F34/F38 (fair allocation):** unified by a **single campaign-batched mutation** per treasury per run that reads in-txn, loops its rows, and allocates pro-rata.
- **F39 (settlement subsystem is scope creep) vs F25/F28/F29 (owed report must be richer):** keep the ledger + a richer read-only owed report in Phase 0 (needed for idempotency + honesty); defer `markSettled`/second-actor/operator-rollup to Phase 2; defer on-chain to Phase 3.
- **F9 (freeze display when broke) vs owner "see progress":** don't freeze — show an explicit `paused/exhausted/completed` **status badge** while the engine-driven progress naturally plateaus.

**Medium/low findings — folded as cheap hardening:**

| # | Sev | Folded as | § |
|---|---|---|---|
| F19 | MED | `contentRewardPayouts`/`owedByMint` (effective sen) is the **sole** settlement source; admin panel shows effective owed prominently; test asserts no "pay Mimie" surface multiplies by nominal rate | §9, §10 |
| F20 | MED | Repost re-pay closed by removing pay-from-0 (F17) + lifetime-paid-views high-water (F7) | §4.5, §10.3 |
| F21 | MED | Single campaign-batched mutation removes the per-treasury OCC hotspot; per-row unpaid surfaced in Sync Now summary | §7 |
| F22 | MED | **Single-flight lease** (`measureRun` doc, TTL); Sync Now disabled while a run holds the lease | §5.6, §7.4 |
| F23 | MED | Debit + ledger insert share ONE gate: **trancheKey looked up FIRST**; if present, pay/debit nothing | §7.3 |
| F24 | MED | **Concurrency tests** mandated (overlapping mutations; Σtranche==accrued; balance≥0; one tranche per level) | §12 |
| F25/F28 | MED | `owedByMint` returns `paidUnsettledSen` AND `accruedUnpaidSen` distinctly; nothing silently dropped | §10.5 |
| F26 | MED | **Input validation** (all integers > 0; reject effective=0; `Number.isFinite` asserts; reject negative `addSen`) | §6.3, §10.2 |
| F27 | MED | On-chain seam reframed as RM-pegged-unit OR explicit audited FX; "conversion-free swap" claim dropped | §6.4 |
| F29 | MED | Owed report rolls up to `operatorWallet` (named payee); custody caveat that mint→human is undefined and keys are devnet-plaintext | §10.5, I10 |
| F30 | MED | Nominal-display mask restricted to **Vello-owned** treasuries via `operatorUserId` (F14); external-owned never gets a scaled treasury | §8, §9 |
| F31 | MED | Baseline trade-off surfaced for owner sign-off; `seedBacklog` gives the demo controlled motion; engine panel shows real per-sync motion | §9, §10.3 |
| F33 | MED | Pause **re-baselines at confirmed count on resume** (forfeits the paused gap by default, admin-overridable); per-sync cap prevents catch-up dumps | §4.7, §10.3 |
| F34/F38 | MED/LOW | Campaign-level **pro-rata** allocation when balance < total owed; deterministic remainder tie-break (not stable first-come) | §4.6, §7.2 |
| F35 | MED | Display is engine-driven off the monotonic confirmed basis → never regresses | §9 |
| F36 | LOW | Subsumed by F3 (rational rate, reject effective=0) | §6 |
| F37 | LOW | Tranche stores `accruedDeltaSen` + `paidSen` + `backlogPaidSen` separately → row-level tie-out | §5.4 |
| F39 | LOW | Phasing: settlement + on-chain deferred to Phase 2/3 | §12 |

---

## Invariants

Money invariants that MUST always hold, and how each is enforced. Each has a corresponding test in §12.

- **I1 — Never pay twice for the same view.**
  Enforced by: (a) accrual is incremental on `rewardedViews` which only advances; (b) `paidSen` is monotonic non-decreasing per row; (c) tranche idempotency `trancheKey = ${submissionId}:${newPaidSen}` with `by_tranche` lookup **before** any debit (§7.3); (d) cross-submission/cross-platform double-bill blocked by `contentRewardPaidContent.lifetimePaidViews` high-water (§4.5).
- **I2 — Never over-draw the treasury.**
  Enforced by: `realBalanceSen` is read and decremented **only inside the single serializable campaign-batched mutation**; `Σ paySen ≤ realBalanceSen` (clamp + pro-rata); exactly one writer per treasury per run (single-flight lease + per-campaign batching). `realBalanceSen` can never go negative.
- **I3 — Never exceed the nominal budget.**
  Enforced by: `scaleFactor × Σ paidSen ≤ nominalBudgetSen` via `paySen ≤ floor(nominalBudgetSen/scaleFactor) − Σpaid`; `status='completed'` halts accrual when reached.
- **I4 — Baseline monotonicity / no phantom progress.**
  Owner-facing `paidOut = nominalPaidSen = scaleFactor × Σ paidSen`, which is monotonic non-decreasing and **identically equal to `scaleFactor × real spend`**. The legacy `views×nominalRate` computation is overridden for treasury-backed campaigns, so displayed progress can never exceed real money moved.
- **I5 — Scale invariance.**
  `realBudgetSen / effectiveRate == nominalBudgetSen / nominalRate` holds **exactly** because the rate is never materialized/rounded: accrual uses `floor(views × nominalRateSenPer1k / (1000 × scaleFactor))`. Worked: `5000/ (2000/100) = 250000 = 500000/2000` views. (§6.1)
- **I6 — No payment for transient/purged views.**
  Only `confirmedViews` (min over the trailing `confirmWindowHours` window) accrue; high-water is taken on the confirmed series. An unconfirmed spike never enters accrual, so "no clawback" is safe.
- **I7 — Rail exclusivity (XOR).**
  A content_reward is paid by the RM engine **iff** a treasury exists AND `getFundedByContentRewardId === null` AND Supabase status active — checked **in-txn**. The instant a funded v2 USDC vault exists, the RM engine refuses (and on-chain replaces it, §6.4). No post is ever paid by both rails.
- **I8 — Only allowlisted operator agents are paid.**
  `row.mintAddress ∈ treasury.agentMints`; any other submitter measures-for-display, pays 0.
- **I9 — Auditability.**
  Every money-moving config change writes an immutable `treasuryAudit` row (actor, before/after, reason, fundingRef). Every paid sen is a `contentRewardPayouts` tranche with row-level tie-out (`accruedDeltaSen` vs `paidSen` + `backlogPaidSen`).
- **I10 — Funds-claim honesty.**
  `realBalanceSen` is an accounting cap, not custody proof; `fundingRef` is an unverified claim; off-band settlement (`markSettled`) requires a second approver (Phase 2). Documented compromise blast-radius (§1.1, §10.4).

---

## 3. Background / current state (verified)

- **Measurement layer (display-only).** `contentRewardMeasurements` (`schema.ts:241-264`) stores per-post `viewCount` (LATEST only), `lastMeasuredAt`, `status`, `mintAddress`, `contentRewardId`, `contentRewardSubmissionId`, `platform`, `postedAt`. Indexes `by_submission`, `by_status`. **No previous/baseline/peak column** — `recordMeasurement` patches by id without reading the old doc (`contentRewardMeasurements.ts:109-117`), so no delta is computable today.
- **The worker.** `POST /api/oracle/measure-views` (`measure-views/route.ts`) collects due rows (`dueForMeasurement`), reads live analytics, runs the **pure** `scoreSubmission` (`oracleFraud.ts:191`) with `maturationHours:0`, `peers:[]` (`route.ts:67,112`), takes `views = result.viewCount` (`route.ts:119`), backfills Supabase via `updateContentRewardViews` (`contentRewardApprove.ts:40`), patches the Convex row via `recordMeasurement` (`route.ts:127`). It `continue`s on `decision==='defer'` (`route.ts:116`) but a hard-`rejected` post still backfills its real view count — a trap the money path must close (Finding 5).
- **Cadence.** No dedicated cron; piggybacks on `runDueOracle` (every 30 min) which POSTs measure-views `{force:false}` (`crons.ts:218-225,290`). Per-row gate `MEASURE_INTERVAL_HOURS` (default 8) ⇒ ≈3×/day. Admin **Sync Now** = `contentRewardMeasurements.syncNow` action → worker `{force:true}` (`contentRewardMeasurements.ts:125-145`), wired in `components/admin/agents-section.tsx:12-14,184,216-255`. **CONCURRENCY=5** per run (`route.ts`).
- **Existing USDC rails (DO NOT disturb).** `computePayoutUsdc(views, rate, remaining)` (`campaigns.ts:340-354`) — pure, floored to 1e6, budget-clamped. `markVerified` (`campaigns.ts:368-483`) reads `campaign.spentUsdc` via `ctx.db.get` **inside the mutation** (`campaigns.ts:399,437`) precisely so concurrent debits serialize. Per-tranche idempotency via `distributions.getByTranche` + `trancheKey=${submissionId}:${cumulativeNet}` (`distributions.ts:27-35,74-87`).
- **The on-chain rail is DEAD.** The escrow IDL was never regenerated (`anchor build` never run); `getFundedByContentRewardId` returns null in prod (`campaigns.ts:109-129`) because no content-reward has `pdaAddress && onchainVersion>=2`. **The only rail that can move value this week is the Convex custodial ledger.** Consequence (Finding 14): the funded-vault "belt-and-suspenders" guard is currently INERT — it is necessary but **not sufficient**; the `operatorUserId` allowlist (§8) is the real scope guard.
- **Owner display today.** `/stage/reward/<id>` enriches each content_reward from Supabase: per-submission `views`, `paidOut = Σ calculatePayout(views, reward_rate)` (which also applies `max_payout` and adds `flat_fee_bonus`), `progress = Math.min(paidOut/budget, 100)`, `remaining = budget − paidOut` (`lib/content-rewards.ts:37-51,114-137`; `content-reward-detail.tsx`). These are **nominal RM** numbers driven by raw backfilled `views` — the exact source of the phantom-progress divergence (Findings 2, 16, 35). This spec **overrides** the paidOut/progress computation for treasury-backed campaigns only.
- **Agent identity.** `mintAddress` is an `nftAgents` agent wallet whose private key is stored as plaintext base64 in Convex (`schema.ts:79 agentWalletSecret`, devnet-grade). The ledger keys payouts on this mint; there is **no on-chain identity** binding owed RM to a real bank recipient (Finding 29, Invariant I10).

---

## 4. The reward-delta ALGORITHM

**Units.** All money is **integer sen** (1 RM = 100 sen). All views are integers. No floats are persisted. Rate is carried as the **rational** `(nominalRateSenPer1k, scaleFactor)`, never as a materialized sen rate (Finding 3).

**Per-post accounting state** (new optional fields on the measurement row, §5.1): `recentSamples`, `baselineViews`, `confirmedHighWaterViews`, `rewardedViews`, `accruedSen`, `paidSen`, `accrualRemainder`, `heldForReview`, `lastRewardSyncAt`.

The pure function **`computePostAccrual(input) → result`** (in `lib/server/contentRewardReward.ts`, unit-tested, **no I/O**). It does NOT take a treasury balance and does NOT decide `paySen` — it returns the *desired* accrual; the campaign-batched mutation (§7.2) allocates `paySen` across posts under the shared balance. This typing makes a worker-supplied balance structurally impossible (Finding 8).

```
input = {
  now, measuredViews,            // raw latest from analytics, finite ≥0 (or undefined)
  recentSamples,                 // prior [{v,t}]
  baselineViews, confirmedHighWaterViews, rewardedViews,
  prevAccruedSen, prevPaidSen, prevRemainder,
  nominalRateSenPer1k, scaleFactor,           // rational rate (scaleFactor integer ≥ 1)
  confirmWindowMs, maxViewsPerSync?, perPostMaxAccrualSen?,
  lifetimePaidViewsForContent,   // contentRewardPaidContent high-water (Finding 7)
  eligibleDecision,              // approved && softFlags.length===0 && mint allowlisted (Findings 5,15)
  isFirstRewardSync,
}
```

**Step 1 — Sample & confirm (Finding 1, I6).**
`current = max(0, floor(measuredViews))`.
`samples = trim(append(recentSamples, {v:current, t:now}), keep = confirmWindowMs + margin, cap = 32)`.
`windowSamples = samples.filter(t ≥ now − confirmWindowMs)`.
`confirmedViews = min(s.v for s in windowSamples)` — a count is "confirmed" only once **every** sample across the trailing window is ≥ it. A spike that appears mid-window does not raise `confirmedViews` until it has persisted the full window; a purged spike never raises it at all.

**Step 2 — Baseline / first reward sync (Findings 2, 17; removes the pay-from-0 path).**
If `isFirstRewardSync`: set `baseline = confirmedViews` (= `current` on the first sample), `rewardedViews = baseline`, `confirmedHighWaterViews = confirmedViews`, `accruedSen=0`, `paidSen=0`, `accrualRemainder=0`. **Return: records baseline, accrues 0, pays 0, persists `samples`.** Pre-treasury views are intentionally unpaid (documented for owner sign-off; backlog only via `seedBacklog`, §10.3). **There is no `baselineFirstSync=false` option** — it was the repost/instant-drain vector (Findings 17, 20).

**Step 3 — Confirmed high-water (no clawback on confirmed; Finding 1).**
`newHighWater = max(confirmedHighWaterViews ?? baseline, confirmedViews)`.

**Step 4 — Eligibility gate (Findings 5, 15).**
If `!eligibleDecision`: set `heldForReview = true`, persist `samples` and `newHighWater`, **do NOT advance `rewardedViews`/`accruedSen`** (so the delta is preserved and accrues later if/when approved), return `owedSen = 0`. This holds soft-flagged spikes and non-allowlisted submitters for admin review.

**Step 5 — Billable delta, dup/repost cap, per-sync cap (Findings 7, 10, 33, I1).**
`flooredBasis = max(rewardedViews, lifetimePaidViewsForContent)` — never re-bill views already billed for this content identity across submissions/platforms.
`rawDelta = max(0, newHighWater − flooredBasis)`.
`cappedDelta = maxViewsPerSync ? min(rawDelta, maxViewsPerSync) : rawDelta` — excess is **not lost**; it is re-measured next sync (smoothing viral bursts and post-defer catch-ups). If `cappedDelta < rawDelta`, set `heldForReview` hint for visibility.

**Step 6 — Incremental, dust-exact, rational accrual (Findings 3, 6, 32, I5).**
```
D   = 1000 × scaleFactor
num = cappedDelta × nominalRateSenPer1k + prevRemainder
addSen          = floor(num / D)
newRemainder    = num − addSen × D
newAccruedSen   = prevAccruedSen + addSen
```
Apply per-post cap (Finding 10): if `perPostMaxAccrualSen` is set and `newAccruedSen > perPostMaxAccrualSen`, set `newAccruedSen = perPostMaxAccrualSen`, `newRemainder = 0`.
`newRewardedViews = rewardedViews + cappedDelta`; `newHighWaterOut = newHighWater`.
`owedSen = max(0, newAccruedSen − prevPaidSen)`.

**Return** `{ samples, baseline, confirmedHighWaterViews:newHighWaterOut, rewardedViews:newRewardedViews, accruedSen:newAccruedSen, accrualRemainder:newRemainder, owedSen, billableDelta:cappedDelta, effectiveRateMillisenPer1k, heldForReview }`. **`paySen` is decided by the mutation, not here.**

**Step 7 — Campaign-level allocation & pay** — see §7.2 (pro-rata under shared balance + nominal clamp + idempotent tranche). The treasury is the solvency cap; partial pay leaves `accruedSen − paidSen` owed, paid on a later sync after a top-up.

### 4.1 Worked example (5k → 50RM → 0.20/1k — integer sen math)

Config: `nominalBudgetSen = 500000` (RM5000), `nominalRateSenPer1k = 2000` (RM20/1k), `scaleFactor = 100` ⇒ `realBudgetSen = 5000` (RM50), display `effectiveRateMillisenPer1k = round(2000×1000/100) = 20000` millisen = RM0.20/1k. `D = 1000 × 100 = 100000`.

- **First reward sync:** confirmed `current = 0..N` → baseline set, pays 0.
- **Sync after a confirmed +2500:** `num = 2500×2000 + 0 = 5,000,000`; `addSen = floor(5,000,000/100000) = 50` sen = RM0.50. (Check: 2500/1000 × RM0.20 = RM0.50.) ✓
- **Next, confirmed +1500 (total 4000):** `num = 1500×2000 = 3,000,000`; `addSen = 30` sen; `owedSen = 30` sen = RM0.30. Cumulative paid = 80 sen for 4000 views @ RM0.20/1k. ✓
- **Scale-invariance:** real pot exhausts at `5000 sen ÷ (RM0.20/1k) = 250,000` views; nominal completes at `500000 sen ÷ RM20/1k = 250,000` views. **Identical** (I5). A non-divisible rate (e.g. nominal RM2.50/1k, `nominalRateSenPer1k=250`, `scaleFactor=100`, `D=100000`) stays exact because we never round the rate: 1,000,000 confirmed views → `floor(1,000,000×250/100000)=2500` sen real = `scaleFactor×` `25` RM nominal — both hit budget at the same view count.

(The owner's Msg-1 RM8/1k example is the same machinery: `nominalRateSenPer1k=800`, scaleFactor chosen per treasury.)

---

## 5. Data model

All additions are **optional fields or new tables** ⇒ no migration of existing rows. Convex types below.

### 5.1 Extend `contentRewardMeasurements` (money-accounting, all optional)
```ts
baselineViews:           v.optional(v.number()),   // confirmed count at first reward sync (unpaid backlog floor)
confirmedHighWaterViews: v.optional(v.number()),   // monotonic confirmed basis (drives display)
rewardedViews:           v.optional(v.number()),   // confirmed views already turned into accruedSen
recentSamples:           v.optional(v.array(v.object({ v: v.number(), t: v.number() }))), // confirmation window
accruedSen:              v.optional(v.number()),   // cumulative owed (integer sen), incremental
paidSen:                 v.optional(v.number()),   // cumulative paid (integer sen)
accrualRemainder:        v.optional(v.number()),   // carried numerator < D (dust-exact)
heldForReview:           v.optional(v.boolean()),  // soft-flag / non-allowlist / per-sync-cap hold
heldReason:              v.optional(v.string()),
lastRewardSyncAt:        v.optional(v.number()),
```
`viewCount`/`lastMeasuredAt`/`status` keep their display meaning. For treasury-backed rows the worker backfills `viewCount` (and Supabase) with `confirmedHighWaterViews` (monotonic, Finding 35); for non-treasury rows behavior is unchanged. The money fields are written ONLY by `syncAndRewardCampaign` (§7.2).

### 5.2 New table `contentRewardTreasuries`
```ts
contentRewardTreasuries: defineTable({
  contentRewardId:            v.string(),          // jobtepi content_reward UUID (one treasury per id)
  operatorUserId:             v.optional(v.string()), // content_rewards.created_by — scope guard (F14/F30)
  operatorWallet:             v.optional(v.string()), // named off-band payee (F29)
  agentMints:                 v.array(v.string()),  // payable-agent allowlist (F15)
  label:                      v.optional(v.string()),
  currency:                   v.string(),           // "MYR" (display); all *Sen are sen
  nominalBudgetSen:           v.number(),           // RM5000 → 500000
  nominalRateSenPer1k:        v.number(),           // RM20/1k → 2000
  scaleFactor:                v.number(),           // integer ≥ 1 (→ 100)
  realDepositedSen:           v.number(),           // cumulative claimed deposits (UNVERIFIED, audit)
  realBalanceSen:             v.number(),           // remaining real pot, debited on pay
  nominalPaidSen:             v.number(),           // = scaleFactor × Σ paidSen (nominal clamp + display, F16/F2)
  effectiveRateMillisenPer1k: v.number(),           // DISPLAY ONLY = round(nominalRateSenPer1k*1000/scaleFactor); reject if 0 (F3)
  perPostMaxAccrualSen:       v.optional(v.number()), // floor(max_payout*100/scaleFactor) (F10)
  maxViewsPerSync:            v.optional(v.number()),  // per-post per-sync delta cap (F5/F10/F33)
  maxViewsPerDay:             v.optional(v.number()),  // per-post per-day cap (F5)
  confirmWindowHours:         v.optional(v.number()),  // default REWARD_CONFIRM_WINDOW_HOURS (24)
  status:                     v.string(),           // "active" | "paused" | "exhausted" | "completed"
  fundingRef:                 v.optional(v.string()), // bank ref / proof — UNVERIFIED claim (F4)
  createdBy:                  v.string(),           // admin email
  createdAt:                  v.number(),
  updatedAt:                  v.number(),
}).index("by_content_reward", ["contentRewardId"]),
```

### 5.3 New table `contentRewardPayouts` (RM reward ledger / per-sync tranches; row-level tie-out — F37)
```ts
contentRewardPayouts: defineTable({
  contentRewardId:            v.string(),
  contentRewardSubmissionId:  v.string(),
  mintAddress:                v.string(),
  trancheKey:                 v.string(),   // `${contentRewardSubmissionId}:${newPaidSen}` — idempotency
  deltaViewsConfirmed:        v.number(),   // confirmed views billed this tranche
  accruedDeltaSen:            v.number(),   // sen accrued for those views (ties out vs rate)
  paidSen:                    v.number(),   // sen paid for this tranche's own delta
  backlogPaidSen:             v.optional(v.number()), // sen paid toward prior unpaid backlog (F37)
  effectiveRateMillisenPer1k: v.number(),
  treasuryBalanceAfterSen:    v.number(),
  nominalPaidAfterSen:        v.number(),
  measuredAt:                 v.number(),
  settledOffSystem:           v.optional(v.boolean()),
  settledBy:                  v.optional(v.string()),
  settledApprovedBy:          v.optional(v.string()), // second actor (F4, Phase 2)
  settledRef:                 v.optional(v.string()),
})
  .index("by_tranche", ["trancheKey"])
  .index("by_submission", ["contentRewardSubmissionId"])
  .index("by_mint", ["mintAddress"])
  .index("by_content_reward", ["contentRewardId"]),
```

### 5.4 New table `treasuryAudit` (MANDATORY on every money-moving change — F4, I9)
```ts
treasuryAudit: defineTable({
  contentRewardId: v.string(),
  treasuryId:      v.id("contentRewardTreasuries"),
  action:          v.string(),  // create|topup|rate_edit|scale_edit|pause|resume|seed_backlog|complete|settle
  actor:           v.string(),  // admin email (resolveAdmin)
  beforeJson:      v.optional(v.string()),
  afterJson:       v.optional(v.string()),
  reason:          v.optional(v.string()),
  fundingRef:      v.optional(v.string()),
  at:              v.number(),
}).index("by_content_reward", ["contentRewardId"]),
```

### 5.5 New table `contentRewardPaidContent` (cross-submission/platform double-bill guard — F7/F20)
```ts
contentRewardPaidContent: defineTable({
  contentRewardId:   v.string(),
  contentKey:        v.string(),   // normalized post URL / content identity
  lifetimePaidViews: v.number(),   // high-water of confirmed views billed for this content
  updatedAt:         v.number(),
}).index("by_content", ["contentRewardId", "contentKey"]),
```

### 5.6 New table `measureRun` (single-flight lease — F22)
```ts
measureRun: defineTable({
  scope:      v.string(),   // "measure-views"
  leaseUntil: v.number(),   // now + LEASE_TTL_MS
  startedAt:  v.number(),
  startedBy:  v.string(),   // "cron" | admin email
}).index("by_scope", ["scope"]),
```

**No per-agent balance table.** Owed is derived (§10.5).

---

## 6. Treasury model — "scale down"

### 6.1 Three quantities, strictly separate

| | Nominal (owner-facing) | Real (Vello accounting) | Effective (engine accrues at) |
|---|---|---|---|
| Budget | `nominalBudgetSen` RM5000 = 500000 | `realBalanceSen` RM50 = 5000 | — |
| Rate /1k | `nominalRateSenPer1k` RM20 = 2000 | — | rational `nominalRateSenPer1k/scaleFactor`; display `effectiveRateMillisenPer1k = 20000` |

### 6.2 Scaling rule (one integer factor; rate NEVER materialized — F3)
```
scaleFactor S  = integer ≥ 1, supplied OR derived = round(nominalBudgetSen / realBudgetSen)   // 500000/5000 = 100
realBudgetSen  = floor(nominalBudgetSen / S)                                                   // if S supplied
effectiveRateMillisenPer1k = round(nominalRateSenPer1k × 1000 / S)   // DISPLAY ONLY → 20000
```
Accrual uses the rational directly (§4.6): `addSen = floor(Δviews × nominalRateSenPer1k / (1000 × S))`. Because `S ≥ 1`, **effective rate ≤ nominal rate always** — a free sanity clamp (F4).

### 6.3 Mandatory validation (F26, F4) — enforced in `upsert`/`topUp`
- `nominalBudgetSen > 0`, `nominalRateSenPer1k > 0`, `scaleFactor` integer `≥ 1`, `realBudgetSen > 0`, `topUp.addSen > 0`, all integers.
- **Reject** any config where `effectiveRateMillisenPer1k === 0` (round-to-zero non-paying engine, F3/F36) — surface "rate too small for this scale" to admin.
- `Number.isFinite` asserted on every derived field before insert (kills div-by-zero NaN/Infinity, F26).
- `perPostMaxAccrualSen`, `maxViewsPerSync`, `maxViewsPerDay` if present must be `> 0`.

### 6.4 On-chain path = REPLACEMENT, not a mirror (F12, F27, F11)
The earlier "seam" framing was wrong. **Turning on chain does NOT mirror this engine; it retires it.** When the escrow program is alive:
1. **Prerequisites (currently DEAD/pending):** regenerate the escrow IDL (`anchor build`), deploy, and initialize vaults. Until then there is **no on-chain option at all**.
2. For a Vello content_reward, create a **small real (scaled) USDC campaign on the EXISTING USDC rail**. This flips `getFundedByContentRewardId` non-null, which **disables the RM engine for that campaign by the §8 XOR**, and the existing `markVerified → distributions → claim_payout` machinery pays the agent's Convex submission. The RM treasury is closed (final owed report run, then archived).
3. **Currency coherence (F27):** denominate the on-chain treasury in an **RM-pegged unit** so the scaled balance maps 1:1, OR introduce an explicit **audited FX layer** (rate source, capture timestamp, slippage/reconciliation). Do **not** silently treat 1 USDC ≈ 1 sen and do **not** claim a conversion-free swap. The RM↔USDC conversion that §2 forbids inside this engine must be an explicit, audited boundary at the Phase-3 replacement, never an implicit mirror.
4. **No tranche mirroring.** `contentRewardPayouts` tranches are an RM-rail artifact; they are not replayed on-chain. The on-chain rail starts fresh from a baseline at switch-over.

---

## 7. Payout flow

### 7.1 Where it hooks
In `measure-views/route.ts`, after scoring, rows are **partitioned**:
- **Non-treasury rows** → `recordMeasurement` (display only) exactly as today. Unchanged. User campaigns are untouched.
- **Treasury-backed rows** → grouped by `contentRewardId`; the worker calls **one** `syncAndRewardCampaign` per group (the batched mutation), passing per-row `{ id, measuredViews, decision, softFlags, contentKey, measuredAt }` ONLY. The worker then backfills Supabase `views` with the per-row `confirmedHighWaterViews` the mutation returns (monotonic, F35). The legacy `paidOut`/`progress` shown to the owner is overridden by engine numbers (§9), so phantom progress is impossible.

The worker first claims the **single-flight lease** (§7.4); concurrent invocations (cron + Sync Now + double-clicks) no-op while held (F22).

### 7.2 The campaign-batched mutation `syncAndRewardCampaign` (NEW, in `contentRewardMeasurements.ts`)
Args: `{ authSecret, contentRewardId, rows: [{ id, viewCount?, decision, softFlags, contentKey, measuredAtMs }] }` (secret-gated by `gate()`). **All balances/eligibility are read in-txn (F8). The worker can never supply a balance.**

```
1. treasury = db.query("contentRewardTreasuries").withIndex("by_content_reward", contentRewardId).first()
   if !treasury OR treasury.status ∉ {active}: do display-only patches, return.   // paused/exhausted/completed → no pay
2. funded = isFundedVault(ctx, contentRewardId)    // in-txn query on campaigns by_content_reward (I7)
   if funded: return display-only.                 // USDC rail owns it; RM refuses (XOR)
3. // PASS A — per-post desired accrual (no balance touched):
   for each row:
     r = db.get(row.id)
     // DISPLAY write: lastMeasuredAt; for treasury-backed, viewCount := confirmedHighWaterViews (post-compute)
     eligible = row.decision==="approved" && (row.softFlags?.length ?? 0)===0 && treasury.agentMints.includes(r.mintAddress)
     paid = db.query("contentRewardPaidContent").withIndex("by_content",[contentRewardId,row.contentKey]).first()
     acc[row.id] = computePostAccrual({ ...from r and treasury...,
                       lifetimePaidViewsForContent: paid?.lifetimePaidViews ?? 0,
                       eligibleDecision: eligible, isFirstRewardSync: r.rewardedViews===undefined })
4. // PASS B — allocate paySen under the SHARED cap (F2/F10/F16/F34):
   totalOwed     = Σ acc[*].owedSen
   nominalCapReal= floor(treasury.nominalBudgetSen / treasury.scaleFactor) - (treasury.nominalPaidSen / treasury.scaleFactor)
   campaignCap   = max(0, min(treasury.realBalanceSen, nominalCapReal))
   if totalOwed <= campaignCap: paySen[id] = acc[id].owedSen                      // pay all in full
   else:  paySen[id] = floor(acc[id].owedSen * campaignCap / totalOwed)           // pro-rata
          distribute the rounding remainder deterministically by submissionId asc, never exceeding campaignCap
5. // PASS C — persist accounting + idempotent debit/ledger (F23):
   for each row:
     a = acc[row.id]; pay = paySen[row.id]
     newPaidSen = (r.paidSen ?? 0) + pay
     patch row: baselineViews, confirmedHighWaterViews, rewardedViews, accruedSen, accrualRemainder,
                recentSamples, heldForReview, lastRewardSyncAt; viewCount := confirmedHighWaterViews
     if pay > 0:
        trancheKey = `${row.contentRewardSubmissionId}:${newPaidSen}`
        existing = db.query("contentRewardPayouts").withIndex("by_tranche", trancheKey).first()
        if existing: continue           // ALREADY PAID — debit nothing, insert nothing (F23, I1)
        // single shared idempotency gate → BOTH debit and insert, never one without the other:
        treasury.realBalanceSen -= pay
        treasury.nominalPaidSen += pay * treasury.scaleFactor
        db.insert("contentRewardPayouts", { ...tie-out fields..., paidSen: pay,
              accruedDeltaSen: a.billableDelta*… (rate), backlogPaidSen: max(0, pay - thisSyncAccrued),
              treasuryBalanceAfterSen: treasury.realBalanceSen, nominalPaidAfterSen: treasury.nominalPaidSen })
        upsert contentRewardPaidContent[contentRewardId,row.contentKey].lifetimePaidViews =
              max(prev, a.confirmedHighWaterViews)
        patch row paidSen = newPaidSen
   // status transitions:
   if treasury.nominalPaidSen >= treasury.nominalBudgetSen: status="completed"
   else if treasury.realBalanceSen <= 0: status="exhausted"
   db.patch(treasury._id, { realBalanceSen, nominalPaidSen, status, updatedAt: now })
6. return per-row { confirmedHighWaterViews, paidSen, owedSen, heldForReview } for worker backfill + summary
```

`recordMeasurement` is retained unchanged for non-treasury rows, the `stop:true` path, and as the pure-display primitive.

### 7.3 Idempotency (no double-pay — F23, I1)
- **Single gate:** `trancheKey = ${submissionId}:${newPaidSen}` is looked up **before** any debit; if present, the mutation debits nothing and inserts nothing. The balance decrement and ledger insert live **inside the same `trancheKey`-absent branch** — never one without the other (closes the paidSen-regression over-debit, F23).
- **Incremental high-water:** `rewardedViews` only advances; re-running a sync with the same confirmed views ⇒ `billableDelta=0` ⇒ `owedSen=0` ⇒ no debit.
- **Atomic, single-writer:** one serializable mutation per treasury per run; `realBalanceSen` is read and written in-txn (mirrors `markVerified`'s `spentUsdc`), so it can never go negative or be lost-updated (F8, F21, I2).

### 7.4 Cadence, single-flight, "straight away" (F1, F22, F33)
- **Cadence:** treasury-backed rows use `REWARD_MEASURE_INTERVAL_HOURS` (default **2h**); display-only rows keep 8h. The worker computes the due cutoff from the tighter value when ≥1 active treasury exists.
- **Single-flight lease (F22):** at run start, claim `measureRun{scope:"measure-views"}` with `leaseUntil = now + LEASE_TTL_MS` (e.g. 5 min) iff no live lease; release at end. Concurrent cron/Sync-Now/double-click runs no-op while held. The admin **Sync Now** button is disabled in the UI while a lease is live. This also caps analytics fan-out (the live Helius/upload-post 429 firefight).
- **"Straight away" (honest definition, F1/F11):** on the next sync after the views have been **confirmed-persistent for `confirmWindowHours`** (default 24h), the engine records the owed delta; admin **Sync Now** records it for all active eligible rows immediately (subject to the confirmation window). The real cash payout is manual/out-of-band (§1.1).

---

## 8. Scope gating — eligible vs NOT (structural, not "admin discipline")

A campaign is paid by the RM engine **iff ALL hold (checked in-txn, I7/I8):**
1. An admin-created `contentRewardTreasuries` row exists for its `contentRewardId` with `status === "active"`.
2. `treasury.operatorUserId` is on the **`VELLO_OPERATED_CREATED_BY` allowlist** — captured from Supabase `content_rewards.created_by` at `upsert` time (F14, F30). `upsert` **refuses** otherwise, unless an admin explicitly types a loud confirm ("owned by `<user>` — NOT Vello"), which is audited.
3. `getFundedByContentRewardId(contentRewardId) === null` (no funded v2 USDC vault) — necessary but **inert today** (rail dead), so it is a guard, not the guard.
4. The submission's `row.mintAddress ∈ treasury.agentMints` (operator-agent allowlist, F15). Any other submitter (external clipper) measures-for-display, pays 0.
5. The Supabase `content_reward.status` is active (skip closed/paused campaigns, F16).

Pausing (`status:"paused"`), exhaustion (`realBalanceSen ≤ 0 → "exhausted"`), or nominal completion (`"completed"`) make a treasury ineligible (display keeps measuring; no pay). The RM ledger and the USDC `distributions` ledger are independent; a post is in **exactly one** rail (Invariant I7).

---

## 9. Owner visibility (engine-driven; "no UI change required" is RETRACTED — F2, F9, F13, F30, F31, F35)

The pre-existing nominal display (`views × reward_rate`) is **NOT evidence the engine works** and would show phantom progress (Finding 2). For treasury-backed campaigns we therefore:

1. **Override `paidOut`/`progress`/`remaining` with engine numbers** in `lib/content-rewards.ts` + `content-reward-detail.tsx`, **for treasury-backed campaigns only** (a new treasury-aware branch; non-treasury campaigns are byte-for-byte unchanged):
   - `paidOut (nominal RM) = treasury.nominalPaidSen / 100` (= `scaleFactor × Σ paidSen / 100`).
   - `progress = min(100, nominalPaidSen / nominalBudgetSen × 100)`.
   - `remaining = (nominalBudgetSen − nominalPaidSen) / 100`.
   - This is **provably `scaleFactor × real spend`** (Invariant I4), monotonic (F35), and plateaus when the pot is exhausted (F9). `flat_fee_bonus`/`min_payout` are deliberately **not** added (they are not accrued on the real side — F10), eliminating real-vs-display divergence.
2. **A first-class "Vello Rewards" live block** (read-only) on `/stage/reward/<id>`, driven entirely by the engine (Convex `treasury` + `contentRewardPayouts`): treasury **status badge** (`active`/`paused`/`exhausted`/`completed`), RM paid (nominal), confirmed views rewarded (`Σ (rewardedViews − baselineViews)`), **last sync Δviews / Δsen**, and **last-paid timestamp**. This is the signal that proves the algo is running (Findings 13, 31) — it is byte-different from a world where the engine never ran.
3. **Per-submission view counts** shown to the owner are the monotonic `confirmedHighWaterViews` (never the raw recount-down value, F35).
4. **Ownership precondition (F30):** the nominal-display mask + scaled treasury apply **only** to `operatorUserId ∈ Vello allowlist`. An externally-owned content_reward never receives a scaled treasury, so a third-party Jobtepi client is never shown inflated payouts.

> **Owner sign-off note (surface in the admin panel):** pre-treasury (backlog) views are unpaid by default. For the Ryze EXISTING-campaign demo, use `seedBacklog` (§10.3) to credit a bounded backlog so the engine shows immediate, real motion rather than appearing idle on mature content (Finding 31).

---

## 10. Admin controls

All admin entry points are Convex `action`s gated by `resolveAdmin(ctx, accessToken)` (mirrors `syncNow`), driving secret-gated mutations. **Every money-moving action writes a `treasuryAudit` row (mandatory, F4/I9).** Surface them in a new `components/admin/treasury-section.tsx`.

### 10.1 Sync Now (reused) — `contentRewardMeasurements.syncNow` → worker `{force:true}`
Now also accrues+pays eligible rows (subject to confirmation window + caps). Disabled while a `measureRun` lease is live (F22). The result toast is extended to `{ rewarded, paidSen, exhausted, completed, heldForReview, perRowUnpaid }` so silent non-payment / held rows are visible (F21).

### 10.2 Create / fund — `treasury.upsert`
`{ accessToken, contentRewardId, label?, operatorWallet?, agentMints, nominalBudgetSen, nominalRateSenPer1k, realBudgetSen | scaleFactor, perPostMaxAccrualSen?, maxViewsPerSync?, maxViewsPerDay?, confirmWindowHours?, fundingRef }`.
- Looks up Supabase `content_rewards.created_by` → stores `operatorUserId`; **refuses unless on the Vello allowlist** (loud confirm override, audited — F14/F30).
- Derives `scaleFactor`/`realBudgetSen`/`effectiveRateMillisenPer1k`; runs all §6.3 validation; **rejects effective=0** (F3).
- Pre-fills `nominalBudgetSen`/`nominalRateSenPer1k`/`perPostMaxAccrualSen` from Supabase `content_rewards.budget × 100` / `reward_rate × 100` / `max_payout × 100 / scaleFactor`.
- Sets `realBalanceSen = realDepositedSen = realBudgetSen`, `nominalPaidSen = 0`, `status="active"`. Requires `fundingRef` (labeled UNVERIFIED claim in the UI, F4/I10).

### 10.3 Edits (audited; prospective; bounded backlog)
- **Top up** — `treasury.topUp({ accessToken, contentRewardId, addSen>0, fundingRef })` → `realBalanceSen += addSen`, `realDepositedSen += addSen`, `status="active"` (un-exhausts). Negative/zero rejected (F26).
- **Rate / scale edit** — only future deltas use the new rate (accrual is incremental, so historical views are **not** re-priced — F6/F32). On edit, flush the row remainder to the old denominator, then proceed. Confirm-preview required for any rate increase (F4).
- **Seed backlog** — `treasury.seedBacklog({ accessToken, contentRewardId, submissionId?, views, reason })` (the ONLY way pre-treasury views are paid — F17/F20/F31): credits `views` (clamped to `min(remaining real balance, nominal remaining, confirmedHighWater − lifetimePaidViews)`) at the current rate, writes a tranche, advances `lifetimePaidViews`. Bounded, audited, idempotent.
- **Pause / resume** — `treasury.setStatus({ accessToken, contentRewardId, status, rebaselineOnResume=true })`. On resume, by default **re-baseline each row to its current confirmed count** (forfeit the paused gap) so resume does not dump a multi-day catch-up in one tranche (F33); admin may opt to back-pay (still subject to per-sync cap).
- All edits stamp `updatedAt` and write `treasuryAudit`.

### 10.4 Security posture (stated, not implied — F4/I10)
- `realBalanceSen`/`realDepositedSen`/`fundingRef` are an **UNVERIFIED claim of funds**, surfaced as such in the panel. There is **no proof-of-funds** in v1.
- Sanity clamps: `scaleFactor ≥ 1` ⇒ effective ≤ nominal; reject effective=0; `perPostMaxAccrualSen` caps per-post; `maxViewsPerSync`/`maxViewsPerDay` cap per-sync/day; nominal-budget clamp caps lifetime spend.
- **v1 has no withdrawal limit and no dual control on accrual.** Admin-token or `INTERNAL_CRON_SECRET` compromise = **unbounded fake debt** that can flow to real bank transfers. Mitigation: mandatory audit trail + caps + (Phase 2) second-actor on `markSettled`.

### 10.5 Owed report (richer; effective-only — F19/F25/F28/F29) — `treasury.owedReport({ accessToken })`
Returns, per `mintAddress` AND rolled up to `operatorWallet`:
- `paidUnsettledSen` = Σ `contentRewardPayouts.paidSen` where `!settledOffSystem`.
- `accruedUnpaidSen` = Σ `(accruedSen − paidSen)` over that mint's measurement rows (the treasury-starved backlog that has **no tranche** — F25/F28).
- `totalOwedSen = paidUnsettledSen + accruedUnpaidSen`.
- **All figures are effective sen** (never `views × nominal rate`). A test asserts no "pay Mimie" surface multiplies by the nominal rate (F19). Caveat shown: mint→human mapping is undefined; settlement is a manual human attestation with no cryptographic link (F29/I10).

### 10.6 Mark settled (Phase 2) — `treasury.markSettled`
`{ accessToken, mintAddress?, trancheKeys?, settledRef }` flips `settledOffSystem:true` after an out-of-band transfer. **Requires a second approver** (`settledApprovedBy ≠ settledBy`) — the real-money trigger (F4). Audited.

---

## 11. Edge cases & failure handling

- **First sync** — baseline at confirmed count, pay 0 (F17). No pay-from-0 path exists.
- **Transient / bought / purged view spike (F1)** — never enters `confirmedViews` (min over the window) unless it persists `confirmWindowHours`; high-water is on the confirmed series, so nothing to claw back.
- **Recount-down (F35)** — confirmed/high-water are monotonic; the owner's progress (engine-driven) never regresses.
- **Treasury < owed (partial pay)** — `paySen` allocated pro-rata across due posts (F34/F38, no first-come starvation); `paidSen` lags `accruedSen`; remainder pays after top-up; at 0 → `status:"exhausted"`. The unpaid backlog is visible in `owedReport.accruedUnpaidSen` (F28).
- **Soft-flagged / non-allowlisted submitter (F5/F15)** — `eligibleDecision=false` ⇒ accrue nothing, `heldForReview=true`, await admin approval. Velocity/engagement gates run; the money path additionally treats ANY softFlag as non-payable.
- **Viral burst / post-defer catch-up (F10/F33)** — `maxViewsPerSync` caps the per-sync billable delta; excess re-measures next sync (smoothed, not lost).
- **Duplicate / cross-platform repost (F7/F20)** — `peers` populated (enables duplicate hard-reject); `contentRewardPaidContent` lifetime high-water prevents re-billing the same content across submissions/platforms.
- **Rate edit mid-campaign (F6/F32)** — prospective only; a cut never erases already-accrued unpaid debt; an increase never repays history.
- **Nominal completion (F16)** — `nominalPaidSen ≥ nominalBudgetSen ⇒ status="completed"`, accrual stops, even if real balance remains.
- **Aged-out row (F18)** — treasury-backed rows are **exempt** from `MEASURE_MAX_AGE_DAYS` while `active`; a final measure+pay runs at completion/exhaustion before stop. Residual unpaid is surfaced, never silently forfeited.
- **Proxy platforms** (facebook/linkedin/reddit) — `scoreSubmission` returns `viewCount 0` ⇒ `billableDelta 0` ⇒ pays 0 (honest).
- **Concurrency (F8/F21)** — one campaign-batched mutation per treasury per run; single-flight lease prevents overlapping worker runs; OCC cannot lost-update the balance.
- **Bad inputs (F26)** — `upsert`/`topUp` reject non-positive/non-integer/non-finite values and effective=0.
- **Worker row error** — per-row `try/catch` leaves accounting untouched; idempotent retry next cycle. Write-conflict on the campaign mutation is retried in-run (re-enqueue) rather than swallowed as a generic error (F21).
- **`NEXT_PUBLIC_APP_URL`/secret unset, Convex deploy lag** — worker unreachable / `Not configured`; no pay; retries. Add `CRM_SYNC_REWARD_CAMPAIGN` via `makeFunctionReference` so the route typechecks before `npx convex deploy`.

---

## 12. Testing / verification

- **Pure `computePostAccrual`:** first sync (baseline, pay 0); confirmation window (spike not paid until persisted; purged spike never paid — F1); normal positive delta (5k→50→0.20/1k: +2500→50 sen, +1500→+30 sen); rational dust-exactness (many small deltas sum exactly via remainder carry — F3); **reject effective=0** path (F3/F36); per-post cap (F10); per-sync cap holds excess (F33); ineligible (soft-flag/non-allowlist) accrues nothing & holds (F5/F15); lifetime-content high-water blocks repost re-bill (F7/F20); rate change prospective both directions (F6/F32).
- **Scale invariance (I5):** assert `250,000` views exhausts `realBalanceSen` to exactly 0 and `nominalPaidSen` to exactly `nominalBudgetSen`, for divisible AND non-divisible rates.
- **Mutation `syncAndRewardCampaign` (Convex):** eligible+approved → debit + tranche + accounting advance; re-run same views → no debit/tranche (I1); paidSen-regression → trancheKey present → debit nothing (F23); pro-rata when balance<totalOwed sums ≤ campaignCap (F34); nominal clamp stops at completion (F16); paused/exhausted/completed/no-treasury/funded-vault/non-allowlist/wrong-owner → no debit (I7/I8); **worker-supplied balance is structurally impossible** (F8).
- **Concurrency (MANDATORY — F24/I2):** overlapping `syncAndRewardCampaign` calls and cron+force overlap assert: (a) `Σ tranche paidSen == final accruedSen` consumed; (b) `realBalanceSen ≥ 0` across N racing rows; (c) exactly one tranche per cumulative `paidSen` level; (d) two concurrent first-syncs baseline once, pay once.
- **Worker integration:** treasury-backed rows route to the batched mutation with measured data; non-treasury rows route to `recordMeasurement` (unchanged); single-flight lease blocks overlapping runs (F22); Supabase backfill uses `confirmedHighWaterViews` (F35).
- **Display:** treasury-backed `paidOut == scaleFactor × Σ paidSen / 100` (I4); progress plateaus at exhaustion (F9); external-owned campaign never gets a treasury / never masked (F30); **no payout/owed surface multiplies by nominal rate** (F19).
- **Admin:** `resolveAdmin` rejection; owner-allowlist refusal (F14); validation rejects (F26); `seedBacklog` clamps (F17); rate edit prospective + audited (F6); `owedReport` includes `accruedUnpaidSen` (F25/F28); `markSettled` requires second actor (F4, Phase 2).
- **Regression:** existing oracle + 220+ clip suites green; **no change** to `markVerified`/`computePayoutUsdc`/`distributions`/`/api/oracle/run` (snapshot the USDC-rail tests). Lint + build before completion.

---

## 13. Decisions (chosen, no hedging)

1. **Unit** → RM integer sen; rate carried as rational `(nominalRateSenPer1k, scaleFactor)`, never materialized; no RM↔USDC conversion stored (F3/F27).
2. **First sync** → baseline-only, pay 0; **no pay-from-0 path**; backlog only via bounded audited `seedBacklog` (F17/F20).
3. **Where real RM lands** → Convex `contentRewardPayouts` ledger + in-txn accounting debit; cash out-of-band; v1 has **no chain/wallet/keys** (F11/§1.1).
4. **Owed** → derived (`owedReport`: `paidUnsettledSen` + `accruedUnpaidSen`, effective sen, operatorWallet rollup) (F19/F25/F28/F29).
5. **Owner display** → **engine-driven** (`nominalPaidSen = scaleFactor × Σ paidSen`), monotonic, plateaus at exhaustion; legacy `views×nominalRate` overridden for treasury-backed only; "no UI change" retracted (F2/F9/F13/F35).
6. **Cadence** → 2h treasury / 8h display; single-flight lease; **24h confirmation window** on the money path (F1/F22).
7. **Fraud on money path** → pay only `approved` with **zero soft-flags**; populate `peers`; scale-aware per-sync/per-day caps; non-allowlisted submitters pay 0 (F5/F7/F15).
8. **Treasury edits** → editable while active, **prospective** (incremental accrual), every edit audited; rate increases confirm-previewed (F6/F32/F4).
9. **Scale input** → `nominalBudgetSen` + `nominalRateSenPer1k` (pre-filled ×100) + one of `realBudgetSen|scaleFactor` (integer ≥1); engine derives the rest; **reject effective=0** (F3/F26).
10. **Atomicity & allocation** → one serializable **campaign-batched** mutation per treasury per run; in-txn reads; pro-rata under the shared balance; idempotent trancheKey gate (F8/F21/F23/F34).
11. **Scope guard** → structural: `operatorUserId` allowlist + `agentMints` allowlist + funded-vault XOR + Supabase status (F14/F15/F30/F16).
12. **On-chain** → Phase-3 **REPLACEMENT** (small real scaled USDC campaign on the existing rail; RM engine retires), blocked on the dead IDL; FX boundary explicit if USDC-denominated (F12/F27).

---

## Implementation file map

- `apps/web/convex/schema.ts` — extend `contentRewardMeasurements` (§5.1); add `contentRewardTreasuries`, `contentRewardPayouts`, `treasuryAudit`, `contentRewardPaidContent`, `measureRun` (§5.2–5.6).
- `apps/web/lib/server/contentRewardReward.ts` (NEW) — pure `computePostAccrual` (§4) + the campaign-level pro-rata allocator (pure) + unit tests.
- `apps/web/convex/contentRewardMeasurements.ts` — add `syncAndRewardCampaign` (§7.2) + `isFundedVault` in-txn helper; keep `recordMeasurement` for non-treasury/`stop`/display.
- `apps/web/convex/contentRewardTreasury.ts` (NEW) — `upsert`/`topUp`/`seedBacklog`/`setStatus`/`owedReport`/`markSettled` admin actions + secret-gated mutations + mandatory `treasuryAudit` writes (§10).
- `apps/web/app/api/oracle/measure-views/route.ts` — partition rows; single-flight lease; route treasury-backed groups to `syncAndRewardCampaign`; backfill Supabase with `confirmedHighWaterViews`; add `CRM_SYNC_REWARD_CAMPAIGN` string ref (§7).
- `apps/web/lib/content-rewards.ts` + `apps/web/components/.../content-reward-detail.tsx` — treasury-aware engine-driven `paidOut`/`progress`/`remaining` + "Vello Rewards" live block (§9). Non-treasury path unchanged.
- `apps/web/components/admin/treasury-section.tsx` (NEW) + wire into the admin agents page; extend the Sync Now toast (§10).
- **No changes** to `campaigns.ts`, `submissions.ts`, `distributions.ts`, `earnings.ts`, `/api/oracle/run`, or the on-chain rails.

---

## Phased implementation checklist (each phase independently shippable + testable)

### Phase 0 — Custodial-ledger MVP (works TODAY; no chain)
Ship the full engine on the Convex ledger.
- [ ] Schema: §5.1–5.6 (all optional/new ⇒ no migration).
- [ ] Pure `computePostAccrual` + pro-rata allocator + unit tests (§4, §12): confirmation window, rational dust-exact accrual, reject effective=0, per-post/per-sync caps, content high-water, prospective rate.
- [ ] `syncAndRewardCampaign` (§7.2): in-txn reads (F8), pro-rata (F34), idempotent trancheKey gate (F23), status transitions (F16). **Concurrency tests** (F24/I2).
- [ ] Worker (§7): row partition, single-flight lease (F22), 2h cadence, `confirmedHighWaterViews` backfill.
- [ ] Treasury admin (§10): `upsert` (owner allowlist F14 + agentMints F15 + validation F26 + reject effective=0 F3), `topUp`, `seedBacklog`, `setStatus`, mandatory `treasuryAudit`. `owedReport` with `accruedUnpaidSen` (F25/F28).
- [ ] Owner display (§9): engine-driven paidOut/progress + "Vello Rewards" block; non-treasury unchanged.
- [ ] **Verify:** all §12 tests green; USDC-rail snapshot unchanged; `npx convex deploy`.
- **Independently testable:** seed a Ryze treasury (RM5000→RM50, scaleFactor 100), run Sync Now, assert engine panel shows real Δviews/paidSen and `paidOut == scaleFactor × Σ paidSen`.

### Phase 1 — Hardening & ops (no new money semantics)
- [ ] Per-day caps (`maxViewsPerDay`), soft-flag **review queue** UI (approve/hold), `seedBacklog` UI, exhaustion/held alerts, in-run write-conflict re-enqueue (F21), Sync-Now button disabled while lease live (F22).
- **Independently testable:** simulate a soft-flagged spike → held, admin approves → pays next sync.

### Phase 2 — Settlement controls (real-money attestation)
- [ ] `markSettled` with **second-actor approval** (F4), `settledRef`, audit export; reconciliation report (effective owed vs paid-unsettled vs accrued-unpaid). Confirm the actual Vello→Mimie payout model before building bulk vs per-mint settlement (F39).
- **Independently testable:** two-admin settle flow; single-admin attempt rejected.

### Phase 3 — On-chain REPLACEMENT (blocked on dead IDL; NOT a mirror — F12/F27)
- [ ] Prereq (USER/infra): regenerate escrow IDL (`anchor build`) → deploy → init vaults.
- [ ] For a Vello content_reward, create a **small real scaled USDC campaign on the EXISTING rail**; `getFundedByContentRewardId` flips non-null ⇒ RM engine auto-retires for it (§8 XOR); run a final `owedReport`, archive the treasury.
- [ ] Currency boundary: RM-pegged unit (1:1) OR explicit audited FX layer — never an implicit conversion (F27).
- **Independently testable:** once a campaign is funded on-chain, assert the RM engine pays 0 for it (XOR) and the USDC rail pays via `distributions`.

**Deploy gate:** Phase 0 schema + functions require `npx convex deploy` before the engine runs in prod; the route's string function refs let it typecheck/ship beforehand. Per project memory, deploys are often pending — verify.