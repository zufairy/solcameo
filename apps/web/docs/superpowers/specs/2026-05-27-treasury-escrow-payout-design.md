# Treasury Escrow + Payout Design

## Goal

Lock USDC into a Solana PDA when a campaign is created. Release USDC to an influencer when the brand (campaign creator) approves their submission. Fully on-chain, trustless, devnet.

## Architecture

Two layers work together:
- **On-chain (Anchor program):** Holds USDC, enforces authorization, executes transfers.
- **Off-chain (Convex):** Stores metadata, submission status, and tx signatures for the UI.

Campaign creation is a two-step atomic flow: sign `create_campaign` tx → write to Convex. Approval is similarly: sign `approve_submission` tx → write approval to Convex.

## On-Chain Program (`programs/vello-escrow`)

Anchor program deployed to Solana devnet.

### Accounts

**`CampaignEscrow`** — PDA derived from `["campaign", campaign_id_bytes]`:
```rust
pub struct CampaignEscrow {
    pub creator: Pubkey,
    pub campaign_id: String,   // Convex _id
    pub usdc_mint: Pubkey,
    pub budget_lamports: u64,  // in USDC micro-units (6 decimals)
    pub approved_count: u32,
    pub bump: u8,
}
```

### Instructions

**`create_campaign(campaign_id: String, budget: u64)`**
- Accounts: creator (signer), campaign_escrow (PDA, init), escrow_usdc_ata (ATA of PDA, init), creator_usdc_ata, usdc_mint, system_program, token_program, associated_token_program
- Transfers `budget` USDC from `creator_usdc_ata` → `escrow_usdc_ata`
- Stores creator, campaign_id, budget in `CampaignEscrow`

**`approve_submission(campaign_id: String, influencer_wallet: Pubkey)`**
- Accounts: creator (signer, must match escrow.creator), campaign_escrow (PDA), escrow_usdc_ata, influencer_usdc_ata (ATA of influencer_wallet, init_if_needed), usdc_mint, token_program, associated_token_program
- Transfers full `budget_lamports` from escrow ATA → influencer ATA
- Increments `approved_count`

**`cancel_campaign(campaign_id: String)`**
- Accounts: creator (signer), campaign_escrow (PDA, close → creator), escrow_usdc_ata, creator_usdc_ata, token_program
- Requires `approved_count == 0`
- Returns all USDC to creator, closes PDA

### Token

Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

## Convex Changes

### Schema additions

`campaigns` table — add:
- `pdaAddress: v.string()` — on-chain PDA address
- `usdcBudget: v.number()` — budget in USDC (human-readable, e.g. 500)

`submissions` table — add:
- `payoutTxSignature: v.optional(v.string())`

`status` values for submissions: `"pending"` | `"approved"` | `"rejected"`

### New mutations

**`approveSubmission({ submissionId, payoutTxSignature })`**
- Patches submission status to `"approved"`, stores txSignature

**`rejectSubmission({ submissionId })`**
- Patches submission status to `"rejected"`

## Frontend Changes

### Campaign form (`components/campaign/campaign-form.tsx`)

1. Add `usdcBudget` number input (budget in USDC)
2. On submit:
   a. Build + sign `create_campaign` tx via `@coral-xyz/anchor` SDK
   b. Confirm tx on devnet
   c. Call Convex `createCampaign` with `pdaAddress` + `usdcBudget`
   d. Redirect to `/stage`
3. Show estimated USDC cost before signing

### Campaign detail (`components/campaign/campaign-detail.tsx`)

1. Show treasury balance pulled from on-chain PDA ATA (via `@solana/web3.js` `getTokenAccountBalance`)
2. For each `"pending"` submission, show Approve + Reject buttons (only visible to campaign creator)
3. Approve flow:
   a. Build + sign `approve_submission` tx
   b. Confirm tx
   c. Call Convex `approveSubmission` with txSignature
4. Reject flow: call Convex `rejectSubmission` only (no on-chain action needed)

### New lib file (`lib/escrow.ts`)

Exports:
- `buildEscrowProgram(wallet)` → Anchor `Program` instance
- `createCampaignTx(program, campaignId, budgetUsdc)` → `{ txSignature, pdaAddress }`
- `approveSubmissionTx(program, campaignId, influencerWallet)` → `{ txSignature }`
- `cancelCampaignTx(program, campaignId)` → `{ txSignature }`
- `getEscrowBalance(connection, pdaAddress)` → `number` (USDC amount)

## File Structure

```
programs/
  vello-escrow/
    src/
      lib.rs          CREATE — Anchor program with 3 instructions
    Cargo.toml        CREATE
    Xargo.toml        CREATE
Anchor.toml           CREATE — project config, devnet cluster
convex/
  schema.ts           MODIFY — add pdaAddress, usdcBudget, payoutTxSignature
  campaigns.ts        MODIFY — createCampaign accepts pdaAddress + usdcBudget
  submissions.ts      MODIFY — add approveSubmission + rejectSubmission mutations
lib/
  escrow.ts           CREATE — Anchor SDK helpers
components/
  campaign/
    campaign-form.tsx      MODIFY — two-step tx + Convex flow
    campaign-detail.tsx    MODIFY — approve/reject buttons, treasury balance display
```

## Error Handling

- If `create_campaign` tx fails: do not write to Convex. Show error, let user retry.
- If Convex write fails after tx: PDA exists on-chain. On next load, detect PDA exists and auto-recover by writing to Convex.
- If `approve_submission` tx fails: submission stays `"pending"`. User can retry.
- Insufficient USDC: Anchor will reject the tx with a token error. Surface as "Insufficient USDC balance."

## Testing

- Anchor tests (`tests/vello-escrow.ts`): create campaign, approve submission, cancel campaign, unauthorized approve rejected
- Manual devnet test: use Circle devnet USDC faucet to get test USDC, create a campaign, submit, approve
