# Vello-Escrow Revival — End-to-End Execution Plan (for the Mac session)

**Goal:** take the existing-but-dead `vello-escrow` Anchor program from "never compiled" to **a live devnet deployment that pays a clipping agent a USDC reward per +1000 new views, from a scaled-down treasury vault** — then lay out the hard gate before any real (mainnet) money.

**You are:** a Claude session on a **macOS** machine **with the ability to install a full Rust/Solana/Anchor toolchain and run it**. The original analysis was done on a Windows PC with no toolchain, which is why this was never built.

**Read first (context, already written, verified):**
- `apps/web/docs/campaign-treasury/04-REVIVAL-SCOPE.md` — the verified scope this plan executes (file:line citations for every claim).
- `apps/web/docs/campaign-treasury/03-INTEGRATION-HANDOFF.md` — the original runbook (note: it says Anchor 0.32.1 — **that is wrong, see Phase 0**).
- `apps/web/docs/superpowers/specs/2026-06-30-view-delta-reward-payout-spec.md` — the off-chain twin of the same algorithm (the confirmation-window + caps logic you'll reuse off-chain in Phase 5).

**The one-line truth:** the smart contract is **already written and correct** (its `claim_payout` already does `floor(views × rate_per_1k / 1000) − paid`, budget-capped, fee-skimmed, double-crank-safe). This is a **build → deploy → wire-up** job, **not** a write-the-contract job. The literal cause of the dead rail is a single stale file (`lib/vello-escrow-idl.json` = the old program); one `cp` after a good build revives it.

---

## ⚠️ Phase 0 — Decisions & toolchain (do this before anything else)

### 0.1 — Decisions (two are LOCKED below; only the peg needs the boss)

> **Confirmed by the team (2026-06-30):** payout is in **USDC**; the program **has never been deployed — `4qyfe9…` is a dead placeholder id**. That settles the two engineering decisions below.

1. **Program-id keypair → GENERATE FRESH (locked).** The id `4qyfe9phDNJDAUYzt4xQh7453F1zSFQLSs5aubfcoYci` in `declare_id!` (`programs/vello-escrow/src/lib.rs:21`) + `Anchor.toml:6` is an **undeployed placeholder** — there is nothing on-chain to preserve. In Phase 1.3, generate a fresh keypair, `anchor keys sync`, and update all three locations (`declare_id!`, `Anchor.toml:6`, `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`). Do **not** hunt for the old keypair. (Skip the "recover" branch entirely.)

2. **Anchor version → 0.30.1 everywhere (locked).** Pin Cargo + anchor-cli + JS all to **0.30.1** (the version the Rust was written/reviewed against — lowest risk). Details in 0.2. Still run the empirical version check in 0.2 first (confirm the crates/npm versions exist), but the target is 0.30.1.

3. **RM↔USDC peg `P` (boss decision — needed at Phase 5/6, not before).** The chain only knows USDC; the boss thinks in RM. You need a fixed **`P` = RM per 1 USDC**, captured at campaign creation and stored for audit. Boss picks the number (e.g. `P = 4.70`). Do **not** use a live FX feed — it makes a fixed vault drift into under/over-funding. (Math in Appendix B.) **This is the only open input; everything else can proceed without it.**

### 0.2 — Resolve the version triangle (the #1 "make no mistake" gate)

The three pins disagree today:
- Rust `Cargo.toml:20-21` → `anchor-lang`/`anchor-spl = "0.30.1"`
- JS `package.json` → `@coral-xyz/anchor ^0.32.1`
- Handoff doc → "install Anchor 0.32.1"

**Decision: align everything to `0.30.1`, NOT up to 0.31/0.32.** Rationale: the Rust program was written and expert-reviewed against **0.30.1** — bumping the crate *up* risks new compile errors from Anchor's 0.31 breaking changes, for zero benefit. Fix the mismatch by pinning the **JS client down** to match the Rust, and use the **0.30.1 CLI**. (The "0.32.1" in the JS pin is a *JavaScript* version line; do not let it drive the Rust crate version.)

**Before you commit to a number, verify empirically (make no mistake):**
```bash
# Confirm the real available crate + npm versions, don't trust this doc blindly:
cargo search anchor-lang | head            # latest anchor-lang on crates.io
npm view @coral-xyz/anchor versions --json # which JS versions actually exist
avm list                                   # which anchor-cli versions avm can install
```
Then apply the **0.30.1** set (do NOT change `Cargo.toml` if it's already 0.30.1):
- `programs/vello-escrow/Cargo.toml:20-21` → stays `0.30.1` (keep features `init-if-needed`, `token`, `associated_token`, `idl-build`).
- `apps/web/package.json` → set `@coral-xyz/anchor` to exactly **`0.30.1`** (drop the `^`); `npm install` to update the lockfile.
- `apps/web/docs/campaign-treasury/03-INTEGRATION-HANDOFF.md` → change "0.32.1" mentions to "0.30.1" so it stops conflicting.

> **Fallback (only if a 0.30.1 build proves intractable):** bump Cargo + CLI + JS all to **0.31.1** together and fix the handful of 0.31 API deltas the build surfaces. Never split versions across CLI/lib/JS — a CLI-vs-lib skew is the classic IDL-build failure.

### 0.3 — Install the toolchain (macOS; Apple Silicon notes inline)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Solana / Agave CLI — pin a version compatible with anchor 0.30.1.
# anchor 0.30.1 targets the Solana 1.18.x line. VERIFY the exact pair from the
# anchor 0.30.1 release notes before trusting a number; 1.18.26 is the value the
# handoff used and is a safe 1.18.x.
sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Anchor via avm, pinned
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1
anchor --version   # must print 0.30.1
```
**Apple Silicon (M-series) caveat:** the first `anchor build` downloads the SBF platform-tools. If it errors on the platform-tools step, update to the latest `solana-install`/platform-tools or run the build under Rosetta. This is a known macOS-arm friction point, not a code problem.

**Devnet wallet:**
```bash
solana config set --url devnet
solana-keygen new   # creates ~/.config/solana/id.json (this is the upgrade authority + init signer)
solana airdrop 2    # may need to retry / use https://faucet.solana.com
```

**DoD for Phase 0:** `anchor --version` = 0.30.1; `solana --version` prints; funded devnet wallet; the three version pins agree; the three human decisions are answered (or #3 deferred to Phase 5).

---

## Phase 1 — Make it compile

All `anchor` commands run from `apps/web/` (the Anchor workspace root — `Anchor.toml` lives there).

### 1.1 — Apply the known compile fix BEFORE the first build
**File:** `programs/vello-escrow/src/lib.rs`, around **line 742** (the `ClaimPayout` accounts struct, `beneficiary_usdc_ata`).

The `init_if_needed` ATA sets `associated_token::mint = campaign.usdc_mint`, but `campaign.usdc_mint` is a **`Pubkey` field, not an account** → Anchor's init-ATA codegen calls `.to_account_info()` on it → **E0599** compile error.

**Change:**
```rust
// BEFORE (lib.rs:~742)
associated_token::mint = campaign.usdc_mint,
// AFTER  — use the usdc_mint ACCOUNT already in the struct (lib.rs:~762),
//          already constrained `== campaign.usdc_mint` at ~761
associated_token::mint = usdc_mint,
```
(~85% this is needed. The other init ATAs at ~596/~842 already use the account; ~732/~873 are `mut`/non-init so a Pubkey is fine there. Don't touch those.)

### 1.2 — Build and fix anything else it surfaces
```bash
anchor build
```
Expect possibly one or two further mechanical errors (borrow/typing). Fix them in-place; the program logic is sound — do **not** restructure. The handoff's "verify on anchor build" list (`03-INTEGRATION-HANDOFF.md` §"Rust verify list") tells you what each guarded item should be if the compiler complains:
- FIX-3 scoped borrow on the keep-and-noop early return (`record_performance`)
- FIX-5 `STATUS_ACTIVE` (=0) is the active guard
- FIX-6 `saturating_sub` returns `u64` (no `?`)
- FIX-4 the `usdc_mint` constraint (the 1.1 fix)
- refund grace: `i64 checked_add(REFUND_GRACE_SECS)` + `RefundGraceActive` error + `STATUS_CLOSED` exemption on the new `require!`
- BLOCKER-1 `idl-build` feature emission — **only the real build proves this**; it's low-risk (all standard types).

### 1.3 — Generate a fresh program id (REQUIRED — old id is a dead placeholder)
```bash
mkdir -p target/deploy
solana-keygen new -o target/deploy/vello_escrow-keypair.json
anchor keys sync          # writes the new id into declare_id! + Anchor.toml
```
Then update `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` everywhere it appears (.env files, Railway, Dockerfile). **The id is build-baked via `declare_id!`** — if it changes after a build, rebuild. `NEXT_PUBLIC_*` is bundle-baked → a Next/Railway rebuild is required after any id change. Run this **before the final build** so the build bakes the fresh id (if you already ran `anchor build` in 1.2, just `anchor build` again after `keys sync`).

**DoD for Phase 1:** `anchor build` exits 0; `target/idl/vello_escrow.json` exists.

---

## Phase 2 — Regenerate the IDL + revive the TS client

### 2.1 — Copy the fresh IDL over the stale one (THE revival step)
```bash
cp target/idl/vello_escrow.json apps/web/lib/vello-escrow-idl.json
node apps/web/scripts/check-escrow-idl.mjs   # must print up-to-date ✓
```
This single `cp` is what makes `createCampaignTx` (and every `.methods` call in `lib/escrow.ts`) encode correctly. The stale committed IDL was the old 2-arg program; the new one has the 4-arg `create_campaign(campaign_id, rate_per_1k, budget, deadline)` + `record_performance` + `claim_payout` + the `Campaign`/`ClaimRecord`/`PlatformConfig`/`AgentWallet` accounts.

### 2.2 — Harden the IDL guard (CODE)
`apps/web/scripts/check-escrow-idl.mjs` currently checks **names only** (case-insensitive) — it would green-light a *format*-stale IDL the JS mis-reads. Add assertions for the 0.30 format:
- top-level `address` present,
- per-instruction and per-account `discriminator` arrays present,
- **absence** of the legacy `isMut` / `isSigner` / `publicKey` keys.

### 2.3 — Sanity-check the client encodes
The TS client (`lib/escrow.ts`) already targets the new program (2-arg `new Program(idlWithAddress, provider)`, 4-arg `createCampaign`, `recordPerformanceTx`, `claimPayoutTx`, typed readers). No client rewrite needed. Confirm `apps/web` typechecks:
```bash
cd apps/web && npm run typecheck   # or tsc --noEmit / next build's type step
```

**DoD for Phase 2:** hardened `check-escrow-idl.mjs` passes; `lib/vello-escrow-idl.json` has the 4-arg `create_campaign` + `claimPayout`; `apps/web` typechecks.

---

## Phase 3 — Tests (the #1 pre-mainnet gap)

`apps/web/tests/vello-escrow.ts` targets the **old** program and won't compile. Rewrite it for the new program. Minimum coverage (these are the money-path invariants — do not skip):
- **double-crank pays 0** (idempotency),
- budget-cap clamp mid-stream (`owed.min(remaining)`),
- monotonic-noop on a view **dip** (no revert, keep-and-noop),
- **fee skim** to treasury (and fee rounds to 0 on tiny deltas),
- **dispute-window** block (claim before maturity reverts `InDisputeWindow`),
- **staleness** block (claim after max-staleness reverts `AttestationStale`),
- refund grace (6h post-deadline) + `status==Closed` idempotent re-refund,
- frozen-clip (`reject_clip`) can't claim,
- empty/invalid window config rejected at `init_platform_config`.

Add `tests/tsconfig.json` (commonjs, `resolveJsonModule`) and point `Anchor.toml`'s `[scripts].test` at it (already set to `npx ts-mocha … tests/**/*.ts`).
```bash
anchor test   # spins a local validator, runs the suite
```
**DoD for Phase 3:** `anchor test` green on a local validator.

---

## Phase 4 — Deploy to devnet + initialize

### 4.1 — Deploy
```bash
anchor deploy --provider.cluster devnet --program-keypair target/deploy/vello_escrow-keypair.json
```
Confirm on an explorer that the program is live at the declared id.

### 4.2 — Initialize platform config (the rail is dead until this exists)
Run `initPlatformConfigTx` (`lib/escrow.ts:550`) **once**, signed by the admin wallet, with:
```
oracle   = pubkey of VELLO_ORACLE_SECRET
treasury = treasury wallet owner (must have a devnet-USDC ATA)
feeBps   = 500            # 5% (0 to disable)
disputeWindowSlots = ~150   # ~1 min on devnet
maxStalenessSlots  = ~30000 # generous (hours)
```
**Critical window math (make no mistake):** the program enforces `dispute_window_slots < max_staleness_slots` (`lib.rs:66-69`). But you must *also* tune them against the **real oracle cadence**: a claim matures only when `now − last_recorded_slot >= dispute_window` AND `<= max_staleness`. Windows are in **slots (~400ms each, ~150/min)**; the crons run on **wall-time**. So:
- `dispute_window` must be **shorter** than how often the claim keeper runs (10 min) so claims mature,
- `max_staleness` must be **longer** than the oracle re-record interval (so an approved clip never goes `AttestationStale` between re-records),
- the re-record interval must sit **strictly between** the two.
Get this wrong and claims either never mature or always go stale.

### 4.3 — Provision + fund the keeper keys
- Set `VELLO_ORACLE_SECRET` and `VELLO_CRANK_SECRET` (base64 64-byte keys; may be the same key) in the **Convex deployment env** and Next env.
- **Fund each with devnet SOL** — oracle pays `ClaimRecord` rent; crank pays the agent-ATA rent + gas. Unfunded = silent stall. Add a low-balance check.
- Set `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`, `INTERNAL_CRON_SECRET`, and a **publicly reachable** `NEXT_PUBLIC_APP_URL` (the crons POST to it; not localhost).

**DoD for Phase 4:** program live on devnet; `getPlatformConfig(program)` resolves on-chain; both keeper keys funded; a manual `createCampaignTx` against devnet funds a vault (USDC leaves your ATA).

---

## Phase 5 — Wire the boss's actual ask (CODE; needs the live IDL to test)

Reviving the program makes it *payable*, but two things still stand between you and "reward per +1000 new views for the Ryze case." Both are in-repo code.

### 5.1 — W6: growing-views re-record (without this, each clip pays ONCE and never catches up)
The contract pays on the **cumulative** attested view count, but the oracle records a clip's views **once at approval** and the only repeating loop (`dueForReattest`) re-records the **same frozen count** just to refresh staleness. Three coupled changes:

1. **Add a re-measure path in `/api/oracle/run`** (augment the reattest loop at `app/api/oracle/run/route.ts:331-363`): for already-approved-unpaid v2 rows, re-fetch live analytics (`getPostAnalytics` by durable handle) → `scoreSubmission` (with peers + fraud gate) → **if approved AND new confirmed cumViews > stored**, call `recordPerformanceTx` with the **new cumViews + a real score hash** (not `ZERO_SCORE_HASH`). Keep the plain slot-refresh reattest as the fallback for rows whose views didn't grow.
2. **Extend `dueForReattest`** (or add `dueForRemeasure`) in `convex/submissions.ts` to project `platformPostId`, `uploadPostRequestId`, `platform`, `postedAt`, `submitterWallet`, **and a measure-interval gate** (e.g. `lastReattestMeasuredAt`) — today it returns only `viewCount` (`submissions.ts:638`), and re-measuring on every 30-min tick would amplify the existing Helius/upload-post 429 problem. Gate the re-measure to a sane cadence (e.g. every few hours).
3. **Recompute `payoutAmountUsdc` + reset `claimDone`** on each higher re-record (via `computePayoutUsdc` with the new cumViews). Otherwise the `paid < payout` gate in `dueForClaim`/`dueForReattest` (`submissions.ts:509-524, 628`) never re-opens and the keeper never pays the new delta even though on-chain `owed` grew.

**DoD:** on devnet, a post that gains views → a higher `record_performance` → the mirror re-opens → `claim_payout` pays the new delta to the agent ATA.

### 5.2 — W7: connect a Ryze content-reward to an on-chain campaign (it has NO vault today)
A Stage-`/reward` content-reward is a **Supabase-only object** — there is **no on-chain campaign and no ClaimRecord** for it. The only bridge (`convex/clipJobs.ts:1734-1749`) creates a payable submission **only when `getFundedByContentRewardId` returns non-null**, which needs a `campaigns` row with `contentRewardId == id` **AND** `pdaAddress` **AND** `onchainVersion >= 2` (`campaigns.ts:120-127`). **No production code ever creates that link** (`campaign-form.tsx` omits `contentRewardId`; only tests set it). So in prod `getFundedByContentRewardId` is null forever and the Ryze reward is never paid.

- **Build the link:** an admin action / script that, for a chosen Ryze content_reward id, creates a Convex campaign carrying `contentRewardId = <that id>`, funds it via `createCampaignTx` (native USDC rate, Appendix B — no peg), and sets `onchainVersion: 2` via `updateCampaignPda`. The `create` mutation already accepts `contentRewardId` (`campaigns.ts:210`); the `by_content_reward` index exists (`schema.ts:234`).
- **Harden the silent soft-fail:** `campaign-form.tsx:773-775` currently catches the escrow throw, `console.warn`s, and redirects anyway — so a campaign can look created while `onchainVersion:2` (line 772) never gets set. Make that a **blocking error / "vault unfunded — off-chain only"** state.

**DoD:** a Ryze content_reward maps to a funded v2 vault; `getFundedByContentRewardId` returns it; a clip on that reward creates a submission and gets paid USDC.

### 5.3 — W8: confirmation window + caps stay OFF-CHAIN
The program enforces **neither** a confirmation window **nor** a per-sync/per-post cap — its only clamp is the budget. So the reward spec's **24h confirmation window** (`confirmedViews = min over the trailing window`, spec §4.2) and **per-sync/per-post caps** (§4.5) must be applied **off-chain, before `record_performance`** — feed the program only the confirmed, capped cumulative count. Reuse the spec's `computePostAccrual` confirmation logic + a `recentSamples` history store; the on-chain call receives the already-confirmed number.

**DoD:** the oracle never records an unconfirmed spike; a bought/transient spike that decays is never attested, so it's never paid.

---

## Phase 6 — End-to-end devnet proof

Drive the full loop on devnet (fake USDC, zero real value):
1. Create a **funded scaled vault** for a Ryze content_reward (native USDC, no peg — Appendix B; e.g. budget ~10 USDC, rate ~0.05 USDC/1k).
2. Post a clip on that reward → `oracle/run` **records performance** (settled, not `skippedV2`).
3. The post gains views → the W6 re-measure records a **higher** cumViews.
4. `oracle/claim` cranks `claim_payout` → `ClaimRecord.paid` advances by the delta → the agent's USDC ATA receives `net`, the treasury receives `fee` → a per-tranche distribution row is written.
5. Re-crank immediately → **pays 0** (idempotency proven).

**DoD:** a screen-recordable run proving "an agent was paid a USDC reward per +1000 new views, from a scaled vault, including the Ryze path." This is the deliverable that answers the boss's "make sure the algo works."

---

## Phase 7 — Mainnet real-money gate (do NOT skip any item)

Devnet proves the algorithm. **Real mainnet USDC is not responsible until ALL of the following land** — the program has never compiled until this plan, has zero audit, and has custody/authority risks a scaled pot does **not** cover:

- [ ] **(a)** Rewrite + **run** the money-path test suite on a real cluster (Phase 3) — green.
- [ ] **(b)** **External money-path audit** of the program (the handoff calls this gap #1; none exists). This is calendar-bound (weeks + budget), not just effort.
- [ ] **(c)** **Custody — fail CLOSED.** `lib/server/walletCrypto.ts:81-90` stores the agent secret as **plaintext base64 and only warns once** if `WALLET_ENCRYPTION_KEY` is unset. Make it **throw on mainnet** when unset; run the `encrypt-wallets` backfill to migrate legacy bare-base64 rows. (Agent custodial wallets + the treasury ATA hold the **aggregate** real USDC — a fail-open key drains *all* of it, not one RM50 vault.)
- [ ] **(d)** **Move upgrade authority to a multisig** (e.g. Squads) and **rotate the pre-committed deploy keypair** (handoff:116). One key today can replace the program and drain **every** vault — per-campaign scaling gives zero protection here.
- [ ] **(e)** **Fix the devnet-pinned client RPC.** `lib/escrow.ts:15-17` hardcodes `DEVNET_RPC` and `buildEscrowProgram` (`:52`) **always** uses it regardless of `NEXT_PUBLIC_SOLANA_NETWORK` → on mainnet the browser create/topUp/cancel path would hit **devnet** (wrong cluster/mint). Switch to `getRpcUrl(getNetwork())` (`lib/solana/network.ts:35`).
- [ ] **(f)** Mainnet deploy + `init_platform_config` + **SOL-fund the keeper keys with monitoring + auto-top-up**.
- [ ] **(g)** Acquire/bridge **real USDC**, seed the treasury, and start with a **scaled RM50-equivalent pilot — never a full RM5000-equivalent before the audit.**

A scaled pot caps the blast radius of a **vault-logic** bug (~one vault's budget). It does **nothing** for custody, upgrade-authority, or wrong-cluster routing. Say this to the boss plainly.

---

## How this relates to the off-chain reward spec (recommended sequencing)

The off-chain spec (`…/2026-06-30-view-delta-reward-payout-spec.md`) implements the **same algorithm** as a custodial RM ledger (Phase 0 there), and the Convex v2 path is already designed as a **mirror of the chain** — so these are not two divergent algorithms, just one algorithm with two sources of truth.

**Recommended:** ship the **custodial Phase 0 now** (no toolchain, proves the algo today, unblocks the owner-progress UI) **and** execute this on-chain plan on **devnet in parallel**. Cut over to on-chain as the **primary** rail at mainnet, after Phase 7. Going straight to on-chain-only means the reward UI stays dark until the whole toolchain/deploy/keys chain lands — a longer critical path. Parallel is the call.

---

## Appendix A — Make-no-mistake checklist (quick reference)
- [ ] Version pins collapsed to **0.30.1** across Cargo + anchor-cli + JS (Phase 0.2).
- [ ] `lib.rs:742` mint fix applied **before** first build (Phase 1.1).
- [ ] Program-id keypair: **generate fresh** (old id is a dead placeholder) + update declare_id/Anchor.toml/env (Phase 0.1/1.3).
- [ ] Payout is **native USDC, no fiat peg**; per-1k rate is **admin-configurable** and rate changes are **prospective only** (never reprice history) — Appendix B.
- [ ] `cp target/idl → lib/vello-escrow-idl.json` done **and** the guard hardened for format (Phase 2).
- [ ] `init_platform_config` windows: dispute < staleness, both tuned to the cron cadence, in **slots** not wall-time (Phase 4.2).
- [ ] Oracle + crank keys **funded** with SOL; low-balance alert (Phase 4.3).
- [ ] W6 growing-views: also recompute `payoutAmountUsdc` + reset `claimDone`, else delta never pays (Phase 5.1).
- [ ] W7: a content_reward has **no vault** until you build the campaign link — revival alone never pays Ryze (Phase 5.2).
- [ ] W8: confirmation window + caps are **off-chain only** — never record an unconfirmed spike (Phase 5.3).
- [ ] Mainnet: nothing real until audit + tests + fail-closed custody + multisig + RPC fix (Phase 7).

## Appendix B — Payout rate: native USDC, NO fiat peg, admin-configurable (UPDATED 2026-06-30)
**Decision (locked):** there is **no RM↔USDC peg**. The payout is **native USDC**. The admin enters the rate **directly in USDC** — "X USDC per 1000 views" and "Y USDC budget" — no fiat conversion, no FX, no `P`. Everything below about a peg is **removed**.

```
rate_per_1k (base units) = round(ratePer1kUsdc × 1e6)   # e.g. 0.05 USDC/1k → 50_000
budget      (base units) = round(budgetUsdc    × 1e6)   # e.g. 10  USDC     → 10_000_000
check: accrued(1000 views) = floor(1000 × 50_000 / 1000) = 50_000 = 0.05 USDC ✓
```
`createCampaignTx(program, campaignId, budgetUsdc, ratePer1kUsdc, deadlineUnix)` already does the `× 1e6` floor internally (`lib/escrow.ts:119-120`) — pass it the USDC numbers directly.

### B.1 — The rate MUST be changeable later (boss requirement)
"Make sure later I can change how much the AI clipper agents get paid." Build an **admin control to set/change the per-1k USDC payout rate** for a campaign's clipper agents. **Design constraint (the trap the audit MUST enforce):** the on-chain `claim_payout` computes `accrued = floor(verified_views × rate_per_1k / 1000)`, so **naively mutating `rate_per_1k` reprices the WHOLE history** (every already-counted view re-priced at the new rate) — the same retroactive-rate bug the off-chain spec caught (F6/F32). A rate change MUST be **prospective only**. Choose ONE and have the swarm design + audit it:
- **(Recommended) Settle-then-reprice:** on a rate change, the engine records the current accrued-at-old-rate as a fixed baseline (a paid/owed checkpoint), then applies the new rate only to **future** view growth. Off-chain this is the spec's incremental-accrual model; on-chain it needs either a new `update_campaign_rate` instruction that snapshots `accrued`/`paid` into a baseline, OR a fresh campaign per rate epoch.
- **(Simplest, no Rust change) New campaign per rate:** changing the rate = create a new on-chain campaign at the new rate; the old one is cancelled/refunded. Safe, prospective by construction, but fragments history across campaigns.
- The admin UI must **confirm-preview** any rate change and **audit-log** it (who/old/new/when). Never silently reprice.

**DoD for the configurable rate:** an admin can change a campaign's clipper per-1k USDC rate; already-counted views are **never** re-priced; the change is audit-logged; a test proves a rate raise/cut affects only views counted **after** the change.

## Appendix C — Key file map
- Program: `apps/web/programs/vello-escrow/src/lib.rs` (compile fix **:742**; claim math :299-413; init window guard :66-69; `declare_id!` :21)
- Pins: `programs/vello-escrow/Cargo.toml:20-21` · `apps/web/package.json` (@coral-xyz/anchor) · `Anchor.toml:6`
- IDL (dead-rail cause): `apps/web/lib/vello-escrow-idl.json` · guard: `apps/web/scripts/check-escrow-idl.mjs`
- TS client: `apps/web/lib/escrow.ts` (RPC bug :15-17,52; ratePer1k :119-120; initPlatformConfigTx :550) · `apps/web/lib/server/escrowServer.ts`
- Custody fail-open: `apps/web/lib/server/walletCrypto.ts:77-90`
- W6 growing-views: `apps/web/app/api/oracle/run/route.ts:331-363` · `apps/web/convex/submissions.ts` (dueForReattest :581-648, gates :509-524,628)
- W7 content-reward link: `apps/web/convex/campaigns.ts:109-128,210` · `apps/web/convex/clipJobs.ts:1734-1749` · `apps/web/lib/server/contentRewardSubmit.ts:158-199` · `apps/web/components/campaign/campaign-form.tsx:716-734,762-775`
- Network/mint: `apps/web/lib/solana/network.ts`
- Crons: `apps/web/convex/crons.ts` (runDueOracle 30m, runClaimPayouts 10m)
- Prior docs: `04-REVIVAL-SCOPE.md` (scope) · `03-INTEGRATION-HANDOFF.md` (original runbook) · `…/specs/2026-06-30-view-delta-reward-payout-spec.md` (off-chain twin)
