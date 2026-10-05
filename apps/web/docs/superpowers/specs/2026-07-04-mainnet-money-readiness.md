# Vello Money-Path Mainnet-Readiness Report — 2026-07-04

Branch: `fix/mainnet-money` (worktree off `dev` @ `3d88ee1`). Scope: exhaustively map every path real
value moves through, adversarially hunt money bugs, fix the confirmed ones (TDD, one commit each,
verified against baseline), and enumerate the human-only blockers that must NOT be attempted in code.

**Method.** Phase 1 mapped 8 money paths with parallel readers reading real source (file:line verified).
Phase 2 ran dimension finders + verified each candidate 3× against source (reproduce / find-the-guard /
money-impact); 10 CONFIRMED, 1 disputed, 3 refuted. Phase 3 fixes each confirmed bug via TDD in this
worktree. Nothing was deployed; no mainnet action taken; no real money spent.

**Baseline (regression yardstick):** `tsc --noEmit` = 84 pre-existing errors; `vitest run` = 17
pre-existing failing tests + 2 uncollectable files (`lib/client/usdcClient.test.ts`,
`lib/client/funding.test.ts`). A regression = a NEW tsc error in a touched file or a NEW vitest failure.

---

## A. Bugs found & fixed (Phase 3)

Status legend: ✅ fixed+verified · 🔧 in progress · ⏳ queued · 📝 code-fixed, needs human infra step.

| ID | Sev | Path | Bug (one line) | Status |
|----|-----|------|----------------|--------|
| C1 | HIGH | clip→post→submit | Drip + manual posts dropped the durable post id (`platformPostId`/`uploadPostRequestId`) → content-reward submissions never satisfy `dueForVerification` → never attested → agent never paid. | ✅ `7a2492a` |
| C2 | HIGH | campaign treasury | `campaigns.create` (public, ungated) persisted client `pdaAddress`+`onchainVersion` → forge a phantom "funded v2" vault that `getFundedByContentRewardId` routes clips/USDC to. | ✅ `0cf8762` |
| C3 | MED | mint fee | `markMintCharged` best-effort → a successful FREE first mint ages out of `countPrior` in 5 min → same wallet re-earns a $50 freebie. | ✅ `61f3d8b` |
| C4 | MED | compute metering | Cloud clip path swallows a THROWN `recordUsage` and renders unbilled (also reachable when `agentAccount` row missing) — asymmetric with `/api/video/clip` #23 fail-closed. | ✅ `a29caee` |
| C5 | MED | compute metering | Unfunded/rotated `PLATFORM_FEE_PAYER_SECRET` strands ALL settlements silently (console.warn, no `sendAlert`). | ✅ `4db46b3` |
| C12 | MED | compute metering | `refundRunFeesTx` only voids UNSETTLED rows → a 0-clip run whose fees were swept at the top of the hour charges the agent for nothing. | ✅ `df2506e` |
| F1-0 | HIGH (LATENT) | funding/withdraw | Withdraw floor reads `sharesOutstanding` that an in-flight redemption already burned → owner can drain investor-backing capital. LATENT: invest not enabled. | ✅ `340064b` |
| C6 | LOW | compute metering | `reconcileImpl` unbounded `.collect()` of feeSettlements → throws >~16k rows → mirror stale. | ✅ `94b9748` |
| C10 | LOW | clip→submit | `submitContentRewardLink` unconditional INSERT → duplicate `/stage/reward` display rows. Code-side dedup here; the DB unique index is a jobtepi migration (human). | ✅ `c2b7b26` 📝 |
| C11 | LOW | autonomous clip | A terminally-failed auto-clip source re-enqueues every cycle forever (head-of-line block, repeated compute). | ✅ `6ec09a8` |

**Adjudicated / not a bug**
- **C7 (DISPUTED)** `checkFunding` coerces a null balance → 0 → a dual-null RPC read hard-blocks a funded
  wallet's launch. This fails CLOSED (blocks the launch, never signs/pays on an unknown balance), so it is
  a **UX false-block, not a money bug**. Optional cheap fix (distinguish "unknown" from "zero"); documented,
  not ship-blocking.
- **C8 refuted** — the auto-clip scout content_rewards branch IS funded-gated in the callee
  (`lib/content-rewards.ts:155`, `.eq(status,active).gt(budget,0)`).
- **C9 refuted (my initial framing)** — but the same area is real via **F1-0** (the sharper burn-before-confirm
  interleaving). Kept F1-0.
- **F0-0 refuted** — `vaultEnabled` is write-once at mint before any submission exists.

---

## B. Human-only blockers — do NOT attempt in code (must be done by a person, off-repo)

These came out of the on-chain rail map (`programs/vello-escrow/src/lib.rs`, both IDLs, the keeper routes,
`docs/campaign-treasury/MAINNET-LAUNCH-RUNBOOK.md`). The on-chain rail is REAL and idempotent on devnet, but
the following are operational/custody/config decisions a person must own before any mainnet cutover:

1. **Single-key custody / upgrade authority (CRITICAL).** One wallet (`G6emPd5…`) is the upgrade authority of
   BOTH upgradeable programs AND the `PlatformConfig` authority AND the agent-vault owner AND the gas fee-payer.
   That key can hot-swap on-chain logic under live funds. **Mainnet requires moving the upgrade authority (and
   the treasury) to a multisig (e.g. Squads)** and separating the gas fee-payer/oracle/crank roles. Cannot be
   fixed in TS.
2. **Mainnet Anchor program deploy.** The programs are built/deployed on DEVNET only (`Gztj63…`, `93RLwd…`).
   Mainnet needs a fresh audited build + deploy + `init_platform_config` with mainnet params. No toolchain in
   this repo; a human runs `anchor build`/deploy per the runbook.
3. **Dispute-window config.** `init-platform-config.ts:39` defaults `DISPUTE_WINDOW_SLOTS=8` (~3s) and the live
   devnet config is 4 (~2s) = effectively NO fraud-challenge window. There is no on-chain minimum floor. **A
   mainnet deploy MUST set `DISPUTE_WINDOW_SLOTS≈9000` (~1h)** at init/update or any attested delta is instantly
   claimable with no challenge period.
4. **Real USDC mint config.** Devnet uses a devnet USDC mint; mainnet must pin the canonical mainnet USDC mint
   (`EPjFW…`) via `NEXT_PUBLIC_SOLANA_NETWORK`/mint config. Verify every balance/transfer path resolves the
   mainnet mint before go-live.
5. **Third-party security audit.** The escrow + agent-vault programs (and the custodial key handling) have not
   had an external audit. Required before holding real user funds at scale.
6. **Signer funding + key rotation runbook.** `PLATFORM_FEE_PAYER_SECRET`, `VELLO_ORACLE_SECRET`,
   `VELLO_CRANK_SECRET` must be valid 64-byte keypairs, SOL-funded, and rotatable. (C5 adds alerting for an
   unfunded fee-payer, but the funding/rotation process itself is operational.) `WALLET_ENCRYPTION_KEY` must be
   set (agent keys are plaintext otherwise) and `INTERNAL_CRON_SECRET` is a single-secret blast radius gating
   ~all money mutations — consider splitting/rotating.
7. **Rust review item (numeric).** Post-deadline `claim_payout` (lib.rs:474) skips the staleness check and relies
   on `last_accrual_slot + dispute_window < deadline + REFUND_GRACE_SECS(6h)`. Safe only if the operator keeps
   the mainnet dispute window well under the 27000-slot cap; verify numerically at the chosen mainnet params.

---

## C. Deploy, merge-back, residual risks & recommendations

All 10 fixes are TDD commits on `fix/mainnet-money` (a worktree off `dev`@`3d88ee1`); nothing was deployed.
Baseline held on every commit (tsc ≤ 84, vitest = 17 pre-existing fails + the new passing tests). The branch
diff is 30 files, +1479/−85 — money source + tests only, no unrelated churn.

### C.1 Deploy sequence (human) — order matters
1. **`npx convex deploy` FIRST.** Several fixes add/change Convex functions/indexes and the routes that call them
   will 500 ("function/index not found") until the backend has them: **F1-0** adds `shareRedemptions.pendingPayoutSumForMint`
   (the withdraw route calls it) and **C6** adds the `feeSettlements.by_mint_paid` index (reconcile queries it).
   Also changed on the backend: C1 (scheduledContent), C2 (campaigns.create), C3 (mintFee/nftAgents), C4 (clipJobs),
   C11 (clipJobs), C12 (usage).
2. **Recommended once:** `npx convex run usage:backfillSettlementPaid` — C6 is correct without it (it reads the legacy
   `paid===undefined` bucket too), but backfilling keeps that bucket small and the scan cheap.
3. **THEN push + Railway rebuild** (route/lib/client changes baked at build): C1 (social/post + drip lib), C4
   (clipChargeGate lib), C5 (recover-settlements route + settlementSignerHealth + usdcTransfer), C10 (contentRewardSubmit lib),
   F1-0 (withdraw route).
4. **Optional env:** `VELLO_MIN_SETTLEMENT_SIGNER_SOL` (C5; defaults to `VELLO_MIN_SIGNER_SOL`, 0.05 SOL). No new required env.

### C.2 Merge-back to `dev` (human) — `dev` advanced 13 commits since the branch point
Expect conflicts in **5 overlapping files**: `app/api/social/post/route.ts`, `convex/campaigns.ts`, `convex/clipJobs.ts`,
`convex/schema.ts`, `convex/usage.ts`. dev independently added: X/Twitter auto-post failure detection (social/post),
a *reject-campaign-budget-below-per-1K-rate* gate (campaigns — its own money fix, compatible with C2), admin-editable
marketplace pricing (an override table + a resolver at `recordUsage` — touches `usage.ts` + `schema.ts`, near C4/C6/C12),
and an inspector/clip-node redesign (clipJobs-adjacent). All conflicts are localized; resolve carefully and re-run
`tsc` + `vitest` after the merge. (These 13 dev commits are NOT reviewed here — only my 10.)

### C.3 Residual risks (documented, not fixed here)
- **Invest / share market is latent and money-unsafe.** F1-0 is fixed but gated behind the unshipped invest feature;
  `shares.test.ts` fails at baseline and the market UI numbers are fabricated ⇒ do NOT enable invest/redeem in prod
  until the share vault is separately hardened (reconcile-overwrites-NAV, redeem idempotency, on-chain shares).
- **C5 follow-ups:** the vault-authority signer's own SOL-exhaustion strand is still unalerted (only its terminal
  misconfig is); and the fee-payer low-SOL tick-skip also defers vault-enabled recoveries for that tick (fail-closed,
  self-heals). Scope the skip to custodial settlements + add a vault-authority SOL alert as a follow-up.
- **C12 realization:** a swept 0-clip fee is refunded as a compute-tab CREDIT (fully makes an active agent whole via a
  reduced next settlement; a paused agent holds the credit). A true cash clawback would need on-chain settlement reversal.
- **C6 follow-up:** `serviceSpendQuery` (usage.ts) has the same latent unbounded `.take`-of-all-`by_mint` read (display-only).
- **C10 follow-up (human):** the fully race-safe closure needs a Postgres UNIQUE INDEX on `content_rewards_submissions`
  `(content_reward_id, user_id, content_url)` + `.upsert(onConflict, ignoreDuplicates)` — a jobtepi/Supabase migration.
- **Scaling:** audit remaining per-agent `.collect()`s before high volume.

### C.4 Adjudicated — C7 (disputed, NOT a money bug)
`checkFunding` coerces a null balance → 0, so a dual-null RPC read hard-blocks a *funded* wallet's campaign launch with
a fabricated "need N more USDC". This **fails CLOSED** (blocks the launch, never signs/pays on an unknown balance), so
it is a UX false-block, not a money bug. Recommendation: optional cheap fix — distinguish "balance unknown" from
"balance zero" and show a retry state instead of a fake shortfall; not ship-blocking.

### C.5 Final whole-branch review + stacked-HEAD verification
An independent adversarial reviewer traced every fix through source and the cross-cutting interactions.
**Verdict: NO Critical, NO Important issues. All 10 fixes are money-safe, fail-closed, idempotent, and compose
correctly** despite isolated authorship. Independently confirmed: (a) the C6 invariant — the only writers of
`feeSettlements.paid` are `settleTab`(→false), `markSettlementPaid`(→true, guarded, real-sig-required) and
`backfillSettlementPaid`(→`isPaidSig` mirror), so a genuinely-unpaid settlement is never flagged paid ⇒ the
paid-bucket skip cannot under-subtract; (b) C12's negative refund-credit cannot be over-withdrawn — the
pre-existing `serviceSpendQuery` `Math.max(0, tab)` clamp keeps it out of the strict on-chain withdraw floor, so
it is redeemable only as compute credit, never as cash, and it nets correctly into the next `settleTab`; (c) C1's
id-forwarding can't re-pay a settled submission (settled-status + write-once `postedAt` guards + `dueForVerification`
excludes any `verificationDecision`-set row); (d) the C12 test rewrite is legitimate — the old test encoded the bug
(a swept 0-clip fee stayed charged), the new one asserts the agent is made whole while leaving the `feeSettlements`
row intact.

**Stacked-HEAD baseline (all 10 fixes together):** `tsc` = 84 (baseline), `vitest` = 7 failed files = the same 17
pre-existing failing tests + 2 uncollectable — **zero cumulative regression**, plus all new tests passing.

Minor notes (none block mainnet, dispositions):
- C6 legacy `paid===undefined` read is capped at 5000 → on carried-over devnet data with >5000 pre-backfill rows,
  reconcile fails closed (stale mirror, safe) until `backfillSettlementPaid` runs; not reachable on fresh mainnet
  (every new row is written with `paid`). Deploy dependency (§C.1).
- C12's charge scan widened to a `.collect()` over the 48h window (bounded in practice by the daily cap; a throw
  fails closed — run stays charged, no double-pay). Same pattern as `hasRunSkillCharge`.
- C5's unhealthy-fee-payer skip halts the whole recover-settlements tick (incl. vault-agent settlements that don't
  need the fee-payer) — liveness only, during an already-alerted drain (see §C.3 follow-up).
- C10: duplicate `content_rewards_submissions` rows are DISPLAY-only and never trigger an RM payout — jobtepi's RM
  rail is manual + gated on `payout_status==="requested"`, and agent submissions are auto-approved (never "requested").
  So the dedup reduces double-display and never under-pays; "no money-path change" holds.
- Pre-existing (NOT introduced here): `markSettlementPaid` would accept an empty-string sig (`isInflight("")` is
  false) and set `paid:true` with `isPaidSig("")===false` — unreachable, the keeper always passes a real confirmed
  base58 sig. Flagged for a future hardening pass, not a regression from this branch.
