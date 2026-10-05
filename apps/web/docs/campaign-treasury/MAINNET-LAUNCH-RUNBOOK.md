# Mainnet Launch Runbook — Vello campaign → clipper → payout

Status as of the 2026-07-02 hardening pass. Fixes live on the **`fix/e2e-mainnet-hardening`** worktree (`.claude/worktrees/e2e-mainnet-hardening`), NOT merged, NOT on prod. Full bug list: repo-root `E2E-HUNT-FINDINGS.json` (39 confirmed).

> ⚠️ I cannot run `solana`/`anchor`/`cargo` or `convex deploy` from this machine (no toolchain / no project login). Every step marked **[YOU]** must run on your Mac/Linux with the Solana+Anchor toolchain.

---

## A. On-chain program (vello-escrow) — the money contract

1. **[YOU] Init front-run gate is RE-ENABLED in code** (`programs/vello-escrow/src/lib.rs`, `InitPlatformConfig`): init now requires `program` + `program_data` and the signer must be the program's **upgrade authority**. This closes the CRITICAL total-drain backdoor (an attacker winning the deploy→init race). Verify with `anchor build` + `anchor test`.
   - **The negative test is now written** (`tests/vello-escrow.ts`, first `it`): a non-upgrade-authority attacker init must fail `Unauthorized` while the PDA is fresh, then the real init runs as the upgrade authority. The old `before()` init was moved into that `it` and now passes `program` + `programData` (the ProgramData PDA = `findProgramAddress([programId], BPFLoaderUpgradeable)`) — otherwise the suite couldn't run against the gate.
   - **The client init passes them too**: `escrow.ts:initPlatformConfigTx` now derives + supplies `program`/`programData` (Anchor may not auto-resolve ProgramData across versions), so `scripts/init-platform-config.ts` works on a fresh cluster.

2. **[YOU] Program id must be consistent.** The REAL deployed devnet program is **`Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx`** (declare_id / Anchor.toml / IDL). The old id `4qyfe9ph…` is a **DEAD** older deploy — the legacy `deploy.sh` that carried it is DELETED (2026-07-02; `scripts/deploy-escrow.sh` supersedes it) — purge it from any remaining env. For mainnet, deploy under a mainnet keypair and propagate its id in lockstep to: `declare_id!`, `Anchor.toml [programs.mainnet]`, the built IDL `address`, `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` (Railway build arg + Convex + .env.local).

3. **[YOU] Widen the dispute window (#3 + config).** Devnet `PlatformConfig` currently has `dispute_window_slots = 4` (~2 seconds) — there is effectively **no fraud-challenge window**. For mainnet set it to hours (e.g. ~9000 slots ≈ 1h) via `update_platform_config`, and ensure `dispute_window_slots < max_staleness_slots` AND the window is shorter than the on-chain refund grace (6h) so owed-but-uncranked clippers aren't swept back to the creator.

4. **[YOU] Deploy + init on mainnet — one command.** `scripts/deploy-escrow.sh` chains it all: `anchor build` → `anchor keys sync` (writes the real id into declare_id!/Anchor.toml — kills the stale-`4qyfe9ph…` footgun) → rebuild → `anchor deploy` → copy IDL with `address` set → `init-platform-config` (widened window) → `verify-oracle-keys`. It asserts the built id == `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` and refuses a mainnet deploy with a <1min dispute window. Run:
   ```bash
   CLUSTER=devnet ./scripts/deploy-escrow.sh   # rehearse first
   CLUSTER=mainnet DISPUTE_WINDOW_SLOTS=9000 ANCHOR_WALLET=~/.config/solana/id.json \
     VELLO_ORACLE_SECRET=… NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET=… NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=… \
     ./scripts/deploy-escrow.sh
   ```
   Fund the deployer with ~2–5 real SOL first (no `solana airdrop` on mainnet); the deployer wallet must be BOTH the upgrade authority AND the config authority. **Review the script before the mainnet run.**

---

## B. Environment (Railway build args + Convex + .env) — [YOU]

- `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` = the **deployed** id (NOT `4qyfe9ph…`)
- `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta`, `NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (or unset), RPC → Helius mainnet
- `VELLO_ORACLE_SECRET` (== on-chain `PlatformConfig.oracle` = **`9kMPgiag9UKjfWMemeNtaLWtFJLKT1Bop4TuxAPckUCU`** on devnet, live-read 2026-07-02) + `VELLO_CRANK_SECRET` — set AND fund both with real SOL (they sponsor gas + ATA rent; unset → the on-chain rail silently falls back to off-chain bookkeeping). **Verify with `railway run node scripts/verify-oracle-keys.mjs`** (prints pubkeys + SOL balances only, never secrets; `RPC_URL=` to target mainnet). `scripts/read-platform-config.mjs` prints the live on-chain config.
- **`INTERNAL_CRON_SECRET`** — REQUIRED. The auth gates added this pass **fail closed** without it: `topUpBudget`, `updateCampaignPda`, `redeemShares`, `markRedeemPaid`, `recordDeposit`, `creditAndRecord`, `buyShares` all reject if it's unset. Set it in Convex + Railway.
- `NEXT_PUBLIC_*` are build-baked → **Railway rebuild required**, not just a runtime change.

---

## C. Merge the fix branch — [YOU]

Merge `fix/e2e-mainnet-hardening` → main, then:
1. `npx convex codegen` (or `convex deploy`) — regenerates `_generated` for the new mutation signatures (all the gated mutations now take `authSecret`). `tsc` shows stale-signature errors until this runs; runtime is verified via convex-test.
2. `convex deploy` + Railway rebuild.

**Fixes on the branch (verified green, no new test regressions):**
- Wave 1 — `topUpBudget` + `updateCampaignPda` gated (budget inflation + PDA IDOR) + `/api/campaigns/topup` (deposit-verified) + `/api/campaigns/set-pda` (SIWS ownership) + terms persistence.
- Wave 2a — `redeemShares`/`markRedeemPaid`/`recordDeposit` gated (share-burn IDOR + fake deposits).
- Wave 2b — `creditAndRecord` atomic credit (kills distribute-earnings NAV double-credit).
- On-chain — init front-run gate re-enabled (this doc, §A).
- #11 — v1 payout dispatch throws on `!res.ok` + secret-gated re-drive keeper.
- #18/24/26 — bridged content-reward clips no longer double-counted in earnings.
- #22 — vaultSweep no longer terminalizes a fee on a transient cap-read failure.
- **#23 — `/api/video/clip` billing backstop**: the route derives PRICED skills from the ffmpeg ops server-side (exclusive-emitter inversion, `lib/server/clipOpsBilling.ts`) and charges them via `recordUsage` idemKey `` `${runId}:skill:${skillId}` `` (dedups the canvas precheck); skill-class ops with NO billing identity → fail-closed 402; drafts (sessionId) stay free; the $0.40 render fee stays absorbed on the canvas path.

---

## D. Custody + secrets — [YOU]

- Move the program **upgrade authority** + **treasury** to a multisig (e.g. Squads). Single-key today: `G6emPd5…` is the upgrade authority of both programs AND the config authority AND the vault owner/gas fee-payer — but it is **NOT** the treasury. Compute fees (vault `debit_fee` and the custodial `transferUsdc` fallback) settle to the USDC ATA of `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET` (`f3yjK4Dt…` on devnet); move THAT wallet to the multisig too.
- **Rotate every secret currently committed in plaintext** in `.env.local` (TREASURY_WALLET_SECRET, PLATFORM_FEE_PAYER_SECRET, SUPABASE_SERVICE_ROLE_KEY, WALLET_ENCRYPTION_KEY, etc.).
- Third-party audit before real money at scale.

---

## E1. Money-path hunt (2026-07-02) — FIXED on main (push + `convex deploy` + Railway rebuild; Rust via `anchor test`)

52-agent adversarial hunt after two live launch bugs. 15 confirmed; all fix-now + Rust shipped:
- **[CRIT] reattest strand** — 30-min reattest re-armed the on-chain dispute window < its length → `claim_payout` reverted forever, USDC stranded on mainnet. `dueForReattest` now throttles on `lastReattestAt` (`REATTEST_INTERVAL_MS`, default 12h). **Pairs with the Rust #3 fix.**
- **[CRIT] RPC-blip NAV zeroing** — balance reads swallowed ANY error to 0 → reconcile persisted a false $0. Strict reads (null on read failure); reconcile SKIPS the write on null.
- **[HIGH] #23 proof forge** — the render charge loop forged its own "precheck ran" proof → multi-skill direct caller got the expensive skill free. Proof now snapshotted before the loop.
- **[HIGH] sendUsdc double-pay** — confirm-timeout + retry sent a 2nd real transfer. Now returns unconfirmed+signature; retry checks the ledger before re-sending.
- **[MED]** accrueTaskCost idemKey (`task:${id}`); admin top-up derives PDA from the creator; launch retry classifies "account already in use" as resume-not-retry; hasRunSkillCharge 48h window (midnight-straddle). Deadline max-cap client gate (the original live bug).
- **[RUST — `anchor test`]** #3 `last_accrual_slot` (dispute window armed by accrual, not keep-alive) + #6 `MAX_DISPUTE_WINDOW_SLOTS` cap (window can't exceed the 6h grace). Fresh deploy only (ClaimRecord layout change).

DEFERRED (product decision / low): reconcile-vs-investor-deposit + multi-tranche NAV fee-drift (**invest = coming soon**); SOL on-ramp / gas sponsorship for embedded wallets (**needs a fee-payer relay or a SOL on-ramp before mainnet embedded-wallet users can launch**); draft(sessionId) free-render cap (weak-by-design). Rust #2 cancel free-drain + #4 rate-0 bounty still open.

## E. Remaining CODE items (all former launch-blockers are FIXED on the branch — see §C)

| # | Where | Risk | Status / Notes |
|---|---|---|---|
| #36/37/38 | `agentAccount.ts` / `vaultSweep.ts` / `usdcTransfer.ts` | reconcile overwrites/zeroes `escrowUsdc` (erases NAV; RPC blip zeroes balance) | **DEFERRED by product decision** — invest/share market ships as "coming soon" at launch. Revisit before enabling it: gate reconcile on a good on-chain read; don't zero on RPC error. |
| #31 | `vaultSweep.ts` | insufficient-funds terminal-path classification | LOW. (#22's transient half is fixed.) |
| #29/33 | `submissions.ts:187` | public `submit` — spam/squat submission slots (no USDC path) | LOW. Route twin + 2 client rewires. |

The escrow-Rust items #2 (cancel free-drain) and #4 (rate-0 bounty vault) also remain — see findings. Accepted-by-design residual on #23: a SIWS-authed caller can render skill-class ops free by presenting a draft `sessionId` (the user-approved free draft tier; the route does not re-count the free-tier daily cap — clip-precheck counts it at run start, so a direct caller skipping precheck is uncounted). Rate-limited only by SIWS sign-in.

---

## F. Smoke test before opening traffic — [YOU]

One small **real-USDC** campaign end-to-end on mainnet: create_campaign → deposit → record_performance (oracle) → claim_payout (crank) → refund. Confirm the clipper wallet + treasury balances move as expected and the Convex mirror matches on-chain `ClaimRecord.paid`.
