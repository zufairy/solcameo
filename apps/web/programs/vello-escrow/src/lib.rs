// TODO(oracle-session): anchor build -> fix compile -> regenerate IDL -> deploy -> init_platform_config(oracle=...)
//
// Per-campaign USDC treasury with oracle-verified, permissionless, incremental
// payout. The CAMPAIGN half of this program was rewritten per
// docs/campaign-treasury/01-PROGRAM-DESIGN.md (and 00-DESIGN.md / 02-ORACLE-SPEC.md).
// The AGENT-WALLET half (register_agent_wallet, sweep_to_treasury, AgentWallet PDA)
// is unchanged — it is the sound agent-wallet rail and shares PlatformConfig.
//
// Key structural change vs the old program:
//   - approve_submission (paid the WHOLE budget to one influencer) is REMOVED.
//   - Attestation (record_performance, oracle-signed) is split from disbursement
//     (claim_payout, permissionless). Money moves only in claim_payout, capped to
//     budget, idempotent per (campaign, submission) via ClaimRecord.paid.
//   - Campaign PDA seed now binds the creator: [b"campaign", creator, campaign_id].
//   - cancel/refund sweep the ACTUAL vault ATA balance, never a stale accounting field.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx");

pub const AGENT_WALLET_SEED: &[u8] = b"vello:agent";
pub const PLATFORM_CONFIG_SEED: &[u8] = b"vello:config";
pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const CLAIM_SEED: &[u8] = b"claim";

// Campaign.status discriminants
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_CANCELLED: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;

/// Hard ceiling on the protocol fee (panel #2 M1). Without it, `protocol_fee_bps`
/// was bounded only by <= 10000, so an admin could set 100% and `claim_payout`
/// would credit the clip as paid while sending the ENTIRE payout to the treasury,
/// zeroing the clipper. 2000 bps = 20% is a generous sane maximum.
pub const MAX_PROTOCOL_FEE_BPS: u16 = 2000;

/// Grace window (seconds) AFTER `deadline_unix` during which the keeper can
/// still crank already-attested-but-uncranked claims before the brand may
/// `refund_remaining`. Without it, a brand calling refund exactly at the
/// deadline drains the vault before the 10-min claim keeper cranks a verified
/// clipper — a deadline-rug that re-opens the cancel-rug FIX-5 closed.
/// 6h is devnet-reasonable (well above the 10-min claim cadence + outage margin).
pub const REFUND_GRACE_SECS: i64 = 6 * 60 * 60;

/// Campaign deadline bounds (panel #2 NEW-1/NEW-3). MIN duration >= the grace window so
/// a clip attested by the deadline is always claimable well before cancel/refund unlocks;
/// MAX bounds `deadline + REFUND_GRACE_SECS` against i64 overflow.
pub const MIN_CAMPAIGN_DURATION_SECS: i64 = REFUND_GRACE_SECS;
pub const MAX_CAMPAIGN_DURATION_SECS: i64 = 365 * 24 * 60 * 60;

/// Upper bound on the dispute window (finding #6). The refund grace is in SECONDS
/// (REFUND_GRACE_SECS = 6h) while the dispute window is in SLOTS; the design relies
/// on a clip attested by the deadline becoming claimable BEFORE the grace unlocks
/// cancel/refund (else the clipper is rugged). We can't read real slot time
/// on-chain, so cap the window at ~half the grace assuming a conservative ~2.5
/// slots/sec (0.4 s/slot): 6h ≈ 54000 slots → cap at 27000 (~3h). This rejects a
/// misconfiguration that sets the window beyond the grace; the recommended mainnet
/// value (~9000 ≈ 1h) sits well within it.
pub const MAX_DISPUTE_WINDOW_SLOTS: u64 = 27_000;

#[program]
pub mod vello_escrow {
    use super::*;

    // ==================================================================
    // Platform config — global singleton. Extended with the oracle key,
    // protocol fee, and dispute/staleness windows that the campaign rail
    // depends on.
    // Seeds: [PLATFORM_CONFIG_SEED]
    // ==================================================================

    /// Initialize the global platform config (called once at deploy time).
    /// `authority` (the signer) becomes the admin / sweep authority.
    /// `oracle` is the only signer allowed to call record_performance / reject_clip.
    pub fn init_platform_config(
        ctx: Context<InitPlatformConfig>,
        treasury: Pubkey,
        oracle: Pubkey,
        protocol_fee_bps: u16,
        dispute_window_slots: u64,
        max_staleness_slots: u64,
    ) -> Result<()> {
        require!(protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS, EscrowError::InvalidFeeBps);
        // The claimable window is [recorded + dispute, recorded + staleness]. If
        // dispute >= staleness the window is empty and funds strand forever.
        require!(
            dispute_window_slots < max_staleness_slots,
            EscrowError::InvalidWindowConfig
        );
        // Keep the window safely under the 6h refund grace (finding #6).
        require!(
            dispute_window_slots <= MAX_DISPUTE_WINDOW_SLOTS,
            EscrowError::InvalidWindowConfig
        );
        let cfg = &mut ctx.accounts.platform_config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.treasury = treasury;
        cfg.oracle = oracle;
        cfg.protocol_fee_bps = protocol_fee_bps;
        cfg.dispute_window_slots = dispute_window_slots;
        cfg.max_staleness_slots = max_staleness_slots;
        cfg.bump = ctx.bumps.platform_config;
        Ok(())
    }

    /// Rotate any of the config fields. Admin-only.
    pub fn update_platform_config(
        ctx: Context<UpdatePlatformConfig>,
        new_authority: Option<Pubkey>,
        new_treasury: Option<Pubkey>,
        new_oracle: Option<Pubkey>,
        new_fee_bps: Option<u16>,
        new_dispute_window_slots: Option<u64>,
        new_max_staleness_slots: Option<u64>,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.platform_config;

        // Validate the EFFECTIVE post-update window pair (either field may be
        // Some): an empty window (dispute >= staleness) would strand all funds.
        let effective_dispute = new_dispute_window_slots.unwrap_or(cfg.dispute_window_slots);
        let effective_staleness = new_max_staleness_slots.unwrap_or(cfg.max_staleness_slots);
        require!(
            effective_dispute < effective_staleness,
            EscrowError::InvalidWindowConfig
        );
        // Keep the window safely under the 6h refund grace (finding #6).
        require!(
            effective_dispute <= MAX_DISPUTE_WINDOW_SLOTS,
            EscrowError::InvalidWindowConfig
        );

        if let Some(a) = new_authority {
            cfg.authority = a;
        }
        if let Some(t) = new_treasury {
            cfg.treasury = t;
        }
        if let Some(o) = new_oracle {
            cfg.oracle = o;
        }
        if let Some(f) = new_fee_bps {
            require!(f <= MAX_PROTOCOL_FEE_BPS, EscrowError::InvalidFeeBps);
            cfg.protocol_fee_bps = f;
        }
        if let Some(d) = new_dispute_window_slots {
            cfg.dispute_window_slots = d;
        }
        if let Some(s) = new_max_staleness_slots {
            cfg.max_staleness_slots = s;
        }
        Ok(())
    }

    // ==================================================================
    // Campaign lifecycle (signer: creator)
    // Seeds: [CAMPAIGN_SEED, creator, campaign_id]
    // ==================================================================

    /// Create a per-campaign vault. Transfers `initial_budget` USDC from the
    /// creator's ATA into the PDA-owned escrow ATA. reserved starts at 0.
    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: String,
        rate_per_1k: u64,
        initial_budget: u64,
        deadline_unix: i64,
    ) -> Result<()> {
        require!(initial_budget > 0, EscrowError::InvalidAmount);
        // Bound the deadline (panel #2 NEW-1/NEW-3). MIN duration >= the 6h grace so a
        // clip attested by the deadline is claimable long before cancel/refund unlocks;
        // combined with the post-deadline record guard this closes the late-attestation
        // rug. MAX bounds the later grace_end checked_add against i64 overflow.
        let now_ts = Clock::get()?.unix_timestamp;
        require!(
            deadline_unix
                >= now_ts
                    .checked_add(MIN_CAMPAIGN_DURATION_SECS)
                    .ok_or(EscrowError::Overflow)?,
            EscrowError::InvalidDeadline
        );
        require!(
            deadline_unix
                <= now_ts
                    .checked_add(MAX_CAMPAIGN_DURATION_SECS)
                    .ok_or(EscrowError::Overflow)?,
            EscrowError::InvalidDeadline
        );

        let campaign = &mut ctx.accounts.campaign;
        campaign.creator = ctx.accounts.creator.key();
        campaign.usdc_mint = ctx.accounts.usdc_mint.key();
        campaign.campaign_id = campaign_id;
        campaign.rate_per_1k = rate_per_1k;
        campaign.budget = initial_budget;
        campaign.reserved = 0;
        campaign.total_verified_views = 0;
        campaign.deadline_unix = deadline_unix;
        campaign.status = STATUS_ACTIVE;
        campaign.bump = ctx.bumps.campaign;
        campaign.rate_epoch = 0;
        campaign.padding = [0u8; 32];

        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_usdc_ata.to_account_info(),
            to: ctx.accounts.escrow_usdc_ata.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            initial_budget,
        )?;

        Ok(())
    }

    /// Add more USDC to an existing campaign vault. Permissionless funder.
    /// budget += amount (checked). Sound, kept from the original program.
    pub fn top_up(ctx: Context<TopUp>, _campaign_id: String, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            ctx.accounts.campaign.status == STATUS_ACTIVE,
            EscrowError::CampaignNotActive
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.funder_usdc_ata.to_account_info(),
            to: ctx.accounts.escrow_usdc_ata.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )?;

        ctx.accounts.campaign.budget = ctx
            .accounts
            .campaign
            .budget
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;
        Ok(())
    }

    /// Change the per-1,000-view USDC payout rate for FUTURE view growth.
    /// PROSPECTIVE ONLY: bumping `rate_epoch` makes each clip's next
    /// record_performance settle its accrued-at-old-rate into a baseline BEFORE
    /// applying the new rate, so already-attested views keep their old price
    /// (Appendix B.1 — the retroactive-repricing trap the audit must enforce).
    /// Creator-only; emits CampaignRateChanged for the off-chain audit log. Has no
    /// effect on accrued/paid until the next attestation, so a rate change can
    /// never claw back owed-unpaid and never reprices already-counted views.
    pub fn update_campaign_rate(
        ctx: Context<UpdateCampaignRate>,
        _campaign_id: String,
        new_rate_per_1k: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.campaign.status == STATUS_ACTIVE,
            EscrowError::CampaignNotActive
        );
        let now_slot = Clock::get()?.slot;
        let campaign = &mut ctx.accounts.campaign;
        let old_rate = campaign.rate_per_1k;
        campaign.rate_per_1k = new_rate_per_1k;
        campaign.rate_epoch = campaign
            .rate_epoch
            .checked_add(1)
            .ok_or(EscrowError::Overflow)?;
        emit!(CampaignRateChanged {
            campaign: campaign.key(),
            old_rate_per_1k: old_rate,
            new_rate_per_1k,
            rate_epoch: campaign.rate_epoch,
            slot: now_slot,
        });
        Ok(())
    }

    // ==================================================================
    // Oracle attestation (signer: oracle == PlatformConfig.oracle)
    // MOVES NO MONEY. Writes/updates the per-clip ClaimRecord.
    // ==================================================================

    /// Record the oracle's cumulative verified views for one (campaign, submission).
    /// Idempotent + monotonic: verified_views must never decrease. Accrual is
    /// floor(verified_views * rate_per_1k / 1000) using a u128 intermediate.
    /// Does NOT transfer any tokens — disbursement is the separate claim_payout.
    pub fn record_performance(
        ctx: Context<RecordPerformance>,
        _campaign_id: String,
        submission_id: String,
        beneficiary: Pubkey,
        verified_views: u64,
        score_hash: [u8; 32],
        attest_tx: [u8; 64],
    ) -> Result<()> {
        require!(
            ctx.accounts.campaign.status == STATUS_ACTIVE,
            EscrowError::CampaignNotActive
        );
        // No new accrual after the deadline (panel #2 NEW-1): otherwise a clip attested
        // in the [deadline, deadline+grace] window might not be claimable before the
        // creator may cancel/refund, rugging it. With this, every owed delta is attested
        // by the deadline, so the 6h grace always covers its dispute window.
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.campaign.deadline_unix,
            EscrowError::CampaignExpired
        );

        let campaign_key = ctx.accounts.campaign.key();
        let rate_per_1k = ctx.accounts.campaign.rate_per_1k;
        let campaign_rate_epoch = ctx.accounts.campaign.rate_epoch;
        let now_slot = Clock::get()?.slot;
        let claim_bump = ctx.bumps.claim;

        // Mutate the ClaimRecord in a scoped borrow so it is released before we
        // touch `ctx.accounts.campaign` again (the borrow checker disallows
        // holding &mut on two fields of ctx.accounts simultaneously).
        let views_delta = {
            let claim = &mut ctx.accounts.claim;

            // On first init these are zero; on re-record they carry prior state.
            if claim.campaign == Pubkey::default() {
                claim.campaign = campaign_key;
                claim.submission_id = submission_id;
                claim.beneficiary = beneficiary;
                claim.paid = 0;
                claim.frozen = false;
                claim.bump = claim_bump;
                // Born synced to the campaign's current rate epoch: a clip first
                // recorded after a rate change prices ALL its views at the new rate.
                claim.rate_epoch = campaign_rate_epoch;
                claim.accrued_baseline = 0;
                claim.views_baseline = 0;
                claim.last_accrual_slot = 0; // set when accrued first increases below
            }
            require!(!claim.frozen, EscrowError::ClipFrozen);
            let accrued_before = claim.accrued;

            // PROSPECTIVE-RATE SETTLE (lazy, O(1)). If the campaign rate changed since
            // this claim last recorded, freeze the accrued-at-old-rate into a baseline
            // and re-base the view counter to the current high-water mark. Only views
            // ABOVE that mark price at the new rate; everything already accrued stays
            // at the old rate — already-attested views are NEVER repriced (Appendix B.1).
            if claim.rate_epoch != campaign_rate_epoch {
                claim.accrued_baseline = claim.accrued;
                claim.views_baseline = claim.verified_views;
                claim.rate_epoch = campaign_rate_epoch;
            }

            // Monotonic high-water mark — transient provider dips must not roll back.
            // Keep-and-noop: a lower cumulative count is a transient provider dip,
            // not an error. Refresh the staleness basis (so the existing accrued
            // delta stays claimable) and return without changing the stored basis
            // or accruing any delta. The crank must never error on a dip.
            if verified_views < claim.verified_views {
                claim.last_recorded_slot = now_slot;
                return Ok(());
            }

            let delta = verified_views
                .checked_sub(claim.verified_views)
                .ok_or(EscrowError::Overflow)?;

            claim.verified_views = verified_views;

            // accrued = accrued_baseline + floor((verified_views - views_baseline)
            //   * rate_per_1k / 1000). The old-rate portion is locked in the baseline;
            // only views above the last rate-change snapshot price at the current rate.
            // u128 intermediate. The double-floor (baseline + forward) only ever rounds
            // DOWN — conservative, never overpays the vault.
            let priced_views = verified_views
                .checked_sub(claim.views_baseline)
                .ok_or(EscrowError::Overflow)?;
            let forward_u128 = (priced_views as u128)
                .checked_mul(rate_per_1k as u128)
                .ok_or(EscrowError::Overflow)?
                / 1000u128;
            let forward = u64::try_from(forward_u128).map_err(|_| EscrowError::Overflow)?;
            claim.accrued = claim
                .accrued_baseline
                .checked_add(forward)
                .ok_or(EscrowError::Overflow)?;

            claim.score_hash = score_hash;
            claim.last_attest_tx = attest_tx;
            claim.last_recorded_slot = now_slot;
            // Advance the DISPUTE basis ONLY when accrued actually grew. An
            // equal-views keep-alive or a rate-0 re-record leaves accrued flat and
            // must not re-arm the dispute window (finding #3). Dips return early
            // above (never reaching here), so they never touch this either.
            if claim.accrued > accrued_before {
                claim.last_accrual_slot = now_slot;
            }

            delta
        };

        // total_verified_views tracks the cumulative delta across re-records.
        ctx.accounts.campaign.total_verified_views = ctx
            .accounts
            .campaign
            .total_verified_views
            .checked_add(views_delta)
            .ok_or(EscrowError::Overflow)?;

        Ok(())
    }

    /// Freeze a clip (fraud / ineligible). Oracle- or authority-gated.
    /// A frozen ClaimRecord can never be paid or re-recorded.
    pub fn reject_clip(
        ctx: Context<RejectClip>,
        _campaign_id: String,
        _submission_id: String,
    ) -> Result<()> {
        ctx.accounts.claim.frozen = true;
        Ok(())
    }

    // ==================================================================
    // Disbursement (signer: anyone — permissionless crank)
    // ==================================================================

    /// Pay the newly-owed delta for one clip, capped to the remaining budget,
    /// skimming the protocol fee. Checked-effects-interactions: accounting is
    /// bumped BEFORE the PDA-signed CPI transfers, so a retry/concurrent crank
    /// pays exactly zero the second time. Idempotent no-op when nothing is owed.
    pub fn claim_payout(
        ctx: Context<ClaimPayout>,
        campaign_id: String,
        _submission_id: String,
    ) -> Result<()> {
        // A cancelled/closed campaign must not be cranked — otherwise a brand can
        // cancel-drain the vault and then a verified-but-uncranked clipper's later
        // crank lands paying 0 (cancel-rug). Hard stop on non-active status.
        require!(
            ctx.accounts.campaign.status == STATUS_ACTIVE,
            EscrowError::CampaignNotActive
        );

        // Copy scalars out up front so no borrow of ctx.accounts is held across
        // the later mutable writes / CPIs.
        let dispute_window_slots = ctx.accounts.platform_config.dispute_window_slots;
        let max_staleness_slots = ctx.accounts.platform_config.max_staleness_slots;
        let protocol_fee_bps = ctx.accounts.platform_config.protocol_fee_bps;

        let claim_frozen = ctx.accounts.claim.frozen;
        let claim_accrued = ctx.accounts.claim.accrued;
        let claim_paid = ctx.accounts.claim.paid;
        let last_recorded_slot = ctx.accounts.claim.last_recorded_slot;
        let last_accrual_slot = ctx.accounts.claim.last_accrual_slot;

        require!(!claim_frozen, EscrowError::ClipFrozen);

        let clock = Clock::get()?;
        let now = clock.slot;
        // Dispute window: measured from the last ACCRUAL, not the last record. A
        // keep-alive/dip re-record refreshes staleness (last_recorded_slot) but must
        // not re-arm this window, or an already-earned delta could never become
        // claimable while the oracle keeps the attestation fresh (finding #3).
        let claimable_at = last_accrual_slot
            .checked_add(dispute_window_slots)
            .ok_or(EscrowError::Overflow)?;
        require!(now >= claimable_at, EscrowError::InDisputeWindow);
        // Staleness: oracle must have re-posted recently enough (basis = last record).
        // PRE-DEADLINE ONLY. After the deadline record_performance is blocked, so
        // last_recorded_slot freezes; enforcing staleness then would let a keeper
        // outage strand an EARNED claim until the creator's refund grace unlocks and
        // sweeps it (deadline-rug via staleness). Post-deadline the accrual is frozen
        // and the dispute window above still applies, so skipping staleness is safe.
        if clock.unix_timestamp <= ctx.accounts.campaign.deadline_unix {
            let age = now
                .checked_sub(last_recorded_slot)
                .ok_or(EscrowError::Overflow)?;
            require!(age <= max_staleness_slots, EscrowError::AttestationStale);
        }

        // --- compute the disbursable amount ---
        // saturating_sub (defensive): if accrued ever shrinks below paid (e.g. a
        // future rate-change instruction), pay 0 rather than Err-bricking the clip.
        let owed = claim_accrued.saturating_sub(claim_paid);
        if owed == 0 {
            return Ok(()); // idempotent no-op
        }
        let remaining = ctx
            .accounts
            .campaign
            .budget
            .checked_sub(ctx.accounts.campaign.reserved)
            .ok_or(EscrowError::Overflow)?;
        let gross = owed.min(remaining); // BUDGET CAP — never overrun the vault
        if gross == 0 {
            return Ok(()); // pot exhausted, idempotent no-op
        }

        let fee = u64::try_from(
            (gross as u128)
                .checked_mul(protocol_fee_bps as u128)
                .ok_or(EscrowError::Overflow)?
                / 10_000u128,
        )
        .map_err(|_| EscrowError::Overflow)?;
        let net = gross.checked_sub(fee).ok_or(EscrowError::Overflow)?;

        // --- EFFECTS (before interactions) ---
        ctx.accounts.campaign.reserved = ctx
            .accounts
            .campaign
            .reserved
            .checked_add(gross)
            .ok_or(EscrowError::Overflow)?;
        ctx.accounts.claim.paid = ctx
            .accounts
            .claim
            .paid
            .checked_add(gross)
            .ok_or(EscrowError::Overflow)?;

        // --- INTERACTIONS (PDA-signed by the campaign seeds) ---
        let creator = ctx.accounts.campaign.creator;
        let bump = ctx.accounts.campaign.bump;
        let seeds: &[&[u8]] = &[CAMPAIGN_SEED, creator.as_ref(), campaign_id.as_bytes(), &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_usdc_ata.to_account_info(),
                    to: ctx.accounts.beneficiary_usdc_ata.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                signer_seeds,
            ),
            net,
        )?;

        if fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_usdc_ata.to_account_info(),
                        to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                        authority: ctx.accounts.campaign.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
            )?;
        }

        Ok(())
    }

    // ==================================================================
    // End of life (signer: creator)
    // ==================================================================

    /// Cancel an active campaign and refund the ACTUAL vault balance to the
    /// creator. No approved_count gate. Halts future accruals via status.
    pub fn cancel_campaign(ctx: Context<CancelCampaign>, campaign_id: String) -> Result<()> {
        require!(
            ctx.accounts.campaign.status == STATUS_ACTIVE,
            EscrowError::CampaignNotActive
        );
        // Anti-rug (panel #1 HIGH, tightened pre-mainnet): `reserved` tracks only PAID,
        // so without this gate a creator could instantly sweep the vault out from under a
        // verified-but-uncranked clipper (claim_payout requires STATUS_ACTIVE, so a
        // post-cancel crank pays 0). The lock is UNCONDITIONAL — a clip can be verified
        // OFF-chain before its first record_performance lands, so "no on-chain attestation
        // yet" does not mean "no clipper to rug". Cancel = refund_remaining timing: only
        // after deadline + grace.
        let now = Clock::get()?.unix_timestamp;
        let grace_end = ctx
            .accounts
            .campaign
            .deadline_unix
            .checked_add(REFUND_GRACE_SECS)
            .ok_or(EscrowError::Overflow)?;
        require!(now >= grace_end, EscrowError::RefundGraceActive);
        ctx.accounts.campaign.status = STATUS_CANCELLED;

        let amount = ctx.accounts.escrow_usdc_ata.amount; // ACTUAL balance, not budget
        if amount > 0 {
            sweep_vault_to_creator(
                &campaign_id,
                ctx.accounts.campaign.creator,
                ctx.accounts.campaign.bump,
                ctx.accounts.campaign.to_account_info(),
                ctx.accounts.escrow_usdc_ata.to_account_info(),
                ctx.accounts.creator_usdc_ata.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                amount,
            )?;
        }
        Ok(())
    }

    /// Sweep the remaining vault balance back to the creator after the deadline
    /// (or once Closed/Cancelled). Sweeps the ACTUAL ATA balance (unspent budget
    /// + rounding dust). Sets status = Closed.
    pub fn refund_remaining(ctx: Context<RefundRemaining>, campaign_id: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let deadline_unix = ctx.accounts.campaign.deadline_unix;
        let status = ctx.accounts.campaign.status;
        let creator = ctx.accounts.campaign.creator;
        let bump = ctx.accounts.campaign.bump;
        require!(
            now >= deadline_unix || status == STATUS_CLOSED,
            EscrowError::CampaignStillActive
        );
        // GRACE WINDOW (Risk 5 / design): after the deadline the keeper still
        // needs time to crank verified-but-uncranked claims before the brand may
        // drain the remainder. Block deadline-triggered refunds until the grace
        // elapses. An already-Closed campaign (deadline path already taken) is
        // exempt — the grace was honored on the first refund.
        let grace_end = deadline_unix
            .checked_add(REFUND_GRACE_SECS)
            .ok_or(EscrowError::Overflow)?;
        require!(
            now >= grace_end || status == STATUS_CLOSED,
            EscrowError::RefundGraceActive
        );

        let amount = ctx.accounts.escrow_usdc_ata.amount; // ACTUAL balance
        if amount > 0 {
            sweep_vault_to_creator(
                &campaign_id,
                creator,
                bump,
                ctx.accounts.campaign.to_account_info(),
                ctx.accounts.escrow_usdc_ata.to_account_info(),
                ctx.accounts.creator_usdc_ata.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                amount,
            )?;
        }

        ctx.accounts.campaign.status = STATUS_CLOSED;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Agent PDA wallets — on-chain treasury for each Vello AI agent
    //
    // Seeds: [AGENT_WALLET_SEED, owner_pubkey, session_hash(32)]
    // The program owns this PDA; no private key exists. Earnings from
    // campaign payouts are deposited to the ATA owned by this PDA.
    //
    // UNCHANGED from the original program (the sound agent-wallet rail).
    // ------------------------------------------------------------------

    /// Register an AgentWallet PDA for a newly minted Vello agent.
    /// Called once per agent mint (off-chain, via the /api/nft/mint route).
    pub fn register_agent_wallet(
        ctx: Context<RegisterAgentWallet>,
        session_hash: [u8; 32],
    ) -> Result<()> {
        let w = &mut ctx.accounts.agent_wallet;
        w.owner = ctx.accounts.creator.key();
        w.session_hash = session_hash;
        w.usdc_mint = ctx.accounts.usdc_mint.key();
        w.bump = ctx.bumps.agent_wallet;
        w.padding = [0u8; 32];
        Ok(())
    }

    /// Sweep accumulated USDC from the agent's on-chain ATA to the Vello treasury.
    /// Only the configured platform authority may call this, and funds can only
    /// move to the treasury account recorded in PlatformConfig.
    /// Used for the hybrid settlement model: on-chain USDC sweeps replenish compute credits.
    pub fn sweep_to_treasury(ctx: Context<SweepToTreasury>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);

        let owner = ctx.accounts.agent_wallet.owner;
        let session_hash = ctx.accounts.agent_wallet.session_hash;
        let bump = ctx.accounts.agent_wallet.bump;
        let seeds: &[&[u8]] = &[AGENT_WALLET_SEED, owner.as_ref(), &session_hash, &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.agent_usdc_ata.to_account_info(),
                    to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                    authority: ctx.accounts.agent_wallet.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        Ok(())
    }
}

// ----------------------------------------------------------------------
// Internal helper: PDA-signed transfer of the entire `amount` from the
// campaign vault ATA back to the creator's ATA. Shared by cancel + refund.
// ----------------------------------------------------------------------
#[allow(clippy::too_many_arguments)]
fn sweep_vault_to_creator<'info>(
    campaign_id: &str,
    creator: Pubkey,
    bump: u8,
    campaign: AccountInfo<'info>,
    escrow_usdc_ata: AccountInfo<'info>,
    creator_usdc_ata: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[CAMPAIGN_SEED, creator.as_ref(), campaign_id.as_bytes(), &[bump]];
    let signer_seeds = &[seeds];
    token::transfer(
        CpiContext::new_with_signer(
            token_program,
            Transfer {
                from: escrow_usdc_ata,
                to: creator_usdc_ata,
                authority: campaign,
            },
            signer_seeds,
        ),
        amount,
    )?;
    Ok(())
}

// ======================================================================
// Account contexts
// ======================================================================

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Campaign::space(&campaign_id),
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), campaign_id.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = campaign,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        // Pin the topped-up vault ATA to the campaign's REAL mint (panel #1 MEDIUM):
        // top_up is permissionless, so without this a worthless foreign mint could be
        // deposited into a fake ATA while `budget += amount` inflates the accounting.
        associated_token::mint = campaign.usdc_mint,
        associated_token::authority = campaign,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub funder_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct UpdateCampaignRate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
        has_one = creator @ EscrowError::Unauthorized,
    )]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String, submission_id: String)]
pub struct RecordPerformance<'info> {
    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
        has_one = oracle @ EscrowError::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// The oracle key pinned in PlatformConfig.oracle — must sign.
    #[account(mut)]
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init_if_needed,
        payer = oracle,
        space = ClaimRecord::space(&submission_id),
        seeds = [CLAIM_SEED, campaign.key().as_ref(), submission_id.as_bytes()],
        bump
    )]
    pub claim: Account<'info, ClaimRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String, submission_id: String)]
pub struct RejectClip<'info> {
    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
        // Oracle OR admin authority may freeze a clip.
        constraint = (authority.key() == platform_config.oracle
            || authority.key() == platform_config.authority) @ EscrowError::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// Either the oracle key or the admin authority (checked above).
    pub authority: Signer<'info>,

    #[account(
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, campaign.key().as_ref(), submission_id.as_bytes()],
        bump = claim.bump,
    )]
    pub claim: Account<'info, ClaimRecord>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String, submission_id: String)]
pub struct ClaimPayout<'info> {
    // NOTE: every data/token account here is Boxed. claim_payout carries 12 accounts
    // incl. two ATAs (one init_if_needed); unboxed, Anchor's generated try_accounts
    // blows the 4KB SBF stack frame ("Access violation in stack frame"). Boxing moves
    // the deserialized account buffers to the heap. (Caught by running anchor test.)
    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
    )]
    pub platform_config: Box<Account<'info, PlatformConfig>>,

    /// Permissionless crank — pays the gas, gains nothing. Funds can only flow
    /// to the claim's recorded beneficiary ATA + the configured treasury.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.creator.as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Box<Account<'info, Campaign>>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, campaign.key().as_ref(), submission_id.as_bytes()],
        bump = claim.bump,
        constraint = claim.campaign == campaign.key() @ EscrowError::ClaimCampaignMismatch,
    )]
    pub claim: Box<Account<'info, ClaimRecord>>,

    #[account(
        mut,
        associated_token::mint = campaign.usdc_mint,
        associated_token::authority = campaign,
    )]
    pub escrow_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// Beneficiary's USDC ATA — must be the wallet recorded by the oracle.
    /// init_if_needed so a never-before-paid clipper can be paid in one crank.
    #[account(
        init_if_needed,
        payer = cranker,
        associated_token::mint = usdc_mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: must equal claim.beneficiary (verified by constraint). Not a signer.
    #[account(
        constraint = beneficiary.key() == claim.beneficiary @ EscrowError::BeneficiaryMismatch,
    )]
    pub beneficiary: UncheckedAccount<'info>,

    /// Protocol-fee sink — must be owned by PlatformConfig.treasury.
    #[account(
        mut,
        constraint = treasury_usdc_ata.mint == campaign.usdc_mint @ EscrowError::MintMismatch,
        constraint = treasury_usdc_ata.owner == platform_config.treasury @ EscrowError::InvalidTreasury,
    )]
    pub treasury_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = usdc_mint.key() == campaign.usdc_mint @ EscrowError::MintMismatch)]
    pub usdc_mint: Box<Account<'info, anchor_spl::token::Mint>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct CancelCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
        has_one = creator @ EscrowError::Unauthorized,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        // Pin the swept vault ATA to the campaign's real mint (panel #2 NEW-2), for
        // consistency with top_up/claim_payout — prevents a foreign-mint cancel from
        // flipping status without sweeping the real vault.
        associated_token::mint = campaign.usdc_mint,
        associated_token::authority = campaign,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct RefundRemaining<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, creator.key().as_ref(), campaign_id.as_bytes()],
        bump = campaign.bump,
        has_one = creator @ EscrowError::Unauthorized,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        // Pin the swept vault ATA to the campaign's real mint (panel #2 NEW-2), for
        // consistency with top_up/claim_payout — prevents a foreign-mint cancel from
        // flipping status without sweeping the real vault.
        associated_token::mint = campaign.usdc_mint,
        associated_token::authority = campaign,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(session_hash: [u8; 32])]
pub struct RegisterAgentWallet<'info> {
    #[account(
        init,
        payer = creator,
        space = AgentWallet::SPACE,
        seeds = [AGENT_WALLET_SEED, creator.key().as_ref(), &session_hash],
        bump
    )]
    pub agent_wallet: Account<'info, AgentWallet>,

    /// ATA owned by the agent_wallet PDA — receives USDC campaign payouts
    #[account(
        init,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = agent_wallet,
    )]
    pub agent_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct SweepToTreasury<'info> {
    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(
        seeds = [AGENT_WALLET_SEED, agent_wallet.owner.as_ref(), &agent_wallet.session_hash],
        bump = agent_wallet.bump,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,

    #[account(
        mut,
        associated_token::mint = agent_wallet.usdc_mint,
        associated_token::authority = agent_wallet,
    )]
    pub agent_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_usdc_ata.mint == agent_wallet.usdc_mint @ EscrowError::MintMismatch,
        constraint = treasury_usdc_ata.owner == platform_config.treasury @ EscrowError::InvalidTreasury,
    )]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    /// Vello platform authority — must match PlatformConfig.authority and sign sweeps
    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct InitPlatformConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = PlatformConfig::SPACE,
        seeds = [PLATFORM_CONFIG_SEED],
        bump
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    // #1 CRITICAL (init front-run) FIX — RE-ENABLED. The singleton config init is
    // first-caller-wins, so a deploy→init gap let an attacker init first and become
    // authority+oracle+treasury of the whole protocol (total drain). Gate init to the
    // program's UPGRADE AUTHORITY: `program` yields the on-chain ProgramData address,
    // and the signer must be its upgrade authority. (Previously reverted only because
    // the anchor-test localnet harness couldn't sign as the upgrade authority — the
    // test now passes the ProgramData PDA + provider wallet; see tests.)
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EscrowError::Unauthorized)]
    pub program: Program<'info, crate::program::VelloEscrow>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EscrowError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePlatformConfig<'info> {
    #[account(
        mut,
        seeds = [PLATFORM_CONFIG_SEED],
        bump = platform_config.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub authority: Signer<'info>,
}

// ======================================================================
// Account state
// ======================================================================

#[account]
pub struct PlatformConfig {
    /// Admin key — the only signer allowed to sweep agent wallets / rotate config.
    pub authority: Pubkey,
    /// Owner of the treasury ATA that sweeps + protocol fees must land in.
    pub treasury: Pubkey,
    /// The only signer allowed to record_performance / reject_clip.
    pub oracle: Pubkey,
    /// Protocol fee skimmed on each claim_payout, in basis points (500 = 5%). 0 disables.
    pub protocol_fee_bps: u16,
    /// A fresh attestation delta is not claimable until this many slots elapse.
    pub dispute_window_slots: u64,
    /// claim_payout is blocked if the attestation is older than this many slots.
    pub max_staleness_slots: u64,
    pub bump: u8,
}

impl PlatformConfig {
    pub const SPACE: usize = 8   // discriminator
        + 32 // authority
        + 32 // treasury
        + 32 // oracle
        + 2  // protocol_fee_bps
        + 8  // dispute_window_slots
        + 8  // max_staleness_slots
        + 1; // bump
}

#[account]
pub struct Campaign {
    /// Brand/owner; only key that may refund/cancel (has_one).
    pub creator: Pubkey,
    pub usdc_mint: Pubkey,
    /// Convex campaigns._id mirror key.
    pub campaign_id: String,
    /// USDC base units (6 dp) per 1,000 verified views.
    pub rate_per_1k: u64,
    /// Total funds committed (deposited), base units.
    pub budget: u64,
    /// Total already paid out, base units. Invariant: reserved <= budget.
    pub reserved: u64,
    /// Running sum of verified views across clips (analytics).
    pub total_verified_views: u64,
    /// Unix secs; refund/cancel allowed at/after this.
    pub deadline_unix: i64,
    /// 0 Active | 1 Cancelled | 2 Closed.
    pub status: u8,
    pub bump: u8,
    /// Bumped by update_campaign_rate. A claim whose rate_epoch lags the campaign's
    /// is settled (accrued frozen into a baseline) on its next record_performance,
    /// so a rate change is PROSPECTIVE — old views are never repriced (Appendix B.1).
    pub rate_epoch: u64,
    /// Forward-compat padding. NAMED `padding`, not `_reserved`: a leading-underscore
    /// field camelCases to `reserved` in the generated IDL/JS client and would SHADOW
    /// the real `reserved` u64 — a client reading `campaign.reserved` would get this
    /// byte array instead of the paid-out accumulator. (Caught by anchor test.)
    pub padding: [u8; 32],
}

impl Campaign {
    pub fn space(campaign_id: &str) -> usize {
        8    // discriminator
        + 32 // creator
        + 32 // usdc_mint
        + 4 + campaign_id.len() // campaign_id String (4-byte len prefix)
        + 8  // rate_per_1k
        + 8  // budget
        + 8  // reserved
        + 8  // total_verified_views
        + 8  // deadline_unix
        + 1  // status
        + 1  // bump
        + 8  // rate_epoch
        + 32 // padding
    }
}

#[account]
pub struct ClaimRecord {
    pub campaign: Pubkey,
    /// Convex submissions._id mirror key (one per (campaign, agent)).
    pub submission_id: String,
    /// Agent payout wallet (AgentWallet PDA or raw wallet).
    pub beneficiary: Pubkey,
    /// Oracle-attested cumulative views — monotonic high-water mark.
    pub verified_views: u64,
    /// floor(verified_views * rate_per_1k / 1000), pre-cap.
    pub accrued: u64,
    /// Amount already transferred for this clip. paid <= accrued always.
    pub paid: u64,
    /// Chain slot of the latest accepted record — STALENESS basis (advances on
    /// every accepted record, incl. dips + equal-views keep-alives).
    pub last_recorded_slot: u64,
    /// Chain slot at which `accrued` last INCREASED — the DISPUTE-window basis.
    /// Kept separate from last_recorded_slot so a keep-alive/dip re-record (which
    /// only refreshes staleness) can't re-arm the dispute window and perpetually
    /// block a payout for an already-earned delta (finding #3).
    pub last_accrual_slot: u64,
    /// Set by reject_clip; halts all future records + claims.
    pub frozen: bool,
    /// Oracle attestation tx sig (audit).
    pub last_attest_tx: [u8; 64],
    /// Oracle evidence hash (audit, not verified on-chain).
    pub score_hash: [u8; 32],
    /// Campaign rate_epoch this claim's baseline is settled to. When it lags the
    /// campaign's, record_performance settles before accruing (prospective rate).
    pub rate_epoch: u64,
    /// Accrued amount locked in at prior rate epochs (the old-rate portion).
    pub accrued_baseline: u64,
    /// verified_views already priced into accrued_baseline; only views ABOVE this
    /// price at the current rate. Re-based on every rate change.
    pub views_baseline: u64,
    pub bump: u8,
}

impl ClaimRecord {
    pub fn space(submission_id: &str) -> usize {
        8    // discriminator
        + 32 // campaign
        + 4 + submission_id.len() // submission_id String
        + 32 // beneficiary
        + 8  // verified_views
        + 8  // accrued
        + 8  // paid
        + 8  // last_recorded_slot
        + 8  // last_accrual_slot
        + 1  // frozen
        + 64 // last_attest_tx
        + 32 // score_hash
        + 8  // rate_epoch
        + 8  // accrued_baseline
        + 8  // views_baseline
        + 1  // bump
    }
}

#[account]
pub struct AgentWallet {
    /// Wallet that minted this agent (the "owner" in Vello terms)
    pub owner: Pubkey,
    /// SHA-256 of the sessionId — uniquely identifies the agent mint
    pub session_hash: [u8; 32],
    /// USDC mint this wallet holds
    pub usdc_mint: Pubkey,
    pub bump: u8,
    pub padding: [u8; 32],
}

impl AgentWallet {
    pub const SPACE: usize = 8   // discriminator
        + 32 // owner
        + 32 // session_hash
        + 32 // usdc_mint
        + 1  // bump
        + 32; // _reserved
}

#[event]
pub struct CampaignRateChanged {
    pub campaign: Pubkey,
    pub old_rate_per_1k: u64,
    pub new_rate_per_1k: u64,
    pub rate_epoch: u64,
    pub slot: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Campaign deadline must be in the future")]
    InvalidDeadline,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("USDC mint mismatch")]
    MintMismatch,
    #[msg("Treasury account does not match the configured platform treasury")]
    InvalidTreasury,
    #[msg("Protocol fee bps exceeds the maximum allowed")]
    InvalidFeeBps,
    #[msg("dispute_window_slots must be strictly less than max_staleness_slots")]
    InvalidWindowConfig,
    #[msg("Campaign is not active")]
    CampaignNotActive,
    #[msg("Campaign deadline has passed; no new accrual")]
    CampaignExpired,
    #[msg("Campaign is still active (deadline not reached and not closed)")]
    CampaignStillActive,
    #[msg("Refund grace window after the deadline has not yet elapsed")]
    RefundGraceActive,
    #[msg("Verified views must be monotonically non-decreasing")]
    NonMonotonicViews,
    #[msg("This clip has been frozen and cannot be paid")]
    ClipFrozen,
    #[msg("Attestation is still inside the dispute window")]
    InDisputeWindow,
    #[msg("Attestation is too stale to claim against")]
    AttestationStale,
    #[msg("Beneficiary account does not match the recorded claim beneficiary")]
    BeneficiaryMismatch,
    #[msg("Claim record does not belong to this campaign")]
    ClaimCampaignMismatch,
}
