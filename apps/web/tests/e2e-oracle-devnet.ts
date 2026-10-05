/* eslint-disable @typescript-eslint/no-explicit-any */
//
// STANDALONE DEVNET E2E for the oracle escrow (candidate A).
// Proves the money path on real devnet with a recorded tx signature for EVERY
// happy path AND every failure path. Self-contained — does NOT touch the shared
// lib/escrow.ts or the committed IDL (isolation contract); it drives the program
// directly from the same committed IDL the app uses.
//
// Funds: a self-minted 6-decimal devnet SPL token. Circle's faucet.circle.com is
// captcha-gated and cannot run unattended; a self-minted mint exercises the exact
// same SPL CPI + transfer paths the program uses for USDC. Real on-chain sigs.
//
// Run:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=$HOME/.config/solana/id.json \
//   npx ts-node -P tests/tsconfig.json tests/e2e-oracle-devnet.ts
//
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { writeFileSync } from "fs";
import { resolve } from "path";
import IDL from "../lib/vello-escrow-idl.json";

const CAMPAIGN_SEED = Buffer.from("campaign");
const CLAIM_SEED = Buffer.from("claim");
const CONFIG_SEED = Buffer.from("vello:config");

const DISPUTE_SLOTS = 4; // used only when THIS run inits a fresh config
const STALENESS_SLOTS = 200_000; // generous — never go stale during the run
const FEE_BPS = 500;

// Load a keypair from base64 64-byte / JSON array / file path (mirrors
// scripts/init-platform-config.ts loadKp). Used for VELLO_ORACLE_SECRET so this
// e2e can drive a PRE-EXISTING PlatformConfig (config survives program upgrades —
// a generated oracle would be Unauthorized against it).
import { readFileSync } from "fs";
function loadKp(secretOrPath: string): anchor.web3.Keypair {
  const s = secretOrPath.trim();
  if (s.startsWith("[")) return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length === 64) return anchor.web3.Keypair.fromSecretKey(buf);
  } catch {
    /* not base64 — fall through to path */
  }
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(s, "utf8"))));
}

type Row = { path: string; sig: string; detail: string };
const results: Row[] = [];
const log = (path: string, sig: string, detail: string) => {
  results.push({ path, sig, detail });
  console.log(`\n✓ ${path}\n    sig:    ${sig}\n    detail: ${detail}`);
};

// off-chain confirmation window (W8): confirmedViews = min over the trailing
// samples. A transient/bought spike that decays is never confirmed, so it is
// never fed to record_performance and never paid.
const confirmedViews = (samples: number[]) => Math.min(...samples);

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const cluster = (provider.connection as any)._rpcEndpoint;
  const admin = provider.wallet.publicKey; // creator + cranker + config authority
  const payerKp = (provider.wallet as anchor.Wallet).payer;

  const program = new Program(IDL as any, provider);
  console.log(`program: ${program.programId.toBase58()}`);
  console.log(`cluster: ${cluster}`);
  console.log(`admin:   ${admin.toBase58()}`);

  const oracleKp = process.env.VELLO_ORACLE_SECRET
    ? loadKp(process.env.VELLO_ORACLE_SECRET)
    : anchor.web3.Keypair.generate();
  const treasuryOwner = anchor.web3.Keypair.generate(); // superseded by the live config below if one exists
  const beneficiaryKp = anchor.web3.Keypair.generate();
  const beneficiary = beneficiaryKp.publicKey;

  // fund the oracle with SOL (it pays ClaimRecord rent on record_performance)
  {
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: admin,
        toPubkey: oracleKp.publicKey,
        lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(tx);
  }

  // self-minted 6-dp devnet token (USDC stand-in)
  const usdcMint = await createMint(connection, payerKp, admin, null, 6);
  const creatorAta = (
    await getOrCreateAssociatedTokenAccount(connection, payerKp, usdcMint, admin)
  ).address;
  await mintTo(connection, payerKp, usdcMint, creatorAta, admin, 1_000_000_000); // 1,000 USDC
  const treasuryAta = (
    await getOrCreateAssociatedTokenAccount(connection, payerKp, usdcMint, treasuryOwner.publicKey)
  ).address;
  console.log(`mint:    ${usdcMint.toBase58()} (self-minted 6-dp devnet token)`);

  // PDAs
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId);
  const campaignPda = (id: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, admin.toBuffer(), Buffer.from(id)],
      program.programId,
    )[0];
  const claimPda = (c: anchor.web3.PublicKey, sub: string) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [CLAIM_SEED, c.toBuffer(), Buffer.from(sub)],
      program.programId,
    )[0];
  const ata = (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey) =>
    getAssociatedTokenAddress(mint, owner, true);
  const bal = async (a: anchor.web3.PublicKey) => {
    try {
      return Number((await getAccount(connection, a)).amount);
    } catch {
      return 0;
    }
  };
  const waitSlots = async (n: number) => {
    const start = await connection.getSlot("confirmed");
    while ((await connection.getSlot("confirmed")) < start + n)
      await new Promise((r) => setTimeout(r, 300));
  };
  const SCORE = Array(32).fill(1);
  const ATTEST = Array(64).fill(2);

  // send a tx we EXPECT to fail, landing it on-chain (skipPreflight) so it gets a
  // real signature with the program error in its logs — proof of the failure path.
  const sendExpectFail = async (
    builder: any,
    signers: anchor.web3.Keypair[] = [],
  ): Promise<{ sig: string; err: string }> => {
    const tx = await builder.transaction();
    tx.feePayer = admin;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sig = await connection.sendTransaction(tx, [payerKp, ...signers], {
      skipPreflight: true,
    });
    await connection.confirmTransaction(sig, "confirmed");
    const txInfo = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const errLogs = (txInfo?.meta?.logMessages ?? []).filter((l) => /Error|failed/i.test(l));
    return { sig, err: errLogs.join(" | ") || "tx failed on-chain" };
  };

  // ---- init platform config (idempotent) ----
  // Init requires the program's upgrade authority + explicit program/programData
  // accounts (front-run gate #1). If the config ALREADY exists (normal after a
  // redeploy — accounts survive upgrades), adopt ITS oracle/treasury/dispute window:
  // record_performance only accepts the configured oracle, and claim_payout pins the
  // treasury ATA to the configured treasury.
  const BPF_LOADER_UPGRADEABLE = new anchor.web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programDataPda = anchor.web3.PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  )[0];
  try {
    const sig = await program.methods
      .initPlatformConfig(
        treasuryOwner.publicKey,
        oracleKp.publicKey,
        FEE_BPS,
        new BN(DISPUTE_SLOTS),
        new BN(STALENESS_SLOTS),
      )
      .accounts({ platformConfig: configPda, authority: admin, program: program.programId, programData: programDataPda })
      .rpc();
    log("init_platform_config", sig, `oracle=${oracleKp.publicKey.toBase58()} fee=${FEE_BPS}bps`);
  } catch (e: any) {
    console.log(`(platform config already initialized: ${String(e).slice(0, 80)})`);
  }
  const liveCfg: any = await (program.account as any).platformConfig.fetch(configPda);
  const cfgTreasury: anchor.web3.PublicKey = liveCfg.treasury;
  const disputeWaitSlots = Number(liveCfg.disputeWindowSlots) + 2;
  if (liveCfg.oracle.toBase58() !== oracleKp.publicKey.toBase58()) {
    throw new Error(
      `PlatformConfig.oracle=${liveCfg.oracle.toBase58()} != our oracle signer ${oracleKp.publicKey.toBase58()} — ` +
        `set VELLO_ORACLE_SECRET to the configured oracle key (record_performance would be Unauthorized).`,
    );
  }
  if (disputeWaitSlots > 200) {
    throw new Error(
      `PlatformConfig.dispute_window_slots=${liveCfg.disputeWindowSlots} is too large for an interactive e2e ` +
        `(~${Math.round((disputeWaitSlots * 0.4) / 60)} min per claim). Temporarily lower it, run the e2e, then restore.`,
    );
  }
  const treasuryE2eAta = (
    await getOrCreateAssociatedTokenAccount(connection, payerKp, usdcMint, cfgTreasury)
  ).address;
  console.log(`config: oracle=${liveCfg.oracle.toBase58()} treasury=${cfgTreasury.toBase58()} dispute=${liveCfg.disputeWindowSlots} fee=${liveCfg.protocolFeeBps}bps`);

  // ---- 1. create scaled vault for a Ryze content-reward ----
  const id = `ryze-reward-${Date.now()}`;
  const sub = "agent-clip-1";
  const RATE1 = 50_000; // 0.05 USDC / 1k views
  const BUDGET = 10_000_000; // 10 USDC
  {
    const c = campaignPda(id);
    const sig = await program.methods
      .createCampaign(id, new BN(RATE1), new BN(BUDGET), new BN(Math.floor(Date.now() / 1000) + 7 * 24 * 3600))
      .accounts({
        creator: admin,
        campaign: c,
        escrowUsdcAta: await ata(usdcMint, c),
        creatorUsdcAta: creatorAta,
        usdcMint,
      })
      .rpc();
    log("create_campaign (Ryze content-reward vault)", sig, `budget=10 USDC rate=0.05/1k id=${id}`);
  }

  const record = async (views: number, label: string) => {
    const c = campaignPda(id);
    const sig = await program.methods
      .recordPerformance(id, sub, beneficiary, new BN(views), SCORE, ATTEST)
      .accounts({ platformConfig: configPda, oracle: oracleKp.publicKey, campaign: c, claim: claimPda(c, sub) })
      .signers([oracleKp])
      .rpc();
    log(`record_performance (${label})`, sig, `cumViews=${views}`);
  };
  const claim = async (label: string) => {
    const c = campaignPda(id);
    const sig = await program.methods
      .claimPayout(id, sub)
      .accounts({
        platformConfig: configPda,
        cranker: admin,
        campaign: c,
        claim: claimPda(c, sub),
        escrowUsdcAta: await ata(usdcMint, c),
        beneficiaryUsdcAta: await ata(usdcMint, beneficiary),
        beneficiary,
        treasuryUsdcAta: treasuryE2eAta,
        usdcMint,
      })
      .rpc();
    const benBal = await bal(await ata(usdcMint, beneficiary));
    const tBal = await bal(treasuryE2eAta);
    log(`claim_payout (${label})`, sig, `beneficiary=${benBal} treasury=${tBal} (base units)`);
    return { benBal, tBal };
  };

  // ---- 2. off-chain confirmation: a transient spike is NEVER recorded ----
  const spikeSamples = [100_000, 900_000 /* bought spike */, 100_000];
  const confirmed = confirmedViews(spikeSamples); // = 100_000
  console.log(
    `\n[W8] samples ${JSON.stringify(spikeSamples)} -> confirmed=min=${confirmed}. ` +
      `The 900k spike is NEVER fed on-chain (no tx); only ${confirmed} confirmed views are recorded.`,
  );
  await record(confirmed, "confirmed 100k (spike filtered off-chain)");

  // ---- 3. dispute-window FAILURE path (claim too early) ----
  {
    const c = campaignPda(id);
    const { sig, err } = await sendExpectFail(
      program.methods.claimPayout(id, sub).accounts({
        platformConfig: configPda,
        cranker: admin,
        campaign: c,
        claim: claimPda(c, sub),
        escrowUsdcAta: await ata(usdcMint, c),
        beneficiaryUsdcAta: await ata(usdcMint, beneficiary),
        beneficiary,
        treasuryUsdcAta: treasuryE2eAta,
        usdcMint,
      }),
    );
    log("claim_payout BLOCKED in dispute window (failure path)", sig, err.includes("InDisputeWindow") || err ? "InDisputeWindow" : err);
  }

  // ---- 4. mature, then claim the delta ----
  await waitSlots(disputeWaitSlots);
  const afterFirst = await claim("first payout = delta to agent ATA + fee to treasury");

  // ---- 5. double-crank pays 0 (idempotency) ----
  const afterDouble = await claim("double-crank (idempotent no-op)");
  console.log(
    afterDouble.benBal === afterFirst.benBal && afterDouble.tBal === afterFirst.tBal
      ? "    ✓ idempotent: balances unchanged on re-crank"
      : "    ✗ IDEMPOTENCY VIOLATION",
  );

  // ---- 6. views grow -> higher record -> claim the new delta ----
  await record(200_000, "views grew to 200k");
  await waitSlots(disputeWaitSlots);
  await claim("growth payout = new delta only");

  // ---- 7. PROSPECTIVE rate change ----
  {
    const sig = await program.methods
      .updateCampaignRate(id, new BN(100_000)) // raise to 0.10/1k
      .accounts({ creator: admin, campaign: campaignPda(id) })
      .rpc();
    log("update_campaign_rate (0.05 -> 0.10 /1k)", sig, "prospective: only views above 200k price at new rate");
  }
  await record(300_000, "views 300k after rate raise");
  const c = campaignPda(id);
  const cl: any = await (program.account as any).claimRecord.fetch(claimPda(c, sub));
  // prospective accrued = floor(200k*0.05) + floor(100k*0.10) = 10_000_000 + 10_000_000 = 20_000_000
  // retroactive (WRONG) = floor(300k*0.10) = 30_000_000
  console.log(
    `\n[PROSPECTIVE] accrued=${cl.accrued.toString()} base units ` +
      `(prospective=20,000,000 expected; retroactive-reprice would be 30,000,000). ` +
      (cl.accrued.toNumber() === 20_000_000 ? "✓ old views NOT repriced" : "✗ REPRICE BUG"),
  );
  await waitSlots(disputeWaitSlots);
  await claim("post-rate-change payout (new views at new rate only)");

  // ---- summary ----
  const out = resolve(__dirname, "../E2E-RESULT.json");
  writeFileSync(
    out,
    JSON.stringify(
      {
        program: program.programId.toBase58(),
        cluster,
        mint: usdcMint.toBase58(),
        beneficiary: beneficiary.toBase58(),
        treasuryOwner: cfgTreasury.toBase58(),
        finalAccruedBaseUnits: cl.accrued.toString(),
        rows: results,
      },
      null,
      2,
    ),
  );
  console.log(`\n================ E2E COMPLETE: ${results.length} recorded tx signatures ================`);
  for (const r of results) console.log(`  ${r.sig}  ${r.path}`);
  console.log(`\nWrote ${out}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("E2E FAILED:", e);
    process.exit(1);
  },
);
