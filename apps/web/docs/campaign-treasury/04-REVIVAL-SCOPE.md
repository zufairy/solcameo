# Vello-Escrow Revival Scope — On-Chain USDC Reward Payouts

*Author: lead engineer. Source: verified file reads + cross-lane investigation + verification verdicts (verdicts override maps on conflict). Nothing below is invented; every "unknowable-until-build" item is flagged as such.*

---

## 1. TL;DR

- **Current state:** A complete, coherent 11-instruction Anchor program (`apps/web/programs/vello-escrow/src/lib.rs`, ~1092 lines) implementing exactly the boss's view-delta reward model exists in-repo, but it has **never been compiled, deployed, or initialized on any machine** — the entire on-chain rail is runtime-dead.
- **Biggest gotcha — the version triangle:** Rust pins `anchor-lang/anchor-spl = 0.30.1` (Cargo.toml), the JS client pins `@coral-xyz/anchor ^0.32.1` (package.json, resolves 0.32.1), and the handoff doc says "install Anchor 0.32.1 toolchain." **0.32.1 is almost certainly not a real Rust `anchor-lang` crate version** — the coherent point is **0.31.1 across Cargo + anchor-cli + JS.** Pick ONE before touching the toolchain; a CLI-vs-lib skew is the classic IDL-build failure.
- **Close or far from compiling?** **Close — mechanical, not rework.** The borrow model, claim math, idempotency, seeds, and 0.30 API usage all read correct. The *first* `anchor build` will very probably **fail on one concrete line (`lib.rs:742`)** — an `init_if_needed` ATA whose `mint` points at a `Pubkey` field instead of an account. One-line fix. IDL-build emission is the only genuinely unknowable item until a build runs.
- **The ONE missing feature for the boss's exact ask:** **growing-views re-record is not wired.** The contract pays a delta on the *cumulative* attested view count, but the oracle records each clip's views **once at first approval** and the only repeating loop re-records the *same frozen count* to refresh staleness. So today each clip pays once and never catches up as views grow — the opposite of "reward per +1000 new views." This is in-repo CODE work, not toolchain work.
- **Real money reality:** Devnet proves the **algorithm** with **free faucet USDC** — that is what the boss said he wants first ("make sure the algo works"). Mainnet = real money and is **NOT responsible near-term**: the program has zero test coverage, no audit, a custody key that fails *open* to plaintext, single-key upgrade authority, and a client RPC hardcoded to devnet. Stay on devnet until the mainnet gate (audit + tests + custody + multisig + funding) is met.

---

## 2. Current state (verified)

### What EXISTS and is correct
- **The program** (`apps/web/programs/vello-escrow/src/lib.rs`): 11 instructions — `init_platform_config`, `update_platform_config`, `create_campaign`, `top_up`, `record_performance`, `reject_clip`, `claim_payout`, `cancel_campaign`, `refund_remaining`, `register_agent_wallet`, `sweep_to_treasury`. `declare_id! = 4qyfe9phDNJDAUYzt4xQh7453F1zSFQLSs5aubfcoYci`.
- **Correct view-delta payout math** (`claim_payout`, lib.rs:299-413): `accrued = floor(verified_views * rate_per_1k / 1000)` (u128 math), `owed = accrued.saturating_sub(paid)`, `gross = owed.min(budget - reserved)` (budget cap), fee skim `floor(gross * fee_bps / 10000)`, then **effects-before-interactions** (`reserved += gross`, `paid += gross`) and a PDA-signed `token::transfer` of `net` to the beneficiary's USDC ATA + fee to treasury. This is a correct cumulative-accrual incremental delta: **double/concurrent cranks pay exactly 0.**
- **Attestation cleanly separated from disbursement:** oracle-signed `record_performance` (moves no money, `has_one = oracle`) vs permissionless `claim_payout` (cranker pays gas only; funds can reach only the recorded beneficiary + configured treasury).
- **All 6 handoff FIX/BLOCKER items are present in source** (FIX-3 scoped borrow, FIX-5 STATUS_ACTIVE guard, FIX-6 saturating_sub, FIX-4 mint constraint, refund grace, idl-build feature wired). The code reads as 0.30.1-consistent (`ctx.bumps.<field>` struct syntax, `init_if_needed`, `anchor_spl::token::Mint`).
- **The TS client is fully written for the NEW program:** `apps/web/lib/escrow.ts` + `lib/server/escrowServer.ts` use the 2-arg `new Program(idlWithAddress, provider)` and 0.30+ account auto-resolution. `createCampaignTx`, `recordPerformanceTx`, `claimPayoutTx`, `rejectClipTx`, `getPlatformConfig`, `getClaimRecord` all exist. **No client rewrite is needed once the IDL is regenerated.**
- **The off-chain v2 orchestration is fully wired and unit-tested:** crons fire (`runDueOracle` 30 min, `runClaimPayouts` 10 min), the oracle/run v2 branch records + mirrors, the claim keeper reads `ClaimRecord.paid` + credits per-tranche NAV, all idempotency/tranche math is implemented.

### What is DEAD, and WHY
The rail is a no-op **end to end** for four compounding reasons:

1. **Stale IDL = the literal dead-rail cause.** `apps/web/lib/vello-escrow-idl.json` is the **OLD program in the OLD format**: `createCampaign` has only 2 args `{campaignId, budget}`, still carries the removed `approveSubmission` + account `campaignEscrow`, is **missing `recordPerformance` + `claimPayout`**, and uses pre-0.30 shape (`isMut`/`isSigner`/`publicKey` + `metadata.address`, no discriminators). `lib/escrow.ts:135` calls `.createCampaign(campaignId, ratePer1k, budget, deadline)` (4 args) against it → **every `.methods` call mis-encodes and soft-fails → no USDC ever enters a vault.**
2. **Never built/deployed.** No `target/**` artifacts exist anywhere (root, `apps/web/`, `programs/`). No deploy keypair for `4qyfe9…` is in the repo.
3. **Never initialized.** No `init_platform_config` was run → `getPlatformConfig` fails → the claim keeper falls back to env treasury with `feeKnown=false` → `computeClaimSettlement` returns `netDelta=0` → **credits nothing even if the IDL were fixed.**
4. **Secrets unset + no v2 campaign exists.** `VELLO_ORACLE_SECRET`/`VELLO_CRANK_SECRET` are unset → oracle/run takes the `skippedV2` branch, oracle/claim no-ops at the key check. And because `createCampaignTx` soft-fails, `updateCampaignPda({onchainVersion:2})` never runs → **no campaign is ever `onchainVersion>=2`** → `dueForClaim`/`dueForReattest` are always empty → the oracle silently uses the v1 off-chain branch.

> **Note:** This is a Solana/Anchor problem (`cargo-build-sbf` + `anchor` + `solana` CLI). It is entirely unrelated to `npx convex deploy` — Convex only pushes `convex/` functions and has zero coupling to `escrow.ts`.

---

## 3. The revival path (ordered workstreams)

**Owner tags:** `USER-INFRA` = needs the Solana/Anchor toolchain, real funds, or keys the user must run (this Windows PC has no Rust/Solana/Anchor toolchain). `CODE` = another Claude can do in-repo.

The infra spine is **W0 → W1 → W2 → W4 → W5**. The code lanes **W6/W7/W8** can be written in parallel and only need the live IDL/devnet for their final smoke. **W3** (tests) gates W4 on the safety axis.

### W0 — Reconcile the Anchor version  `CODE` (edit) + `USER-INFRA` (confirm crate availability) · **S** · risk: medium
- **Decision:** pin **0.31.1** everywhere (Option A — least churn, removes the npm-vs-crate skew). Edit `programs/vello-escrow/Cargo.toml:20-21` `0.30.1 → 0.31.1` (keep features `init-if-needed`/`token`/`associated_token`/`idl-build`); pin `package.json:21` `@coral-xyz/anchor` to **exactly `0.31.1`** (drop the `^`); update `03-INTEGRATION-HANDOFF.md` from 0.32.1 → 0.31.1 so it stops conflicting with Cargo.
- **Why not 0.32.1:** the Rust `anchor-lang` crate most likely tops out at 0.31.x; "0.32.1" is the **JS** version. Pin the JS *down* to match the CLI/crate the build emits.
- **DoD:** Cargo == anchor-cli == JS == emitted-IDL all 0.31.1; handoff doc no longer says 0.32.1. *(If `cargo` reports 0.30.1 source-incompat on the bump, fall back to keeping Cargo at 0.30.1 + anchor-cli 0.30.1 and pinning JS to 0.30.x — but verify the JS reads the 0.30 IDL.)*

### W1 — Toolchain + program id / keypair  `USER-INFRA` · **M** · risk: high · deps: W0
- Install rustup + solana CLI + `avm`/anchor-cli **0.31.1** on a Linux/WSL/macOS box. Fund a devnet wallet at `~/.config/solana/id.json`.
- **Resolve the program-id keypair.** The `4qyfe9…` keypair is **NOT in the repo.** Two paths:
  - **(a)** If recoverable (boss's machine / backup) → place at `target/deploy/vello_escrow-keypair.json` before deploy, keep `declare_id!` as-is.
  - **(b)** If unrecoverable → `anchor keys sync` (or generate fresh) and update **all three**: `declare_id!` (lib.rs:21), `Anchor.toml:6 [programs.devnet]`, and `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` on every surface.
- **Gotcha:** the program id is **build-baked via `declare_id!`** — if it changes *after* a build you must rebuild. `NEXT_PUBLIC_*` is baked into the Next bundle → a Railway/Next **rebuild** is required after any id change.
- **DoD:** toolchain installed at 0.31.1; funded devnet wallet; a single chosen program id consistent across `declare_id!` + `Anchor.toml` + env, with a keypair on disk.

### W2 — `anchor build` → fix compile errors → regenerate IDL → cp → check  `USER-INFRA` (build) + `CODE` (fixes/cp/harden) · **M** · risk: medium · deps: W0, W1
- **Apply the known compile fix BEFORE the first build (`lib.rs:742`):** `ClaimPayout.beneficiary_usdc_ata` is `init_if_needed` with `associated_token::mint = campaign.usdc_mint`, but `campaign.usdc_mint` is a **`Pubkey` field, not an account** → Anchor's init-ATA codegen calls `.to_account_info()` on it → **E0599**. Change to **`associated_token::mint = usdc_mint`** — the account already present at lib.rs:762, already constrained `== campaign.usdc_mint` at 761. *(~85% this errors; even if 0.30 tolerates it, the fix is harmless. This is the unique offender — the other init ATAs at 596/842 use the account; 732/873 are `mut`/non-init so Pubkey is fine.)*
- Run `anchor build`. Fix any further real errors it surfaces.
- **Regenerate + replace the IDL:** `cp target/idl/vello_escrow.json apps/web/lib/vello-escrow-idl.json`, then `node apps/web/scripts/check-escrow-idl.mjs`.
- **Harden the guard:** `check-escrow-idl.mjs` currently checks **content only** (instruction/account names, case-insensitive) — it would green-light a format-stale IDL. Add assertions for **format**: top-level `address`, per-instruction/account `discriminator`, and **absence** of legacy `isMut`/`publicKey`.
- **DoD:** build succeeds; `target/idl/vello_escrow.json` has **4-arg `create_campaign`** + `recordPerformance` + `claimPayout` + all 4 account types; copied into `lib/`; hardened guard passes. **This single cp is the change that revives `createCampaignTx`.**
- **Unknowable until here:** BLOCKER-1 (idl-build emission) cannot be proven from source — but it is **low-risk** (all standard primitives/String/Pubkey/`[u8;32]`/`[u8;64]`/Option; idl-build feature wired). Do not assert the IDL exists until the build emits it.

### W3 — Rewrite tests + `anchor test`  `CODE` (write) + `USER-INFRA` (run) · **L** · risk: medium · deps: W2
- `apps/web/tests/vello-escrow.ts` targets the **old** program (`campaignEscrow`/`approveSubmission`) and won't compile. Rewrite for the new program covering: **double-crank pays 0**, budget-cap mid-stream, monotonic-noop on view dip, fee skim, **dispute/staleness window boundaries**, refund grace (6h), frozen-clip block, fee-rounds-to-0 on tiny deltas.
- **DoD:** `anchor test` green on a local validator. This is the **#1 pre-mainnet gap** per the handoff and the only way to trust the claim-math before real funds.

### W4 — Deploy to devnet  `USER-INFRA` · **S–M** · risk: medium · deps: W2 (W3 strongly recommended)
- `anchor deploy` to devnet under the W1 keypair. **DoD:** program live at the declared id; explorer confirms.

### W5 — `init_platform_config` + provision/fund oracle & crank keys  `USER-INFRA` · **M** · risk: high · deps: W4
- Run `initPlatformConfigTx` (`escrow.ts:550`) **once** with the real treasury ATA, oracle pubkey, `protocol_fee_bps`, and **`dispute_window_slots` < `max_staleness_slots`** (the program enforces dispute<staleness at lib.rs:66-69).
- **Tune the windows against the real cadence (see §7):** the oracle re-post interval must sit **between** dispute_window and max_staleness, in **slots** (~400ms/slot; ~150 slots/min) vs the **wall-time** crons. Wrong windows = claims never mature or always go stale.
- Set `VELLO_ORACLE_SECRET` + `VELLO_CRANK_SECRET`, fund **each** with devnet SOL (oracle pays `ClaimRecord` rent; crank pays agent-ATA rent + gas), set `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`.
- **DoD:** `getPlatformConfig` succeeds on-chain; both keys funded; campaign rail no longer inert.

### W6 — Growing-views re-record wire (THE BOSS'S ACTUAL ASK)  `CODE` · **M** · risk: medium · deps: W2 (to test)
The contract is *already* built for incremental pay-per-growth; the feed is frozen. Three coupled changes:
1. **Add a re-measure path in `/api/oracle/run`** (augmenting the reattest loop at `run/route.ts:331-363`, which today re-records the **same `s.viewCount`** with `ZERO_SCORE_HASH`): for already-approved-unpaid v2 rows, re-fetch live analytics (`getPostAnalytics` by durable handle) → `scoreSubmission` (peers + fraud gate) → **if approved AND new confirmed cumViews > stored**, call `recordPerformanceTx` with the **NEW cumViews + a real score hash** (not ZERO). Keep the plain slot-refresh reattest as a fallback for rows whose views haven't grown.
2. **Extend `dueForReattest` (or add `dueForRemeasure`)** to project `platformPostId`, `uploadPostRequestId`, `platform`, `postedAt`, `submitterWallet`, **and a measure-interval gate field** (e.g. `lastReattestMeasuredAt`) — today it returns only `viewCount` (`submissions.ts:638`), insufficient to re-fetch/re-score, and re-measuring every 30-min tick would amplify the existing Helius/upload-post 429 firefight.
3. **Recompute + patch `payoutAmountUsdc`** (via `computePayoutUsdc` with the new cumViews) and **reset `claimDone`** on each higher re-record — otherwise `dueForClaim`/`dueForReattest`'s `paid < payout` gate (`submissions.ts:509-524, 628`) never re-opens and the keeper never pays the delta even though on-chain `owed` grew.
- **DoD:** on devnet, a post that gains views triggers a higher `record_performance`, the mirror re-opens, and `claim_payout` pays the new delta to the agent.

### W7 — Connect content-reward / Ryze to an on-chain campaign  `CODE` · **M** · risk: high · deps: W2
**Verdict 2 refutes the assumption that revival alone makes the boss's Ryze case pay.** A Ryze content_reward is a **Supabase-only object** (`content_rewards_submissions`, `contentRewardSubmit.ts:158-199`) — **no on-chain campaign, no ClaimRecord.** The only bridge is `clipJobs.ts:1734-1749`, which creates a Convex submission **only when `getFundedByContentRewardId` returns non-null**, which requires a campaigns row with `contentRewardId==id` **AND** `pdaAddress` **AND** `onchainVersion>=2` (`campaigns.ts:120-127`). **No production code creates that link** — `campaign-form.tsx` omits `contentRewardId` entirely; only tests set it (`submissions.test.ts:834,909-919`). So in prod `getFundedByContentRewardId` is **null forever** and the Ryze reward is never paid USDC.
- **Build the link:** add a path (admin/builder UI or script) that creates a Convex campaign carrying `contentRewardId = the Ryze content_reward id`, funds it via `createCampaignTx`, and sets `onchainVersion:2` via `updateCampaignPda`. The `create` mutation already accepts `contentRewardId` (`campaigns.ts:210`); the `by_content_reward` index exists (`schema.ts:234`).
- **Also harden the silent soft-fail:** `campaign-form.tsx:773-775` catches the escrow throw, `console.warn`s, and redirects to `/stage` anyway — so a campaign can present as created while `onchainVersion:2` (line 772) **never gets set**. Surface a blocking error / "vault unfunded — off-chain only" state so a campaign is never silently left v1-with-no-vault while looking funded.
- **DoD:** a Ryze content_reward maps to a funded v2 vault; `getFundedByContentRewardId` returns it; a clip on that reward creates a submission and gets paid.
- **This is a DISTINCT workstream — not covered by W6.** Even after revival + growing-views, the Ryze case stays dead without it.

### W8 — Confirmation-window + caps placement (off-chain)  `CODE` · **M** · risk: medium · deps: W6
The program enforces **neither** a confirmation window **nor** a per-sync/per-post view cap — its only clamp is the budget cap (`owed.min(remaining)`, lib.rs:350); `record_performance` only enforces monotonicity. So the reward spec's **24h confirmation window** (`confirmedViews = min over trailing confirmWindowHours`, §4.2) and **per-sync/per-post caps** (§4.5) **must be applied off-chain BEFORE `record_performance`** — pass the program only the confirmed, capped cumulative count.
- **DoD:** the oracle feeds `record_performance` a confirmed+capped cumulative; reuse the spec §4 algorithm + a `recentSamples` history store.

### W9 — End-to-end devnet proof  `USER-INFRA` (drive) + `CODE` (smoke script) · **M** · risk: low · deps: all above
- On devnet: create a **funded scaled vault** → post a clip → `oracle/run` records performance (**settled, not `skippedV2`**) → the post accrues **more** views → W6 re-measure re-records higher cumViews → `oracle/claim` cranks `claim_payout`, `ClaimRecord.paid` advances by the delta, beneficiary USDC ATA receives `net`, treasury receives `fee`, a per-tranche distribution row is written → **double-crank pays 0.**
- **DoD:** a screen-recordable run proving "agent paid a USDC reward per +1000 new views from a scaled vault," including the Ryze path via W7.

---

## 4. Devnet demo vs mainnet real-money

### Tier 1 — Devnet (prove the ALGO, what the boss wants first)
Devnet = **free faucet USDC** (`faucet.circle.com`, devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) on a free RPC, throwaway keys, zero real value. It **proves the view-delta payout algorithm end-to-end** without risking a cent. Reaching Tier 1 = **W0–W6 + W9** (W7/W8 to fully prove the boss's exact Ryze case). This is the correct, responsible first milestone and it directly answers "make sure the algo works."

### Tier 2 — Mainnet (real money) — **HARD GATE, all required, none optional**
**Verdict 3 = FALSE: this program cannot hold real mainnet money safely near-term.** You cannot call money-path code "safe" when it has **never compiled.** Before ANY real USDC:

- **(a)** `anchor build` on the pinned toolchain → regenerate `lib/vello-escrow-idl.json` → pass the hardened `check-escrow-idl.mjs`.
- **(b)** Rewrite + **run** the money-path test suite on a real cluster (W3).
- **(c)** An **external money-path audit** — the handoff calls this gap #1. None exists today.
- **(d)** **Custody review — fail CLOSED.** `walletCrypto.ts:81-90` currently **stores the agent secret as plaintext base64 and only warns once** when `WALLET_ENCRYPTION_KEY` is unset. Make it throw on mainnet if unset; run the `encrypt-wallets` backfill to migrate any legacy bare-base64 rows.
- **(e)** **Move upgrade authority to a multisig** (e.g. Squads) and **rotate the pre-committed deploy keypair** (handoff:116). One key today can replace the program and drain **every** vault.
- **(f)** **Fix the devnet-pinned client RPC.** `escrow.ts:15-17` hardcodes `DEVNET_RPC` and `buildEscrowProgram` (escrow.ts:52) **always** uses it regardless of `NEXT_PUBLIC_SOLANA_NETWORK` → on a mainnet deploy the browser create/topUp/cancel path targets **devnet** (wrong cluster/mint). Must use `getRpcUrl(getNetwork())` (`network.ts:35`).
- **(g)** Deploy + `init_platform_config` + SOL-fund the oracle/crank keys with **monitoring + auto-top-up**, else the rail is a silent no-op.

**What a scaled RM50 pot DOES de-risk:** each per-campaign vault is budget-capped on-chain (`owed.min(remaining)`), so a **contract bug in the disbursement path** can lose at most that one vault's funded budget (~RM50) per campaign. A scaled pot is a reasonable blast-radius cap for **vault-logic** risk.

**What RM50 does NOT de-risk — the boss must hear this:**
- **Custody:** agent custodial wallets + the protocol **treasury ATA** are *separate* from the per-campaign vault and hold the **aggregate** real USDC across all agents/campaigns. A fails-open plaintext key (or a `WALLET_ENCRYPTION_KEY` + Convex dual-compromise) drains **all of them**, not RM50.
- **Upgrade authority:** one compromised single key replaces the program and drains **every** vault at once. Per-campaign scaling gives **zero** protection.
- **Routing:** the devnet-RPC bug means RM50 sent to the wrong cluster is still RM50 lost/stuck.

**Bottom line:** putting real mainnet USDC in this contract near-term is **not responsible.** Keep it on devnet (proves the algo with fake USDC) until (b)+(c)+(d)+(e)+(f) land. After that, a **scaled RM50-pot mainnet pilot is the correct first real-money step — never a full RM5000-equivalent before the audit.**

---

## 5. The RM ↔ USDC decision

The boss thinks in **RM**; the chain only knows **USDC base units** (6 dp). `rate_per_1k` and `budget` are stored as `u64` USDC base units (lib.rs:144,962); `createCampaignTx` does `ratePer1k = new BN(Math.floor(ratePer1kUsdc * 1_000_000))` (escrow.ts:119-120). **The program has no RM concept and no FX.** Today `campaign-form.tsx:762-764` passes the operator's numbers **straight through as USDC** with **no peg encoded** — so the RM scaling is an unhandled, implicit manual decision.

**Recommendation — fixed peg captured at campaign creation (NOT live FX):**
1. Boss enters RM figures (campaign RM5000 → scaled pot **RM50** → rate **RM0.20 / 1k views**).
2. Capture a **fixed peg `P` = RM per 1 USDC at creation time**, store it on the campaign mirror for audit (the reward spec §6.4/F27 mandates an *explicit, audited* FX boundary — never implicit).
3. Derive the USDC inputs deterministically:
   - `budgetUsdc = potRM / P` → `budget (base units) = round(budgetUsdc × 1e6)`
   - `ratePer1kUsdc = rateRM / P` → `rate_per_1k (base units) = round(ratePer1kUsdc × 1e6)`

**Worked example (peg illustrative — boss picks the real number):** with `P = 4.70`:
- `budget = round((50 / 4.70) × 1e6) = 10_638_298` base units (≈ 10.64 USDC).
- `rate_per_1k = round((0.20 / 4.70) × 1e6) = 42_553` base units (≈ 0.0426 USDC/1k).
- Check: `accrued(1000 views) = floor(1000 × 42_553 / 1000) = 42_553` = RM0.20 at peg. ✔

**Why fixed, not live FX:** a live rate makes a fixed-budget vault drift into under- or over-funding as FX moves between top-up and payout. A creation-time peg keeps the vault's RM-denominated promise exact and auditable. **Boss decision needed: pick `P` and the peg policy (per-campaign snapshot recommended).**

---

## 6. How this relates to the off-chain reward spec

The separate spec (`apps/web/docs/superpowers/specs/2026-06-30-view-delta-reward-payout-spec.md`) implements the *same* view-delta algorithm **off-chain** as a custodial RM ledger — **Phase 0** — and defers on-chain to **Phase 3.** Critically, the Convex v2 path is already designed as a **mirror of the chain** (the mirror fields `paidUsdc`/`navCreditedUsdc`/`claimDone` exist), so these are not two divergent algorithms — they are the same algorithm with a different source of truth.

**Recommendation (decisive):**
- **Ship custodial Phase 0 NOW.** It needs **no toolchain**, proves the algorithm immediately, and unblocks the owner-progress UI today. `onchainVersion=1`, Convex ledger is source of truth, pays in RM ledger units.
- **Revive the on-chain rail on DEVNET in PARALLEL** (W0–W9). Same algorithm, chain is source of truth, Convex mirrors it (`onchainVersion=2`), fake USDC. No dependency on Phase 0.
- **Cut over to on-chain as the PRIMARY rail at mainnet, after the §4 gate.** New campaigns flip to `onchainVersion=2` on mainnet; the custodial path remains as legacy/fallback, not the long-term primary.

**Tradeoff, stated plainly:** Phase 0 gives the boss a *working reward today* and de-risks the algorithm before any toolchain or audit cost. The on-chain revival is the *durable deliverable* the user demanded ("the smart contract IS the deliverable") but it is gated on infra the user must run + an audit that takes real time/budget. Running them in parallel means **neither blocks the other**: the progress UI ships on Phase 0 while the contract matures on devnet. **Going straight to devnet-on-chain (skipping Phase 0) is only advisable if the user accepts that the reward UI stays dark until W0–W9 + the keys/deploy all land** — a longer critical path with a hard dependency on the absent toolchain. Given the boss's "make sure the algo works first," **ship Phase 0 + revive on devnet in parallel** is the right call.

---

## 7. Critical risks / make-no-mistake checklist

- [ ] **Version pin (W0).** Cargo 0.30.1 vs JS 0.32.1 vs handoff 0.32.1 must collapse to **one real coherent set (0.31.1 likely).** A CLI-vs-lib skew is the classic IDL-build failure. Resolve before any build.
- [ ] **The `lib.rs:742` compile fix.** First `anchor build` will very probably fail there (`associated_token::mint = campaign.usdc_mint` on an `init_if_needed` ATA, Pubkey-field-not-account → E0599). Fix to `= usdc_mint` before building.
- [ ] **Program id + missing keypair.** `4qyfe9…` keypair is **NOT in the repo.** Either recover it or change `declare_id!` + `Anchor.toml` + `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` together. Id is **build-baked**; `NEXT_PUBLIC_*` is **bundle-baked** → rebuild Next/Railway after any change.
- [ ] **The IDL cp step.** After build, `cp target/idl/vello_escrow.json → apps/web/lib/vello-escrow-idl.json` and run the guard. **Harden the guard for FORMAT** (it only checks names today and would pass a format-stale IDL the JS mis-reads).
- [ ] **Init windows (`dispute_window_slots` < `max_staleness_slots`).** The program enforces dispute<staleness, but **not** that the oracle's real re-post cadence respects it. `claim_payout` requires `now - last_recorded_slot >= dispute_window` (else `InDisputeWindow`) **and** `<= max_staleness` (else `AttestationStale`); the reattest loop refreshes `last_recorded_slot` every tick. So the **re-post interval must sit strictly between the two windows**, and the claim keeper must fire in the gap after maturity. Windows are in **slots (~400ms)**; crons are **wall-time** — convert carefully or claims **never mature / always go stale.**
- [ ] **Oracle + crank keys funded.** Both need SOL (rent + gas). Unfunded = silent stall. Add low-balance alerts.
- [ ] **Content-reward has NO vault (W7).** The Ryze case is Supabase-only with no on-chain campaign; `getFundedByContentRewardId` is null in prod forever. **Revival alone does NOT fix this** — the link is a distinct workstream.
- [ ] **Plaintext agent-key custody.** `WALLET_ENCRYPTION_KEY` unset → secrets stored **verbatim**, warn-once. Fail-closed on mainnet + run the backfill before real funds.
- [ ] **Zero test coverage + no audit.** The committed `tests/vello-escrow.ts` targets the old program. Rewrite + run + audit before mainnet.
- [ ] **Silent escrow soft-fail.** `campaign-form.tsx:773-775` swallows the escrow throw and redirects anyway — a campaign can look funded while `onchainVersion:2` never set. Make it blocking.
- [ ] **Single-key upgrade authority.** Move to a multisig + rotate the pre-committed deploy keypair before mainnet.
- [ ] **`payoutAmountUsdc` recompute (W6).** A higher on-chain `owed` is **inert** unless the mirror's `payoutAmountUsdc` is recomputed and `claimDone` reset per re-record. Easy to forget; without it growing-views pays nobody.
- [ ] **Confirmation window + caps are OFF-CHAIN only (W8).** The program enforces neither — feed it the confirmed, capped cumulative or you over-pay on view spikes/fraud.
- [ ] **`NonMonotonicViews` is intentional dead code.** View dips are keep-and-noop (no revert). Confirm the off-chain oracle does **not** expect a revert on regressions.

---

## 8. Effort roll-up

### (a) Devnet working demo — proves the ALGO with fake USDC
| Lane | Items | Effort |
|---|---|---|
| **USER-INFRA** | W1 toolchain + keypair (M) · W2 run build (M) · W4 deploy devnet (S–M) · W5 init + fund oracle/crank w/ devnet SOL + faucet USDC (M) · W3 run tests (part of L) · W9 drive (M) | **≈ M–L** (a few focused sessions on a Linux/WSL box) |
| **CODE** | W0 version pins (S) · W2 `lib.rs:742` fix + IDL cp + harden guard (S) · W6 growing-views wire (M) · W7 content-reward link + soft-fail harden (M) · W8 confirmation-window/caps off-chain (M) · W3 write tests (L) | **≈ L** |

**Critical path to a devnet demo of the boss's exact ask:** W0 → W1 → W2 → W5 → W6 → W7 → W9. The infra spine (W1/W2/W4/W5) is the long pole because the toolchain is absent on this PC; the CODE lanes can be written in parallel and merged once the live IDL exists.

### (b) Mainnet real-money-ready — additional, on top of (a)
| Lane | Items | Effort |
|---|---|---|
| **USER-INFRA** | External money-path **audit** (third-party, budget + weeks) · move upgrade authority to multisig + rotate keypair (M) · acquire/bridge real USDC + seed treasury (M) · SOL monitoring + auto-top-up (M) · mainnet deploy + init (M) | **≈ XL** (audit dominates the calendar) |
| **CODE** | Fix devnet-pinned client RPC (S, high-value) · enforce `WALLET_ENCRYPTION_KEY` fail-closed + run backfill (S) · encode the RM↔USDC peg (M) · finalize money-path test suite for audit (L, shared with W3) | **≈ M–L** |

**Headline:** the **devnet demo is reachable with modest infra effort + the in-repo code lanes** and is the right next milestone. **Mainnet is gated primarily by the external audit and the custody/multisig hardening — calendar-bound, not just effort-bound — and must not be rushed for real funds.**

---

### Key file references
- Program: `apps/web/programs/vello-escrow/src/lib.rs` (compile fix at **:742**; claim math :299-413; init guard :66-69)
- Cargo pin: `apps/web/programs/vello-escrow/Cargo.toml:20-21` · JS pin: `apps/web/package.json:21`
- Stale IDL (the dead-rail cause): `apps/web/lib/vello-escrow-idl.json` · guard: `apps/web/scripts/check-escrow-idl.mjs`
- TS client: `apps/web/lib/escrow.ts` (devnet-RPC bug :15-17,52; ratePer1k :119-120) · `apps/web/lib/server/escrowServer.ts`
- Custody fail-open: `apps/web/lib/server/walletCrypto.ts:77-90`
- Growing-views wire: `apps/web/app/api/oracle/run/route.ts:331-363` · `apps/web/convex/submissions.ts` (dueForReattest :581-648, gates :509-524,628)
- Content-reward link gap: `apps/web/convex/campaigns.ts:109-128,210` · `apps/web/convex/clipJobs.ts:1734-1749` · `apps/web/lib/server/contentRewardSubmit.ts:158-199` · `apps/web/components/.../campaign-form.tsx:716-734,762-775`
- Network/mint: `apps/web/lib/solana/network.ts` · Runbook: `apps/web/docs/campaign-treasury/03-INTEGRATION-HANDOFF.md` · Off-chain spec: `apps/web/docs/superpowers/specs/2026-06-30-view-delta-reward-payout-spec.md`