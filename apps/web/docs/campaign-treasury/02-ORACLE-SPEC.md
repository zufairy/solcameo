I have complete context. The current state: an off-chain Convex webhook (`/oracle/attestation`, shared-secret) already exists and pays the full budget once via `approve_submission`. The on-chain program has no oracle concept yet, no per-view accrual, no monotonic basis. Here is the spec.

---

# Vello Oracle ⟷ Campaign-Treasury Integration Spec

Target program: `programs/vello-escrow` (Anchor, devnet program id `4qyfe9phDNJDAUYzt4xQh7453F1zSFQLSs5aubfcoYci`). Off-chain mirror: Convex (`convex/campaigns.ts::markVerified`, `convex/http.ts` `/oracle/attestation`).

## 0. What exists today (so the oracle team knows the gap)

- The Anchor program has **no oracle concept**. `approve_submission` pays the *entire* `budget_lamports` to one influencer, gated only by `has_one = creator`. There is no per-view pricing, no per-clip ledger, no monotonic basis on-chain. View-count pricing (`computePayoutUsdc = views/1000 * ratePerThousandViews`, clamped to budget) lives **only in Convex**, and the "oracle" today is a shared-secret HTTP webhook (`x-oracle-secret`) that any holder of `ORACLE_WEBHOOK_SECRET` can call. That is the trust hole this spec closes.
- This spec **adds** an on-chain attestation layer the new program builds against, and keeps Convex as the (now non-authoritative) indexer/UI mirror.

---

## 1. Recommended trust model: **(a) permissioned oracle authority posting signed attestations on-chain**

Pick **(a)**. Rationale for view-count data specifically:

- **View counts are off-chain, subjective, and provider-defined.** There is no on-chain source of truth and no deterministic on-chain computation possible. A price feed (option c, Switchboard/Pyth) is built for *fungible market prices with many independent reporters converging on one number*; "views on clip X at time T" is a single-source, per-object fact. Pyth/Switchboard would mean standing up a custom oracle job anyway (you'd be writing the same off-chain verifier), paying feed/crank costs, and accepting feed latency/staleness windows that are wrong for high-frequency per-clip data. **Overkill and a poor fit. Reject (c).**
- **Option (b) "an oracle PDA the program reads"** is not a separate trust model — it is an *implementation detail of (a)*. Something still has to write that PDA, and that writer is a permissioned authority. We adopt the PDA-as-record shape from (b) (the attestation is persisted in a `ClipPerformance` PDA the payout instruction reads) but the *trust* comes from (a): only `OracleConfig.oracle_authority` may write it.
- **(a) is cheapest and simplest for the oracle team to target:** they hold one keypair, build one instruction (`record_performance`), sign, send. Anchor's `Signer` + a stored authority pubkey gives the program-side check for free — no ed25519 precompile gymnastics, no secp, no feed plumbing.

So: the oracle is a **single keypair** (`oracle_authority`) pinned in an on-chain `OracleConfig` PDA (rotatable by admin). The oracle calls `record_performance`; the program verifies the signer == stored authority and writes/updates a per-clip `ClipPerformance` PDA. Payout reads that PDA. The whole "signature" is the Solana transaction signature itself — **do not invent an app-level ed25519 attestation payload**; the tx being signed by the authority IS the attestation. (Keep a `score_hash`/`observed_at` in the record for provenance, not as a verified signature.)

> Rotation/decentralization path (state it, don't build it): `OracleConfig` can later hold an array of N oracle pubkeys + an M-of-N threshold and a `nonce` per record, upgrading (a) to a multi-sig oracle committee without changing the payout instruction's read path. Design `ClipPerformance` so this is additive.

---

## 2. Attestation data shape (the contract the oracle team builds to)

### 2a. On-chain instruction (authoritative)

```rust
// programs/vello-escrow/src/lib.rs

pub const ORACLE_CONFIG_SEED: &[u8] = b"vello:oracle";
pub const CLIP_PERF_SEED:     &[u8] = b"vello:clipperf";

/// Posted by the trusted oracle. One call per (campaign, clip) observation.
/// Re-callable: updates the running verified basis (see §3).
pub fn record_performance(
    ctx: Context<RecordPerformance>,
    campaign_id: String,     // Convex campaigns._id — matches CampaignEscrow seed
    clip_id: [u8; 32],       // sha256(Convex submissions._id) — stable per-clip key
    platform: u8,            // enum: 0=TikTok 1=Instagram 2=YouTube 3=X 4=Other
    verified_views: u64,     // CUMULATIVE lifetime views the oracle has verified
    observed_at: i64,        // unix secs, oracle's observation time (provenance)
    score_hash: [u8; 32],    // sha256 of the oracle's raw evidence blob (audit, not verified on-chain)
) -> Result<()>;
```

`clip_id` is the join key. Use `[u8;32] = sha256(submission_id_utf8)` so a Convex string id maps deterministically to a fixed-size seed (Solana seed segments are ≤32 bytes; raw Convex ids are fine length-wise but hashing makes it uniform and avoids encoding ambiguity — pick one and document it; I recommend the hash).

### 2b. On-chain record (the `ClipPerformance` PDA — option (b)'s account, written only via (a))

```rust
#[account]
pub struct ClipPerformance {
    pub campaign: Pubkey,         // the CampaignEscrow PDA this clip belongs to
    pub clip_id: [u8; 32],        // join key (== seed)
    pub platform: u8,
    pub verified_views: u64,      // monotonic high-water mark (the PAID BASIS, see §3)
    pub paid_views: u64,          // views already converted to a USDC claim
    pub last_observed_at: i64,    // oracle observation time of the latest accepted record
    pub last_recorded_slot: u64,  // chain slot when written — staleness measured in slots
    pub recorded_count: u32,      // how many times the oracle updated this clip
    pub bump: u8,
}
// seeds = [CLIP_PERF_SEED, campaign.key().as_ref(), &clip_id]
```

### 2c. Off-chain mirror (Convex — already exists, extend it)

The webhook payload the oracle sends to Convex `/oracle/attestation` (for the UI/indexer, **not** the money path) should mirror 2a and add the on-chain tx so Convex can verify it later:

```jsonc
{
  "campaign":        "<convex campaigns._id>",
  "submissionId":    "<convex submissions._id>",   // == preimage of clip_id
  "platform":        "tiktok",
  "verifiedViews":   123456,                        // cumulative
  "observedAt":      1735000000,                    // unix secs
  "attestationTx":   "<solana tx sig of record_performance>",  // ties mirror→chain
  "scoreHash":       "deadbeef…",                   // hex sha256 of evidence
  "decision":        "approved" | "rejected"        // rejected = fraud/ineligible
}
```

Existing Convex fields (`viewCount`, `scoreHash`, `attestationTx`, `verifiedAt`, `verificationDecision`, `payoutAmountUsdc`) already cover this; rename/treat `viewCount` as **cumulative verified_views** and require `attestationTx` to be present and confirmable on-chain (today it is optional and unchecked — that's the residual trust hole).

---

## 3. Anti-abuse rules (enforced **in the program**, mirrored in Convex)

1. **Monotonic paid basis.** `record_performance` accepts a new `verified_views` only if `verified_views >= clip_performance.verified_views`. If a platform's count drops (deletions, recounts), the program keeps the high-water mark — **the paid basis never decreases.** New `verified_views < stored` ⇒ silently keep stored (or `RecordedViewsRegressed` error if you prefer hard-fail; recommend keep-and-noop so transient API dips don't error the crank).
2. **Per-clip idempotency / no double-pay.** Payout is driven by the delta `verified_views - paid_views`. The claim instruction computes `claimable = price(verified_views - paid_views)` then sets `paid_views = verified_views` **in the same tx**. Re-running pays 0. This is the on-chain analogue of Convex's current `alreadyProcessed` guard, but at the per-view granularity instead of all-or-nothing.
3. **Staleness / expiry.** Store `last_recorded_slot`. The claim instruction requires `current_slot - last_observed_slot <= MAX_STALENESS_SLOTS` (recommend ~ a few hours of slots, configurable in `OracleConfig`). Stale record ⇒ `AttestationStale`; the oracle must re-post before more can be claimed. Also enforce `observed_at` monotonic-ish: reject `observed_at` older than the stored `last_observed_at` (replay of an old observation) ⇒ `StaleObservation`.
4. **Dispute window.** `OracleConfig.dispute_window_slots`. A freshly-recorded delta is **not claimable** until `current_slot >= last_recorded_slot + dispute_window_slots`. This gives the brand/admin time to call `flag_clip` (admin-only) which freezes `claimable` for that clip pending manual `record_performance(decision=rejected-equivalent)` — i.e., the oracle can *lower intent* by posting a rejection that zeroes future claims (it can't claw back already-paid, see §5). Recommend a short window on devnet (minutes), longer on mainnet (hours).
5. **Budget clamp (already in Convex, must be on-chain too).** `claimable` is clamped to `campaign_escrow.budget_lamports - campaign_escrow.total_paid`. A clip can never drain more than remaining budget. Mirrors `computePayoutUsdc`'s clamp.
6. **Authority gate.** `record_performance` requires `oracle_authority` signer == `OracleConfig.oracle_authority`. `flag_clip`/`update_oracle_config` require `admin`. Anyone may call the permissionless `claim` (funds can only go to the clip's bound influencer ATA), so a crank/keeper can settle without privileged keys.

---

## 4. Flow: oracle → record_performance → claimable → payout

```
                    OFF-CHAIN ORACLE (other team)
  polls TikTok/IG/YT  ──►  computes cumulative verified_views per clip
            │                         │
            │ (1) sign + send         │ (2) POST mirror
            ▼  record_performance     ▼  /oracle/attestation (x-oracle-secret)
   ┌─────────────────────┐     ┌──────────────────────────┐
   │ vello-escrow program│     │ Convex (indexer/UI only)  │
   │  • verify signer ==  │     │  markVerified: store views│
   │    OracleConfig.auth │     │  decision, attestationTx, │
   │  • monotonic basis   │     │  payoutAmountUsdc (mirror)│
   │  • write ClipPerf PDA│     │  → schedule distributions │
   └──────────┬──────────┘     └──────────────────────────┘
              │  (3) anyone cranks claim(campaign, clip_id)
              ▼
   claim: assert fresh + past dispute_window
          claimable = price(verified_views - paid_views), clamp to remaining budget
          token::transfer escrow_ata ──► influencer_ata (or agent_wallet ATA)
          paid_views = verified_views ; campaign_escrow.total_paid += claimable
              │
              ▼  (4) distributions.dispatch (existing) splits 50/45/5
```

Key change vs today: **money no longer moves on the webhook.** The Convex path becomes a mirror; the authoritative payout is `claim`, reading the on-chain `ClipPerformance`. Pricing (`ratePerThousandViews`) must be put on-chain in `CampaignEscrow` (add `rate_per_thousand_views: u64` and `total_paid: u64`) so `price()` is computed in the program, not trusted from Convex.

New instruction sketch:

```rust
pub fn claim_performance_payout(
    ctx: Context<ClaimPerformancePayout>,
    campaign_id: String,
    clip_id: [u8; 32],
) -> Result<()> {
    let now = Clock::get()?.slot;
    let perf = &mut ctx.accounts.clip_performance;
    let esc  = &mut ctx.accounts.campaign_escrow;

    require!(now >= perf.last_recorded_slot + ctx.accounts.oracle_config.dispute_window_slots,
             EscrowError::InDisputeWindow);
    require!(now - perf.last_recorded_slot <= ctx.accounts.oracle_config.max_staleness_slots,
             EscrowError::AttestationStale);

    let new_views = perf.verified_views.saturating_sub(perf.paid_views);
    let gross = (new_views as u128) * (esc.rate_per_thousand_views as u128) / 1000; // USDC micro-units
    let remaining = esc.budget_lamports.saturating_sub(esc.total_paid);
    let amount = (gross as u64).min(remaining);

    if amount > 0 {
        // transfer escrow_usdc_ata -> influencer_usdc_ata, signed by campaign PDA
        perf.paid_views = perf.verified_views;
        esc.total_paid = esc.total_paid.checked_add(amount).ok_or(EscrowError::Overflow)?;
    }
    Ok(())
}
```

---

## 5. Failure modes (the part the oracle team most needs pinned)

| Failure | Behavior | Whose responsibility |
|---|---|---|
| **Oracle down / not posting** | No new `record_performance` ⇒ `paid_views` frozen at last basis. Already-earned-and-claimed funds are safe; un-recorded views simply aren't claimable yet. When oracle recovers and posts higher cumulative `verified_views`, the next `claim` pays the catch-up delta in one shot. **No funds lost, no double-pay.** | Oracle: resume posting. Program: nothing — monotonic basis makes recovery automatic. |
| **Oracle posts wrong (too high)** | If still inside `dispute_window_slots`, admin `flag_clip` freezes; oracle posts a corrected (lower-intent) record. Since basis is monotonic, the *paid basis* can't be reduced, **but** if not yet claimed the dispute window prevents the bad delta from paying. If already claimed → **no clawback** (USDC is gone); mitigated by sizing `dispute_window` ≥ oracle's own correction latency and by the budget clamp limiting blast radius to one campaign's budget. | Admin within window; otherwise treat as accepted loss bounded by budget. |
| **Oracle posts wrong (too low / regression)** | Program keeps the high-water mark (§3.1); a low report is a no-op. Influencer never under-paid by a transient dip. | Program (automatic). |
| **Oracle key compromised** | Attacker can inflate `verified_views` up to each campaign's budget cap (clamp limits total exposure to sum of open budgets) — within the dispute window, all such records are catchable by admin freeze. Response: `update_oracle_config(new_oracle_authority)` rotates the key; queued records past the window that already paid are bounded by budget. **This is why budgets are the hard ceiling and why dispute_window > 0 is mandatory.** | Admin rotates key; budget clamp + dispute window contain damage. |
| **Convex (mirror) and chain disagree** | Chain is authoritative for money. A reconciliation cron reads `ClipPerformance` PDAs and back-fills Convex (`viewCount`, `payoutAmountUsdc`, `attestationTx`). Convex `markVerified` keeps its existing `alreadyProcessed` idempotency but is downgraded to "indexer", never the payer. | Vello backend (reconcile job). |
| **`claim` race / double-submit** | Idempotent by construction: `paid_views = verified_views` makes the second claim compute delta 0. Concurrent txs serialize on the `ClipPerformance` account write-lock; the loser sees `paid_views` already advanced ⇒ pays 0. | Program (automatic). |
| **Submission rejected as fraud** | Oracle posts `record_performance` for that clip with a sentinel (recommend a dedicated `reject_clip(clip_id)` admin/oracle instruction that sets a `frozen: bool` on `ClipPerformance` so no future `claim` pays). Convex mirror sets `status="rejected"`. | Oracle/admin. |
| **Campaign budget exhausted mid-stream** | `claim` clamps to `budget - total_paid`; once equal, all further claims pay 0 even as views grow. Brand may `top_up` (existing instruction) to extend. | Program (automatic) + brand. |

---

## 6. Concrete deliverables for the oracle team to target

1. **Hold one keypair** = `OracleConfig.oracle_authority` (Vello provides/rotates it; on devnet it can be the platform authority).
2. **Per clip, on each poll cycle:** compute *cumulative lifetime* `verified_views`, then sign+send `record_performance(campaign_id, clip_id=sha256(submissionId), platform, verified_views, observed_at, score_hash)`. Idempotent and monotonic — safe to re-send; safe to retry on RPC failure.
3. **Then POST the mirror** to `{CONVEX_SITE_URL}/oracle/attestation` with header `x-oracle-secret: $ORACLE_WEBHOOK_SECRET` and the §2c JSON, including `attestationTx` (the sig from step 2) so Convex can verify chain↔mirror.
4. **Never move money.** The oracle's only on-chain write is `record_performance` (+ optional `reject_clip`). `claim_performance_payout` is cranked separately (by a Vello keeper or the influencer) and is permissionless.
5. **Honor monotonicity:** always report cumulative, never per-interval deltas — the program de-dupes via `paid_views`. Reporting deltas would double-pay.
6. **SLA knobs Vello sets, oracle must respect:** `max_staleness_slots` (re-post before this elapses or claims block) and `dispute_window_slots` (recorded views aren't claimable until this passes — size your correction/retraction latency under it).

---

## 7. Files to change (for whoever wires the program side)

- `apps/web/programs/vello-escrow/src/lib.rs` — add `OracleConfig` + `ClipPerformance` accounts, `init_oracle_config`/`update_oracle_config`, `record_performance`, `reject_clip`, `claim_performance_payout`; add `rate_per_thousand_views` + `total_paid` to `CampaignEscrow` (note: changing `CampaignEscrow` layout requires migration or a new account version since live PDAs exist).
- `apps/web/lib/vello-escrow-idl.json` + `apps/web/lib/escrow.ts` — regenerate IDL; add `recordPerformanceTx`, `claimPerformancePayoutTx`, `getClipPerformance` helpers.
- `apps/web/convex/campaigns.ts::markVerified` — downgrade to indexer: require + verify `attestationTx` on-chain (or via reconcile cron) before trusting `viewCount`; keep idempotency.
- `apps/web/convex/http.ts` `/oracle/attestation` — keep the shared-secret gate as a *defense-in-depth on the mirror*, but document that it is no longer the authority for payment.
- `apps/web/convex/schema.ts` — treat `viewCount` as cumulative; consider adding `paidViews` + `clipPerfPda` mirror fields.

Note: there is already an `oracle-layer` git worktree at `C:\Project\Vello\.claude\worktrees\oracle-layer` whose `lib.rs` is currently identical to main (no oracle code yet) — that is the intended home for this work.