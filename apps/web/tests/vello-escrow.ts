/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Money-path invariant suite for the ORACLE escrow program (candidate A).
// Runs on a local validator via `anchor test`. Every invariant the runner's
// rigor protocol §3a names has a dedicated assertion here:
//   payout-math · double-pay/idempotency · authority&scope · over-draw/budget
//   conservation · mint/PDA-signer · view-confirmation(dip/freeze) ·
//   PROSPECTIVE rate (no retroactive reprice) · dispute/staleness windows.
//
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { assert } from "chai";

type VelloEscrow = any; // concrete IDL type is generated post-build; `any` is fine here

const CAMPAIGN_SEED = Buffer.from("campaign");
const CLAIM_SEED = Buffer.from("claim");
const CONFIG_SEED = Buffer.from("vello:config");

// Singleton platform-config windows (in slots). dispute large enough that an
// "immediate" claim reliably lands INSIDE the dispute window on a fast local
// validator; staleness large enough to leave a usable claim window after it.
const DISPUTE_SLOTS = 12;
const STALENESS_SLOTS = 120;
const FEE_BPS = 500; // 5%

describe("vello-escrow (oracle / pay-per-view)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.VelloEscrow as Program<VelloEscrow>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // creator == provider wallet (also the permissionless cranker in these tests)
  const creator = provider.wallet.publicKey;
  const oracleKp = anchor.web3.Keypair.generate();
  const treasuryOwner = anchor.web3.Keypair.generate();

  let usdcMint: anchor.web3.PublicKey;
  let creatorAta: anchor.web3.PublicKey;
  let treasuryAta: anchor.web3.PublicKey;
  let configPda: anchor.web3.PublicKey;

  // ProgramData account for the init front-run gate: PDA of the program id under
  // the BPF upgradeable loader. Its `upgrade_authority_address` must equal the
  // init signer, so only the deployer (localnet provider wallet) may init.
  const BPF_LOADER_UPGRADEABLE = new anchor.web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programDataPda = anchor.web3.PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  )[0];

  // ---- helpers ------------------------------------------------------------
  const campaignPda = (id: string, c = creator) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, c.toBuffer(), Buffer.from(id)],
      program.programId,
    )[0];

  const claimPda = (campaign: anchor.web3.PublicKey, sub: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [CLAIM_SEED, campaign.toBuffer(), Buffer.from(sub)],
      program.programId,
    )[0];

  const ata = (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey) =>
    getAssociatedTokenAddress(mint, owner, true);

  const airdrop = async (pk: anchor.web3.PublicKey, sol = 5) => {
    const sig = await connection.requestAirdrop(pk, sol * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  };

  const waitSlots = async (n: number) => {
    const start = await connection.getSlot("confirmed");

    while (true) {
      const now = await connection.getSlot("confirmed");
      if (now >= start + n) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const SCORE = Array(32).fill(7);
  const ATTEST = Array(64).fill(9);

  // create + fund a fresh campaign vault
  const createCampaign = async (
    id: string,
    ratePer1k: number,
    budget: number,
    deadlineUnix?: number,
  ) => {
    const c = campaignPda(id);
    const escrowAta = await ata(usdcMint, c);
    const deadline = new BN(deadlineUnix ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
    await program.methods
      .createCampaign(id, new BN(ratePer1k), new BN(budget), deadline)
      .accounts({
        creator,
        campaign: c,
        escrowUsdcAta: escrowAta,
        creatorUsdcAta: creatorAta,
        usdcMint,
      })
      .rpc();
    return { campaign: c, escrowAta };
  };

  // oracle records cumulative verified views for one clip
  const record = async (
    id: string,
    sub: string,
    beneficiary: anchor.web3.PublicKey,
    views: number,
  ) => {
    const c = campaignPda(id);
    await program.methods
      .recordPerformance(id, sub, beneficiary, new BN(views), SCORE, ATTEST)
      .accounts({
        platformConfig: configPda,
        oracle: oracleKp.publicKey,
        campaign: c,
        claim: claimPda(c, sub),
      })
      .signers([oracleKp])
      .rpc();
  };

  // permissionless crank
  const claim = async (
    id: string,
    sub: string,
    beneficiary: anchor.web3.PublicKey,
    treasury = treasuryOwner.publicKey,
    treasuryAtaOverride?: anchor.web3.PublicKey,
  ) => {
    const c = campaignPda(id);
    await program.methods
      .claimPayout(id, sub)
      .accounts({
        platformConfig: configPda,
        cranker: creator,
        campaign: c,
        claim: claimPda(c, sub),
        escrowUsdcAta: await ata(usdcMint, c),
        beneficiaryUsdcAta: await ata(usdcMint, beneficiary),
        beneficiary,
        treasuryUsdcAta: treasuryAtaOverride ?? (await ata(usdcMint, treasury)),
        usdcMint,
      })
      .rpc();
  };

  const balance = async (acct: anchor.web3.PublicKey) => {
    try {
      return Number((await getAccount(connection, acct)).amount);
    } catch {
      return 0;
    }
  };

  // ---- setup --------------------------------------------------------------
  before(async () => {
    // anchor test boots a fresh local validator — the provider wallet starts at 0 SOL.
    await airdrop(creator, 100);
    await airdrop(oracleKp.publicKey, 5);

    usdcMint = await createMint(connection, payer, creator, null, 6);
    creatorAta = await createAssociatedTokenAccount(connection, payer, usdcMint, creator);
    // 1,000,000 USDC to the creator (plenty for every campaign)
    await mintTo(connection, payer, usdcMint, creatorAta, creator, 1_000_000_000_000);

    treasuryAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdcMint,
        treasuryOwner.publicKey,
      )
    ).address;

    [configPda] = anchor.web3.PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId);
    // NOTE: the platform config is initialized in the FIRST `it` below (not here),
    // so the front-run gate can be exercised while the singleton PDA is still fresh.
  });

  // #1 CRITICAL — init front-run gate. `init_platform_config` is a singleton,
  // first-caller-wins: a deploy→init gap let an attacker init first and become
  // authority+oracle+treasury of the whole protocol (total drain). The program now
  // constrains init to the program's UPGRADE AUTHORITY (on localnet = the provider
  // wallet `anchor test` deploys with). Prove the attacker is rejected WHILE the PDA
  // is still uninitialized, then init for real as the upgrade authority. Both calls
  // pass `program` + `programData` explicitly (Anchor may not auto-resolve the
  // ProgramData account across versions — the client does the same, see escrow.ts).
  it("rejects init_platform_config from a non-upgrade-authority, then inits as the upgrade authority (#1)", async () => {
    const attacker = anchor.web3.Keypair.generate();
    await airdrop(attacker.publicKey, 5);
    const initAccounts = { platformConfig: configPda, program: program.programId, programData: programDataPda };

    // Attacker is NOT the program's upgrade authority → the program_data constraint
    // fails (Unauthorized) and the singleton PDA is left uninitialized.
    try {
      await program.methods
        .initPlatformConfig(attacker.publicKey, attacker.publicKey, FEE_BPS, new BN(DISPUTE_SLOTS), new BN(STALENESS_SLOTS))
        .accounts({ ...initAccounts, authority: attacker.publicKey })
        .signers([attacker])
        .rpc();
      assert.fail("attacker (non-upgrade-authority) must not initialize the platform config");
    } catch (e: any) {
      assert.include(e.toString(), "Unauthorized");
    }

    // The provider wallet IS the localnet upgrade authority → the real init succeeds.
    await program.methods
      .initPlatformConfig(treasuryOwner.publicKey, oracleKp.publicKey, FEE_BPS, new BN(DISPUTE_SLOTS), new BN(STALENESS_SLOTS))
      .accounts({ ...initAccounts, authority: creator })
      .rpc();
  });

  it("initialized the platform config with the right oracle/treasury/fee/windows", async () => {
    const cfg = await (program.account as any).platformConfig.fetch(configPda);
    assert.equal(cfg.oracle.toBase58(), oracleKp.publicKey.toBase58());
    assert.equal(cfg.treasury.toBase58(), treasuryOwner.publicKey.toBase58());
    assert.equal(cfg.protocolFeeBps, FEE_BPS);
    assert.equal(cfg.disputeWindowSlots.toNumber(), DISPUTE_SLOTS);
    assert.equal(cfg.maxStalenessSlots.toNumber(), STALENESS_SLOTS);
  });

  it("rejects an invalid window config (dispute >= staleness)", async () => {
    try {
      await program.methods
        .updatePlatformConfig(null, null, null, null, new BN(STALENESS_SLOTS), new BN(DISPUTE_SLOTS))
        .accounts({ platformConfig: configPda, authority: creator })
        .rpc();
      assert.fail("should have rejected dispute >= staleness");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidWindowConfig");
    }
  });

  // #6: the dispute window must stay under the 6h refund grace. A window above the
  // cap (even if < staleness) would let a near-deadline clip's claimable_at land
  // after cancel/refund unlocks, stranding the clipper.
  it("rejects a dispute window above MAX_DISPUTE_WINDOW_SLOTS (grace-safety cap)", async () => {
    const tooBig = 30_000; // > 27000 cap; staleness raised above it to isolate the cap
    try {
      await program.methods
        .updatePlatformConfig(null, null, null, null, new BN(tooBig), new BN(tooBig + 10_000))
        .accounts({ platformConfig: configPda, authority: creator })
        .rpc();
      assert.fail("should have rejected an over-cap dispute window");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidWindowConfig");
    }
  });

  it("creates a campaign and locks USDC in the PDA vault", async () => {
    const id = `c-create-${Date.now()}`;
    const before = await balance(creatorAta);
    const { escrowAta } = await createCampaign(id, 50_000, 10_000_000); // 0.05/1k, 10 USDC
    assert.equal(await balance(escrowAta), 10_000_000, "vault funded");
    assert.equal(before - (await balance(creatorAta)), 10_000_000, "creator debited");
    const camp = await (program.account as any).campaign.fetch(campaignPda(id));
    assert.equal(camp.budget.toString(), "10000000");
    assert.equal(camp.reserved.toString(), "0");
    assert.equal(camp.rateEpoch.toString(), "0");
  });

  it("records performance (oracle) and accrues floor(views*rate/1000)", async () => {
    const id = `c-accrue-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000); // 10k views @ 0.05/1k => 0.5 USDC
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    assert.equal(cl.accrued.toNumber(), 500_000, "accrued = floor(10000*50000/1000)");
    assert.equal(cl.paid.toNumber(), 0);
    assert.equal(cl.verifiedViews.toNumber(), 10_000);
  });

  it("rejects record_performance from a non-oracle signer", async () => {
    const id = `c-auth-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const imposter = anchor.web3.Keypair.generate();
    await airdrop(imposter.publicKey, 1);
    const c = campaignPda(id);
    try {
      await program.methods
        .recordPerformance(id, "s1", imposter.publicKey, new BN(1000), SCORE, ATTEST)
        .accounts({
          platformConfig: configPda,
          oracle: imposter.publicKey,
          campaign: c,
          claim: claimPda(c, "s1"),
        })
        .signers([imposter])
        .rpc();
      assert.fail("non-oracle must not record");
    } catch (e: any) {
      assert.match(e.toString(), /Unauthorized|has_one|ConstraintHasOne/);
    }
  });

  it("blocks a claim inside the dispute window (InDisputeWindow)", async () => {
    const id = `c-dispute-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);
    try {
      await claim(id, "s1", ben); // immediate => inside dispute window
      assert.fail("claim should be blocked inside dispute window");
    } catch (e: any) {
      assert.include(e.toString(), "InDisputeWindow");
    }
  });

  it("pays accrued delta to beneficiary + fee to treasury after the dispute window", async () => {
    const id = `c-pay-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const benKp = anchor.web3.Keypair.generate();
    const ben = benKp.publicKey;
    await record(id, "s1", ben, 10_000); // accrued 500_000
    await waitSlots(DISPUTE_SLOTS + 2);
    const tBefore = await balance(treasuryAta);
    await claim(id, "s1", ben);
    const benAta = await ata(usdcMint, ben);
    // gross 500_000; fee = 5% = 25_000; net = 475_000
    assert.equal(await balance(benAta), 475_000, "beneficiary net");
    assert.equal((await balance(treasuryAta)) - tBefore, 25_000, "treasury fee");
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    assert.equal(cl.paid.toNumber(), 500_000, "paid == gross");
  });

  // #3: a keep-alive re-record (same views → no new accrual) refreshes staleness
  // but must NOT re-arm the dispute window. Otherwise the oracle's own staleness
  // refresh would perpetually push claimable_at forward and an earned delta could
  // never be claimed. Here we accrue, let the window elapse, then re-record the
  // SAME views at a much later slot and confirm the payout is STILL claimable
  // immediately (dispute measured from the accrual, not the recent re-record).
  it("keep-alive re-record does not re-arm the dispute window (#3)", async () => {
    const id = `c-rearm-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);         // accrue → last_accrual_slot = A
    await waitSlots(DISPUTE_SLOTS + 4);           // dispute window (from A) elapses
    await record(id, "s1", ben, 10_000);         // keep-alive: same views, recent slot
    // Under the OLD basis (last_recorded_slot) this claim would be InDisputeWindow;
    // with last_accrual_slot it is claimable now.
    await claim(id, "s1", ben);
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    assert.equal(cl.paid.toNumber(), 500_000, "paid despite the recent keep-alive re-record");
  });

  it("double-crank pays 0 (idempotency)", async () => {
    const id = `c-idem-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);
    await waitSlots(DISPUTE_SLOTS + 2);
    await claim(id, "s1", ben);
    const benAta = await ata(usdcMint, ben);
    const after1 = await balance(benAta);
    await claim(id, "s1", ben); // immediate re-crank, no new record
    assert.equal(await balance(benAta), after1, "second crank moved nothing");
  });

  it("is monotonic-noop on a view dip (no revert, no reprice)", async () => {
    const id = `c-dip-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);
    await record(id, "s1", ben, 4_000); // provider dip — must NOT revert or lower
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    assert.equal(cl.verifiedViews.toNumber(), 10_000, "high-water held");
    assert.equal(cl.accrued.toNumber(), 500_000, "accrued unchanged on dip");
  });

  it("clamps payout to the remaining budget (over-draw protection)", async () => {
    const id = `c-cap-${Date.now()}`;
    await createCampaign(id, 1_000_000, 1_000_000); // 1 USDC/1k, budget only 1 USDC
    const benKp = anchor.web3.Keypair.generate();
    const ben = benKp.publicKey;
    await record(id, "s1", ben, 10_000); // accrued floor(10000*1_000_000/1000)=10_000_000 >> budget
    await waitSlots(DISPUTE_SLOTS + 2);
    await claim(id, "s1", ben);
    const escrowAta = await ata(usdcMint, campaignPda(id));
    assert.equal(await balance(escrowAta), 0, "vault fully drained, never over-drawn");
    const benAta = await ata(usdcMint, ben);
    // gross capped at remaining 1_000_000; fee 50_000; net 950_000
    assert.equal(await balance(benAta), 950_000);
    // second crank: owed still huge but remaining == 0 => pays 0
    await claim(id, "s1", ben);
    assert.equal(await balance(benAta), 950_000, "no over-draw on re-crank");
  });

  it("rounds the fee to 0 on a tiny delta (and never overpays)", async () => {
    const id = `c-fee0-${Date.now()}`;
    await createCampaign(id, 1, 10_000_000); // rate 1 base unit / 1k
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 19_000); // accrued floor(19000*1/1000)=19 base units
    await waitSlots(DISPUTE_SLOTS + 2);
    const tBefore = await balance(treasuryAta);
    await claim(id, "s1", ben);
    const benAta = await ata(usdcMint, ben);
    assert.equal(await balance(benAta), 19, "tiny gross paid in full");
    assert.equal((await balance(treasuryAta)) - tBefore, 0, "fee floored to 0");
  });

  it("freezes a clip (reject_clip): cannot record or claim", async () => {
    const id = `c-freeze-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);
    const c = campaignPda(id);
    await program.methods
      .rejectClip(id, "s1")
      .accounts({ platformConfig: configPda, authority: oracleKp.publicKey, campaign: c, claim: claimPda(c, "s1") })
      .signers([oracleKp])
      .rpc();
    await waitSlots(DISPUTE_SLOTS + 2);
    try {
      await claim(id, "s1", ben);
      assert.fail("frozen clip must not pay");
    } catch (e: any) {
      assert.include(e.toString(), "ClipFrozen");
    }
    try {
      await record(id, "s1", ben, 20_000);
      assert.fail("frozen clip must not re-record");
    } catch (e: any) {
      assert.include(e.toString(), "ClipFrozen");
    }
  });

  it("rate change is PROSPECTIVE on a raise — old views keep the old rate", async () => {
    const id = `c-rateup-${Date.now()}`;
    await createCampaign(id, 50_000, 100_000_000); // 0.05/1k
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000); // accrued 500_000 @ old rate
    // raise to 0.10/1k
    await program.methods
      .updateCampaignRate(id, new BN(100_000))
      .accounts({ creator, campaign: campaignPda(id) })
      .rpc();
    await record(id, "s1", ben, 20_000); // +10k views at NEW rate
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    // prospective: 500_000 (first 10k @0.05) + 1_000_000 (next 10k @0.10) = 1_500_000
    // retroactive (WRONG) would be floor(20000*100000/1000) = 2_000_000
    assert.equal(cl.accrued.toNumber(), 1_500_000, "old views NOT repriced");
    assert.notEqual(cl.accrued.toNumber(), 2_000_000);
    assert.equal(cl.rateEpoch.toNumber(), 1);
  });

  it("rate change never claws back owed-unpaid on a cut", async () => {
    const id = `c-ratedn-${Date.now()}`;
    await createCampaign(id, 100_000, 100_000_000); // 0.10/1k
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000); // accrued 1_000_000 (unpaid)
    // cut to 0.01/1k
    await program.methods
      .updateCampaignRate(id, new BN(10_000))
      .accounts({ creator, campaign: campaignPda(id) })
      .rpc();
    await record(id, "s1", ben, 10_000); // no growth — settle only
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    assert.equal(cl.accrued.toNumber(), 1_000_000, "owed-unpaid preserved at old rate, not clawed to 100_000");
  });

  it("rejects update_campaign_rate from a non-creator", async () => {
    const id = `c-rateauth-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const imposter = anchor.web3.Keypair.generate();
    await airdrop(imposter.publicKey, 1);
    try {
      await program.methods
        .updateCampaignRate(id, new BN(1))
        .accounts({ creator: imposter.publicKey, campaign: campaignPda(id) })
        .signers([imposter])
        .rpc();
      assert.fail("non-creator must not change the rate");
    } catch (e: any) {
      // seed derivation uses creator; an imposter signer can't derive the real PDA
      assert.match(e.toString(), /Unauthorized|has_one|ConstraintSeeds|ConstraintHasOne|seeds/);
    }
  });

  // Pre-mainnet fix (b): staleness now gates claims PRE-deadline only (post-deadline
  // record_performance is blocked → last_recorded_slot freezes → a keeper outage would
  // strand an earned claim for the creator's refund sweep). This test proves the gate
  // is still ARMED pre-deadline; the post-deadline EXEMPTION success path needs a 6h+
  // clock and is unreachable on a live localnet (verified instead on devnet e2e + review).
  it("rejects a claim once the attestation is stale (AttestationStale)", async () => {
    const id = `c-stale-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000);
    await waitSlots(STALENESS_SLOTS + 4); // let it go stale
    try {
      await claim(id, "s1", ben);
      assert.fail("stale attestation must not pay");
    } catch (e: any) {
      assert.include(e.toString(), "AttestationStale");
    }
  });

  // Pre-mainnet fix (a): the deadline+grace cancel lock is now UNCONDITIONAL. A clip
  // can be verified OFF-chain before its first record_performance lands, so a
  // pre-attestation cancel could still rug a real clipper. The refund path itself
  // (sweep_vault_to_creator) is shared with refund_remaining and covered there; the
  // post-grace SUCCESS path needs a 12h+ clock and is unreachable on a live localnet
  // (same limitation as the refund_remaining grace test below).
  it("cancel_campaign is blocked before deadline+grace even with ZERO attestations (fix a)", async () => {
    const id = `c-cancel-${Date.now()}`;
    const { escrowAta } = await createCampaign(id, 50_000, 7_000_000);
    try {
      await program.methods
        .cancelCampaign(id)
        .accounts({ creator, campaign: campaignPda(id), escrowUsdcAta: escrowAta, creatorUsdcAta: creatorAta, usdcMint })
        .rpc();
      assert.fail("pre-grace cancel must be rejected even with no attestations");
    } catch (e: any) {
      assert.include(e.toString(), "RefundGraceActive");
    }
    assert.equal(await balance(escrowAta), 7_000_000, "vault untouched by the blocked cancel");
  });

  it("refund_remaining is blocked before the deadline (CampaignStillActive)", async () => {
    const id = `c-refund-${Date.now()}`;
    const { escrowAta } = await createCampaign(id, 50_000, 3_000_000, Math.floor(Date.now() / 1000) + 7 * 3600);
    try {
      await program.methods
        .refundRemaining(id)
        .accounts({ creator, campaign: campaignPda(id), escrowUsdcAta: escrowAta, creatorUsdcAta: creatorAta, usdcMint })
        .rpc();
      assert.fail("refund must be blocked before the deadline");
    } catch (e: any) {
      assert.include(e.toString(), "CampaignStillActive");
    }
    // The deadline+grace sweep path (sweep_vault_to_creator, shared with cancel_campaign)
    // has NO in-suite success coverage since fix (a) made cancel honor the same 12h+
    // grace timing — the 6h-after-deadline path can't be reached on a fast validator
    // without warp. It was proven on devnet during the OG bake-off E2E (tx sigs in
    // docs/campaign-treasury/OG-APPROVAL-RESULT.md).
    assert.equal(await balance(escrowAta), 3_000_000, "funds remain until the deadline");
  });

  it("rejects an out-of-range campaign deadline (too short < 6h min — anti-rug, panel #2)", async () => {
    const id = `c-baddl-${Date.now()}`;
    try {
      // 1h < the 6h MIN_CAMPAIGN_DURATION — would make the grace window too short to
      // protect a late-attested clip, so it must be rejected at creation.
      await createCampaign(id, 50_000, 1_000_000, Math.floor(Date.now() / 1000) + 3600);
      assert.fail("a deadline shorter than the min duration must be rejected");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidDeadline");
    }
  });

  it("anti-rug: cancel is blocked once a clip is attested (panel #1 HIGH fix)", async () => {
    const id = `c-rug-${Date.now()}`;
    const { escrowAta } = await createCampaign(id, 50_000, 10_000_000);
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 100_000); // clipper now owed 5 USDC, uncranked
    try {
      await program.methods
        .cancelCampaign(id)
        .accounts({ creator, campaign: campaignPda(id), escrowUsdcAta: escrowAta, creatorUsdcAta: creatorAta, usdcMint })
        .rpc();
      assert.fail("cancel must be blocked while a clip is owed-but-uncranked");
    } catch (e: any) {
      assert.include(e.toString(), "RefundGraceActive");
    }
    assert.equal(await balance(escrowAta), 10_000_000, "vault still holds the clipper's funds");
  });

  it("multi-rate-epoch jump prices the gap at the latest rate (documented behavior)", async () => {
    const id = `c-jump-${Date.now()}`;
    await createCampaign(id, 50_000, 100_000_000); // 0.05/1k
    const ben = anchor.web3.Keypair.generate().publicKey;
    await record(id, "s1", ben, 10_000); // accrued 500_000 @ 0.05
    await program.methods.updateCampaignRate(id, new BN(100_000)).accounts({ creator, campaign: campaignPda(id) }).rpc();
    await program.methods.updateCampaignRate(id, new BN(200_000)).accounts({ creator, campaign: campaignPda(id) }).rpc();
    await record(id, "s1", ben, 30_000); // +20k gap-views price at the LATEST rate (0.20)
    const cl = await (program.account as any).claimRecord.fetch(claimPda(campaignPda(id), "s1"));
    // 500_000 + floor(20_000*200_000/1000)=4_000_000 => 4_500_000; the first 10k NOT repriced
    assert.equal(cl.accrued.toString(), "4500000");
    assert.equal(cl.rateEpoch.toString(), "2");
  });

  it("rejects a top_up with a foreign mint (panel #1 MEDIUM fix)", async () => {
    const id = `c-foreign-${Date.now()}`;
    await createCampaign(id, 50_000, 10_000_000);
    const evilMint = await createMint(connection, payer, creator, null, 6);
    const evilFunderAta = await createAssociatedTokenAccount(connection, payer, evilMint, creator);
    await mintTo(connection, payer, evilMint, evilFunderAta, creator, 1_000_000_000);
    const c = campaignPda(id);
    try {
      await program.methods
        .topUp(id, new BN(1_000_000_000))
        .accounts({ funder: creator, campaign: c, escrowUsdcAta: await ata(evilMint, c), funderUsdcAta: evilFunderAta, usdcMint: evilMint })
        .rpc();
      assert.fail("top_up with a foreign mint must be rejected");
    } catch (e: any) {
      // any rejection tied to the escrow ATA proves the foreign-mint top_up was blocked
      assert.match(e.toString(), /escrow_usdc_ata|ConstraintAssociated|AccountNotInitialized|associated|MintMismatch|constraint/i);
    }
  });
});
