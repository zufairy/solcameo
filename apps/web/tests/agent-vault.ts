/* eslint-disable @typescript-eslint/no-explicit-any */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
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
const idl = require("../target/idl/agent_vault.json");

const USDC_DECIMALS = 6;
const usdc = (n: number) => new BN(Math.round(n * 10 ** USDC_DECIMALS));

const VAULT_SEED = Buffer.from("vault");
const FEE_SEED = Buffer.from("fee");

// 32-byte agent id (sha256 of a Vello sessionId, here a test label)
const agentId = createHash("sha256").update("test-agent-vault").digest();
const runId = (label: string) => createHash("sha256").update(label).digest();

describe("agent-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider) as Program<any>;
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // owner = provider wallet (init + withdraw rights)
  const owner = provider.wallet.publicKey;
  const authority = anchor.web3.Keypair.generate(); // debit signer
  const treasury = anchor.web3.Keypair.generate(); // treasury ATA owner
  const stranger = anchor.web3.Keypair.generate(); // unauthorized actor

  let usdcMint: anchor.web3.PublicKey;
  let ownerUsdcAta: anchor.web3.PublicKey;
  let treasuryUsdcAta: anchor.web3.PublicKey;
  let strangerUsdcAta: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let vaultUsdcAta: anchor.web3.PublicKey;

  const CAP = usdc(1); // max 1 USDC per run

  const bal = async (ata: anchor.web3.PublicKey) =>
    Number((await getAccount(conn, ata)).amount);

  const feeRecordPda = (rid: Buffer) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [FEE_SEED, vaultPda.toBuffer(), rid],
      program.programId
    )[0];

  before(async () => {
    // Fund the side-keypairs that must sign.
    for (const kp of [authority, stranger]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }

    usdcMint = await createMint(conn, payer, owner, null, USDC_DECIMALS);

    ownerUsdcAta = await createAssociatedTokenAccount(conn, payer, usdcMint, owner);
    treasuryUsdcAta = await createAssociatedTokenAccount(conn, payer, usdcMint, treasury.publicKey);
    strangerUsdcAta = await createAssociatedTokenAccount(conn, payer, usdcMint, stranger.publicKey);

    // Owner starts with 1000 USDC to fund the vault.
    await mintTo(conn, payer, usdcMint, ownerUsdcAta, owner, 1000 * 10 ** USDC_DECIMALS);

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [VAULT_SEED, owner.toBuffer(), agentId],
      program.programId
    );
    vaultUsdcAta = await getAssociatedTokenAddress(usdcMint, vaultPda, true);
  });

  it("init_vault: creates the vault PDA + its USDC ATA", async () => {
    await program.methods
      .initVault([...agentId], authority.publicKey, treasury.publicKey, CAP)
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

    const v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.owner.toBase58(), owner.toBase58(), "owner");
    assert.equal(v.authority.toBase58(), authority.publicKey.toBase58(), "authority");
    assert.equal(v.treasury.toBase58(), treasury.publicKey.toBase58(), "treasury");
    assert.equal(v.usdcMint.toBase58(), usdcMint.toBase58(), "mint");
    assert.equal(v.maxFeePerRun.toString(), CAP.toString(), "cap");
    assert.equal(v.totalDebited.toString(), "0", "total_debited starts 0");
    assert.deepEqual([...v.agentId], [...agentId], "agent_id");
    assert.equal(await bal(vaultUsdcAta), 0, "fresh vault ATA empty");
  });

  it("init_vault: rejects a zero cap", async () => {
    const badId = createHash("sha256").update("bad-cap").digest();
    const [badVault] = anchor.web3.PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), badId], program.programId);
    const badAta = await getAssociatedTokenAddress(usdcMint, badVault, true);
    try {
      await program.methods
        .initVault([...badId], authority.publicKey, treasury.publicKey, new BN(0))
        .accounts({
          owner, vault: badVault, vaultUsdcAta: badAta, usdcMint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("should reject zero cap");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidCap");
    }
  });

  it("deposit: funds the vault ATA", async () => {
    await program.methods
      .deposit(usdc(100))
      .accounts({
        funder: owner,
        vault: vaultPda,
        vaultUsdcAta,
        funderUsdcAta: ownerUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    assert.equal(await bal(vaultUsdcAta), 100 * 10 ** USDC_DECIMALS, "vault holds 100 USDC");
  });

  it("debit_fee: debits within cap → treasury (idempotency record created)", async () => {
    const rid = runId("run-1");
    const treasBefore = await bal(treasuryUsdcAta);

    await program.methods
      .debitFee(usdc(0.5), [...rid])
      .accounts({
        authority: authority.publicKey,
        vault: vaultPda,
        feeRecord: feeRecordPda(rid),
        vaultUsdcAta,
        treasuryUsdcAta,
        payer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    assert.equal(await bal(treasuryUsdcAta) - treasBefore, 0.5 * 10 ** USDC_DECIMALS, "treasury +0.5");
    assert.equal(await bal(vaultUsdcAta), 99.5 * 10 ** USDC_DECIMALS, "vault -0.5");
    const v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.totalDebited.toString(), usdc(0.5).toString(), "total_debited tracks");
    const rec = await program.account.feeRecord.fetch(feeRecordPda(rid));
    assert.equal(rec.amount.toString(), usdc(0.5).toString(), "fee record amount");
  });

  it("debit_fee: rejects amount over the on-chain cap", async () => {
    const rid = runId("run-over-cap");
    try {
      await program.methods
        .debitFee(usdc(2), [...rid]) // > 1 cap
        .accounts({
          authority: authority.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
          vaultUsdcAta, treasuryUsdcAta, payer: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      assert.fail("should reject over-cap debit");
    } catch (e: any) {
      assert.include(e.toString(), "FeeExceedsCap");
    }
  });

  it("debit_fee: is idempotent — a replayed run_id is rejected", async () => {
    const rid = runId("run-1"); // SAME as the successful debit
    const treasBefore = await bal(treasuryUsdcAta);
    try {
      await program.methods
        .debitFee(usdc(0.5), [...rid])
        .accounts({
          authority: authority.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
          vaultUsdcAta, treasuryUsdcAta, payer: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      assert.fail("replay should fail (fee_record already in use)");
    } catch (e: any) {
      // Account-already-in-use / allocate failure on the FeeRecord PDA.
      assert.match(e.toString(), /already in use|custom program error|0x0/i);
    }
    assert.equal(await bal(treasuryUsdcAta), treasBefore, "no second transfer on replay");
  });

  it("debit_fee: rejects an unauthorized signer", async () => {
    const rid = runId("run-stranger");
    try {
      await program.methods
        .debitFee(usdc(0.1), [...rid])
        .accounts({
          authority: stranger.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
          vaultUsdcAta, treasuryUsdcAta, payer: stranger.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc();
      assert.fail("stranger must not debit");
    } catch (e: any) {
      assert.include(e.toString(), "Unauthorized");
    }
  });

  it("debit_fee: rejects a treasury ATA not owned by vault.treasury", async () => {
    const rid = runId("run-wrong-treasury");
    try {
      await program.methods
        .debitFee(usdc(0.1), [...rid])
        .accounts({
          authority: authority.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
          vaultUsdcAta, treasuryUsdcAta: strangerUsdcAta /* wrong dest */, payer: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      assert.fail("must reject redirect to a non-treasury ATA");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidTreasury");
    }
  });

  it("set_cap / set_authority: owner-only", async () => {
    await program.methods.setCap(usdc(5)).accounts({ owner, vault: vaultPda }).rpc();
    let v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.maxFeePerRun.toString(), usdc(5).toString(), "cap updated");

    // stranger cannot
    try {
      await program.methods.setCap(usdc(999)).accounts({ owner: stranger.publicKey, vault: vaultPda })
        .signers([stranger]).rpc();
      assert.fail("stranger cannot set cap");
    } catch (e: any) {
      assert.include(e.toString(), "Unauthorized");
    }

    const newAuth = anchor.web3.Keypair.generate();
    await program.methods.setAuthority(newAuth.publicKey).accounts({ owner, vault: vaultPda }).rpc();
    v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.authority.toBase58(), newAuth.publicKey.toBase58(), "authority rotated");
    // rotate back so later tests using `authority` still work
    await program.methods.setAuthority(authority.publicKey).accounts({ owner, vault: vaultPda }).rpc();
  });

  it("withdraw: owner pulls funds back (self-custody)", async () => {
    const ownerBefore = await bal(ownerUsdcAta);
    const vaultBal = await bal(vaultUsdcAta);
    await program.methods
      .withdraw(new BN(vaultBal))
      .accounts({
        owner,
        vault: vaultPda,
        vaultUsdcAta,
        ownerUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    assert.equal(await bal(vaultUsdcAta), 0, "vault drained");
    assert.equal(await bal(ownerUsdcAta) - ownerBefore, vaultBal, "owner received the funds");
  });

  it("withdraw: rejects a non-owner", async () => {
    // refund the vault a little first
    await program.methods.deposit(usdc(10)).accounts({
      funder: owner, vault: vaultPda, vaultUsdcAta, funderUsdcAta: ownerUsdcAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    try {
      await program.methods
        .withdraw(usdc(10))
        .accounts({
          owner: stranger.publicKey, vault: vaultPda, vaultUsdcAta,
          ownerUsdcAta: strangerUsdcAta, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc();
      assert.fail("stranger cannot withdraw");
    } catch (e: any) {
      assert.include(e.toString(), "Unauthorized");
    }
  });

  it("debit_fee: fails when the vault has insufficient balance", async () => {
    const remaining = await bal(vaultUsdcAta);
    if (remaining > 0) {
      await program.methods.withdraw(new BN(remaining)).accounts({
        owner, vault: vaultPda, vaultUsdcAta, ownerUsdcAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
    }
    assert.equal(await bal(vaultUsdcAta), 0, "vault is empty");
    const rid = runId("run-insufficient");
    try {
      await program.methods.debitFee(usdc(0.1), [...rid]).accounts({
        authority: authority.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
        vaultUsdcAta, treasuryUsdcAta, payer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([authority]).rpc();
      assert.fail("debit on an empty vault must fail");
    } catch (e: any) {
      assert.ok(e, "token transfer rejected on insufficient funds");
    }
  });

  it("debit_fee: works with a separate payer (payer != authority)", async () => {
    await program.methods.deposit(usdc(2)).accounts({
      funder: owner, vault: vaultPda, vaultUsdcAta, funderUsdcAta: ownerUsdcAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    const rid = runId("run-split-payer");
    const treasBefore = await bal(treasuryUsdcAta);
    await program.methods.debitFee(usdc(0.2), [...rid]).accounts({
      authority: authority.publicKey, vault: vaultPda, feeRecord: feeRecordPda(rid),
      vaultUsdcAta, treasuryUsdcAta, payer: stranger.publicKey, // separate rent payer
      systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([authority, stranger]).rpc();
    assert.equal(await bal(treasuryUsdcAta) - treasBefore, usdc(0.2).toNumber(), "debited with split payer");
  });

  it("debit_fee: rejects a fee_record PDA derived from a different vault", async () => {
    const rid = runId("run-cross-vault");
    const otherVault = anchor.web3.Keypair.generate().publicKey;
    const [wrongFeeRecord] = anchor.web3.PublicKey.findProgramAddressSync(
      [FEE_SEED, otherVault.toBuffer(), rid],
      program.programId
    );
    try {
      await program.methods.debitFee(usdc(0.1), [...rid]).accounts({
        authority: authority.publicKey, vault: vaultPda, feeRecord: wrongFeeRecord, // mismatched PDA
        vaultUsdcAta, treasuryUsdcAta, payer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([authority]).rpc();
      assert.fail("must reject a fee_record PDA not derived from this vault");
    } catch (e: any) {
      assert.match(e.toString(), /seeds|ConstraintSeeds|2006|0x7d6/i);
    }
  });
});
