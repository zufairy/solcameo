# Oracle ⟷ Campaign-Treasury — Integration Handoff (oracle-layer session)

**Status:** TS/Convex integration COMPLETE + green. Rust program fixed by expert review (uncompiled — `anchor build` is the gate). On-chain execution is wired but **runtime-dead until you build + deploy + regenerate the IDL**.

Branch: `worktree-oracle-layer`. Integration commits (on top of the main-merge `45e7ee6`):

| Commit | What |
|---|---|
| `cc07086` | **Rust fixes** — `idl-build` feature; pin `beneficiary` at first-record; monotonic keep-and-noop; dispute<staleness window guard; `usdc_mint` constraint on `ClaimPayout`; `status==Active` on `claim_payout`; `saturating_sub` on owed. |
| `96287f3` | **escrow.ts server side** — `lib/server/escrowServer.ts` (`buildServerEscrowProgram`/`loadKeypair`); `getClaimRecord`/`getCampaignAccount`/`getPlatformConfig`/`initPlatformConfigTx`/`updatePlatformConfigTx`; PDA-parity tests. |
| `03ce744` | **Convex mirror** — `computePayoutUsdc`→`Math.floor`; `markVerified` gated on `onchainVersion` (v1 keeps off-chain dispatch, v2 = pure mirror); `dueForClaim` query; `markPaidOnchain` mutation; schema `onchainVersion`/`paidUsdc`/`claimPda`; `dueForVerification` projection extended with `agentWallet`/`creatorWallet`/`onchainVersion`. |
| `df7cd87` | **On-chain wiring** — `record_performance`/`reject_clip` in `/api/oracle/run` (v2-gated); `claim_payout` keeper (`/api/oracle/claim` route + `runClaimPayouts` cron, 10 min); NAV credit re-anchored to the **net** on-chain payout; `campaign-form.tsx` `rate_per_1k=0` bug fixed + sets `onchainVersion:2`. |

## Post-audit fixes (this session)
An adversarial audit (6 reviewers, 31 raw → **21 confirmed**, 9 *important*) was run over the integration AFTER the first wiring above. **Every important TS/Convex money bug it found was fixed** — no Rust change was needed for any of them except the refund grace (the on-chain program was already correct on the rest). Fixes applied this session:

| Commit | What it fixes |
|---|---|
| `9f59915` | **Claim-path correctness** — terminal `claimDone` flag so a wedged row leaves `dueForClaim` instead of cranking real $0-pay Solana txs every 10 min forever; **per-tranche durable NAV** (founder shares + escrow credited on each cumulative-paid tranche, not once per `submissionId`) so multi-tranche payouts (budget-capped partial fills + later top-ups) no longer under-mint builder equity; **fee-known fail-closed** (don't settle a v2 net credit when the on-chain fee basis is unknown). |
| `cbbdefd` | **Re-attest already-approved-unpaid v2 rows every cycle** (`dueForReattest`) — re-records the same cumulative views each 30-min oracle tick to refresh `last_recorded_slot`, so an approved clip can never go permanently `AttestationStale` while the claim keeper is briefly unreachable (the spec's "re-post every poll cycle" model). Also **skip-not-settle** for a v2 row when `VELLO_ORACLE_SECRET` is unset (leaves `verificationDecision` unset so the row re-enters `dueForVerification` and auto-heals once the key lands — closes the silent-strand-then-burn-`spentUsdc` trap). |
| `fb47329` | **Network-derived USDC mint** (no more hardcoded `DEVNET_USDC_MINT`); **webhook defers v2 settlement to the worker** (v2 rows aren't off-chain-dispatched from the webhook); **`.env.example`** keys for the new oracle/crank rail; **stale-IDL guard script** (`check-escrow-idl.mjs`) wired so a forgotten `cp` of the regenerated IDL fails loudly. |
| *(this commit)* | **Rust `refund_remaining` grace window** — see the Rust verify list below. |

## Transition safety (important)
New on-chain behavior is gated on `campaigns.onchainVersion >= 2`. **Existing campaigns (no version = v1) keep the exact old off-chain path** — nothing breaks during rollout. A campaign becomes v2 only when created via the fixed `campaign-form` (which funds the on-chain vault and sets `onchainVersion:2`).

## End-to-end flow (v2)
`createCampaignTx(rate_per_1k, budget, deadline)` funds the vault → agent posts → `runDueOracle` (30 min) verifies → **`record_performance`** (signed by `VELLO_ORACLE_SECRET`, cumulative views, moves no money) → `settleFromOracle` mirror with the real on-chain sig → **`runClaimPayouts`** (10 min) cranks **`claim_payout`** (signed by `VELLO_CRANK_SECRET`) → USDC vault→agent ATA (budget-clamped, no double-pay) → `markPaidOnchain` mirror → NAV credit on the **net** (real-backed; fixes the dilution bug).

---

## YOU MUST RUN (on a machine with the Anchor/Solana toolchain — none on this PC)

All `anchor` commands run from `apps/web/` (the Anchor workspace root).

### 1. Toolchain — match the JS lib (`@coral-xyz/anchor` is **0.32.1** in this repo)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"
sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"   # solana/agave 1.18.26
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1 && avm use 0.32.1 && anchor --version    # MUST match the JS lib (0.32.1)
```
> ⚠️ `programs/vello-escrow/Cargo.toml` pins `anchor-lang`/`anchor-spl` — confirm they're `0.32.x` to match the CLI + the JS lib, or the IDL format the TS client expects won't line up. (the legacy `deploy.sh` that installed `avm latest` is deleted — use `scripts/deploy-escrow.sh` with a pinned toolchain.)

### 2. Devnet wallet + funds
```bash
solana config set --url devnet
# ~/.config/solana/id.json is the upgrade authority + init_platform_config signer
solana airdrop 2 || true
```

### 3. Program id (devnet: fresh id, abandon old PDAs — they have the incompatible old layout)
```bash
cd apps/web && mkdir -p target/deploy && solana-keygen new -o target/deploy/vello_escrow-keypair.json
anchor keys sync   # writes the new id into declare_id! + Anchor.toml
# update NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID everywhere (.env.example, Railway, Dockerfile)
```

### 4. Build → regenerate IDL (THE heal step) → test → deploy
```bash
anchor build                                              # EXPECT compile errors → fix per the list below
cp target/idl/vello_escrow.json lib/vello-escrow-idl.json # heals the ENTIRE TS client (escrow.ts/escrowServer.ts already expect the new shape)
node scripts/check-escrow-idl.mjs                         # AFTER the cp: fails if the IDL is still stale (forgot the cp) — must print "up to date ✓"
# (rewrite tests/vello-escrow.ts — the committed one tests the OLD program; see "tests" below)
anchor test
anchor deploy --provider.cluster devnet --program-keypair target/deploy/vello_escrow-keypair.json
```

### 5. Init platform config (one-time, AFTER deploy — the whole oracle/claim path is dead until this exists)
Use the new `initPlatformConfigTx` (lib/escrow.ts), signed by the admin wallet:
```
initPlatformConfig(
  oracle   = <pubkey of VELLO_ORACLE_SECRET>,
  treasury = <treasury wallet; must have a devnet-USDC ATA>,
  feeBps   = 500,                 // 5% protocol fee (0 to disable)
  disputeWindowSlots = ~150,      // ~1 min on devnet; MUST be < maxStaleness
  maxStalenessSlots  = ~30000,    // generous (hours); MUST exceed the 30-min oracle cadence or every claim reverts AttestationStale
)
```

### 6. Env keys to provision (Convex deployment env + Next env)
| Var | Purpose | Needs |
|---|---|---|
| `VELLO_ORACLE_SECRET` | signs `record_performance`/`reject_clip`; = `PlatformConfig.oracle`; rent payer for `ClaimRecord` | base64 64-byte key; **funded with SOL** |
| `VELLO_CRANK_SECRET` | signs `claim_payout`; rent payer for the agent ATA + gas (may equal the oracle key) | base64 64-byte key; **funded with SOL** |
| `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID` | the program id | update if you generated a fresh id |
| `INTERNAL_CRON_SECRET`, `NEXT_PUBLIC_APP_URL` | the keeper crons (must be set in the **Convex** env; `APP_URL` must be publicly reachable, not localhost) | existing |

### Rust "verify on `anchor build`" list (flagged by the fixer — cannot compile here)
1. **FIX-3 borrow:** the keep-and-noop early `return Ok(())` fires inside the `&mut ctx.accounts.claim` scope — should be fine (return drops the borrow) but confirm.
2. **FIX-5 status constant** = `STATUS_ACTIVE` (=0) — confirm that's the active guard.
3. **FIX-6** `saturating_sub` returns `u64` (dropped `.ok_or(Overflow)?`) — confirm nothing downstream expected a `Result`.
4. **BLOCKER-1** `idl-build` feature string — only the real build proves IDL emission.
5. **FIX-4** `constraint` on a bare `Account<Mint>` referencing `campaign.usdc_mint` — confirm the macro accepts it (campaign is declared earlier in the struct).
6. **Refund grace (this session)** — `refund_remaining` now blocks a deadline-triggered refund until `now >= deadline_unix + REFUND_GRACE_SECS` (6h), via a new `REFUND_GRACE_SECS: i64` const, `Clock::get()?.unix_timestamp` (already imported/used in this fn), and a new `RefundGraceActive` error variant. Confirm: the `i64` `checked_add` + comparison typecheck; the `status == STATUS_CLOSED` exemption on the new `require!` (so a second refund call on an already-Closed campaign — vault already swept, amount 0 — is still a clean idempotent no-op and doesn't wrongly revert); the const + error variant emit into the regenerated IDL. **The grace deliberately keeps the brand's refund blocked even when the vault holds only unclaimed dust** — operationally fine (the brand just waits 6h post-deadline), but if you want `cancel_campaign`-style immediacy for a fully-paid campaign, that's a follow-up, not part of this fix.

### tests/vello-escrow.ts
The committed test exercises the OLD program (old seeds, `approveSubmission`, `campaignEscrow`) and **won't compile**. Rewrite minimally before `anchor test`: init config; double-crank pays 0; budget clamp at exhaustion; monotonic noop; fee skim; dispute-window block; staleness block; refund-after-partial sweeps actual balance; frozen-clip can't claim; empty-window config rejected. Add `tests/tsconfig.json` (commonjs, `resolveJsonModule`) + repoint `Anchor.toml`'s test script.

---

## Decisions taken (recommended defaults — override before deploy if the boss wants)
1. **Monotonic = keep-and-noop** (oracle can blindly resend cumulative; transient view dips don't error the crank).
2. **`claim_payout` requires `status==Active`** (a brand can't cancel-rug a verified-but-uncranked clipper).
3. **NAV economy = E1:** the off-chain NAV/founder-share credit now fires from the claim keeper off the **net** USDC actually paid on-chain (real-backed — fixes the dilution bug). The protocol fee is counted once (on-chain skim; off-chain credits net).
4. **Beneficiary = the raw `influencers.agentWallet` pubkey** (what the code provisions today). Its ATA is created on first crank by `init_if_needed` (cranker pays ~0.002 SOL rent). `register_agent_wallet` / AgentWallet-PDA path deferred.
5. **Split kept:** `record_performance` (oracle, no money) vs `claim_payout` (permissionless crank) — enables the dispute window + trivially-idempotent retries.
6. **Dispute/staleness windows** — you set these at `init_platform_config` (see step 5). They gate whether claims work at all; the recommended devnet values are above.

## Known limitations / follow-ups
- **Incremental-claim NAV:** the on-chain program supports paying a clip incrementally as views grow. The post-audit `9f59915` fix makes the NAV credit durable **per cumulative-paid tranche** (no longer once-per-`submissionId`), so a budget-capped partial fill followed by a top-up credits each tranche correctly. **Known limitation:** the `cbbdefd` `dueForReattest` slot-refresh re-records the **same** `viewCount` each cycle (its job is only to keep `last_recorded_slot` fresh so claims don't go stale); **catch-up as views GROW after first approval is still deferred** — the recurring "pay-per-+1000-new-views" model needs the oracle to re-fetch and re-record growing views, which is not yet wired.
- **v2 rail is a silent no-op until provisioned:** the on-chain oracle/claim rail does nothing until `init_platform_config` runs **and** `VELLO_ORACLE_SECRET`/`VELLO_CRANK_SECRET` are set + SOL-funded. Post-`cbbdefd`, a v2 row hit while the oracle key is unset is **skipped (not mirror-settled)** so it auto-heals once the key lands — but until the full bringup is done, v2 campaigns accrue no on-chain attestations and pay nobody. Do the step-5 init + step-6 env provisioning before flagging any campaign v2 in production.
- **The rewritten program has zero test coverage** until `tests/vello-escrow.ts` is rewritten — this is the #1 pre-mainnet gap (plus an external money-path audit).
- **Pre-existing test failures (baseline = 28 at branch HEAD, NONE from this integration):** 21 are Convex-level, inherited from `main` (`shares.test` 13 from the boss's `buyShares` gate, `walletSecret` 6, `crons` 1, `earnings` 1); the other 7 surface only in the full `vitest` run on this machine (`clipSkillsCatalog` ×2 snapshot, `clipFilterGraph.ffmpeg` ×5 — ffmpeg missing locally). The 21-vs-28 gap is just convex-only vs full-suite scope — neither set is caused by this work.
- **Pre-mainnet:** `DEVNET_USDC_MINT` is hardcoded (`escrow.ts`) — make env-driven; legacy-PDA drain tool; rotate the pre-committed deploy keypair / move upgrade authority to a multisig.
