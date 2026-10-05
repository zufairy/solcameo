/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * full-loop.ts — cross-program integration test proving the agent-economy keystone:
 *
 *   reward-in  (escrow claim_payout  → vault ATA)
 *   compute-out (vault  debit_fee    → treasury ATA)
 *
 * ...both hit the SAME vault ATA, and the SAME treasury ATA earns BOTH fees.
 *
 * RUN STANDALONE. This suite inits the singleton PlatformConfig, so it collides with
 * tests/vello-escrow.ts (which also inits it) on a shared validator. It is deliberately
 * NOT in the default `anchor test` script. To run it: point Anchor.toml [scripts] test at
 * ONLY tests/full-loop.ts, then `anchor test --skip-build --provider.cluster localnet`.
 * Verified 8/8 green on localnet 2026-07-01.
 *
 * Math (all µUSDC, 6 dp):
 *   deposit      =  5_000_000   (5 USDC seeded into vault)
 *   compute_fee  =    750_000   (0.75 USDC, debit_fee)
 *   gross reward =  5_000_000   (500 views × 10 USDC/1k)
 *   protocol_fee =    500_000   (10% of gross, via escrow claim_payout)
 *   net_reward   =  4_500_000   (gross − protocol_fee)
 *
 *   FINAL vault ATA    = deposit − compute_fee + net_reward  = 8_750_000 (8.75 USDC)
 *   FINAL treasury ATA = compute_fee + protocol_fee          = 1_250_000 (1.25 USDC)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor"; // Program used for IDL constructor call
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const escrowIdl = require("../target/idl/vello_escrow.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vaultIdl = require("../target/idl/agent_vault.json");

// ── helpers ──────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const usdc = (n: number) => new BN(Math.round(n * 10 ** USDC_DECIMALS));

// Pre-computed expected final values (µUSDC)
const DEPOSIT_MICRO          = 5_000_000;
const COMPUTE_MICRO          = 750_000;
const GROSS_MICRO            = 5_000_000;   // floor(500 × 10_000_000 / 1000)
const PROTOCOL_MICRO         = 500_000;     // 10% of gross
const NET_MICRO              = 4_500_000;   // gross − protocol_fee
const EXPECTED_VAULT_MICRO   = DEPOSIT_MICRO - COMPUTE_MICRO + NET_MICRO;   // 8_750_000
const EXPECTED_TREASURY_MICRO = COMPUTE_MICRO + PROTOCOL_MICRO;              // 1_250_000

// PDA seeds — must match program declare_id seeds exactly
const PLATFORM_CONF_SEED = Buffer.from("vello:config");
const CAMPAIGN_SEED      = Buffer.from("campaign");
const CLAIM_SEED         = Buffer.from("claim");
const VAULT_SEED         = Buffer.from("vault");
const FEE_SEED           = Buffer.from("fee");

// ── suite ────────────────────────────────────────────────────────────────────

describe("full-loop: reward-in + compute-out → same vault ATA, treasury earns both fees", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load both programs via IDL (mirrors agent-vault.ts pattern).
  // Typed as `any` so that `.account.vault`, `.account.campaign`, etc. are
  // accessible without TS complaining about AccountNamespace<any> index access
  // (the same issue exists in the template agent-vault.ts and is pre-existing).

  const escrowProgram: any = new Program(escrowIdl as anchor.Idl, provider);

  const vaultProgram: any  = new Program(vaultIdl  as anchor.Idl, provider);

  const conn  = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const owner = provider.wallet.publicKey; // vault owner + campaign creator = platform wallet

  // Side keypairs
  const oracle    = anchor.web3.Keypair.generate(); // escrow oracle signer
  const treasury  = anchor.web3.Keypair.generate(); // shared treasury owner (both programs)
  const debitAuth = anchor.web3.Keypair.generate(); // vault fee-debit authority

  // Token accounts
  let usdcMint:        anchor.web3.PublicKey;
  let creatorUsdcAta:  anchor.web3.PublicKey;
  let treasuryUsdcAta: anchor.web3.PublicKey;

  // Agent-vault program PDAs
  let vaultPda:     anchor.web3.PublicKey;
  let vaultUsdcAta: anchor.web3.PublicKey; // THE shared account

  // ProgramData account for the init front-run gate (#1): PDA of the escrow program
  // id under the BPF upgradeable loader. init_platform_config requires the signer to
  // be the program's upgrade authority (on localnet = the provider wallet, via the
  // upgradeable [[test.genesis]] entry in Anchor.toml). Same pattern as vello-escrow.ts.
  const BPF_LOADER_UPGRADEABLE = new anchor.web3.PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111"
  );
  const escrowProgramDataPda = anchor.web3.PublicKey.findProgramAddressSync(
    [escrowProgram.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  )[0];

  // Escrow program PDAs
  let platformConfigPda: anchor.web3.PublicKey;
  let campaignPda:       anchor.web3.PublicKey;
  let claimPda:          anchor.web3.PublicKey;
  let escrowUsdcAta:     anchor.web3.PublicKey;

  // Stable test IDs — timestamp suffix prevents collision between runs
  const campaignId   = `full-loop-${Date.now()}`;
  const submissionId = `sub-${Date.now()}`;
  const agentId      = createHash("sha256").update("full-loop-agent").digest();
  const batchRunId   = createHash("sha256").update("batch-run-1").digest();

  const bal = async (ata: anchor.web3.PublicKey) =>
    Number((await getAccount(conn, ata)).amount);

  // ── setup ──────────────────────────────────────────────────────────────────
  before(async () => {
    // Fund oracle + debitAuth with SOL for rent + gas
    for (const kp of [oracle, debitAuth]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }

    // Single fake USDC mint for the entire suite (no devnet/real USDC needed)
    usdcMint = await createMint(conn, payer, owner, null, USDC_DECIMALS);

    creatorUsdcAta  = await createAssociatedTokenAccount(conn, payer, usdcMint, owner);
    treasuryUsdcAta = await createAssociatedTokenAccount(conn, payer, usdcMint, treasury.publicKey);

    // Mint 1000 USDC to creator (100 for campaign + 5 for vault deposit = 105 needed)
    await mintTo(conn, payer, usdcMint, creatorUsdcAta, owner, 1000 * 10 ** USDC_DECIMALS);

    // ── escrow PDAs ─────────────────────────────────────────────────────────
    [platformConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [PLATFORM_CONF_SEED],
      escrowProgram.programId
    );

    // campaign seed: ["campaign", creator, campaign_id]
    [campaignPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, owner.toBuffer(), Buffer.from(campaignId)],
      escrowProgram.programId
    );

    // claim seed: ["claim", campaign, submission_id]
    [claimPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [CLAIM_SEED, campaignPda.toBuffer(), Buffer.from(submissionId)],
      escrowProgram.programId
    );

    // standard ATA owned by the campaign PDA
    escrowUsdcAta = await getAssociatedTokenAddress(usdcMint, campaignPda, true);

    // ── agent-vault PDAs ────────────────────────────────────────────────────
    // vault seed: ["vault", owner, agent_id]
    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [VAULT_SEED, owner.toBuffer(), agentId],
      vaultProgram.programId
    );

    // THE shared ATA: owned by vaultPda; receives reward-in and loses compute-out
    vaultUsdcAta = await getAssociatedTokenAddress(usdcMint, vaultPda, true);
  });

  // ── 1. init_platform_config ──────────────────────────────────────────────
  it("1. init_platform_config (escrow): oracle + shared treasury + feeBps=1000 (10%)", async () => {
    await escrowProgram.methods
      .initPlatformConfig(
        treasury.publicKey, // treasury — must match vault's treasury for the keystone
        oracle.publicKey,   // oracle (only key allowed to call record_performance)
        1000,               // protocol_fee_bps = 1000 = 10%
        new BN(0),          // dispute_window_slots = 0 → claimable immediately (0 < max_staleness)
        new BN(1_000_000)   // max_staleness_slots
      )
      .accounts({
        platformConfig: platformConfigPda,
        authority: owner,
        program: escrowProgram.programId,
        programData: escrowProgramDataPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfg = await escrowProgram.account.platformConfig.fetch(platformConfigPda);
    assert.equal(cfg.treasury.toBase58(), treasury.publicKey.toBase58(), "escrow treasury set");
    assert.equal(cfg.oracle.toBase58(), oracle.publicKey.toBase58(), "oracle set");
    assert.equal(cfg.protocolFeeBps, 1000, "fee bps = 1000 (10%)");
    assert.equal(cfg.disputeWindowSlots.toNumber(), 0, "dispute window = 0 slots");
  });

  // ── 2. init_vault ────────────────────────────────────────────────────────
  it("2. init_vault (agent-vault): vault PDA + ATA; treasury = SAME as escrow treasury", async () => {
    await vaultProgram.methods
      .initVault(
        [...agentId],          // agent_id: [u8; 32]
        debitAuth.publicKey,   // authority: allowed to call debit_fee
        treasury.publicKey,    // treasury: SAME keypair as escrow PlatformConfig.treasury
        usdc(5)                // max_fee_per_run: 5 USDC cap
      )
      .accounts({
        owner,
        vault: vaultPda,
        vaultUsdcAta,
        usdcMint,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const v = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(v.owner.toBase58(), owner.toBase58(), "vault.owner");
    assert.equal(v.authority.toBase58(), debitAuth.publicKey.toBase58(), "vault.authority");
    assert.equal(v.treasury.toBase58(), treasury.publicKey.toBase58(),
      "KEYSTONE SETUP: vault.treasury == escrow PlatformConfig.treasury — one sink for both fees");
    assert.equal(v.usdcMint.toBase58(), usdcMint.toBase58(), "vault.usdc_mint");
    assert.deepEqual([...v.agentId], [...agentId], "vault.agent_id");
    assert.equal(await bal(vaultUsdcAta), 0, "vault ATA starts empty");
  });

  // ── 3. create_campaign ───────────────────────────────────────────────────
  it("3. create_campaign (escrow): 100 USDC budget, 10 USDC / 1000 views, 30-day deadline", async () => {
    const deadlineUnix = new BN(Math.floor(Date.now() / 1000) + 86400 * 30);

    await escrowProgram.methods
      .createCampaign(
        campaignId,    // campaign_id
        usdc(10),      // rate_per_1k = 10 USDC per 1000 views
        usdc(100),     // initial_budget = 100 USDC
        deadlineUnix   // deadline_unix (i64)
      )
      .accounts({
        creator: owner,
        campaign: campaignPda,
        escrowUsdcAta,
        creatorUsdcAta,
        usdcMint,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const campaign = await escrowProgram.account.campaign.fetch(campaignPda);
    assert.equal(campaign.budget.toNumber(), usdc(100).toNumber(), "campaign.budget = 100 USDC");
    assert.equal(campaign.creator.toBase58(), owner.toBase58(), "campaign.creator");
    assert.equal(await bal(escrowUsdcAta), usdc(100).toNumber(), "escrow ATA holds 100 USDC");
  });

  // ── 4. deposit ──────────────────────────────────────────────────────────
  it("4. deposit (agent-vault): seed vault ATA with 5 USDC", async () => {
    await vaultProgram.methods
      .deposit(usdc(5))
      .accounts({
        funder: owner,
        vault: vaultPda,
        vaultUsdcAta,
        funderUsdcAta: creatorUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.equal(await bal(vaultUsdcAta), DEPOSIT_MICRO, "vault ATA holds 5 USDC after deposit");
  });

  // ── 5. debit_fee ─────────────────────────────────────────────────────────
  it("5. debit_fee (agent-vault): 0.75 USDC compute — vault −0.75, treasury +0.75", async () => {
    const [feeRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [FEE_SEED, vaultPda.toBuffer(), Buffer.from(batchRunId)],
      vaultProgram.programId
    );

    const vaultBefore = await bal(vaultUsdcAta);
    const treasBefore = await bal(treasuryUsdcAta);

    await vaultProgram.methods
      .debitFee(
        usdc(0.75),      // amount = 0.75 USDC (within 5 USDC cap)
        [...batchRunId]  // run_id: [u8; 32]
      )
      .accounts({
        authority: debitAuth.publicKey,
        vault: vaultPda,
        feeRecord: feeRecordPda,
        vaultUsdcAta,
        treasuryUsdcAta,
        payer: debitAuth.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([debitAuth])
      .rpc();

    assert.equal(
      await bal(vaultUsdcAta) - vaultBefore,
      -COMPUTE_MICRO,
      "vault ATA −0.75 USDC (compute fee debited)"
    );
    assert.equal(
      await bal(treasuryUsdcAta) - treasBefore,
      COMPUTE_MICRO,
      "treasury ATA +0.75 USDC (compute fee received)"
    );

    const v = await vaultProgram.account.vault.fetch(vaultPda);
    assert.equal(v.totalDebited.toNumber(), COMPUTE_MICRO, "vault.total_debited tracks 0.75 USDC");
  });

  // ── 6. record_performance ────────────────────────────────────────────────
  it("6. record_performance (escrow): 500 views, beneficiary = vaultPda (THE keystone)", async () => {
    // Dummy score hash and attestation tx (stored for audit, not validated on-chain)
    const scoreHash: number[] = Array(32).fill(0);
    const attestTx:  number[] = Array(64).fill(0);

    await escrowProgram.methods
      .recordPerformance(
        campaignId,    // _campaign_id (positional arg 0)
        submissionId,  // submission_id (positional arg 1)
        vaultPda,      // beneficiary = THE AGENT VAULT PDA (keystone: reward lands in vault ATA)
        new BN(500),   // verified_views (500 views → 5 USDC gross at 10/1k rate)
        scoreHash,     // score_hash: [u8; 32]
        attestTx       // attest_tx:  [u8; 64]
      )
      .accounts({
        // Pass all PDAs explicitly — campaign seed uses "campaign.creator" path which
        // requires the account to be fetched; claim seed arg is "submission_id" not
        // "_campaign_id", so auto-resolution of campaign can't work from the leading-
        // underscore arg. Safe to be explicit throughout.
        platformConfig: platformConfigPda,
        oracle: oracle.publicKey,
        campaign: campaignPda,
        claim: claimPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const claim = await escrowProgram.account.claimRecord.fetch(claimPda);
    assert.equal(claim.verifiedViews.toNumber(), 500, "500 views attested");
    assert.equal(
      claim.beneficiary.toBase58(),
      vaultPda.toBase58(),
      "KEYSTONE: claim.beneficiary == vaultPda (reward-in will hit vault ATA)"
    );
    // gross = floor(500 × 10_000_000 / 1000) = 5_000_000 µUSDC = 5 USDC
    assert.equal(claim.accrued.toNumber(), GROSS_MICRO, "claim.accrued = 5 USDC gross");
    assert.equal(claim.paid.toNumber(), 0, "nothing paid yet (claim_payout not called)");
  });

  // ── 7. claim_payout ──────────────────────────────────────────────────────
  it("7. claim_payout (escrow): net reward → vault ATA; 10% fee → treasury ATA", async () => {
    const vaultBefore = await bal(vaultUsdcAta);
    const treasBefore = await bal(treasuryUsdcAta);

    await escrowProgram.methods
      .claimPayout(
        campaignId,    // campaign_id
        submissionId   // _submission_id (positional arg 1)
      )
      .accounts({
        platformConfig: platformConfigPda,
        cranker: owner,               // permissionless crank (pays gas, gains nothing)
        campaign: campaignPda,
        claim: claimPda,
        escrowUsdcAta,                // source: campaign vault
        beneficiaryUsdcAta: vaultUsdcAta, // THE vault ATA — same account as debit_fee's source
        beneficiary: vaultPda,        // the vault PDA is the beneficiary
        treasuryUsdcAta,              // same treasury ATA as debit_fee's destination
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultDelta = await bal(vaultUsdcAta) - vaultBefore;
    const treasDelta  = await bal(treasuryUsdcAta) - treasBefore;

    // gross=5 USDC, fee=10%=0.5 USDC, net=4.5 USDC
    assert.equal(
      vaultDelta,
      NET_MICRO,
      "vault ATA +4.5 USDC (net reward: gross 5 − 10% fee 0.5)"
    );
    assert.equal(
      treasDelta,
      PROTOCOL_MICRO,
      "treasury ATA +0.5 USDC (escrow protocol fee = 10% of gross)"
    );
  });

  // ── 8. Keystone final assertions ─────────────────────────────────────────
  it("8. KEYSTONE: vault ATA = deposit−compute+reward_net; treasury = compute+reward_fee", async () => {
    const vaultFinal    = await bal(vaultUsdcAta);
    const treasuryFinal = await bal(treasuryUsdcAta);

    // Vault:    5_000_000 − 750_000 + 4_500_000 = 8_750_000 µUSDC = 8.75 USDC
    assert.equal(
      vaultFinal,
      EXPECTED_VAULT_MICRO,
      `vault ATA final = ${EXPECTED_VAULT_MICRO} µUSDC (8.75 USDC): ` +
      `deposit(5) − compute_fee(0.75) + reward_net(4.5)`
    );

    // Treasury: 750_000 + 500_000 = 1_250_000 µUSDC = 1.25 USDC
    assert.equal(
      treasuryFinal,
      EXPECTED_TREASURY_MICRO,
      `treasury ATA final = ${EXPECTED_TREASURY_MICRO} µUSDC (1.25 USDC): ` +
      `compute_fee(0.75) + reward_fee(0.5)`
    );

    // Confirm vaultUsdcAta is ONE account that received both flows
    const vaultAcct = await getAccount(conn, vaultUsdcAta);
    assert.equal(
      vaultAcct.owner.toBase58(),
      vaultPda.toBase58(),
      "vault ATA.owner == vaultPda — reward-in AND compute-out share this single account"
    );
    assert.equal(
      vaultAcct.mint.toBase58(),
      usdcMint.toBase58(),
      "both programs operate over the same fake USDC mint"
    );

    // Confirm claim was fully paid
    const claim = await escrowProgram.account.claimRecord.fetch(claimPda);
    // claim.paid tracks GROSS settled (== accrued once fully paid → double-crank pays 0,
    // per the escrow idempotency test). The 10% fee split happens at transfer time:
    // beneficiary vault got net 4.5 (asserted above), treasury got the 0.5 fee.
    assert.equal(claim.paid.toNumber(), GROSS_MICRO, "claim.paid = gross settled (5 USDC)");
    assert.equal(claim.accrued.toNumber(), GROSS_MICRO, "claim.accrued = gross (5 USDC)");
  });
});
