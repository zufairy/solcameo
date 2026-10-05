# Per-Campaign USDC Treasury + Oracle-Verified Auto-Payout

**Status:** design complete (swarm-generated, verified against `main` 2026-06-25). Build target: `apps/web/programs/vello-escrow/src/lib.rs`. **Intended owner: the `oracle-layer` worktree / oracle session** (the on-chain payout and the oracle are tightly coupled).

## What this is
Every clipping campaign gets its **own USDC treasury vault** (a PDA — no private key). The brand/boss **deposits USDC**; the **oracle posts verified clip view-counts on-chain**; a **permissionless crank pays clippers pro-rata by verified views, capped at budget, with no double-pay**. Unspent budget refunds to the owner after the deadline.

This replaces the current broken `approve_submission` (which pays the *entire* budget to one clipper, then freezes) and the off-chain payout path (which credits a Convex vault and never drains the on-chain escrow).

## Documents
| File | What |
|---|---|
| [`00-DESIGN.md`](./00-DESIGN.md) | **Start here.** Decision-ready end-to-end design: how it works, the Anchor program (accounts/instructions/PDA seeds/payout math), migration, roadmap, risks. |
| [`01-PROGRAM-DESIGN.md`](./01-PROGRAM-DESIGN.md) | Deep dive on the program design (account layouts, instruction signatures, integer payout math). |
| [`02-ORACLE-SPEC.md`](./02-ORACLE-SPEC.md) | **The cross-team contract for the oracle.** What `record_performance` expects, the attestation/trust model, anti-abuse rules, failure modes, oracle-team deliverables. |

## The one thing the oracle team must build to
The oracle holds **one keypair = `PlatformConfig.oracle`** and, per clip, calls
`record_performance(campaign_id, submission_id, beneficiary, verified_views /* CUMULATIVE, not delta */, score_hash, attest_tx)` — signed by that key. It **never moves money** (`claim_payout` is a separate permissionless crank). It then POSTs the existing `/oracle/attestation` webhook purely as a UI mirror. Full spec + failure-mode table in `02-ORACLE-SPEC.md`.

## Proposed implementation
A first-pass `lib.rs` rewrite (+ `lib/escrow.ts` wrappers) implementing this design is provided as a PR for the oracle session to refine, `anchor build`, regenerate the IDL, and deploy. It was authored without an Anchor toolchain in the loop, so **`anchor build` + the test suite are the gate** — treat compile-fixes as expected.
