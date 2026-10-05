use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("93RLwdPcyuNFFougLvRLe7912oJBfq77Y8ZNYXQZD6CP");

// ---------------------------------------------------------------------------
// Vello Agent Vault
//
// A per-agent on-chain USDC vault. Each agent gets a PDA (`["vault", owner, agent_id]`,
// owner-bound to prevent seed-squatting — see the InitVault note)
// that owns a USDC associated-token-account — the agent's funds live there with
// NO private key in any database (this closes the at-rest key liability that the
// custodial path carries, see lib/server/walletCrypto.ts plaintext fallback).
//
// Money paths:
//   deposit    — anyone funds the vault ATA (funder-signed).
//   debit_fee  — the platform AUTHORITY sweeps a per-run fee to the configured
//                treasury. Three independent on-chain guards:
//                  (1) amount <= max_fee_per_run               (cap)
//                  (2) a FeeRecord PDA keyed by run_id is init'd, so the same
//                      run_id can NEVER debit twice                (idempotent)
//                  (3) destination is constrained to vault.treasury (no redirect)
//   withdraw   — the OWNER pulls funds back out (self-custody, anytime).
//   set_*      — OWNER-only authority/cap rotation (mainnet key-rotation).
//
// This program is ADDITIVE: new agents opt in behind a flag; the legacy
// custodial keypair path (lib/economy/settleAgent.ts) is untouched.
// ---------------------------------------------------------------------------

pub const VAULT_SEED: &[u8] = b"vault";
pub const FEE_SEED: &[u8] = b"fee";

#[program]
pub mod agent_vault {
    use super::*;

    /// Create the vault PDA + its USDC ATA for an agent. The signer becomes the
    /// `owner` (self-custody / withdraw rights). `authority` is the key allowed to
    /// debit fees; `treasury` is the ONLY account debits may land in; the per-run
    /// cap is fixed here (rotatable later by the owner via `set_cap`).
    pub fn init_vault(
        ctx: Context<InitVault>,
        agent_id: [u8; 32],
        authority: Pubkey,
        treasury: Pubkey,
        max_fee_per_run: u64,
    ) -> Result<()> {
        require!(max_fee_per_run > 0, VaultError::InvalidCap);

        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.authority = authority;
        vault.treasury = treasury;
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        vault.agent_id = agent_id;
        vault.max_fee_per_run = max_fee_per_run;
        vault.total_debited = 0;
        vault.bump = ctx.bumps.vault;
        emit!(VaultInitialized {
            vault: vault.key(),
            owner: vault.owner,
            authority: vault.authority,
            treasury: vault.treasury,
            agent_id,
            max_fee_per_run,
        });
        Ok(())
    }

    /// Deposit USDC into the vault ATA. Funder-signed; anyone may top up.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::InvalidAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder_usdc_ata.to_account_info(),
                    to: ctx.accounts.vault_usdc_ata.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
        )?;
        emit!(Deposited {
            vault: ctx.accounts.vault.key(),
            funder: ctx.accounts.funder.key(),
            amount,
        });
        Ok(())
    }

    /// Debit a per-run fee from the vault to the treasury. AUTHORITY-signed.
    /// Idempotent per `run_id` (the FeeRecord PDA `init` fails on replay), capped
    /// at `max_fee_per_run`, and the destination is pinned to `vault.treasury`.
    pub fn debit_fee(ctx: Context<DebitFee>, amount: u64, run_id: [u8; 32]) -> Result<()> {
        require!(amount > 0, VaultError::InvalidAmount);
        require!(
            amount <= ctx.accounts.vault.max_fee_per_run,
            VaultError::FeeExceedsCap
        );

        // Persist the run_id record. `init` (see DebitFee) makes a second debit
        // with the same (vault, run_id) abort with "account already in use" —
        // this is the idempotency / double-charge guard.
        let record = &mut ctx.accounts.fee_record;
        record.vault = ctx.accounts.vault.key();
        record.run_id = run_id;
        record.amount = amount;
        record.bump = ctx.bumps.fee_record;

        let agent_id = ctx.accounts.vault.agent_id;
        let owner = ctx.accounts.vault.owner;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), agent_id.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc_ata.to_account_info(),
                    to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let vault = &mut ctx.accounts.vault;
        vault.total_debited = vault
            .total_debited
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;
        emit!(FeeDebited {
            vault: vault.key(),
            run_id,
            amount,
            treasury: vault.treasury,
            total_debited: vault.total_debited,
        });
        Ok(())
    }

    /// Withdraw USDC from the vault back to the owner. OWNER-signed (self-custody).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::InvalidAmount);

        let agent_id = ctx.accounts.vault.agent_id;
        let owner = ctx.accounts.vault.owner;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), agent_id.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc_ata.to_account_info(),
                    to: ctx.accounts.owner_usdc_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        emit!(Withdrawn {
            vault: ctx.accounts.vault.key(),
            owner: ctx.accounts.owner.key(),
            amount,
        });
        Ok(())
    }

    /// Rotate the fee-debit authority. OWNER-only (recover from a leaked authority key).
    pub fn set_authority(ctx: Context<AdminUpdate>, new_authority: Pubkey) -> Result<()> {
        let old_authority = ctx.accounts.vault.authority;
        ctx.accounts.vault.authority = new_authority;
        emit!(AuthorityChanged {
            vault: ctx.accounts.vault.key(),
            old_authority,
            new_authority,
        });
        Ok(())
    }

    /// Change the per-run fee cap. OWNER-only.
    pub fn set_cap(ctx: Context<AdminUpdate>, new_cap: u64) -> Result<()> {
        require!(new_cap > 0, VaultError::InvalidCap);
        let old_cap = ctx.accounts.vault.max_fee_per_run;
        ctx.accounts.vault.max_fee_per_run = new_cap;
        emit!(CapChanged {
            vault: ctx.accounts.vault.key(),
            old_cap,
            new_cap,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(agent_id: [u8; 32])]
pub struct InitVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    // SEED-SQUAT FIX: the owner is bound INTO the seed, so a vault PDA is
    // `["vault", owner, agent_id]`. Only a signer holding `owner`'s key can create
    // the PDA at that address. Because the platform derives the reward-beneficiary
    // vault from a KNOWN platform owner key, an attacker cannot front-run/init the
    // platform's vault for a guessable agent_id — they can only create their own
    // `["vault", theirKey, agent_id]`, which the platform never reads.
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref(), agent_id.as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// USDC ATA owned by the vault PDA — where the agent's funds live.
    /// `init_if_needed` (not `init`) so an attacker cannot permanently DoS vault
    /// creation by front-creating this ATA (MED-2). Anchor still verifies the ATA's
    /// mint + authority, so adopting a pre-existing correct ATA is safe.
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub funder: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent_id.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        associated_token::mint = vault.usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = funder_usdc_ata.mint == vault.usdc_mint @ VaultError::MintMismatch,
    )]
    pub funder_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(amount: u64, run_id: [u8; 32])]
pub struct DebitFee<'info> {
    /// Must equal `vault.authority` (enforced by has_one) and sign.
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent_id.as_ref()],
        bump = vault.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    /// One-shot per-run marker. `init` here is the idempotency guard: a replayed
    /// (vault, run_id) makes the whole transaction fail.
    #[account(
        init,
        payer = payer,
        space = 8 + FeeRecord::INIT_SPACE,
        seeds = [FEE_SEED, vault.key().as_ref(), run_id.as_ref()],
        bump
    )]
    pub fee_record: Account<'info, FeeRecord>,

    #[account(
        mut,
        associated_token::mint = vault.usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    /// Destination is pinned to the vault's configured treasury — the authority
    /// cannot redirect fees to an arbitrary account.
    #[account(
        mut,
        constraint = treasury_usdc_ata.mint == vault.usdc_mint @ VaultError::MintMismatch,
        constraint = treasury_usdc_ata.owner == vault.treasury @ VaultError::InvalidTreasury,
    )]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    /// Rent payer for the FeeRecord (a funded platform wallet; keeps SOL off the
    /// signing authority if desired). May equal `authority`.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent_id.as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        associated_token::mint = vault.usdc_mint,
        associated_token::authority = vault,
    )]
    pub vault_usdc_ata: Account<'info, TokenAccount>,

    /// Owner's USDC ATA — must already exist (the client ensures it). Verified to
    /// belong to the owner and hold the vault's mint; no `init_if_needed` so there
    /// is no re-initialization surface.
    #[account(
        mut,
        constraint = owner_usdc_ata.mint == vault.usdc_mint @ VaultError::MintMismatch,
        constraint = owner_usdc_ata.owner == owner.key() @ VaultError::Unauthorized,
    )]
    pub owner_usdc_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminUpdate<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.agent_id.as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Wallet that initialized the vault — holds withdraw + admin rights.
    pub owner: Pubkey,
    /// Key allowed to call `debit_fee` (the Vello platform signer).
    pub authority: Pubkey,
    /// Owner of the only ATA `debit_fee` may pay into.
    pub treasury: Pubkey,
    /// USDC mint this vault holds.
    pub usdc_mint: Pubkey,
    /// 32-byte agent identifier (e.g. sha256 of the Vello sessionId/mint).
    pub agent_id: [u8; 32],
    /// On-chain ceiling for a single `debit_fee` call.
    pub max_fee_per_run: u64,
    /// Lifetime sum of debited fees (audit trail).
    pub total_debited: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct FeeRecord {
    pub vault: Pubkey,
    pub run_id: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Max fee per run must be greater than zero")]
    InvalidCap,
    #[msg("Fee exceeds the on-chain per-run cap")]
    FeeExceedsCap,
    #[msg("Signer is not authorized for this vault")]
    Unauthorized,
    #[msg("Token account mint does not match the vault USDC mint")]
    MintMismatch,
    #[msg("Destination is not the vault's configured treasury")]
    InvalidTreasury,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ---------------------------------------------------------------------------
// Events (off-chain monitoring / audit trail)
// ---------------------------------------------------------------------------

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub agent_id: [u8; 32],
    pub max_fee_per_run: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeeDebited {
    pub vault: Pubkey,
    pub run_id: [u8; 32],
    pub amount: u64,
    pub treasury: Pubkey,
    pub total_debited: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AuthorityChanged {
    pub vault: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct CapChanged {
    pub vault: Pubkey,
    pub old_cap: u64,
    pub new_cap: u64,
}
