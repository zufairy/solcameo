# OVERNIGHT BAKE-OFF RUNNER — build BOTH escrow candidates, in isolation, until green

**What I want in the morning:** TWO escrow smart contracts, each **built + deployed to devnet + proven end-to-end with real USDC tx signatures**, running in **complete isolation (zero conflicts)**, plus an honest comparison doc for the boss. Run autonomously overnight. **Do not stop until BOTH are actually proven on-chain.**

**The two candidates:**
- **A — ORACLE / pay-per-view** → brief `00-MAC-SESSION-BRIEF.md`. *(The design that matches the boss's ask: pay clippers per 1000 views, many clippers, ongoing.)*
- **B — OG approval / single-winner bounty** → brief `OG-APPROVAL-MAC-SESSION-BRIEF.md`. *(The simpler original design; the contrast.)*

> **Morning honesty note (bake it into the comparison):** A actually does "reward per +1000 new views." B structurally **cannot** — `approve_submission` pays the *whole pot to one* approved influencer, once. B is the simplicity/safety contrast, **not** a true rival on the requirement. Build both honestly; let the boss see the tradeoff.

---

## 0. Get the files (one-time)
You need: this runner, **both** briefs, and the supporting plan/spec — all under `apps/web/docs/campaign-treasury/` (`00-MAC-SESSION-BRIEF.md`, `OG-APPROVAL-MAC-SESSION-BRIEF.md`, `03/04/05-*.md`) and `apps/web/docs/superpowers/specs/2026-06-30-view-delta-reward-payout-spec.md`.
- If branch `escrow-revival-impl` is on origin: `git fetch origin && git checkout escrow-revival-impl`.
- The **oracle** program code is already on `main`; the **OG** program is restored from git `28b1e0d` (history — always available, the OG brief has the commands).

---

## 1. THE ISOLATION CONTRACT (this is the "no conflicts" requirement — obey exactly)
Both builds edit the SAME file paths (`programs/vello-escrow/src/lib.rs`, `Anchor.toml`, `Cargo.toml`, `lib/escrow.ts`, `lib/vello-escrow-idl.json`, `tests/vello-escrow.ts`). They therefore **must never share a checkout.** Enforce:

| | **A — oracle** | **B — OG approval** |
|---|---|---|
| Worktree dir | `../vello-oracle-build` | `../vello-og-build` |
| Branch | `escrow-oracle-build` | `escrow-og-build` |
| Program source | current/oracle `lib.rs` (~1092 lines) | restored from `28b1e0d` (536 lines) |
| Program id | fresh keygen **#1** | fresh keygen **#2** (MUST differ from #1) |
| IDL | its own regenerated IDL (isolated path) | its own regenerated IDL (isolated path) |
| Result doc | `ORACLE-RESULT.md` | `OG-APPROVAL-RESULT.md` |

**Rules (non-negotiable):**
- Create each with `git worktree add <dir> -b <branch> <base>`. **Each worktree has its OWN `target/`** → the two `anchor build`s can never collide.
- Each generates its **OWN fresh program id** (`solana-keygen new -o target/deploy/vello_escrow-keypair.json` → wire into `declare_id!` + `Anchor.toml`). **The two ids MUST be different** (random keygen guarantees it — just never reuse the dead `4qyfe9…` placeholder in either). Distinct ids → both programs coexist on devnet.
- **Neither candidate touches the other's worktree, branch, program id, or result doc.**
- **Do NOT overwrite the repo-shared `apps/web/lib/escrow.ts` / `lib/vello-escrow-idl.json` on any branch the main Next app builds.** Keep each candidate's SDK/IDL **isolated** (drive it through `anchor test` + a standalone E2E script). Full app/Convex wiring is reserved for whichever design the boss picks — **out of scope tonight.**
- The same deploy wallet (`~/.config/solana/id.json`) is fine for both (one wallet → many programs); keep it SOL-funded. `init_platform_config` derives a PDA **per program id**, so the two platform configs never collide.

---

## 2. How to run (pick one — BOTH honor the isolation contract above)
- **Option 1 — two parallel sessions (recommended for speed):** open two Claude Code sessions on the Mac. Session 1 → Worktree A → execute `00-MAC-SESSION-BRIEF.md`. Session 2 → Worktree B → execute `OG-APPROVAL-MAC-SESSION-BRIEF.md`. They are fully isolated, so they **cannot** conflict. Halves wall-clock.
- **Option 2 — one session, sequential:** build A to fully green → commit/push → then build B to fully green. Slower, but a single dead-simple babysitter-free run.

Either way: **run until BOTH are green** (see §4). Devnet has all night — don't cut a build short.

---

## 3. SHARED RIGOR PROTOCOL — MANDATORY for BOTH candidates
**This is the intensive-E2E + adversarial-debate requirement. Apply it to EACH build. Neither candidate is "done" without it.**

**(a) Adversarial debate at every stage.** Before accepting any money-path code, convene a panel of **skeptic sub-agents** that actively try to BREAK it — each on a distinct lens — and only proceed when they can't:
- payout-math correctness (amounts, rounding, USDC base units)
- double-pay / idempotency (re-runs, concurrent cranks/approvals)
- authority & scope (only the right signer moves money; no scope leak)
- over-draw / budget conservation (USDC out ≤ USDC in; no dust, no overpay)
- mint / PDA-signer correctness (wrong mint rejected; vault authority is the PDA)
- *(oracle only)* view-confirmation/fraud + **prospective-rate** (no transient spike recorded; a rate change never reprices counted views)

Run it as multiple independent agents + a synthesizer; fold **every** critical/high finding back into the code; **re-run the panel after fixes.** Don't accept "looks fine" — make them attack it.

**(b) Intensive E2E on devnet — PROVE it, don't assume it.** Not "compiles," not "should work." For EACH candidate, run a real devnet script that moves real devnet USDC and **records a tx signature for every HAPPY path AND every FAILURE path**:
- **A (oracle):** create scaled USDC vault → record growing confirmed views → `claim_payout` pays the **delta** to the agent ATA → **double-crank pays 0** → **rate change is prospective** (old views not repriced) → **unconfirmed spike never recorded** → the **Ryze content-reward path** pays.
- **B (OG):** create vault (lock budget) → `top_up` → `approve_submission` pays the **FULL budget** to one influencer → **second approve FAILS** (one-shot) → **non-creator can't approve/cancel** → cancel **before** approval refunds, **after** approval blocked → **budget in == budget out**.

A money path with **no recorded tx signature is NOT proven.** Put the sigs in the result doc.

**(c) TDD + loop-until-green.** Failing test first, then code. `anchor test` green **before** deploy. Commit incrementally. If a stage fails, fix and re-run — **do not stop at the first clean compile; the bar is on-chain proof.**

---

## 4. Definition of Done (per candidate)
- [ ] Program built (Anchor **0.30.1**), **fresh distinct program id**, deployed to **devnet**, `init_platform_config` run.
- [ ] `anchor test` green — every money invariant (§3a lenses) has a passing test.
- [ ] E2E devnet script run; **every money + failure path has a recorded tx signature**.
- [ ] Adversarial panel ran; **no surviving critical/high** money-path finding.
- [ ] Result doc written with: program id, cluster, init tx, the **ordered E2E tx sigs + USDC amounts**, which invariant tests pass, and an honest one-page design summary (what the model IS and ISN'T).

## 5. Final artifact — the comparison
When **both** are green, write `apps/web/docs/campaign-treasury/BAKEOFF-COMPARISON.md`: A vs B side-by-side — model, who-gets-paid, worker on-chain guarantee, complexity/attack-surface, off-chain dependency, and **fit for the boss's ask** (per-1000-view, multi-clipper, ongoing) — with a clear recommendation. State plainly that **A matches the requirement** and **B is the simpler discretionary bounty that does not do per-view payouts.**

## 6. Funds
**Devnet only — FREE, self-serve.** `solana airdrop` / faucet.solana.com (SOL for the deploy wallet + oracle/crank keys); **faucet.circle.com** (devnet USDC to fund the test vaults). Retry if rate-limited. **Do NOT ask the human for devnet funds.** Only the **mainnet** pilot needs real money — **out of scope tonight; stay on devnet.**

## 7. When I wake up
I want: **two deployed devnet program ids, two result docs full of real tx signatures, the comparison doc, and both branches pushed.** If anything blocked: the result doc states exactly what + the single human action needed.

---

**TL;DR** — Two isolated worktrees (`../vello-oracle-build` / `../vello-og-build`), two branches, two **fresh distinct** program ids; never touch each other's files or the shared `escrow.ts`/IDL. Build **A (oracle)** per `00-MAC-SESSION-BRIEF.md` and **B (OG)** per `OG-APPROVAL-MAC-SESSION-BRIEF.md`, each under the **Shared Rigor Protocol** (adversarial debate + intensive devnet E2E with a real tx sig for every path), until **both** are green. Then write `BAKEOFF-COMPARISON.md`. Devnet is free; only ping me for real money at mainnet.
