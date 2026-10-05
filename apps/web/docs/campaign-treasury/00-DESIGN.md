I have full confirmation of the existing code, including the `PlatformConfig` (authority/treasury/bump, no oracle field) and `AgentWallet` PDA seed scheme `[AGENT_WALLET_SEED, owner, session_hash]`. Now writing the decision-ready doc.

# Vello Per-Campaign USDC Treasury with Oracle-Verified Auto-Payout — Design Doc

Status: decision-ready. Program target: `apps/web/programs/vello-escrow/src/lib.rs` (program id `4qyfe9phDNJDAUYzt4xQh7453F1zSFQLSs5aubfcoYci`). Intended worktree: `C:\Project\Vello\.claude\worktrees\oracle-layer`.

This doc is opinionated. Where the existing code disagrees with the design, the existing code is wrong (its bugs are confirmed below) and must change.

---

## 0. TL;DR / decisions

- **Build the per-campaign vault as a rewrite of the campaign half of `vello-escrow`**, not a new program. Keep the agent-wallet rail (`register_agent_wallet`, `sweep_to_treasury`, `PlatformConfig`) — it is sound and shares the authority/treasury we need.
- **Three new account types**: extend `PlatformConfig` (+`oracle`, +`protocol_fee_bps`), replace `CampaignEscrow` with `Campaign` (adds `rate_per_1k`, `reserved`, `deadline`, status), add a per-clip `ClaimRecord` (the idempotency anchor).
- **Split attestation from disbursement**: oracle-only `record_performance` writes verified views; permissionless `claim_payout` moves money. This is the structural fix for the current single buggy `approve_submission`.
- **Money moves on-chain, not in Convex.** Today `markVerified` schedules `distributions.dispatch` which credits an off-chain vault and never drains the escrow PDA (campaigns.ts:385-391). After this work the chain is authoritative; Convex becomes a mirror/indexer.
- **The three correctness gates**: per-clip `ClaimRecord.paid` (no double-pay), `gross = min(owed, budget − reserved)` (no overrun), `PlatformConfig.oracle` signer + monotonic views (oracle bound by budget). Floor rounding everywhere.

---

## 1. How it works end-to-end

### Narrative

A brand ("boss") wants clippers to cut and post videos and get paid by performance. The boss creates a campaign with a **budget** (e.g. 1,000 USDC) and a **rate** (e.g. 5 USDC per 1,000 verified views) and a **deadline**. On create, the budget is transferred from the boss's USDC ATA into a per-campaign vault — a PDA-owned token account with no private key. Nobody, including the boss, can move that money except by the program's rules.

Clipper agents submit clips (the existing `submissions` flow, unchanged). An **off-chain oracle** (a separate team) polls TikTok/IG/YT/X, computes each clip's **cumulative verified views**, and posts that number on-chain via `record_performance`, signed by a single oracle key pinned in `PlatformConfig`. This writes a per-clip `ClaimRecord` but moves **no money**.

Disbursement is a separate, **permissionless crank** (`claim_payout`) anyone can call — a Vello keeper cron, the agent, or the brand. It computes what's newly owed for that clip (`accrued − already_paid`), caps it to what's left in the vault (`budget − reserved`), skims an optional protocol fee, and the PDA signs a transfer to the clipper's payout wallet. `paid` and `reserved` advance **before** the transfer (checked-effects-interactions), so a retry or a concurrent crank pays exactly zero the second time.

Payout is **pro-rata by verified views**, **capped at budget** (the vault can never be over-drained), and **incremental** (a clip that grows from 10k to 50k views gets topped up on later cranks, never double-paid for the first 10k). After the deadline, the boss calls `refund_remaining`, which sweeps the **actual** vault balance (rounding dust + unspent budget) back to the boss.

### Sequence

```
BOSS                 PROGRAM (vello-escrow)        ORACLE (other team)     KEEPER/CRANK
 |                         |                              |                     |
 | create_campaign         |                              |                     |
 |  (id, rate_per_1k,      |                              |                     |
 |   budget, deadline)     |                              |                     |
 |------------------------>| init Campaign PDA + vault ATA|                     |
 |                         | transfer budget boss->vault  |                     |
 |                         | reserved=0                   |                     |
 |                                                        |                     |
 |   [clipper agents submit clips -> Convex submissions, unchanged]             |
 |                                                        |                     |
 |                         |   record_performance         |                     |
 |                         |   (campaign_id, submission_id,                     |
 |                         |    beneficiary, verified_views,                    |
 |                         |    score_hash, attest_tx)    |                     |
 |                         |<-----------------------------| (signer == cfg.oracle)
 |                         | init/update ClaimRecord      |                     |
 |                         | require views >= prev (monotonic)                  |
 |                         | accrued = floor(views*rate/1000)                   |
 |                         | (no money moves)             |                     |
 |                                                        |                     |
 |                         |   claim_payout(campaign_id, submission_id)         |
 |                         |<---------------------------------------------------| (permissionless)
 |                         | owed   = accrued - paid                            |
 |                         | gross  = min(owed, budget - reserved)              |
 |                         | fee    = gross * fee_bps / 10000                   |
 |                         | reserved += gross ; paid += gross   (EFFECTS)      |
 |                         | transfer vault->beneficiary (net)   (INTERACTION)  |
 |                         | transfer vault->treasury    (fee)                  |
 |                                                        |                     |
 | refund_remaining        |                              |                     |
 |  (after deadline)       |                              |                     |
 |------------------------>| transfer vault->boss (actual ATA balance)          |
 |                         | status = Closed              |                     |
```

Convex mirrors each step for the UI (`campaigns.pdaAddress`, `submissions.viewCount/payoutAmountUsdc/paidUsdc/attestationTx`) but is never the payer.

---

## 2. Anchor program design

### 2.1 What's broken today (confirmed against `lib.rs`)

| Bug | Location | Why fatal for per-campaign payout |
|---|---|---|
| `approve_submission` pays the **entire** `budget_lamports` to one influencer | lib.rs:50, 65-72 | No per-view, no pro-rata, no multi-clipper. One clipper takes the whole pot. |
| Hard lock `approved_count == 0` | lib.rs:46 | Campaign can pay exactly **one** submission ever, then is frozen. |
| PDA seed has no creator | lib.rs:246/276 `[b"campaign", campaign_id]` | PDA not bound to creator; no per-creator namespacing. |
| `cancel_campaign` also gated `approved_count == 0` and refunds `budget_lamports` not the real balance | lib.rs:107, 111 | After any payout, refund math is wrong / cancel impossible. |
| Live payout never touches the escrow | campaigns.ts:385-391 → `distributions.dispatch` | Funds locked on-chain are **stranded**; payout happens off-chain in a Convex vault. |
| Off-chain `Math.round` rounding | campaigns.ts:308 | Can promise 1 base-unit more than the chain floors → stuck "unpaid 0.000001". |

### 2.2 Accounts

**`PlatformConfig`** — reuse existing (lib.rs:172-197), **extend**. Seeds `[b"vello:config"]`.
```
authority: Pubkey            // existing — admin/rotation/emergency
treasury:  Pubkey            // existing — fee + sweep sink owner
oracle:    Pubkey            // NEW — only signer allowed to record_performance
protocol_fee_bps: u16        // NEW — e.g. 500 = 5% skim per payout; 0 disables
dispute_window_slots: u64    // NEW — delta not claimable until this elapses
max_staleness_slots:  u64    // NEW — claim blocked if attestation older than this
bump: u8
```
`init_platform_config`/`update_platform_config` gain the new optional fields.

**`Campaign`** — NEW, replaces `CampaignEscrow`. **Seed includes creator** (fixes the collision).
```
seeds = [b"campaign", creator.key().as_ref(), campaign_id.as_bytes()]

creator: Pubkey              // only key that may refund/cancel (has_one)
usdc_mint: Pubkey
campaign_id: String          // Convex campaigns._id mirror
rate_per_1k: u64             // USDC base units (6dp) per 1,000 verified views
budget: u64                  // total committed (deposited), base units
reserved: u64                // total already PAID OUT, base units
total_verified_views: u64    // running sum across clips (analytics)
deadline_unix: i64           // refund/cancel allowed at/after this
status: u8                   // 0 Active | 1 Cancelled | 2 Closed
bump: u8
_reserved: [u8; 32]          // forward-compat
```
Maintained invariant: `escrow_ata.amount == budget − reserved` (modulo in-flight top-ups), `reserved <= budget`.

**`Campaign` vault ATA** — `associated_token::mint = usdc_mint, authority = campaign`. Same shape as today's `escrow_usdc_ata` (lib.rs:251-257). Kept.

**`ClaimRecord`** — NEW, the idempotency anchor. **One per (campaign, submission).**
```
seeds = [b"claim", campaign.key().as_ref(), submission_id.as_bytes()]

campaign: Pubkey
submission_id: String        // Convex submissions._id mirror (one-per (campaign,agent))
beneficiary: Pubkey          // agent payout wallet (AgentWallet PDA or raw)
verified_views: u64          // monotonic high-water mark (paid basis)
accrued: u64                 // floor(verified_views * rate_per_1k / 1000), pre-cap
paid: u64                    // already transferred for this clip
last_recorded_slot: u64      // staleness + dispute-window basis
frozen: bool                 // set by reject path; halts future claims
last_attest_tx: [u8; 64]     // oracle tx sig (audit)
score_hash: [u8; 32]         // oracle evidence hash (audit, not verified on-chain)
bump: u8
```
`paid <= accrued` always; claimable delta = `accrued − paid`.

> Note on `submission_id` as a seed segment: Convex ids are short ASCII and fit the ≤32-byte seed limit, so we can use the raw bytes. If you prefer fixed-width, use `sha256(submission_id)` as a `[u8;32]` and store the preimage in Convex. **Pick one and document it.** I recommend raw bytes for debuggability since they're already short; the oracle spec's `clip_id = sha256(...)` framing is equivalent — just be consistent across `record_performance` and `claim_payout`.

### 2.3 Instructions

```rust
// config (signer: authority)
init_platform_config(treasury, oracle, protocol_fee_bps, dispute_window_slots, max_staleness_slots)
update_platform_config(new_authority?, new_treasury?, new_oracle?, new_fee_bps?, ...)   // MODIFIED: +oracle/fee/windows

// campaign lifecycle (signer: creator)  — REPLACES create/approve/cancel
create_campaign(campaign_id, rate_per_1k, initial_budget, deadline_unix)   // MODIFIED: +rate,+deadline; seed +creator
top_up(campaign_id, amount)                                                // KEEP (sound); budget += amount (checked)

// oracle (signer: oracle, has_one via PlatformConfig.oracle)  — NEW
record_performance(campaign_id, submission_id, beneficiary, verified_views, score_hash, attest_tx)
reject_clip(campaign_id, submission_id)        // NEW: sets ClaimRecord.frozen (fraud/ineligible)

// disbursement (signer: anyone — permissionless crank)  — NEW (replaces approve_submission's money move)
claim_payout(campaign_id, submission_id)

// end of life (signer: creator)  — REPLACES broken cancel
refund_remaining(campaign_id)     // after deadline OR status==Closed: sweep ACTUAL vault balance to creator
cancel_campaign(campaign_id)      // MODIFIED: status=Cancelled, then refund actual balance (no approved_count gate)
```

**New vs modified vs kept:**
- KEEP unchanged: `top_up` (lib.rs:78-100), `register_agent_wallet`, `sweep_to_treasury` (lib.rs:148-233).
- MODIFIED: `PlatformConfig` + its init/update; `create_campaign` (rate, deadline, creator-in-seed); `cancel_campaign` (drop `approved_count` gate, refund real balance).
- REMOVED: `approve_submission` (its money move is replaced by `record_performance` + `claim_payout`).
- NEW: `Campaign`, `ClaimRecord` accounts; `record_performance`, `reject_clip`, `claim_payout`, `refund_remaining`.

### 2.4 Payout math (integer-only, USDC = 6dp)

`rate_per_1k` is in base units ($5.00/1k = `5_000_000`).

```rust
// record_performance — accrue, no money
require!(verified_views >= claim.verified_views, NonMonotonicViews); // high-water mark
claim.verified_views = verified_views;
let accrued = (verified_views as u128)
    .checked_mul(rate_per_1k as u128).unwrap() / 1000u128;           // FLOOR
claim.accrued = accrued as u64;
claim.last_recorded_slot = Clock::get()?.slot;

// claim_payout — disburse the new delta, capped to the pot
require!(!claim.frozen, ClipFrozen);
let now = Clock::get()?.slot;
require!(now >= claim.last_recorded_slot + cfg.dispute_window_slots, InDisputeWindow);
require!(now - claim.last_recorded_slot <= cfg.max_staleness_slots, AttestationStale);

let owed = claim.accrued.checked_sub(claim.paid).unwrap();           // never negative
if owed == 0 { return Ok(()); }                                      // idempotent no-op
let remaining = campaign.budget.checked_sub(campaign.reserved).unwrap();
let gross = owed.min(remaining);                                     // BUDGET CAP
if gross == 0 { return Ok(()); }                                     // pot exhausted

let fee = (gross as u128 * cfg.protocol_fee_bps as u128 / 10_000) as u64;
let net = gross.checked_sub(fee).unwrap();

// EFFECTS before INTERACTIONS
campaign.reserved = campaign.reserved.checked_add(gross).unwrap();
claim.paid        = claim.paid.checked_add(gross).unwrap();
// INTERACTIONS (PDA-signed by [b"campaign", creator, campaign_id, bump])
transfer(vault -> beneficiary, net);
if fee > 0 { transfer(vault -> treasury, fee); }
```

Properties: pro-rata by views; capped at budget; idempotent per clip; floor rounding means aggregate payout `<= floor(views*rate/1k)` — dust stays in vault, refunded to owner. Default exhaustion policy is **FCFS within budget** (whoever cranks first while `remaining > 0`). Strict proportional-at-exhaustion is a v2 option (needs a frozen `Σaccrued` + `finalized` flag) — call it out, don't build it now.

**Files to change:**
- `apps/web/programs/vello-escrow/src/lib.rs` — accounts + instructions above.
- `apps/web/lib/escrow.ts` — `getCampaignPda` add creator to seeds; add `getClaimPda`, `recordPerformanceTx`, `claimPayoutTx`, `refundRemainingTx`, `rejectClipTx`.
- `apps/web/lib/vello-escrow-idl.json` — regenerate after `anchor build`.
- `apps/web/convex/campaigns.ts:300` — `Math.round` → `Math.floor` to match chain.
- `apps/web/convex/schema.ts:212` — add `paidUsdc: v.optional(v.number())` to `submissions`.

---

## 3. Oracle interface spec (the cross-team contract)

This is the crisp contract the oracle team builds to. **The oracle's only job: report cumulative verified views, signed.** It never moves money.

### 3.1 Trust model — decided

**Permissioned oracle authority posting signed transactions on-chain.** One keypair pinned in `PlatformConfig.oracle`. The Solana transaction signature *is* the attestation — do not invent an app-level ed25519 payload. Rejected alternatives: Pyth/Switchboard (built for many-reporter fungible prices, wrong for single-source per-clip facts; overkill); "oracle PDA the program reads" is just an implementation detail of this (something permissioned still writes it — that's what `ClaimRecord` is). Future M-of-N committee is additive: `oracle` becomes an array + threshold + nonce without changing `claim_payout`'s read path.

### 3.2 The instruction the oracle calls

```rust
record_performance(
    campaign_id: String,      // Convex campaigns._id — must match Campaign seed
    submission_id: String,    // Convex submissions._id — the per-clip join key
    beneficiary: Pubkey,      // agent payout wallet (Vello provides the derivation)
    verified_views: u64,      // CUMULATIVE lifetime verified views (NOT a delta)
    score_hash: [u8; 32],     // sha256 of the oracle's raw evidence blob (audit only)
    attest_tx: [u8; 64],      // optional self-reference / prior sig for provenance
)
// signer MUST equal PlatformConfig.oracle, else Unauthorized.
```

### 3.3 The mirror webhook (UI/indexer only — already exists)

POST `{CONVEX_SITE_URL}/oracle/attestation`, header `x-oracle-secret: $ORACLE_WEBHOOK_SECRET` (convex/http.ts:20). After this work this path is **defense-in-depth on the mirror, never the payer**.

```jsonc
{
  "campaign":      "<convex campaigns._id>",
  "submissionId":  "<convex submissions._id>",
  "platform":      "tiktok",
  "verifiedViews": 123456,                 // CUMULATIVE
  "observedAt":    1735000000,             // unix secs (provenance)
  "attestationTx": "<sig of record_performance>",   // ties mirror -> chain
  "scoreHash":     "deadbeef...",
  "decision":      "approved" | "rejected"
}
```
`markVerified` (campaigns.ts:324) keeps its idempotency but is downgraded to indexer: it must require `attestationTx` and (via a reconcile cron) confirm it on-chain before trusting `viewCount`. Today `attestationTx` is optional+unchecked (campaigns.ts:330) — that residual trust hole closes here.

### 3.4 Program-enforced anti-abuse rules (the contract's teeth)

1. **Report cumulative, never deltas.** The program de-dupes via `claim.paid`. Reporting deltas double-pays. (Hard rule for the oracle team.)
2. **Monotonic basis.** `verified_views < stored` ⇒ keep stored, no-op (transient API dips don't error the crank).
3. **Idempotent / no double-pay.** Driven by `accrued − paid`; re-sends are safe to retry on RPC failure.
4. **Staleness.** `claim_payout` requires `now − last_recorded_slot <= max_staleness_slots`; oracle must re-post before claims unblock.
5. **Dispute window.** A fresh delta isn't claimable until `now >= last_recorded_slot + dispute_window_slots` (minutes on devnet, hours on mainnet). Admin can `reject_clip` (freeze) inside the window.
6. **Budget clamp.** A clip can never drain more than `budget − reserved`. This is the hard ceiling on a compromised oracle.
7. **Authority gate.** `record_performance`/`reject_clip` require the oracle/admin signer.

### 3.5 Failure modes (what the oracle team most needs)

| Failure | Behavior | Owner |
|---|---|---|
| Oracle down | `paid` frozen; on recovery, next cumulative report pays the catch-up delta in one crank. No loss, no double-pay. | Oracle resumes; program auto-recovers via monotonic basis. |
| Oracle reports too high | Inside dispute window → admin `reject_clip` freezes; budget clamp caps blast radius to one campaign's budget. Already-claimed → no clawback. | Admin within window; loss bounded by budget. |
| Oracle reports too low/regress | High-water mark kept; no-op. | Program. |
| Oracle key compromised | Exposure ≤ Σ open budgets, catchable within dispute window. Rotate via `update_platform_config(new_oracle)`. | Admin rotates; budget + window contain. |
| Chain ≠ mirror | Chain authoritative; reconcile cron backfills Convex. | Vello backend. |
| Claim race / double crank | Serialized on `ClaimRecord` write-lock; loser computes delta 0. | Program. |
| Budget exhausted mid-stream | Claims pay 0; brand may `top_up`. | Program + brand. |

### 3.6 Oracle team deliverables (target list)

1. Hold one keypair = `PlatformConfig.oracle` (Vello provisions/rotates; on devnet may be the platform authority).
2. Each poll cycle, per clip: compute **cumulative** `verified_views`, sign+send `record_performance(...)`. Idempotent/monotonic; safe to retry.
3. Then POST the §3.3 mirror with `attestationTx`.
4. **Never move money.** Only on-chain writes are `record_performance` (+ optional flag). `claim_payout` is cranked separately and permissionlessly.
5. Honor `max_staleness_slots` and `dispute_window_slots` (Vello sets; oracle keeps correction latency under the window).

---

## 4. Migration from today's RM-per-1k off-chain model

There are **two parallel systems**. Migrate them differently.

**A. Supabase `content_rewards` ("Jobs", legacy, RM, manual approve on jobtepi-web).** Approval and actual payout (`actual_payout`, `payout_status`) happen on the external jobtepi platform; Vello only reads and shows a `paidOut` estimate (content-rewards.ts:118). **Do not migrate this to chain.** It pays in RM (fiat) and is owned by another product surface. Leave it as-is; the clipper agent keeps feeding it via `job.contentRewardId` (clipJobs.ts:951-985). This is a fiat product, not a USDC one.

**B. Convex `campaigns` (Vello-native) — this is what goes on-chain.** Today its money path is broken: `create_campaign`/`top_up` lock real USDC, but `markVerified` pays an **off-chain vault** via `distributions.dispatch` and never drains the escrow (campaigns.ts:385-391). The escrow funds are stranded.

Migration steps for path B:
1. **Pre-deploy:** ship the new program to devnet, `init_platform_config` with the oracle key, fee bps, and windows.
2. **New campaigns only, day one:** all new `campaigns.create` use the new `create_campaign(rate_per_1k, budget, deadline)` with creator-in-seed PDAs. `campaign-form.tsx:744` already calls `createCampaignTx`; update its args + `getCampaignPda` seeds. Keep step-3 soft-fail (campaign-form.tsx:748-752) but log loudly when `pdaAddress` is missing.
3. **Rewire payout:** replace the `markVerified → distributions.dispatch` money path. `markVerified` becomes a mirror; the oracle service calls `record_performance` on-chain; a Convex cron cranks `claim_payout`; on confirm, patch `submissions.paidUsdc`/`payoutTxSignature`. The 50/45/5 investor/builder/protocol split (`distributions.record`, idempotent on `submissionId`) stays **downstream of the on-chain net agent earnings** — unchanged.
4. **Rate units:** convert `ratePerThousandViews` (a UI number, currently RM-flavored in some campaigns) to USDC `rate_per_1k` base units at create time. Decide the RM→USDC FX policy explicitly (recommend: campaigns are created in USDC going forward; no RM on the on-chain path).
5. **Legacy escrow PDAs already funded (no payout wired):** these used the old `[b"campaign", campaign_id]` seed and old `CampaignEscrow` layout. They cannot be read by the new program (different account size). Provide a one-shot **drain tool**: deploy a tiny `legacy_cancel` path (or keep the old `cancel_campaign` reachable by program-version pinning) so the boss can refund the few stranded PDAs back to the creator before fully cutting over. Inventory them first (`campaigns` with `pdaAddress` set).
6. **Backfill flag:** add `campaigns.onchainVersion` (1 = legacy escrow, 2 = new treasury) so the UI and cron know which rail a campaign is on during the transition.

No double-payment risk during cutover because legacy campaigns paid off-chain (vault) and new ones pay on-chain — they don't share the `ClaimRecord` ledger.

---

## 5. Phased roadmap, effort/risk, top correctness risks

### Phases

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| **P0 — Program core** | New `Campaign`+`ClaimRecord`, extend `PlatformConfig`, `create_campaign`/`top_up`/`record_performance`/`claim_payout`/`refund_remaining`/`cancel`. Anchor tests for double-pay, overrun, monotonic, refund-after-payout. | 1.5–2.5 wk | **High** (money). Mitigate with exhaustive tests + audit before mainnet. |
| **P1 — TS wrappers + IDL** | `escrow.ts` helpers, regenerate IDL, `getCampaignPda` seed fix, `getClaimPda`. | 3–4 d | Med (seed mismatch = wrong PDA; unit-test derivation against on-chain). |
| **P2 — Convex rewire** | `markVerified` → mirror; cron to crank `claim_payout`; `computePayoutUsdc` floor fix; `submissions.paidUsdc`; reconcile cron chain→Convex. | 1 wk | Med (idempotency + reconcile correctness). |
| **P3 — Oracle integration** | Oracle team builds `record_performance` caller + mirror POST against §3; Vello provisions key, sets windows. | Cross-team, 1–2 wk parallel | Med (contract drift; pin the schema, version it). |
| **P4 — UI** | `campaign-detail.tsx` show per-clip `paid`/`accrued`/remaining budget; brand refund button; live cost badge. | 4–5 d | Low. |
| **P5 — Migration + cutover** | Legacy drain tool, `onchainVersion` flag, devnet→mainnet. | 4–5 d | Med (stranded legacy funds). |
| **P6 (defer) — strict pro-rata at exhaustion** | Frozen `Σaccrued` + `finalized`. | — | Optional. |

### Top correctness risks + mitigations

1. **Double-pay** (the current program's actual bug). Mitigation: per-clip `ClaimRecord.paid` monotonic; pay only `accrued − paid`; **effects-before-interactions** (bump `paid`/`reserved` before the CPI). One `ClaimRecord` PDA per `submission_id` — a second `init` collides and fails. Never gate on a global counter (the old `approved_count == 0` is both too strict and unsafe).
2. **Budget overrun / vault drain.** `gross = min(owed, budget − reserved)`, all `checked_sub`; invariant `reserved <= budget`. Concurrent crankers serialize on the `Campaign` write-lock → no TOCTOU. Auto-disburse-in-record racing a manual `claim_payout` is safe because both go through the same `disburse()` gated on `paid`/`reserved`.
3. **Oracle compromise.** Signer pinned to `PlatformConfig.oracle`; monotonic `verified_views` (can't roll back to re-accrue); `dispute_window_slots` lets admin `reject_clip` before bad deltas pay; **budget is the hard ceiling** — max loss per campaign is its budget. Rotate via `update_platform_config`.
4. **Rounding drift.** Floor on-chain; fix `computePayoutUsdc` `Math.round`→`Math.floor` (campaigns.ts:308) so Convex never promises more than the chain pays. Dust refunded to owner.
5. **Refund vs in-flight claims.** `refund_remaining`/`cancel` transfer the **actual** vault balance (not the old `budget_lamports` field, lib.rs:111). Gate on `deadline_unix` reached OR `status==Cancelled`; keep a short grace window where already-attested clips can still `claim_payout` before refund, to avoid griefing clippers whose crank lands after the brand refunds.

---

## 6. Relationship to the agent-treasury PDA (Phase 1 of the prior on-chain roadmap)

The campaign treasury and the agent treasury are **two account families under one program, sharing one `PlatformConfig` authority and the same patterns.** This is deliberate and is why we extend `vello-escrow` rather than fork a new program.

- **Shared `PlatformConfig` (lib.rs:172-233).** Already governs `sweep_to_treasury` (authority + treasury). We extend the *same singleton* with `oracle` + `protocol_fee_bps` + windows. One admin key rotates everything; one treasury sinks both protocol fees (from `claim_payout`) and agent sweeps. No second config account.
- **Shared PDA-as-vault pattern.** `AgentWallet` (seeds `[AGENT_WALLET_SEED, owner, session_hash]`, lib.rs:212-217) and `Campaign` (seeds `[b"campaign", creator, campaign_id]`) are both program-owned, key-less, with a PDA-owned USDC ATA, drained only by PDA-signed CPI transfers under the program's rules. `Campaign`'s `_reserved: [u8;32]` mirrors `AgentWallet`'s for forward-compat.
- **The natural join: clipper payout → agent wallet.** `ClaimRecord.beneficiary` is the clipper agent's payout wallet. The opinionated wiring is to make that the agent's `AgentWallet` ATA: `claim_payout` pays the campaign vault → AgentWallet ATA, and later `sweep_to_treasury` moves USDC from the AgentWallet to the platform treasury for compute-credit replenishment (the hybrid settlement model the agent rail was built for). Campaign treasury is "money in"; agent treasury is "money held + swept." Same authority, same token rail, composable.
- **Shared correctness discipline.** Both use checked arithmetic, PDA-signer seeds, and a pinned authority. The campaign side adds the oracle + per-clip ledger; the agent side already has the sweep authority gate. Auditing one familiarizes you with the other.

Sequencing note: `PlatformConfig` (agent-rail Phase 1) is the prerequisite for the campaign treasury — `record_performance` reads `PlatformConfig.oracle`. If Phase 1 isn't deployed, ship `init_platform_config` (extended) as the first step of P0.

---

### Key file references
- Program: `apps/web/programs/vello-escrow/src/lib.rs` — bugs at 46, 50, 65-72, 107, 111, 246/276; reuse 172-233 (config), 148-233 (agent rail).
- TS wrappers: `apps/web/lib/escrow.ts` (`getCampaignPda`, add claim/record/refund helpers); IDL `apps/web/lib/vello-escrow-idl.json`.
- Convex: `convex/campaigns.ts:300` (`computePayoutUsdc` floor fix), `:324-395` (`markVerified` → mirror), `convex/distributions.ts` + `app/api/agents/distribute-earnings/route.ts` (downstream split, unchanged), `convex/http.ts:20-67` (mirror webhook), `convex/schema.ts:212` (`paidUsdc`).
- UI: `components/campaign/campaign-form.tsx:713-752` (create+escrow), `components/campaign/campaign-detail.tsx` (display, add per-clip + refund).
- Worktree home: `C:\Project\Vello\.claude\worktrees\oracle-layer`.