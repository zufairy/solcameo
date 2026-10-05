# Treasury Escrow + Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a real Anchor program to Solana devnet that locks USDC in a PDA when a campaign is created, and releases it to an influencer when the brand approves their submission.

**Architecture:** Two-layer system: Anchor program (on-chain escrow + transfer authority) + Convex (metadata, submission status, tx signatures). Campaign creation is a 3-step flow: Convex insert → Anchor `create_campaign` → Convex `updateCampaignPda`. Approval is: Anchor `approve_submission` → Convex `approveSubmission`. The Convex `_id` string is used as the Anchor `campaign_id` seed.

**Tech Stack:** Rust + Anchor 0.30, `@coral-xyz/anchor`, `@solana/spl-token`, Convex, Next.js App Router, `@solana/wallet-adapter-react`, devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

---

## Prerequisites (human steps — do these before running tasks)

1. Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. Install Anchor CLI: `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.30.1 && avm use 0.30.1`
3. Install Solana CLI: `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"`
4. Create devnet wallet: `solana-keygen new` (or use existing `~/.config/solana/id.json`)
5. Set devnet: `solana config set --url devnet`
6. Airdrop SOL for deploy fees: `solana airdrop 2`

---

## File Structure

```
programs/
  vello-escrow/
    src/lib.rs          CREATE — Anchor program (3 instructions)
    Cargo.toml          CREATE — crate config
    Xargo.toml          CREATE — BPF target
Anchor.toml             CREATE — workspace config
Cargo.toml              CREATE — workspace root
tests/
  vello-escrow.ts       CREATE — Anchor integration tests
lib/
  vello-escrow-idl.json CREATE — copied from target/idl after anchor build
  escrow.ts             CREATE — TypeScript SDK helpers
convex/
  schema.ts             MODIFY — add pdaAddress to campaigns, payoutTxSignature to submissions
  campaigns.ts          MODIFY — createCampaign accepts pdaAddress (optional), add updateCampaignPda
  submissions.ts        MODIFY — add approveSubmission + rejectSubmission mutations
lib/
  types.ts              MODIFY — add creatorWallet + pdaAddress to Campaign interface
app/
  stage/page.tsx        MODIFY — map creatorWallet + pdaAddress from Convex doc
  stage/[id]/page.tsx   MODIFY — map creatorWallet + pdaAddress from Convex doc
components/
  campaign/
    campaign-form.tsx   MODIFY — 3-step escrow flow on submit
    campaign-detail.tsx MODIFY — submissions list, approve/reject buttons, treasury balance
next.config.ts          MODIFY — add stream + path to webpack fallbacks
```

---

## Task 1: Install npm dependencies

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install Anchor client SDK and SPL token library**

```bash
cd /Users/along/Documents/vello && npm install @coral-xyz/anchor @solana/spl-token
```

Expected: both packages added to `node_modules`, no peer dep errors.

- [ ] **Step 2: Verify installations**

```bash
node -e "require('@coral-xyz/anchor'); require('@solana/spl-token'); console.log('OK')"
```

Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @coral-xyz/anchor and @solana/spl-token"
```

---

## Task 2: Anchor workspace files

**Files:**
- Create: `Anchor.toml`
- Create: `Cargo.toml` (workspace root)
- Create: `programs/vello-escrow/Cargo.toml`
- Create: `programs/vello-escrow/Xargo.toml`

- [ ] **Step 1: Create workspace Cargo.toml**

Create `/Users/along/Documents/vello/Cargo.toml`:

```toml
[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
```

- [ ] **Step 2: Create Anchor.toml**

Create `/Users/along/Documents/vello/Anchor.toml`:

```toml
[features]
resolution = true
skip-lint = false

[programs.devnet]
vello_escrow = "PLACEHOLDER_PROGRAM_ID"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[workspace]
members = ["programs/*"]
```

- [ ] **Step 3: Create programs/vello-escrow directory and Cargo.toml**

```bash
mkdir -p /Users/along/Documents/vello/programs/vello-escrow/src
```

Create `/Users/along/Documents/vello/programs/vello-escrow/Cargo.toml`:

```toml
[package]
name = "vello-escrow"
version = "0.1.0"
description = "Vello Protocol escrow for campaign treasury"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "vello_escrow"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
anchor-spl = { version = "0.30.1", features = ["token", "associated_token"] }
```

- [ ] **Step 4: Create Xargo.toml**

Create `/Users/along/Documents/vello/programs/vello-escrow/Xargo.toml`:

```toml
[target.bpfel-unknown-unknown.dependencies.std]
features = []
```

- [ ] **Step 5: Commit**

```bash
git add Anchor.toml Cargo.toml programs/
git commit -m "feat: add Anchor workspace config for vello-escrow program"
```

---

## Task 3: Write Anchor program

**Files:**
- Create: `programs/vello-escrow/src/lib.rs`

- [ ] **Step 1: Write the program**

Create `/Users/along/Documents/vello/programs/vello-escrow/src/lib.rs`:

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("PLACEHOLDER_PROGRAM_ID");

#[program]
pub mod vello_escrow {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: String,
        budget: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.campaign_escrow;
        escrow.creator = ctx.accounts.creator.key();
        escrow.campaign_id = campaign_id;
        escrow.usdc_mint = ctx.accounts.usdc_mint.key();
        escrow.budget_lamports = budget;
        escrow.approved_count = 0;
        escrow.bump = ctx.bumps.campaign_escrow;

        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_usdc_ata.to_account_info(),
            to: ctx.accounts.escrow_usdc_ata.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            budget,
        )?;

        Ok(())
    }

    pub fn approve_submission(
        ctx: Context<ApproveSubmission>,
        campaign_id: String,
        _influencer_wallet: Pubkey,
    ) -> Result<()> {
        let budget = ctx.accounts.campaign_escrow.budget_lamports;
        let bump = ctx.accounts.campaign_escrow.bump;

        let seeds: &[&[u8]] = &[
            b"campaign",
            campaign_id.as_bytes(),
            &[bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_usdc_ata.to_account_info(),
            to: ctx.accounts.influencer_usdc_ata.to_account_info(),
            authority: ctx.accounts.campaign_escrow.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            budget,
        )?;

        ctx.accounts.campaign_escrow.approved_count += 1;
        Ok(())
    }

    pub fn cancel_campaign(
        ctx: Context<CancelCampaign>,
        campaign_id: String,
    ) -> Result<()> {
        require!(
            ctx.accounts.campaign_escrow.approved_count == 0,
            EscrowError::AlreadyApproved
        );

        let budget = ctx.accounts.campaign_escrow.budget_lamports;
        let bump = ctx.accounts.campaign_escrow.bump;

        let seeds: &[&[u8]] = &[
            b"campaign",
            campaign_id.as_bytes(),
            &[bump],
        ];
        let signer_seeds = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_usdc_ata.to_account_info(),
            to: ctx.accounts.creator_usdc_ata.to_account_info(),
            authority: ctx.accounts.campaign_escrow.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            budget,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(campaign_id: String)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = CampaignEscrow::space(&campaign_id),
        seeds = [b"campaign", campaign_id.as_bytes()],
        bump
    )]
    pub campaign_escrow: Account<'info, CampaignEscrow>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = campaign_escrow,
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
#[instruction(campaign_id: String, influencer_wallet: Pubkey)]
pub struct ApproveSubmission<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"campaign", campaign_id.as_bytes()],
        bump = campaign_escrow.bump,
        has_one = creator @ EscrowError::Unauthorized,
    )]
    pub campaign_escrow: Account<'info, CampaignEscrow>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = campaign_escrow,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = usdc_mint,
        associated_token::authority = influencer_wallet,
    )]
    pub influencer_usdc_ata: Account<'info, TokenAccount>,

    /// CHECK: This is the influencer's wallet pubkey, not required to sign
    pub influencer_wallet: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
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
        seeds = [b"campaign", campaign_id.as_bytes()],
        bump = campaign_escrow.bump,
        has_one = creator @ EscrowError::Unauthorized,
        close = creator,
    )]
    pub campaign_escrow: Account<'info, CampaignEscrow>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = campaign_escrow,
    )]
    pub escrow_usdc_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_usdc_ata: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
pub struct CampaignEscrow {
    pub creator: Pubkey,
    pub campaign_id: String,
    pub usdc_mint: Pubkey,
    pub budget_lamports: u64,
    pub approved_count: u32,
    pub bump: u8,
}

impl CampaignEscrow {
    pub fn space(campaign_id: &str) -> usize {
        8    // discriminator
        + 32 // creator
        + 4 + campaign_id.len() // campaign_id string (4-byte length prefix)
        + 32 // usdc_mint
        + 8  // budget_lamports
        + 4  // approved_count
        + 1  // bump
    }
}

#[error_code]
pub enum EscrowError {
    #[msg("Only the campaign creator can perform this action")]
    Unauthorized,
    #[msg("Cannot cancel: campaign already has approved submissions")]
    AlreadyApproved,
}
```

- [ ] **Step 2: Commit**

```bash
git add programs/vello-escrow/src/lib.rs
git commit -m "feat: write vello-escrow Anchor program with create/approve/cancel instructions"
```

---

## Task 4: Write Anchor integration tests

**Files:**
- Create: `tests/vello-escrow.ts`

- [ ] **Step 1: Install test deps**

```bash
cd /Users/along/Documents/vello && npm install --save-dev mocha ts-mocha @types/mocha chai @types/chai
```

- [ ] **Step 2: Write the test file**

Create `/Users/along/Documents/vello/tests/vello-escrow.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
// VelloEscrow type is generated after `anchor build` — use `any` until then
type VelloEscrow = any;

describe("vello-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.VelloEscrow as Program<VelloEscrow>;

  const campaignId = `test-${Date.now()}`;
  let usdcMint: anchor.web3.PublicKey;
  let creatorUsdcAta: anchor.web3.PublicKey;
  const influencer = anchor.web3.Keypair.generate();

  before(async () => {
    const payer = (provider.wallet as anchor.Wallet).payer;

    usdcMint = await createMint(
      provider.connection,
      payer,
      provider.wallet.publicKey,
      null,
      6 // USDC has 6 decimal places
    );

    creatorUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      usdcMint,
      provider.wallet.publicKey
    );

    // Mint 1000 USDC (1_000_000_000 micro-USDC) to creator
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      creatorUsdcAta,
      provider.wallet.publicKey,
      1_000_000_000
    );
  });

  it("creates a campaign escrow and locks USDC", async () => {
    const budget = new BN(100_000_000); // 100 USDC
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(campaignId)],
      program.programId
    );

    await program.methods
      .createCampaign(campaignId, budget)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        creatorUsdcAta,
        usdcMint,
      })
      .rpc();

    const escrow = await program.account.campaignEscrow.fetch(pda);
    assert.equal(escrow.budgetLamports.toNumber(), 100_000_000, "budget stored");
    assert.equal(escrow.approvedCount, 0, "no approvals yet");
    assert.equal(escrow.creator.toBase58(), provider.wallet.publicKey.toBase58());
  });

  it("approves a submission and transfers USDC to influencer", async () => {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(campaignId)],
      program.programId
    );

    await program.methods
      .approveSubmission(campaignId, influencer.publicKey)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        influencerWallet: influencer.publicKey,
        usdcMint,
      })
      .rpc();

    const escrow = await program.account.campaignEscrow.fetch(pda);
    assert.equal(escrow.approvedCount, 1, "approval count incremented");

    // Influencer ATA should now hold the USDC
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const influencerAta = await getAssociatedTokenAddress(usdcMint, influencer.publicKey);
    const ataInfo = await getAccount(provider.connection, influencerAta);
    assert.equal(Number(ataInfo.amount), 100_000_000, "influencer received 100 USDC");
  });

  it("rejects cancel when submissions already approved", async () => {
    const campaignId2 = `test-cancel-${Date.now()}`;
    const budget = new BN(50_000_000); // 50 USDC
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(campaignId2)],
      program.programId
    );

    await program.methods
      .createCampaign(campaignId2, budget)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        creatorUsdcAta,
        usdcMint,
      })
      .rpc();

    await program.methods
      .approveSubmission(campaignId2, influencer.publicKey)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        influencerWallet: influencer.publicKey,
        usdcMint,
      })
      .rpc();

    try {
      await program.methods
        .cancelCampaign(campaignId2)
        .accounts({
          creator: provider.wallet.publicKey,
          campaignEscrow: pda,
          creatorUsdcAta,
          usdcMint,
        })
        .rpc();
      assert.fail("should have thrown AlreadyApproved");
    } catch (err: any) {
      assert.include(err.message, "AlreadyApproved");
    }
  });

  it("successfully cancels a campaign with no approvals", async () => {
    const campaignId3 = `test-fresh-${Date.now()}`;
    const budget = new BN(25_000_000); // 25 USDC
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), Buffer.from(campaignId3)],
      program.programId
    );
    const payer = (provider.wallet as anchor.Wallet).payer;

    await program.methods
      .createCampaign(campaignId3, budget)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        creatorUsdcAta,
        usdcMint,
      })
      .rpc();

    const balanceBefore = (await getAccount(provider.connection, creatorUsdcAta)).amount;

    await program.methods
      .cancelCampaign(campaignId3)
      .accounts({
        creator: provider.wallet.publicKey,
        campaignEscrow: pda,
        creatorUsdcAta,
        usdcMint,
      })
      .rpc();

    const balanceAfter = (await getAccount(provider.connection, creatorUsdcAta)).amount;
    assert.equal(
      Number(balanceAfter) - Number(balanceBefore),
      25_000_000,
      "creator received refund"
    );
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add tests/vello-escrow.ts package.json package-lock.json
git commit -m "test: add Anchor integration tests for vello-escrow"
```

---

## Task 5: Build, test, and deploy Anchor program

**Files:**
- Modify: `Anchor.toml` — update program ID after deploy
- Modify: `programs/vello-escrow/src/lib.rs` — update `declare_id!`

- [ ] **Step 1: Build the program**

```bash
cd /Users/along/Documents/vello && anchor build
```

Expected: `target/deploy/vello_escrow.so` created, `target/idl/vello_escrow.json` created, `target/types/vello_escrow.ts` created.

- [ ] **Step 2: Get the program keypair address**

```bash
solana-keygen pubkey target/deploy/vello_escrow-keypair.json
```

Expected: prints a base58 pubkey like `7abc...xyz`. Save this — it's your program ID.

- [ ] **Step 3: Update declare_id! in lib.rs**

Replace `PLACEHOLDER_PROGRAM_ID` in `programs/vello-escrow/src/lib.rs` line 6:
```rust
declare_id!("<YOUR_PROGRAM_ID_FROM_STEP_2>");
```

- [ ] **Step 4: Update Anchor.toml**

Replace `PLACEHOLDER_PROGRAM_ID` in `Anchor.toml`:
```toml
[programs.devnet]
vello_escrow = "<YOUR_PROGRAM_ID_FROM_STEP_2>"
```

- [ ] **Step 5: Rebuild with correct ID**

```bash
anchor build
```

- [ ] **Step 6: Run tests (uses local validator)**

```bash
anchor test --skip-deploy
```

Expected: 4 tests pass. If a test fails, fix the program and re-run.

- [ ] **Step 7: Deploy to devnet**

```bash
anchor deploy --provider.cluster devnet
```

Expected: `Program Id: <YOUR_PROGRAM_ID>` printed, deployed successfully.

- [ ] **Step 8: Commit**

```bash
git add Anchor.toml programs/vello-escrow/src/lib.rs
git commit -m "feat: build and deploy vello-escrow to Solana devnet"
```

---

## Task 6: Copy IDL, configure environment, update webpack

**Files:**
- Create: `lib/vello-escrow-idl.json` — copied from `target/idl/vello_escrow.json`
- Modify: `.env.local` — add `NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID`
- Modify: `next.config.ts` — add webpack fallbacks

- [ ] **Step 1: Copy IDL to lib/**

```bash
cp /Users/along/Documents/vello/target/idl/vello_escrow.json /Users/along/Documents/vello/lib/vello-escrow-idl.json
```

- [ ] **Step 2: Add program ID to .env.local**

Append to `/Users/along/Documents/vello/.env.local`:
```
NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID=<YOUR_PROGRAM_ID_FROM_TASK_5>
```

- [ ] **Step 3: Update next.config.ts webpack fallbacks**

Replace the webpack config in `/Users/along/Documents/vello/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

export default nextConfig;
```

- [ ] **Step 4: Verify Next.js still builds**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/vello-escrow-idl.json next.config.ts
git commit -m "feat: add escrow IDL to lib, update webpack fallbacks for Anchor"
```

---

## Task 7: Update Convex schema and mutations

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/campaigns.ts`
- Modify: `convex/submissions.ts`

- [ ] **Step 1: Update convex/schema.ts**

Replace the full file `/Users/along/Documents/vello/convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  influencers: defineTable({
    mintAddress: v.string(),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    niche: v.string(),
    language: v.string(),
    isHalal: v.boolean(),
    archetype: v.string(),
    description: v.string(),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
    tvl: v.number(),
    monthlyEarnings: v.number(),
    sharePrice: v.number(),
    totalShares: v.number(),
    availableShares: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_creator", ["creatorWallet"]),

  campaigns: defineTable({
    creatorWallet: v.string(),
    brandName: v.string(),
    brandLogoUrl: v.string(),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    isHalalOnly: v.boolean(),
    status: v.string(),
    submissionsCount: v.number(),
    deadline: v.string(),
    pdaAddress: v.optional(v.string()),
  })
    .index("by_creator", ["creatorWallet"])
    .index("by_status", ["status"]),

  submissions: defineTable({
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    status: v.string(),
    payoutTxSignature: v.optional(v.string()),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_submitter", ["submitterWallet"]),
});
```

- [ ] **Step 2: Update convex/campaigns.ts**

Replace `/Users/along/Documents/vello/convex/campaigns.ts`:

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("campaigns").order("desc").collect();
  },
});

export const getById = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const listByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
  },
});

export const create = mutation({
  args: {
    creatorWallet: v.string(),
    brandName: v.string(),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    isHalalOnly: v.boolean(),
    deadline: v.string(),
    pdaAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const brandLogoUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(args.brandName)}&backgroundColor=1a1a2e`;
    return await ctx.db.insert("campaigns", {
      ...args,
      brandLogoUrl,
      status: "open",
      submissionsCount: 0,
    });
  },
});

export const updateCampaignPda = mutation({
  args: {
    id: v.id("campaigns"),
    pdaAddress: v.string(),
  },
  handler: async (ctx, { id, pdaAddress }) => {
    await ctx.db.patch(id, { pdaAddress });
  },
});

export const incrementSubmissions = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    await ctx.db.patch(id, {
      submissionsCount: campaign.submissionsCount + 1,
    });
  },
});
```

- [ ] **Step 3: Update convex/submissions.ts**

Replace `/Users/along/Documents/vello/convex/submissions.ts`:

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const listByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

export const submit = mutation({
  args: {
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("influencerMint"), args.influencerMint))
      .first();
    if (existing) throw new Error("Already submitted to this campaign");

    const id = await ctx.db.insert("submissions", {
      ...args,
      status: "pending",
    });

    await ctx.runMutation(api.campaigns.incrementSubmissions, {
      id: args.campaignId,
    });

    return id;
  },
});

export const approveSubmission = mutation({
  args: {
    submissionId: v.id("submissions"),
    payoutTxSignature: v.string(),
  },
  handler: async (ctx, { submissionId, payoutTxSignature }) => {
    await ctx.db.patch(submissionId, {
      status: "approved",
      payoutTxSignature,
    });
  },
});

export const rejectSubmission = mutation({
  args: {
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, { submissionId }) => {
    await ctx.db.patch(submissionId, { status: "rejected" });
  },
});
```

- [ ] **Step 4: Verify Convex regenerates types**

```bash
cd /Users/along/Documents/vello && npx convex dev --once 2>&1 | tail -5
```

Expected: no schema errors, types regenerated.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/campaigns.ts convex/submissions.ts
git commit -m "feat: add pdaAddress to campaigns schema, add approveSubmission + rejectSubmission mutations"
```

---

## Task 8: Write lib/escrow.ts

**Files:**
- Create: `lib/escrow.ts`

- [ ] **Step 1: Write the file**

Create `/Users/along/Documents/vello/lib/escrow.ts`:

```typescript
import { AnchorProvider, Program, BN, web3 } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { PublicKey, Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import IDL from "./vello-escrow-idl.json";

const DEVNET_RPC = process.env.NEXT_PUBLIC_HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

export const DEVNET_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

function getProgramId(): PublicKey {
  const id = process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID;
  if (!id) throw new Error("NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID not set");
  return new PublicKey(id);
}

export function buildEscrowProgram(wallet: WalletContextState) {
  const connection = new web3.Connection(DEVNET_RPC, "confirmed");
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  return new Program(IDL as any, provider);
}

export function getCampaignPda(campaignId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), Buffer.from(campaignId)],
    getProgramId()
  );
}

export async function createCampaignTx(
  program: Program<any>,
  campaignId: string,
  budgetUsdc: number
): Promise<{ txSignature: string; pdaAddress: string }> {
  const wallet = program.provider.publicKey!;
  const budget = new BN(Math.floor(budgetUsdc * 1_000_000));
  const [pdaPubkey] = getCampaignPda(campaignId);
  const creatorUsdcAta = await getAssociatedTokenAddress(DEVNET_USDC_MINT, wallet);

  const txSignature = await program.methods
    .createCampaign(campaignId, budget)
    .accounts({
      creator: wallet,
      campaignEscrow: pdaPubkey,
      creatorUsdcAta,
      usdcMint: DEVNET_USDC_MINT,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature, pdaAddress: pdaPubkey.toBase58() };
}

export async function approveSubmissionTx(
  program: Program<any>,
  campaignId: string,
  influencerWalletAddress: string
): Promise<{ txSignature: string }> {
  const wallet = program.provider.publicKey!;
  const [pdaPubkey] = getCampaignPda(campaignId);
  const influencerWallet = new PublicKey(influencerWalletAddress);

  const txSignature = await program.methods
    .approveSubmission(campaignId, influencerWallet)
    .accounts({
      creator: wallet,
      campaignEscrow: pdaPubkey,
      influencerWallet,
      usdcMint: DEVNET_USDC_MINT,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

export async function cancelCampaignTx(
  program: Program<any>,
  campaignId: string
): Promise<{ txSignature: string }> {
  const wallet = program.provider.publicKey!;
  const [pdaPubkey] = getCampaignPda(campaignId);
  const creatorUsdcAta = await getAssociatedTokenAddress(DEVNET_USDC_MINT, wallet);

  const txSignature = await program.methods
    .cancelCampaign(campaignId)
    .accounts({
      creator: wallet,
      campaignEscrow: pdaPubkey,
      creatorUsdcAta,
      usdcMint: DEVNET_USDC_MINT,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

export async function getEscrowBalance(
  connection: Connection,
  pdaAddress: string
): Promise<number> {
  const pdaPubkey = new PublicKey(pdaAddress);
  const escrowAta = await getAssociatedTokenAddress(
    DEVNET_USDC_MINT,
    pdaPubkey,
    true // allowOwnerOffCurve — PDAs are off-curve by definition
  );

  try {
    const balance = await connection.getTokenAccountBalance(escrowAta);
    return parseFloat(balance.value.uiAmountString ?? "0");
  } catch {
    return 0;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors on `lib/escrow.ts`. If you get "cannot find module './vello-escrow-idl.json'" add `"resolveJsonModule": true` to `tsconfig.json` compilerOptions.

- [ ] **Step 3: Commit**

```bash
git add lib/escrow.ts
git commit -m "feat: add lib/escrow.ts with Anchor SDK helpers for escrow program"
```

---

## Task 9: Update lib/types.ts and stage page mappings

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/stage/page.tsx`
- Modify: `app/stage/[id]/page.tsx`

- [ ] **Step 1: Add creatorWallet and pdaAddress to Campaign interface in lib/types.ts**

In `/Users/along/Documents/vello/lib/types.ts`, replace the `Campaign` interface:

```typescript
export interface Campaign {
  id: string;
  brandName: string;
  brandLogoUrl: string;
  title: string;
  brief: string;
  budget: number;
  ratePerThousandViews: number;
  targetNiche: Niche[];
  targetLanguage: Language[];
  isHalalOnly: boolean;
  status: "open" | "in_progress" | "completed" | "cancelled";
  submissionsCount: number;
  deadline: string;
  createdAt: string;
  creatorWallet: string;
  pdaAddress?: string;
}
```

- [ ] **Step 2: Update campaign mapping in app/stage/page.tsx**

In `/Users/along/Documents/vello/app/stage/page.tsx`, replace the `.map((doc) => ({` block:

```typescript
  const campaigns: Campaign[] = (rawCampaigns ?? []).map((doc) => ({
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    isHalalOnly: doc.isHalalOnly,
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
    creatorWallet: doc.creatorWallet,
    pdaAddress: doc.pdaAddress,
  }));
```

- [ ] **Step 3: Update campaign mapping in app/stage/[id]/page.tsx**

In `/Users/along/Documents/vello/app/stage/[id]/page.tsx`, replace the `const campaign: Campaign = {` block:

```typescript
  const campaign: Campaign = {
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    isHalalOnly: doc.isHalalOnly,
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
    creatorWallet: doc.creatorWallet,
    pdaAddress: doc.pdaAddress,
  };
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts app/stage/page.tsx app/stage/\[id\]/page.tsx
git commit -m "feat: add creatorWallet + pdaAddress to Campaign type and stage page mappings"
```

---

## Task 10: Update campaign-form.tsx with escrow flow

**Files:**
- Modify: `components/campaign/campaign-form.tsx`

- [ ] **Step 1: Replace components/campaign/campaign-form.tsx**

Replace the full file `/Users/along/Documents/vello/components/campaign/campaign-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buildEscrowProgram, createCampaignTx } from "@/lib/escrow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Wallet, Shield } from "lucide-react";

const campaignSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  brandName: z.string().min(2, "Brand name required"),
  brief: z.string().min(50, "Brief must be at least 50 characters"),
  budget: z.coerce.number().min(1, "Minimum budget is 1 USDC"),
  ratePerThousandViews: z.coerce
    .number()
    .min(0.5, "Minimum rate is $0.50 per 1K views"),
  isHalalOnly: z.boolean().default(false),
  deadline: z.string().min(1, "Deadline required"),
  targetNiche: z.string().min(1, "Select a niche"),
  targetLanguage: z.string().min(1, "Select a language"),
});

type CampaignFormInput = z.input<typeof campaignSchema>;
type CampaignFormValues = z.output<typeof campaignSchema>;

type Step = "idle" | "creating-convex" | "signing-escrow" | "finalizing" | "done";

function stepLabel(step: Step): string {
  switch (step) {
    case "creating-convex": return "Creating campaign...";
    case "signing-escrow": return "Approve USDC transfer in wallet...";
    case "finalizing": return "Locking treasury...";
    default: return "Post Campaign";
  }
}

export function CampaignForm() {
  const router = useRouter();
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  const { setVisible } = useWalletModal();
  const createCampaign = useMutation(api.campaigns.create);
  const updateCampaignPda = useMutation(api.campaigns.updateCampaignPda);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CampaignFormInput, unknown, CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      title: "",
      brandName: "",
      brief: "",
      budget: 100,
      ratePerThousandViews: 3,
      isHalalOnly: false,
      deadline: "",
      targetNiche: "lifestyle",
      targetLanguage: "en",
    },
  });

  const budgetValue = watch("budget");

  if (!connected || !publicKey) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          Connect your wallet to post a campaign.
        </p>
        <Button onClick={() => setVisible(true)} className="gap-2">
          <Wallet className="size-4" />
          Connect Wallet
        </Button>
      </div>
    );
  }

  async function onSubmit(values: CampaignFormValues) {
    if (!publicKey) return;
    setStep("creating-convex");
    setError(null);

    let convexId: string | null = null;

    try {
      // Step 1: Create campaign in Convex (no PDA yet) — get Convex _id
      convexId = await createCampaign({
        creatorWallet: publicKey.toBase58(),
        brandName: values.brandName,
        title: values.title,
        brief: values.brief,
        budget: values.budget,
        ratePerThousandViews: values.ratePerThousandViews,
        targetNiche: [values.targetNiche],
        targetLanguage: [values.targetLanguage],
        isHalalOnly: values.isHalalOnly,
        deadline: new Date(values.deadline).toISOString(),
      });

      // Step 2: Sign create_campaign tx on-chain using convexId as seed
      setStep("signing-escrow");
      const program = buildEscrowProgram(wallet);
      const { pdaAddress } = await createCampaignTx(
        program,
        convexId,
        values.budget
      );

      // Step 3: Update Convex record with PDA address
      setStep("finalizing");
      await updateCampaignPda({ id: convexId as any, pdaAddress });

      setStep("done");
      router.push("/stage");
    } catch (err) {
      // If escrow tx fails, campaign exists in Convex without PDA — acceptable for devnet
      setError(
        err instanceof Error ? err.message : "Failed to post campaign"
      );
      setStep("idle");
    }
  }

  const submitting = step !== "idle" && step !== "done";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="brandName">
              Brand name
            </label>
            <Input
              id="brandName"
              placeholder="Zalora, Notion, Wise..."
              {...register("brandName")}
            />
            {errors.brandName && (
              <p className="text-xs text-destructive">{errors.brandName.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="title">
              Campaign title
            </label>
            <Input
              id="title"
              placeholder="Raya Collection 2026 Launch..."
              {...register("title")}
            />
            {errors.title && (
              <p className="text-xs text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="brief">
              Campaign brief
            </label>
            <textarea
              id="brief"
              className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              placeholder="Describe what the content should cover, style, key messages, restrictions..."
              {...register("brief")}
            />
            <p className="text-xs text-muted-foreground">
              Be specific — AI Influencers follow this brief when generating content.
            </p>
            {errors.brief && (
              <p className="text-xs text-destructive">{errors.brief.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Targeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="targetNiche">Niche</label>
              <select
                id="targetNiche"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register("targetNiche")}
              >
                <option value="lifestyle">Lifestyle</option>
                <option value="tech">Tech</option>
                <option value="fashion">Fashion</option>
                <option value="fitness">Fitness</option>
                <option value="food">Food</option>
                <option value="travel">Travel</option>
                <option value="finance">Finance</option>
                <option value="gaming">Gaming</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="targetLanguage">Language</label>
              <select
                id="targetLanguage"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                {...register("targetLanguage")}
              >
                <option value="en">English</option>
                <option value="ms">Malay</option>
                <option value="id">Indonesian</option>
                <option value="ar">Arabic</option>
                <option value="zh">Chinese</option>
                <option value="hi">Hindi</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              {...register("isHalalOnly")}
            />
            <span className="text-sm font-medium">
              Halal-only campaign (filters to halal-certified AI Influencers)
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Treasury / Budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="budget">
                Total budget (USDC)
              </label>
              <Input
                id="budget"
                type="number"
                min={1}
                {...register("budget")}
              />
              {errors.budget && (
                <p className="text-xs text-destructive">{errors.budget.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="rate">
                Rate per 1K views (USDC)
              </label>
              <Input
                id="rate"
                type="number"
                min={0.5}
                step={0.5}
                {...register("ratePerThousandViews")}
              />
              {errors.ratePerThousandViews && (
                <p className="text-xs text-destructive">
                  {errors.ratePerThousandViews.message}
                </p>
              )}
            </div>
          </div>

          {/* Escrow notice */}
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm">
            <Shield className="size-4 text-amber-400 mt-0.5 shrink-0" />
            <span className="text-amber-200">
              <strong>{budgetValue || 0} USDC</strong> will be locked in an on-chain escrow when you post this campaign. Your wallet will prompt for approval.
            </span>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="deadline">
              Campaign deadline
            </label>
            <Input id="deadline" type="date" {...register("deadline")} />
            {errors.deadline && (
              <p className="text-xs text-destructive">{errors.deadline.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto"
        disabled={submitting}
      >
        {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
        {stepLabel(step)}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "campaign-form" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/campaign/campaign-form.tsx
git commit -m "feat: campaign form locks USDC in Anchor escrow on submit"
```

---

## Task 11: Update campaign-detail.tsx with approve/reject flow

**Files:**
- Modify: `components/campaign/campaign-detail.tsx`

- [ ] **Step 1: Replace components/campaign/campaign-detail.tsx**

Replace the full file `/Users/along/Documents/vello/components/campaign/campaign-detail.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  DollarSign,
  Eye,
  Globe,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  Wallet,
  Shield,
} from "lucide-react";
import {
  buildEscrowProgram,
  approveSubmissionTx,
  getEscrowBalance,
} from "@/lib/escrow";
import type { Campaign } from "@/lib/types";

const NOW = Date.now();

interface CampaignDetailProps {
  campaign: Campaign;
  campaignDocId: Id<"campaigns">;
}

export function CampaignDetail({ campaign, campaignDocId }: CampaignDetailProps) {
  const daysLeft = Math.ceil(
    (new Date(campaign.deadline).getTime() - NOW) / 86400000
  );

  const { connection } = useConnection();
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  const { setVisible } = useWalletModal();

  const submit = useMutation(api.submissions.submit);
  const approveSub = useMutation(api.submissions.approveSubmission);
  const rejectSub = useMutation(api.submissions.rejectSubmission);

  const myInfluencers = useQuery(
    api.influencers.listByCreator,
    connected && publicKey ? { creatorWallet: publicKey.toBase58() } : "skip"
  );

  const allSubmissions = useQuery(api.submissions.listByCampaign, {
    campaignId: campaignDocId,
  });

  const [selectedMint, setSelectedMint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState<number | null>(null);

  const isBrand =
    connected && publicKey?.toBase58() === campaign.creatorWallet;

  useEffect(() => {
    if (!campaign.pdaAddress) return;
    getEscrowBalance(connection, campaign.pdaAddress).then(setTreasuryBalance);
  }, [connection, campaign.pdaAddress]);

  async function handleSubmit() {
    if (!connected || !publicKey) { setVisible(true); return; }
    if (!selectedMint) return;
    const inf = myInfluencers?.find((i) => i.mintAddress === selectedMint);
    if (!inf) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await submit({
        campaignId: campaignDocId,
        influencerMint: selectedMint,
        influencerName: inf.name,
        submitterWallet: publicKey.toBase58(),
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(
    subId: Id<"submissions">,
    submitterWallet: string
  ) {
    if (!campaign.pdaAddress) {
      setActionError("This campaign has no on-chain escrow.");
      return;
    }
    setApprovingId(subId);
    setActionError(null);
    try {
      const program = buildEscrowProgram(wallet);
      const { txSignature } = await approveSubmissionTx(
        program,
        campaignDocId,
        submitterWallet
      );
      await approveSub({ submissionId: subId, payoutTxSignature: txSignature });
      // Refresh treasury balance
      const balance = await getEscrowBalance(connection, campaign.pdaAddress);
      setTreasuryBalance(balance);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Approval failed"
      );
    } finally {
      setApprovingId(null);
    }
  }

  async function handleReject(subId: Id<"submissions">) {
    setRejectingId(subId);
    setActionError(null);
    try {
      await rejectSub({ submissionId: subId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setRejectingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Details */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <img
                src={campaign.brandLogoUrl}
                alt={campaign.brandName}
                className="size-16 rounded-xl object-cover"
              />
              <div>
                <h2 className="text-xl font-bold">{campaign.title}</h2>
                <p className="text-muted-foreground">{campaign.brandName}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-1.5">Campaign Brief</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {campaign.brief}
              </p>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-2">Target Audience</h3>
              <div className="flex flex-wrap gap-2">
                {campaign.targetNiche.map((n) => (
                  <Badge key={n} variant="secondary" className="capitalize">{n}</Badge>
                ))}
                {campaign.targetLanguage.map((l) => (
                  <Badge key={l} variant="outline" className="uppercase">{l}</Badge>
                ))}
                {campaign.isHalalOnly && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">Halal only</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submissions list — visible to brand only */}
        {isBrand && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submissions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {allSubmissions === undefined && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="size-3.5 animate-spin" /> Loading...
                </div>
              )}
              {allSubmissions?.length === 0 && (
                <p className="text-sm text-muted-foreground">No submissions yet.</p>
              )}
              {allSubmissions?.map((sub) => (
                <div
                  key={sub._id}
                  className="flex items-center justify-between p-3 rounded-md border border-border"
                >
                  <div>
                    <p className="text-sm font-medium">{sub.influencerName}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                      {sub.submitterWallet}
                    </p>
                    {sub.payoutTxSignature && (
                      <p className="text-xs text-emerald-400 mt-0.5">
                        Paid ·{" "}
                        <a
                          href={`https://explorer.solana.com/tx/${sub.payoutTxSignature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          view tx
                        </a>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {sub.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            handleApprove(
                              sub._id as Id<"submissions">,
                              sub.submitterWallet
                            )
                          }
                          disabled={approvingId === sub._id || !!rejectingId}
                        >
                          {approvingId === sub._id ? (
                            <Loader2 className="size-3.5 animate-spin mr-1" />
                          ) : (
                            <CheckCircle2 className="size-3.5 mr-1" />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(sub._id as Id<"submissions">)}
                          disabled={rejectingId === sub._id || !!approvingId}
                        >
                          {rejectingId === sub._id ? (
                            <Loader2 className="size-3.5 animate-spin mr-1" />
                          ) : (
                            <XCircle className="size-3.5 mr-1" />
                          )}
                          Reject
                        </Button>
                      </>
                    )}
                    {sub.status === "approved" && (
                      <Badge className="bg-emerald-600">Approved</Badge>
                    )}
                    {sub.status === "rejected" && (
                      <Badge variant="destructive">Rejected</Badge>
                    )}
                  </div>
                </div>
              ))}
              {actionError && (
                <p className="text-xs text-destructive">{actionError}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Economics + Action */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign Economics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                icon: DollarSign,
                label: "Budget",
                value: `$${campaign.budget.toLocaleString()} USDC`,
              },
              {
                icon: Shield,
                label: "Treasury (on-chain)",
                value:
                  treasuryBalance !== null
                    ? `$${treasuryBalance.toFixed(2)} USDC`
                    : campaign.pdaAddress
                    ? "Loading..."
                    : "No escrow",
              },
              {
                icon: Eye,
                label: "Rate per 1K views",
                value: `$${campaign.ratePerThousandViews} USDC`,
              },
              {
                icon: Users,
                label: "Submissions",
                value: campaign.submissionsCount.toString(),
              },
              {
                icon: Clock,
                label: "Days remaining",
                value: daysLeft > 0 ? `${daysLeft} days` : "Ended",
              },
              {
                icon: Globe,
                label: "Deadline",
                value: new Date(campaign.deadline).toLocaleDateString(),
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Icon className="size-3.5" />
                  {label}
                </span>
                <span className="text-sm font-mono font-semibold">{value}</span>
              </div>
            ))}
            {campaign.pdaAddress && (
              <p className="text-xs text-muted-foreground font-mono truncate">
                PDA:{" "}
                <a
                  href={`https://explorer.solana.com/address/${campaign.pdaAddress}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {campaign.pdaAddress.slice(0, 8)}…
                </a>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Submit section — influencer view */}
        {!isBrand && (
          <>
            {submitted ? (
              <Card className="border-emerald-600/30 bg-emerald-600/10">
                <CardContent className="p-3 flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="size-4" />
                  Submitted successfully!
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {!connected && (
                  <Button
                    className="w-full gap-2"
                    size="lg"
                    onClick={() => setVisible(true)}
                  >
                    <Wallet className="size-4" />
                    Connect wallet to submit
                  </Button>
                )}

                {connected && myInfluencers && myInfluencers.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    You have no AI Influencers. Create one in Studio first.
                  </p>
                )}

                {connected && myInfluencers && myInfluencers.length > 0 && (
                  <>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={selectedMint}
                      onChange={(e) => setSelectedMint(e.target.value)}
                    >
                      <option value="">Select an AI Influencer...</option>
                      {myInfluencers.map((inf) => (
                        <option key={inf.mintAddress} value={inf.mintAddress}>
                          {inf.name} ({inf.handle})
                        </option>
                      ))}
                    </select>

                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleSubmit}
                      disabled={!selectedMint || submitting}
                    >
                      {submitting && (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      )}
                      Submit for Campaign
                    </Button>
                  </>
                )}

                {submitError && (
                  <p className="text-xs text-destructive text-center">
                    {submitError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "campaign-detail" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/campaign/campaign-detail.tsx
git commit -m "feat: campaign detail shows submissions, approve/reject with on-chain payout"
```

---

## Task 12: Final TypeScript + build verification

**Files:** No changes — verification only.

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output (zero errors). If there are errors, fix them before proceeding.

- [ ] **Step 2: Lint check**

```bash
npm run lint 2>&1 | grep error
```

Expected: no errors printed.

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: all routes compile, no build errors. Routes should include `/stage`, `/stage/[id]`, `/stage/create`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete treasury escrow + payout integration — Anchor PDA escrow, USDC locking, approve/reject flows"
```
