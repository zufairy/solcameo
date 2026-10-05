# MISSION BRIEF — Overnight Autonomous Build: On-Chain USDC Reward Payouts (Mac session)

**You are** a Claude Code session on a **macOS machine with a full Rust/Solana/Anchor toolchain** (or able to install one). You are being handed a fully-scoped, verified plan that another session prepared on a Windows box (which had no toolchain, so it could not build/deploy). **Your job: take it the rest of the way — implement, audit, deploy to devnet, and prove the money flow end-to-end — running autonomously until green.**

> **Run this overnight, nonstop, until green.** Use swarms + adversarial debate at every stage. Make no mistakes on the money path. Do real E2E testing on **all** the money flow. If you genuinely need real funds, stop and ask the human (devnet is free — see §6).
>
> **RIGOR (mandatory):** This is candidate **A (oracle)** in a two-way bake-off. You MUST run in your OWN isolated worktree with your OWN fresh program id, and follow the **Shared Rigor Protocol** in `OVERNIGHT-BAKEOFF-RUNNER.md` §3 — adversarial-debate verification at every stage + intensive devnet E2E that records a **real tx signature for every money path AND every failure path**. Do NOT touch the OG candidate's files, branch, or the shared `lib/escrow.ts` / `lib/vello-escrow-idl.json` on a buildable branch. Not "done" until that bar is met (see the runner §4 DoD).

---

## 0. First moves
1. **Pull the latest.** `git fetch origin && git checkout escrow-revival-impl` (the branch carrying the plan + the current money-flow feature state). If you prefer, branch off it. Confirm you see `apps/web/docs/campaign-treasury/05-REVIVAL-PLAN.md`.
2. **Work in an isolated git worktree** so a failed experiment never corrupts the branch:
   `git worktree add ../vello-escrow-build -b escrow-build-run escrow-revival-impl`
3. **Ingest the context (read these in full before acting):**
   - `apps/web/docs/campaign-treasury/05-REVIVAL-PLAN.md` — the end-to-end runbook (Phases 0–7, Appendices). **This is your master plan.**
   - `apps/web/docs/campaign-treasury/04-REVIVAL-SCOPE.md` — the verified scope (file:line for every claim).
   - `apps/web/docs/superpowers/specs/2026-06-30-view-delta-reward-payout-spec.md` — the off-chain twin of the SAME algorithm (reuse its confirmation-window + caps + incremental-accrual logic).
   - `apps/web/docs/campaign-treasury/03-INTEGRATION-HANDOFF.md` — the original runbook (note: it says Anchor 0.32.1 — that's wrong; see Locked Decisions).

## 1. The mission (what "done / green" means)
A **devnet** deployment where: a clipping agent is paid a **USDC reward per +1000 NEW views**, drawn from a **scaled-down USDC vault**, including the **Ryze content-reward** case — proven by a reproducible E2E run, with every money invariant tested. Plus the Anchor program built, deployed, initialized, and the integration code merged + green.

## 2. Locked decisions (do NOT relitigate)
- **Payout is NATIVE USDC. No fiat/RM peg, no FX.** Admin enters the rate directly in USDC ("X USDC per 1000 views", "Y USDC budget"). (Plan Appendix B.)
- **The per-1k USDC payout rate must be admin-CHANGEABLE later, and rate changes MUST be PROSPECTIVE ONLY** — never reprice already-counted views. The on-chain `claim_payout` computes `accrued = floor(verified_views × rate_per_1k / 1000)`, so naively mutating `rate_per_1k` reprices ALL history. Design + audit around this (Plan Appendix B.1: settle-then-reprice baseline, or new-campaign-per-rate-epoch — you decide and defend it).
- **Program id `4qyfe9…` is a DEAD PLACEHOLDER (never deployed) → generate a fresh id.** (Plan Phase 1.3.)
- **Anchor version → 0.30.1 everywhere** (Cargo + anchor-cli + JS). The Rust was written/reviewed at 0.30.1; do NOT bump it up. Verify the real crate/npm/CLI versions empirically first (Plan Phase 0.2).

## 3. The process to run (each stage uses swarms + adversarial debate)
Execute the plan's phases, but wrap them in this rigor loop — **do not skip the audits**:
1. **Adversarial map + verify** — independently re-map the money flow from the real code and *verify* the plan's claims (don't trust them blindly; the prep session may have erred). Use a fan-out of readers + skeptics.
2. **Integration plan + audit** — turn the plan into a concrete, file-level TDD task list; then run an **adversarial audit panel** over that task list (lenses: double-pay/idempotency, retroactive-rate, over-draw/rail-XOR, view-confirmation/fraud, test-coverage). Fold every critical/high finding back in.
3. **Implement (TDD)** — for each task, write the failing test first, then the change. This includes the real Solana work you (uniquely) can do:
   - Apply the `lib.rs:742` mint fix; pin versions; `anchor build` → fix compile errors → regenerate IDL → `cp target/idl/vello_escrow.json apps/web/lib/vello-escrow-idl.json` → harden + run `check-escrow-idl.mjs` (Plan Phases 1–2).
   - Rewrite `apps/web/tests/vello-escrow.ts` for the new program → `anchor test` green (Plan Phase 3).
   - `anchor deploy --devnet` + `init_platform_config` (mind the dispute<staleness window math, in slots) + fund oracle/crank keys (Plan Phases 4).
   - Wire W6 growing-views, W7 content-reward↔campaign link, W8 off-chain confirmation+caps, and the configurable prospective rate (Plan Phase 5).
4. **Audit the implementation** — re-run the adversarial panel against the actual diffs + on-chain behavior. Fix what survives.
5. **E2E test ALL the money flow on devnet** (Plan Phase 6) — prove, with real devnet-USDC movement:
   - create a scaled USDC vault → agent posts → oracle records confirmed cumulative views → views grow → W6 re-records higher cumViews → `claim_payout` pays the **delta** to the agent's USDC ATA → treasury gets the fee → mirror updates;
   - **double-crank pays 0** (idempotency);
   - a **rate change is prospective** (old views not repriced);
   - an **unconfirmed/transient spike is never recorded** (confirmation window);
   - the **Ryze content-reward path** pays (the W7 link).
6. **Loop until green**, committing as you go. Don't stop at "should work" — run it.

## 4. Money invariants (each MUST have a passing test before you call it green)
- Never pay twice for the same view (on-chain idempotency + off-chain trancheKey).
- Never over-draw the vault / exceed budget.
- Rail XOR: a post is paid by the on-chain vault **or** the off-chain ledger, never both.
- Rate changes are prospective only (no retroactive repricing; a cut never erases owed-unpaid).
- Only confirmed, capped views are recorded on-chain (no transient/bought spike, irreversible).
- Only allowlisted operator agents on a Vello-operated campaign are paid (no scope leak to user-deposited campaigns).

## 5. Make-no-mistake gates (Plan Appendix A — verify each)
Version pin 0.30.1 · `lib.rs:742` fix before first build · fresh program id (update `declare_id!` + `Anchor.toml` + `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`) · the IDL `cp` + format-hardened guard · init windows dispute<staleness in slots vs wall-time crons · oracle+crank keys funded · W6 also recomputes `payoutAmountUsdc` + resets `claimDone` · W7 link respects the funded-vault XOR + operator allowlist · W8 caps/confirmation are off-chain · custody fail-closed + RPC fix are **mainnet** gates (not devnet).

## 6. Funds — what to ask the human for
- **Devnet (your whole job tonight) = FREE.** Self-serve: `solana airdrop` / faucet.solana.com for SOL (deploy wallet + oracle + crank keys); **faucet.circle.com** for devnet USDC to fund a test vault. **Do not ask the human for devnet funds** — pull them yourself. If an airdrop is rate-limited, retry / use the web faucet.
- **Only ask the human to airdrop real SOL/USDC if you are doing the MAINNET pilot (Plan Phase 7)** — which is gated behind an external audit + tests + fail-closed custody + multisig, and is **NOT** part of tonight. Stay on devnet.

## 7. Reporting
Commit incrementally on the worktree branch. When you stop (green or blocked), leave a clear summary: what's green + the E2E proof (tx signatures / a recorded run), what's tested, what (if anything) is blocked and why, and the exact next human action. Push the branch.

---

**TL;DR:** pull `escrow-revival-impl`, read `05-REVIVAL-PLAN.md`, run the map→verify→audit→implement→audit→E2E loop with swarms + adversarial debate, build+deploy+init on devnet, prove the USDC-reward-per-1000-new-views money flow (incl. the Ryze path) with every invariant tested, and run until green. Native USDC, no peg, prospective configurable rate, fresh program id, Anchor 0.30.1. Devnet funds are free — only ping the human for real money at the mainnet stage.
