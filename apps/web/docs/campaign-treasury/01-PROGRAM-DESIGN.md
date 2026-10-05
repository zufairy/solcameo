I have everything I need. Here is the complete design.

---

# Vello Per-Campaign USDC Treasury — Anchor Program Design

## 0. What's broken in the current `vello-escrow` (must fix)

The existing program at `apps/web/programs/vello-escrow/src/lib.rs` has fatal bugs for the per-campaign-payout model:

1. **PDA collision (boss's known bug).** `CreateCampaign` seeds are `[b"campaign", campaign_id.as_bytes()]` (lib.rs:246). `campaign_id` is the Convex doc id, globally unique, so collision is unlikely *today* — but the seed does **not** include `creator.key()`, so a campaign PDA is not bound to its creator. Any address that knows a `campaign_id` string can derive the same PDA. The boss explicitly wants `creator.key()` in the seed. Fix: `[b"campaign", creator.key().as_ref(), campaign_id.as_bytes()]`.
2. **`approve_submission` pays out the ENTIRE budget to the first influencer** (lib.rs:50, `let budget = … budget_lamports;` then transfers `budget`). It also hard-blocks a second payout via `approved_count == 0` (lib.rs:46). So a campaign can pay exactly one clipper the whole pot — not pro-rata, not per-views, not multi-clipper. This is the core "buggy payout."
3. **No verified-views accounting, no per-clip claim record, no idempotency on-chain** — double-pay is only prevented by the `approved_count == 0` global lock, which is wrong for a multi-clipper campaign.
4. **`top_up` increments `budget_lamports` but `budget_lamports` is also (incorrectly) used as the per-payout amount** — conflates "total budget" with "amount to pay this person."
5. **`cancel_campaign` refunds `budget_lamports`** (the *accounting* number) rather than the **actual ATA balance**, so after any partial payout the refund math is wrong and the transfer can fail or over/under-refund.

The design below replaces these instructions. I keep `register_agent_wallet` / `PlatformConfig` / `sweep_to_treasury` as-is (they're the agent-wallet rail and are sound).

---

## (a) Accounts / Layouts

### `PlatformConfig` (reuse existing, extend)
Global singleton. Add the **oracle** key — the only signer allowed to write verified views.

```
seeds = [b"vello:config"]
authority:       Pubkey   // admin (rotate config, emergency)
oracle:          Pubkey   // ADDED — only signer that may record_performance
treasury:        Pubkey   // protocol-fee sink owner
protocol_fee_bps: u16     // ADDED — e.g. 500 = 5% skim on each payout (0 to disable)
bump:            u8
```

### `Campaign` PDA (replaces `CampaignEscrow`)
One per campaign. **Seed includes `creator.key()`** to fix the collision.

```
seeds = [b"campaign", creator.key().as_ref(), campaign_id.as_bytes()]

creator:            Pubkey      // brand/owner; only key that can refund/cancel
usdc_mint:          Pubkey
campaign_id:        String      // Convex campaigns._id (mirror key)
rate_per_1k:        u64         // USDC base units per 1,000 verified views (6 dp)
budget:             u64         // total funds COMMITTED (deposited), base units
reserved:           u64         // sum of amounts already PAID OUT (base units)
total_verified_views: u64       // running sum of verified views across clips
deadline_unix:      i64         // unix secs; refund/cancel allowed after this
status:             u8          // 0=Active 1=Cancelled 2=Closed
bump:               u8
_reserved:          [u8; 32]    // forward-compat
```

Invariant maintained by the program at all times:
`escrow_ata.amount == budget - reserved` (modulo top-ups in flight). `reserved` is the single source of truth for "already paid," and `budget - reserved` is the spendable remainder.

### `Campaign`'s USDC escrow ATA
`associated_token::mint = usdc_mint, associated_token::authority = campaign` (PDA-owned, off-curve). This is the per-campaign vault. Already how the current program does it — kept.

### `ClaimRecord` PDA (NEW — the idempotency anchor)
**One per (campaign, clip/submission).** Its existence + `paid` flag is what makes payout idempotent and double-pay-proof. Keyed by `submission_id` (the Convex `submissions._id`, since Vello is one-submission-per-(campaign,agent); a clip maps to a submission via `clips.submissionId`).

```
seeds = [b"claim", campaign.key().as_ref(), submission_id.as_bytes()]

campaign:        Pubkey
submission_id:   String     // Convex submissions._id (mirror key)
beneficiary:     Pubkey     // agent payout wallet (AgentWallet PDA or raw wallet)
verified_views:  u64        // oracle-attested cumulative views for this clip
accrued:         u64        // amount owed at last record (base units, pre-cap)
paid:            u64        // amount ALREADY transferred for this clip (base units)
last_attest_tx:  [u8;64]    // oracle attestation sig (audit)
score_hash:      [u8;32]    // oracle score hash (audit)
bump:            u8
```

`paid <= accrued` always. The claimable delta is `accrued - paid`. This supports **incremental pay as views grow** (a clip that hits 10k then 50k gets topped up) while never paying the same views twice.

---

## (b) Instruction signatures + PDA seeds + signers

```rust
// --- config ---
init_platform_config(ctx, oracle: Pubkey, treasury: Pubkey, protocol_fee_bps: u16)
update_platform_config(ctx, new_authority: Option<Pubkey>, new_oracle: Option<Pubkey>,
                       new_treasury: Option<Pubkey>, new_fee_bps: Option<u16>)
                       // signer: authority

// --- campaign lifecycle (signer: creator) ---
create_campaign(ctx, campaign_id: String, rate_per_1k: u64,
                initial_budget: u64, deadline_unix: i64)
    // seeds: [b"campaign", creator.key(), campaign_id]
    // inits Campaign + escrow ATA; transfers initial_budget creator_ata -> escrow_ata
    // sets budget = initial_budget, reserved = 0

top_up(ctx, campaign_id: String, amount: u64)        // signer: any funder
    // require amount > 0; transfer funder_ata -> escrow_ata; budget += amount (checked)

// --- oracle attestation (signer: oracle, gated by PlatformConfig.oracle) ---
record_performance(ctx, campaign_id: String, submission_id: String,
                   beneficiary: Pubkey, verified_views: u64,
                   score_hash: [u8;32], attest_tx: [u8;64])
    // inits ClaimRecord if needed (seeds: [b"claim", campaign.key(), submission_id])
    // MONOTONIC guard: require verified_views >= claim.verified_views (no rollback)
    // claim.verified_views = verified_views
    // claim.accrued = floor(verified_views * rate_per_1k / 1000)   // see (c)
    // does NOT move money. Splits attestation from disbursement.

// --- disbursement (permissionless crank OR auto in record_performance) ---
claim_payout(ctx, campaign_id: String, submission_id: String)  // signer: anyone (crank)
    // computes delta, caps to budget, applies protocol fee, transfers escrow -> beneficiary
    // + escrow -> treasury (fee). Updates claim.paid and campaign.reserved.

// --- end of life (signer: creator) ---
refund_remaining(ctx, campaign_id: String)
    // after deadline OR status==Closed: transfer (budget - reserved) escrow -> creator_ata
    // (transfers the ACTUAL escrow_ata.amount, not the accounting field — robust)

cancel_campaign(ctx, campaign_id: String)
    // status=Cancelled; halts new accruals; refunds remainder like refund_remaining.
    // Already-recorded-but-unpaid claims may still be drained first (grace) — see risks.
```

### Why split `record_performance` from `claim_payout`
- The oracle (compute-light, runs on a cron) only writes attestation state; it never needs token-program CPI authority or to know ATAs.
- Disbursement is a **permissionless crank** anyone can call (the agent, the brand, a Vello bot). The PDA signs the transfer via seeds. This is the robust separation that the current single buggy `approve_submission` lacks.
- For UX, `record_performance` can `cpi`-call the same internal `disburse()` helper so it's one tx in practice — but the accounting is still idempotent because it keys off `ClaimRecord.paid`.

### Auto-payout path (`auto_payout`)
Just `record_performance` immediately followed by the internal `disburse()` in the same instruction. Same math, same caps.

---

## (c) Payout math (concrete, integer-only, USDC = 6 dp)

All amounts are `u64` USDC **base units** (1 USDC = 1_000_000). Never use floats on-chain. `rate_per_1k` is itself in base units (e.g. $5.00/1k = `5_000_000`).

### Per-clip accrual (in `record_performance`)
```
// 128-bit intermediate to avoid overflow: views up to ~1e12 * rate 1e9
let accrued_u128 = (verified_views as u128)
    .checked_mul(rate_per_1k as u128)? / 1000u128;   // floor division
claim.accrued = accrued_u128 as u64;                  // fits: capped by budget anyway
require!(verified_views >= claim.verified_views, NonMonotonicViews); // no rollback
```

### Disbursement (in `claim_payout` / `disburse`)
```
let owed_delta = claim.accrued.checked_sub(claim.paid)?;   // never negative
if owed_delta == 0 { return Ok(()); }                      // idempotent no-op

// BUDGET CAP — the hard correctness gate. remaining is the pot truth.
let remaining = campaign.budget.checked_sub(campaign.reserved)?;
let gross = min(owed_delta, remaining);                    // never overrun the vault
if gross == 0 { return Ok(()); }                           // budget exhausted

// Protocol fee skim (optional)
let fee = (gross as u128 * cfg.protocol_fee_bps as u128 / 10_000) as u64;
let net = gross.checked_sub(fee)?;

// Effects BEFORE interactions (CEI): bump accounting first, then transfer.
campaign.reserved = campaign.reserved.checked_add(gross)?;
claim.paid        = claim.paid.checked_add(gross)?;

// Interactions: PDA-signed transfers
transfer(escrow -> beneficiary, net);                      // signer: campaign PDA seeds
if fee > 0 { transfer(escrow -> treasury, fee); }
```

### Properties this guarantees
- **Pro-rata by verified views** falls out naturally: each clip claims `views * rate/1k`; when the pot can't cover everyone, it's **first-come within the budget** (whoever cranks first while `remaining > 0`). If you want *strict* proportional split at exhaustion rather than FCFS, see the variant in Risks.
- **Capped at budget**: `gross = min(owed, remaining)` and `reserved <= budget` is a maintained invariant — the vault can never be over-drained.
- **Idempotent per clip**: `paid` is monotonic; re-running pays only the new delta. A duplicate crank pays `0`.
- **Floor rounding** (truncation) means the campaign can *never* pay out more than `floor(views*rate/1k)` in aggregate; rounding dust stays in the vault and is refunded to the owner. This is the safe rounding direction.

---

## (d) Convex / Next integration (off-chain mirror)

The on-chain `ClaimRecord` is the mirror of a row in `submissions`. Mapping:

| On-chain | Convex `submissions` field |
|---|---|
| `claim.submission_id` seed | `submissions._id` |
| `claim.verified_views` | `viewCount` |
| `claim.accrued` (display) | `payoutAmountUsdc` (× 1e6) |
| `claim.paid` | new field `paidUsdc` (add) |
| `claim.last_attest_tx` | `attestationTx` |
| `claim.score_hash` | `scoreHash` |
| `claim.beneficiary` | derive from `influencerMint` → AgentWallet PDA |

Flow (replaces the broken single-payout path):

1. **Create**: brand creates campaign in Convex (`campaigns.create`), then `lib/escrow.ts → createCampaignTx` deposits `initial_budget`. Today `getCampaignPda` uses `[b"campaign", campaignId]` — **must change to include creator wallet**: `[b"campaign", creatorWallet.toBuffer(), Buffer.from(campaignId)]`. Store the PDA in `campaigns.pdaAddress`.
2. **Submit/clip**: unchanged — `submissions.submitClipToCampaign` / `submitForCampaign` create the one-per-(campaign,agent) submission and link clips.
3. **Verify (oracle)**: `/oracle/attestation` webhook → `campaigns.markVerified` (already computes `computePayoutUsdc`, lib campaigns.ts:300). **Change**: instead of the off-chain `distributions.dispatch` being the payout, the oracle service (or a Convex action holding the oracle key) calls `record_performance(views, score_hash, attest_tx)` on-chain. `computePayoutUsdc`'s float math (campaigns.ts:306-309) should be replaced by the same integer `floor(views*rate/1k)` so off-chain mirror == on-chain truth (the current `Math.round(raw*1e6)/1e6` can round *up* a half-unit and disagree with the chain's floor — fix to `Math.floor`).
4. **Pay**: a Convex cron / the agent cranks `claim_payout`. On confirm, patch `submissions.paidUsdc` and `payoutTxSignature`. The existing `distributions.record` (idempotent by `submissionId`) records the investor/builder/protocol split *of the net agent earnings* — that off-chain split is downstream of the on-chain disbursement, unchanged.
5. **Refund**: brand calls `refund_remaining` after `deadline`; mirror by setting `campaigns.status = "closed"`.

`processedSignatures` / `consumeSignature` (campaigns.ts:247) already gives off-chain replay protection for top-ups; keep it for the deposit mirror.

---

## Hardest correctness risks (flagged)

1. **Double-pay** — the #1 risk and the current program's actual bug. Defense: `ClaimRecord.paid` monotonic + pay only `accrued - paid` + CEI ordering (bump `paid`/`reserved` *before* the CPI transfer so a re-entrant or retried call sees the updated state). The `ClaimRecord` PDA being seeded on `submission_id` means there is exactly one record per clip — a second `init` collides and fails. **Never** gate on a global `approved_count` (the current lib.rs:46 approach) — that's both too strict (one payout per campaign) and unsafe for multi-clipper.

2. **Budget overrun / vault drain** — `gross = min(owed_delta, remaining)` with `remaining = budget - reserved`, all checked-sub. Invariant `reserved <= budget` and `escrow_ata.amount >= budget - reserved`. Two clippers cranking concurrently: Solana serializes writes to the same `Campaign` account, so the second tx sees the first's `reserved` bump — no TOCTOU overrun. **Race subtlety**: if you also auto-disburse inside `record_performance`, a manual `claim_payout` racing it is safe because both go through `disburse()` and `paid`/`reserved` are the gate.

3. **Rounding** — always **floor** (integer `/1000`). Off-chain `computePayoutUsdc` currently uses `Math.round(...*1e6)/1e6` which can round a half-base-unit *up* and make Convex promise 1 base unit more than the chain pays → a stuck "unpaid 0.000001". Fix off-chain to `Math.floor`. Dust accumulates in the vault and is swept to the owner via `refund_remaining`, so no value is lost.

4. **FCFS vs proportional at exhaustion** — with `min(owed, remaining)`, when the budget can't cover all verified clips, **whoever cranks first gets paid in full until the pot empties**; late crankers get the truncated remainder or zero. For a clipper marketplace this is usually acceptable and is gas-cheap. If the boss wants *strict pro-rata at exhaustion*, that requires a two-phase close (freeze accruals at `deadline`, then disburse `paid_i = remaining_at_close * accrued_i / Σaccrued`), which needs a `Σaccrued` accumulator on `Campaign` and a `finalized` flag — call it out as a v2 option; it changes `claim_payout` to read the frozen total.

5. **Oracle trust / monotonic views** — `record_performance` is gated to `PlatformConfig.oracle` (`has_one = oracle`). Add `require!(verified_views >= claim.verified_views)` so the oracle can't *lower* views to reset accrual (it could only ever increase the owed delta, never claw back already-paid funds since `paid` is independent). Compromised oracle is bounded by `budget` (can't exceed the vault) — that cap is the backstop.

6. **Refund vs in-flight claims** — `refund_remaining`/`cancel` must transfer the **actual `escrow_ata.amount`** (or `budget - reserved`), not a stale accounting field (the current `cancel_campaign` refunds `budget_lamports`, lib.rs:111, which is wrong post-payout). Gate refund on `deadline_unix` reached OR `status==Cancelled` so a brand can't refund out from under a clip that's verified-but-not-yet-cranked. Recommend a short grace window after `deadline` where `claim_payout` still works for already-attested claims before `refund_remaining` is allowed, to avoid griefing clippers whose payout crank lands after the brand's refund.

### Files to change
- `apps/web/programs/vello-escrow/src/lib.rs` — add `Campaign`/`ClaimRecord`, fix seeds (`+creator.key()`), replace `approve_submission` with `record_performance`+`claim_payout`, fix `cancel`/add `refund_remaining`, add `oracle`+`protocol_fee_bps` to `PlatformConfig`.
- `apps/web/lib/escrow.ts:35` `getCampaignPda` — add `creatorWallet` to seeds; add `getClaimPda`, `recordPerformanceTx`, `claimPayoutTx`, `refundRemainingTx`.
- `apps/web/lib/vello-escrow-idl.json` — regenerate after `anchor build`.
- `apps/web/convex/campaigns.ts:300` `computePayoutUsdc` — switch `Math.round` → `Math.floor` to match on-chain truncation; keep base-unit semantics.
- `apps/web/convex/schema.ts:212` `submissions` — add `paidUsdc: v.optional(v.number())` to mirror `claim.paid`.