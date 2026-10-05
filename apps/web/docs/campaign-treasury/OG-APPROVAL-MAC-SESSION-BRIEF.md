# MISSION BRIEF — Overnight Autonomous Build: **OG Approval-Escrow** (the comparison candidate)

**You are** a Claude Code session on a **macOS machine with a full Rust/Solana/Anchor toolchain** (or able to install one). You are building the **ORIGINAL "brand-approval" escrow design** (authored in the jobtepi base by `zufairy`, extracted at git `28b1e0d`) to a **deployed, proven, demoable devnet state** — so that in the morning it can be compared head-to-head against the *oracle* design and a human (the boss) can pick one. **Your job: restore it, build it, deploy it to devnet, and prove the money flow end-to-end — running autonomously until green.**

> **This is a bake-off.** A sibling session is building the **oracle / pay-per-view** design (see `00-MAC-SESSION-BRIEF.md` in this folder — that is the OTHER candidate, NOT your task). You are building the **approval** candidate. Keep your design **pure** — do not borrow oracle features; the whole point is an honest contrast. Run overnight, nonstop, until green. Use swarms + adversarial debate on the money path. Devnet is free — see §6.
>
> **RIGOR (mandatory):** This is candidate **B (OG approval)**. You MUST run in your OWN isolated worktree (`../vello-og-build`, branch `escrow-og-build`) with your OWN fresh program id **distinct from the oracle candidate's**, and follow the **Shared Rigor Protocol** in `OVERNIGHT-BAKEOFF-RUNNER.md` §3 — adversarial-debate verification at every stage + intensive devnet E2E that records a **real tx signature for every money path AND every failure path** (create / top_up / approve-full-budget / double-approve-fails / unauthorized-fails / cancel-before & after). Do NOT touch the oracle candidate's files/branch or the shared `lib/escrow.ts` / `lib/vello-escrow-idl.json` on a buildable branch. Not "done" until that bar is met (runner §4 DoD).

---

## 0. First moves
1. **Pull latest, then isolate in your OWN worktree** (never share a branch with the oracle session — you both touch the same file paths and would clobber each other):
   ```
   git fetch origin
   git worktree add ../vello-escrow-og-build -b escrow-og-build origin/escrow-revival-impl   # or off main; base barely matters, you restore the OG files next
   cd ../vello-escrow-og-build
   ```
2. **Restore the OG escrow source from `28b1e0d`** (HEAD currently holds the *oracle* rewrite — you must roll the contract back):
   ```
   git checkout 28b1e0d -- apps/web/programs/vello-escrow/    # OG lib.rs (536 lines) + Cargo/Xargo
   git checkout 28b1e0d -- apps/web/Anchor.toml apps/web/Cargo.toml
   git show 28b1e0d:apps/web/lib/escrow.ts            > /tmp/og-escrow.ts          # OG SDK (has approveSubmission)
   git show 28b1e0d:apps/web/lib/vello-escrow-idl.json > /tmp/og-vello-escrow-idl.json
   git show 28b1e0d:apps/web/tests/vello-escrow.ts    > /tmp/og-vello-escrow.test.ts   # if present; else write fresh
   ```
3. **Ingest the OG context (read in full before acting):**
   - `git show 28b1e0d:apps/web/programs/vello-escrow/src/lib.rs` — **the OG contract. This is your source of truth.**
   - `apps/web/docs/superpowers/specs/2026-05-27-treasury-escrow-payout-design.md` — the original design rationale.
   - `apps/web/docs/superpowers/plans/2026-05-27-treasury-escrow-payout.md` — the original build plan.
4. **IGNORE the rest of `docs/campaign-treasury/`** (`00-DESIGN`, `01-PROGRAM-DESIGN`, `02-ORACLE-SPEC`, `03/04/05-*`, `00-MAC-SESSION-BRIEF.md`). **All of those describe the COMPETING oracle design.** They are not your spec and will pollute the comparison if you copy from them.

## 1. The mission (what "done / green" means)
A **devnet** deployment of the OG approval escrow where the money flow is proven by a reproducible E2E run with real devnet-USDC tx signatures:
- A **brand** creates a campaign → USDC budget is locked in a per-campaign PDA vault.
- The brand can **`top_up`** the vault.
- The brand calls **`approve_submission`** → the **entire budget** transfers to **one** influencer's USDC ATA. (This is the OG model: single winner, discretionary, all-or-nothing.)
- Before approval, the brand can **`cancel_campaign`** → full refund to the creator. After approval, cancel is blocked.
- Plus: `register_agent_wallet`, `init_platform_config` / `update_platform_config`, `sweep_to_treasury` build + work.
- The program is **built, deployed (devnet), initialized**, `anchor test` is green, and there is a recorded standalone E2E script. **A FRESH program id, distinct from the oracle session's.**

## 2. Locked decisions (do NOT relitigate)
- **Keep the OG design PURE.** No oracle, no `record_performance`, no per-1000-view metering, no protocol-fee skim, no dispute/staleness windows. `approve_submission` pays the **full budget** to **one** influencer, exactly as in `28b1e0d`. If you "improve" it toward the oracle design you destroy the comparison. (Minimal, defensible hardening that does NOT change the model — e.g. an overflow check — is fine; new economic behavior is not.)
- **Payout is NATIVE USDC.** No fiat/RM peg, no FX.
- **Anchor version → 0.30.1 everywhere** (Cargo + anchor-cli + JS). The OG Rust targets Anchor 0.30; pin 0.30.1. Verify the real crate/npm/CLI versions empirically first; fix any compile errors the bump surfaces (the OG is only 536 lines — there is no `lib.rs:742` issue from the oracle brief here).
- **Generate a FRESH program id that is DIFFERENT from the oracle session's id.** The shared `4qyfe9…` placeholder is dead/never-deployed, and the two candidates must coexist on devnet for the demo. `solana-keygen new -o target/deploy/vello_escrow-keypair.json`, then put its pubkey in `declare_id!(...)` **and** `Anchor.toml [programs.devnet]`.
- **Do NOT overwrite the shared `apps/web/lib/escrow.ts` or `apps/web/lib/vello-escrow-idl.json` on a branch that the main app builds.** The rest of the repo now imports oracle-only wrappers (`recordPerformanceTx`, `claimPayoutTx`); replacing them with the OG SDK breaks repo-wide `tsc`/`next build`. Keep your OG SDK + IDL **isolated** (e.g. `apps/web/programs/vello-escrow/og-idl.json` + a standalone `scripts/og-escrow-e2e.ts`, or driven straight through the Anchor test). Full app/Convex wiring is **out of scope** for the decision and is reserved for whichever design the boss picks.

## 3. The process to run (each stage: swarms + adversarial debate)
1. **Adversarial map + verify** — independently re-map the OG money flow from the `28b1e0d` source. Confirm exactly how `approve_submission` computes/transfers, the `approved_count == 0` one-shot gate, the cancel guard, and every signer/`has_one`.
2. **TDD task list + audit** — turn it into a file-level test-first task list; run an adversarial audit panel (lenses: double-pay/one-shot, creator-only authority, cancel-after-approval, budget-in == budget-out, mint mismatch, PDA-signer correctness).
3. **Implement (TDD)** — failing test first, then the change. The real Solana work only you can do:
   - Pin versions → `anchor build` → fix compile errors → regenerate IDL → save it to your isolated OG IDL path → verify instruction set is the OG one (`createCampaign / approveSubmission / topUp / cancelCampaign / registerAgentWallet / initPlatformConfig / updatePlatformConfig / sweepToTreasury`; accounts `CampaignEscrow / PlatformConfig / AgentWallet`).
   - Write/restore `tests/vello-escrow.ts` for the OG program → `anchor test` green.
   - `anchor deploy` to devnet + `init_platform_config` + fund the deploy wallet.
4. **Audit the implementation** — re-run the panel against the real diffs + on-chain behavior. Fix what survives.
5. **E2E on devnet** — prove, with real devnet-USDC movement (record tx sigs):
   - create campaign (lock a scaled USDC budget) → `top_up` → `approve_submission` pays the **full budget** to the influencer's USDC ATA;
   - **second `approve_submission` fails** (one-shot `approved_count == 0`);
   - **a non-creator cannot approve or cancel** (`Unauthorized`);
   - `cancel_campaign` **before** approval refunds the creator; **after** approval it is blocked;
   - budget deposited == budget paid out (no dust left, no overpay).
6. **Loop until green**, committing as you go. Don't stop at "should work" — run it.

## 4. Money invariants (each MUST have a passing test before "green")
- Pays **exactly once** per campaign (the `approved_count == 0` gate holds; no double-approve).
- Only the **creator** can `approve_submission` / `cancel_campaign` (`has_one = creator`).
- `cancel_campaign` is **blocked once approved**; refunds the **full** balance to the creator before approval.
- **Budget conservation**: USDC out on approval == USDC locked at create/top_up (no over-draw, no leftover).
- **Mint guard**: wrong USDC mint is rejected.
- PDA-signed transfer uses the correct campaign seeds; vault authority is the PDA.

## 5. Make-no-mistake gates
Anchor 0.30.1 pinned · fresh program id **distinct from the oracle id**, wired into `declare_id!` + `Anchor.toml` (+ the isolated env/script only — NOT the shared app env on a buildable branch) · IDL regenerated from YOUR build and stored at an isolated path · shared `lib/escrow.ts` + `lib/vello-escrow-idl.json` left untouched so the repo still compiles · `init_platform_config` run after deploy · deploy wallet funded · the design kept **pure approval** (no oracle creep).

## 6. Funds — what to ask the human for
- **Devnet (your whole job) = FREE.** Self-serve: `solana airdrop` / faucet.solana.com for SOL (deploy wallet); **faucet.circle.com** for devnet USDC to fund a test vault. **Do not ask the human for devnet funds** — pull them yourself; retry if rate-limited.
- Mainnet is **out of scope** tonight. Stay on devnet.

## 7. Reporting — produce the boss-comparison artifact
Commit incrementally on `escrow-og-build` and push. When you stop (green or blocked), write **`apps/web/docs/campaign-treasury/OG-APPROVAL-RESULT.md`** containing:
- The deployed **program id**, cluster, and `init_platform_config` tx.
- The E2E proof: ordered **tx signatures** for create → top_up → approve (full-budget transfer) → the failed double-approve → cancel, with the USDC amounts moved.
- Which invariant tests pass (link the test file + `anchor test` output).
- **An honest one-page design summary for the boss**, stating plainly what this model IS and ISN'T:
  - ✅ Simple (536 lines, small attack surface), no off-chain oracle dependency, brand keeps full control.
  - ❌ Single winner takes the whole pot; ❌ payout is **100% brand discretion** (worker has no enforceable on-chain guarantee; brand can withhold approval or cancel-and-reclaim); ❌ no pay-per-performance / no view metering / no multi-clipper support.
  - One line on fit: good for "fixed bounty, one approved deliverable"; a poor fit for Vello's many-clippers-paid-by-views model.
- The exact next human action.

---

**TL;DR:** worktree off latest, restore the OG escrow from `28b1e0d`, read the 2026-05-27 design docs (and ignore the oracle `campaign-treasury` docs), pin Anchor 0.30.1, generate a **fresh program id distinct from the oracle build**, keep the design **pure approval** (no oracle), build → deploy devnet → init → `anchor test` green → prove the create/top_up/approve(full-budget)/double-approve-fails/cancel money flow with real devnet-USDC tx sigs, don't touch the shared `escrow.ts`/IDL so the repo keeps compiling, and leave `OG-APPROVAL-RESULT.md` with the tx sigs + an honest design summary for the morning bake-off. Run until green.
