/* eslint-disable @typescript-eslint/no-explicit-any */
// Program<any> is required until `anchor build` generates the concrete IDL type
import { AnchorProvider, Program, BN, web3 } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { PublicKey, Connection, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { getUsdcMint, getRpcUrl, getNetwork } from "./solana/network";
import IDL from "./vello-escrow-idl.json";

export const AGENT_WALLET_SEED = Buffer.from("vello:agent");
export const PLATFORM_CONFIG_SEED = Buffer.from("vello:config");
export const CAMPAIGN_SEED = Buffer.from("campaign");
export const CLAIM_SEED = Buffer.from("claim");

/** RPC for the escrow program — network-aware so mainnet signs against mainnet.
 *  (Was hardcoded to devnet, which would sign a mainnet deploy against devnet.) */
export function getEscrowRpcUrl(): string {
  return getRpcUrl(getNetwork());
}

export function getEscrowConnection(): Connection {
  return new Connection(getEscrowRpcUrl(), "confirmed");
}

/**
 * The USDC mint for the active cluster, resolved from the SAME single source the
 * rest of the codebase uses (an explicit `NEXT_PUBLIC_USDC_MINT` override, else
 * the network-keyed `getUsdcMint()` from lib/solana/network.ts — which defaults
 * to Circle's devnet USDC on devnet). Read LAZILY so a non-devnet deploy doesn't
 * mis-derive ATAs against a hardcoded devnet mint while the server crank's RPC
 * follows NEXT_PUBLIC_SOLANA_NETWORK. On devnet (the current deploy) this resolves
 * to the same devnet mint as before, so behavior is unchanged.
 */
export function getEscrowUsdcMint(): PublicKey {
  const override = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
  return new PublicKey(override && override.length > 0 ? override : getUsdcMint());
}

function getProgramId(): PublicKey {
  const id = process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID;
  if (!id) throw new Error("NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID not set");
  return new PublicKey(id);
}

/**
 * Minimal Anchor-compatible wallet. Satisfied by both the wallet-adapter
 * `WalletContextState` and the Privy-aware `useUnifiedSolanaWallet()` (whose
 * signer routes through the user's login wallet). Use the latter so funding the
 * treasury works for Google/embedded-wallet logins too.
 */
export interface EscrowSignerWallet {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

export function buildEscrowProgram(wallet: EscrowSignerWallet) {
  const connection = new web3.Connection(getEscrowRpcUrl(), "confirmed");
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  const idlWithAddress = { ...(IDL as any), address: getProgramId().toBase58() };
  return new Program(idlWithAddress, provider);
}

/**
 * Derive the per-campaign PDA. Seeds bind the creator:
 *   [CAMPAIGN_SEED, creatorWallet, campaignId]
 * `creatorWallet` is REQUIRED — the campaign PDA cannot be derived without it
 * (the on-chain seed uses `campaign.creator`). Pass the creator's pubkey (or the
 * connected wallet for the create/top-up/cancel case where they are the same).
 */
export function getCampaignPda(
  campaignId: string,
  creatorWallet: PublicKey | string
): [PublicKey, number] {
  const creator =
    typeof creatorWallet === "string"
      ? new PublicKey(creatorWallet)
      : creatorWallet;
  return PublicKey.findProgramAddressSync(
    [CAMPAIGN_SEED, creator.toBuffer(), Buffer.from(campaignId)],
    getProgramId()
  );
}

/**
 * Derive the per-clip ClaimRecord PDA. Seeds:
 *   [CLAIM_SEED, campaignPda, submissionId]
 */
export function getClaimPda(
  campaignPda: PublicKey | string,
  submissionId: string
): [PublicKey, number] {
  const campaign =
    typeof campaignPda === "string" ? new PublicKey(campaignPda) : campaignPda;
  return PublicKey.findProgramAddressSync(
    [CLAIM_SEED, campaign.toBuffer(), Buffer.from(submissionId)],
    getProgramId()
  );
}

/** Derive the global PlatformConfig PDA. */
export function getPlatformConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PLATFORM_CONFIG_SEED], getProgramId());
}

/**
 * Create the per-campaign vault and deposit the initial budget.
 *
 * NOTE: the on-chain instruction now also takes `rate_per_1k` and `deadline_unix`.
 * These are optional here ONLY to keep the existing campaign-form.tsx call site
 * (which passes 3 args) type-checking during the P2 rewire. The caller SHOULD
 * pass the real per-1k rate (USDC) and deadline (unix secs); the defaults below
 * (rate 0, deadline +90d) are placeholders. See docs/campaign-treasury P2.
 */
export async function createCampaignTx(
  program: Program<any>,
  campaignId: string,
  budgetUsdc: number,
  ratePer1kUsdc = 0,
  deadlineUnix = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60
): Promise<{ txSignature: string; pdaAddress: string }> {
  const wallet = program.provider.publicKey!;
  const budget = new BN(Math.floor(budgetUsdc * 1_000_000));
  const ratePer1k = new BN(Math.floor(ratePer1kUsdc * 1_000_000));
  const deadline = new BN(Math.floor(deadlineUnix));
  const usdcMint = getEscrowUsdcMint();
  const [pdaPubkey] = getCampaignPda(campaignId, wallet);
  const creatorUsdcAta = await getAssociatedTokenAddress(usdcMint, wallet);

  const escrowUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    pdaPubkey,
    true // allowOwnerOffCurve — PDAs are off-curve
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – Anchor Program<any> causes TS2589 deep instantiation; safe at runtime
  const txSignature = await program.methods
    .createCampaign(campaignId, ratePer1k, budget, deadline)
    .accounts({
      creator: wallet,
      campaign: pdaPubkey,
      escrowUsdcAta,
      creatorUsdcAta,
      usdcMint,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature, pdaAddress: pdaPubkey.toBase58() };
}

// NOTE: approveSubmissionTx was REMOVED. The old single-payout instruction
// (which paid the entire budget to one influencer) no longer exists on-chain.
// Disbursement now flows through recordPerformanceTx (oracle) + claimPayoutTx
// (permissionless crank). See docs/campaign-treasury/01-PROGRAM-DESIGN.md.

export async function cancelCampaignTx(
  program: Program<any>,
  campaignId: string
): Promise<{ txSignature: string }> {
  const wallet = program.provider.publicKey!;
  const usdcMint = getEscrowUsdcMint();
  const [pdaPubkey] = getCampaignPda(campaignId, wallet);
  const creatorUsdcAta = await getAssociatedTokenAddress(usdcMint, wallet);
  const escrowUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    pdaPubkey,
    true
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .cancelCampaign(campaignId)
    .accounts({
      creator: wallet,
      campaign: pdaPubkey,
      escrowUsdcAta,
      creatorUsdcAta,
      usdcMint,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

/**
 * Top up an existing campaign vault. `creatorWallet` defaults to the connected
 * funder wallet, which only works when the funder IS the campaign creator (the
 * current campaign-detail.tsx flow). Pass the creator explicitly to fund someone
 * else's campaign.
 */
export async function topUpCampaignTx(
  program: Program<any>,
  campaignId: string,
  amount: number,
  creatorWallet?: PublicKey | string
): Promise<{ txSignature: string }> {
  const wallet = program.provider.publicKey!;
  const usdcMint = getEscrowUsdcMint();
  const [pdaPubkey] = getCampaignPda(campaignId, creatorWallet ?? wallet);
  const funderUsdcAta = await getAssociatedTokenAddress(usdcMint, wallet);
  const escrowUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    pdaPubkey,
    true
  );
  const amountLamports = new BN(Math.floor(amount * 1_000_000));

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .topUp(campaignId, amountLamports)
    .accounts({
      funder: wallet,
      campaign: pdaPubkey,
      escrowUsdcAta,
      funderUsdcAta,
      usdcMint,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

// ----------------------------------------------------------------------
// Oracle attestation + permissionless disbursement (campaign treasury)
// ----------------------------------------------------------------------

/**
 * Oracle posts cumulative verified views for one clip. MOVES NO MONEY — it
 * inits/updates the per-clip ClaimRecord. Must be signed by the key pinned in
 * PlatformConfig.oracle. `scoreHash`/`attestTx` are byte arrays (32 / 64 bytes).
 */
export async function recordPerformanceTx(
  program: Program<any>,
  campaignId: string,
  submissionId: string,
  creatorWallet: PublicKey | string,
  beneficiary: PublicKey | string,
  verifiedViews: number | BN,
  scoreHash: Uint8Array | number[],
  attestTx: Uint8Array | number[]
): Promise<{ txSignature: string; claimPda: string }> {
  const oracle = program.provider.publicKey!;
  const [campaignPda] = getCampaignPda(campaignId, creatorWallet);
  const [platformConfig] = getPlatformConfigPda();
  const [claimPda] = getClaimPda(campaignPda, submissionId);
  const beneficiaryKey =
    typeof beneficiary === "string" ? new PublicKey(beneficiary) : beneficiary;
  const views = BN.isBN(verifiedViews) ? verifiedViews : new BN(verifiedViews);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .recordPerformance(
      campaignId,
      submissionId,
      beneficiaryKey,
      views,
      Array.from(scoreHash),
      Array.from(attestTx)
    )
    .accounts({
      platformConfig,
      oracle,
      campaign: campaignPda,
      claim: claimPda,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature, claimPda: claimPda.toBase58() };
}

/**
 * Permissionless crank: pay the newly-owed delta for one clip, capped to budget,
 * skimming the protocol fee to the treasury. Anyone may call (the signer just
 * pays gas + ATA rent). Idempotent: a duplicate crank pays zero.
 */
export async function claimPayoutTx(
  program: Program<any>,
  campaignId: string,
  submissionId: string,
  creatorWallet: PublicKey | string,
  beneficiary: PublicKey | string,
  treasuryOwner: PublicKey | string
): Promise<{ txSignature: string }> {
  const cranker = program.provider.publicKey!;
  const [campaignPda] = getCampaignPda(campaignId, creatorWallet);
  const [platformConfig] = getPlatformConfigPda();
  const [claimPda] = getClaimPda(campaignPda, submissionId);
  const beneficiaryKey =
    typeof beneficiary === "string" ? new PublicKey(beneficiary) : beneficiary;
  const treasuryKey =
    typeof treasuryOwner === "string"
      ? new PublicKey(treasuryOwner)
      : treasuryOwner;
  const usdcMint = getEscrowUsdcMint();

  const escrowUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    campaignPda,
    true
  );
  const beneficiaryUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    beneficiaryKey,
    true // beneficiary may be the off-curve AgentWallet PDA
  );
  const treasuryUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    treasuryKey,
    true
  );

  // ORA-CLAIM-3: the very first claim of a fresh platform config can revert if the
  // treasury's USDC ATA does not exist yet (the fee transfer's destination). The
  // program does NOT init the treasury ATA, so pre-create it idempotently here
  // (payer = cranker, who already sponsors gas + the beneficiary ATA rent). The
  // "idempotent" variant is a no-op when the ATA already exists, so every
  // subsequent claim carries a cheap, harmless pre-instruction.
  const treasuryAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    cranker,
    treasuryUsdcAta,
    treasuryKey,
    usdcMint,
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .claimPayout(campaignId, submissionId)
    .accounts({
      platformConfig,
      cranker,
      campaign: campaignPda,
      claim: claimPda,
      escrowUsdcAta,
      beneficiaryUsdcAta,
      beneficiary: beneficiaryKey,
      treasuryUsdcAta,
      usdcMint,
    })
    .preInstructions([treasuryAtaIx])
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

/**
 * Freeze a clip (fraud / ineligible). Signer must be the oracle or admin
 * authority pinned in PlatformConfig.
 */
export async function rejectClipTx(
  program: Program<any>,
  campaignId: string,
  submissionId: string,
  creatorWallet: PublicKey | string
): Promise<{ txSignature: string }> {
  const authority = program.provider.publicKey!;
  const [campaignPda] = getCampaignPda(campaignId, creatorWallet);
  const [platformConfig] = getPlatformConfigPda();
  const [claimPda] = getClaimPda(campaignPda, submissionId);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .rejectClip(campaignId, submissionId)
    .accounts({
      platformConfig,
      authority,
      campaign: campaignPda,
      claim: claimPda,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

/**
 * Creator sweeps the remaining vault balance back to themselves after the
 * deadline (or once the campaign is Closed). Transfers the ACTUAL vault balance.
 */
export async function refundRemainingTx(
  program: Program<any>,
  campaignId: string
): Promise<{ txSignature: string }> {
  const wallet = program.provider.publicKey!;
  const usdcMint = getEscrowUsdcMint();
  const [pdaPubkey] = getCampaignPda(campaignId, wallet);
  const creatorUsdcAta = await getAssociatedTokenAddress(usdcMint, wallet);
  const escrowUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    pdaPubkey,
    true
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .refundRemaining(campaignId)
    .accounts({
      creator: wallet,
      campaign: pdaPubkey,
      escrowUsdcAta,
      creatorUsdcAta,
      usdcMint,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}

/**
 * Derive the AgentWallet PDA for a Vello agent.
 * Seeds: [AGENT_WALLET_SEED, creatorWallet, sha256(sessionId)]
 */
export function getAgentWalletPda(
  creatorWallet: string,
  sessionId: string
): [PublicKey, number] {
  const sessionHash = createHash("sha256").update(sessionId).digest();
  return PublicKey.findProgramAddressSync(
    [AGENT_WALLET_SEED, new PublicKey(creatorWallet).toBuffer(), sessionHash],
    getProgramId()
  );
}

/**
 * Derive just the session hash (32 bytes) from a sessionId string.
 * Used when passing the hash to the on-chain instruction.
 */
export function sessionIdToHash(sessionId: string): Buffer {
  return createHash("sha256").update(sessionId).digest();
}

export async function registerAgentWalletTx(
  program: Program<any>,
  creatorWallet: string,
  sessionId: string
): Promise<{ txSignature: string; agentWallet: string; agentUsdcAta: string }> {
  const sessionHash = sessionIdToHash(sessionId);
  const [pdaPubkey] = PublicKey.findProgramAddressSync(
    [AGENT_WALLET_SEED, new PublicKey(creatorWallet).toBuffer(), sessionHash],
    getProgramId()
  );
  const usdcMint = getEscrowUsdcMint();
  const agentUsdcAta = await getAssociatedTokenAddress(
    usdcMint,
    pdaPubkey,
    true
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const txSignature = await program.methods
    .registerAgentWallet(Array.from(sessionHash))
    .accounts({
      agentWallet: pdaPubkey,
      agentUsdcAta,
      usdcMint,
      creator: new PublicKey(creatorWallet),
    })
    .rpc({ commitment: "confirmed" });

  return {
    txSignature,
    agentWallet: pdaPubkey.toBase58(),
    agentUsdcAta: agentUsdcAta.toBase58(),
  };
}

export async function getEscrowBalance(
  connection: Connection,
  pdaAddress: string
): Promise<number> {
  const pdaPubkey = new PublicKey(pdaAddress);
  const escrowAta = await getAssociatedTokenAddress(
    getEscrowUsdcMint(),
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

/**
 * True when the per-campaign vault already holds at least `budgetUsdc`
 * (minus dust). Uses the raw SPL balance via getEscrowBalance, so it works
 * WITHOUT an IDL regen. This is the double-charge guard: derive the PDA from
 * the SAME (reused) campaignId + creator wallet and read the on-chain vault so
 * a prior deposit that landed but timed out on confirmation is detected before
 * the wallet is ever prompted to pay again.
 */
export async function checkVaultFunded(
  campaignId: string,
  creatorWallet: PublicKey | string,
  budgetUsdc: number
): Promise<{ funded: boolean; balance: number; pdaAddress: string }> {
  const [pda] = getCampaignPda(campaignId, creatorWallet);
  const creator = typeof creatorWallet === "string" ? new PublicKey(creatorWallet) : creatorWallet;
  const balance = await getEscrowBalance(getEscrowConnection(), pda.toBase58());
  let validCampaign = false;
  try {
    const account = await getCampaignAccount(buildEscrowProgram({ publicKey: creator }), pda);
    const expectedBudget = BigInt(Math.floor(budgetUsdc * 1_000_000));
    validCampaign = account.creator.equals(creator)
      && account.usdcMint.equals(getEscrowUsdcMint())
      && account.campaignId === campaignId
      && Number(account.status) === 0
      && BigInt(account.budget.toString()) === expectedBudget;
  } catch {
    // A token account can be pre-funded without initializing the campaign PDA.
  }
  return { funded: validCampaign && balance + 1e-6 >= budgetUsdc, balance, pdaAddress: pda.toBase58() };
}

// ----------------------------------------------------------------------
// Typed account READERS (server crank / reconcile).
//
// These resolve to the deserialized on-chain account state. They only EXECUTE
// after `anchor build` regenerates lib/vello-escrow-idl.json with the new
// account shapes (Campaign / ClaimRecord / PlatformConfig). They typecheck now
// because the program is `Program<any>`; the stale committed IDL still only has
// the old CampaignEscrow / AgentWallet accounts, so calling them pre-regen
// throws (the `program.account.<name>` namespace is undefined). See §3A.
// ----------------------------------------------------------------------

/**
 * Read one clip's ClaimRecord (oracle-attested accrual + payout state).
 * Returns { campaign, submissionId, beneficiary, verifiedViews, accrued, paid,
 *   lastRecordedSlot, frozen, lastAttestTx, scoreHash, bump }.
 * The crank uses {beneficiary, accrued, paid, frozen, lastRecordedSlot} to
 * decide whether a claim_payout pays > 0 and to reconcile the Convex mirror.
 */
export async function getClaimRecord(
  program: Program<any>,
  claimPda: PublicKey | string
): Promise<any> {
  const pda = typeof claimPda === "string" ? new PublicKey(claimPda) : claimPda;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – typed accessor only exists after IDL regen; Program<any> at runtime
  return program.account.claimRecord.fetch(pda);
}

/**
 * Read a Campaign account (budget / reserved / status / deadline / mint / rate).
 * Returns { creator, usdcMint, campaignId, ratePer1k, budget, reserved,
 *   totalVerifiedViews, deadlineUnix, status, bump }.
 */
export async function getCampaignAccount(
  program: Program<any>,
  campaignPda: PublicKey | string
): Promise<any> {
  const pda =
    typeof campaignPda === "string" ? new PublicKey(campaignPda) : campaignPda;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – typed accessor only exists after IDL regen; Program<any> at runtime
  return program.account.campaign.fetch(pda);
}

/**
 * Read the global PlatformConfig (singleton). Returns { authority, treasury,
 * oracle, protocolFeeBps, disputeWindowSlots, maxStalenessSlots, bump }.
 * The crank derives `treasury` from this (the authoritative on-chain value the
 * program enforces) rather than trusting a passed-in argument.
 */
export async function getPlatformConfig(program: Program<any>): Promise<any> {
  const [configPda] = getPlatformConfigPda();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – typed accessor only exists after IDL regen; Program<any> at runtime
  return program.account.platformConfig.fetch(configPda);
}

// ----------------------------------------------------------------------
// Admin / deploy wrappers for PlatformConfig (one-time init + rotation).
//
// init_platform_config / update_platform_config Rust signatures:
//   init(treasury, oracle, protocol_fee_bps: u16, dispute_window_slots: u64,
//        max_staleness_slots: u64)   — signer `authority` becomes admin.
//   update(new_authority?, new_treasury?, new_oracle?, new_fee_bps?: u16,
//          new_dispute_window_slots?: u64, new_max_staleness_slots?: u64)
// u16 fee/bps stay plain numbers; u64 slot windows are passed as BN.
// ----------------------------------------------------------------------

/**
 * One-time platform config init (deploy step). The provider wallet (signer)
 * becomes `authority` (admin / sweep / config-rotation key). `oracle` is the
 * only key allowed to record_performance / reject_clip. `treasury` is the OWNER
 * of the treasury USDC ATA that protocol fees + sweeps land in.
 * `feeBps` (0..=10000) is the protocol fee; the windows are in chain slots and
 * MUST satisfy disputeWindowSlots < maxStalenessSlots (else funds strand).
 */
export async function initPlatformConfigTx(
  program: Program<any>,
  oracle: PublicKey | string,
  treasury: PublicKey | string,
  feeBps: number,
  disputeWindowSlots: number | BN,
  maxStalenessSlots: number | BN
): Promise<{ txSignature: string; platformConfig: string }> {
  const authority = program.provider.publicKey!;
  const [configPda] = getPlatformConfigPda();
  const oracleKey = typeof oracle === "string" ? new PublicKey(oracle) : oracle;
  const treasuryKey =
    typeof treasury === "string" ? new PublicKey(treasury) : treasury;
  const dispute = BN.isBN(disputeWindowSlots)
    ? disputeWindowSlots
    : new BN(disputeWindowSlots);
  const staleness = BN.isBN(maxStalenessSlots)
    ? maxStalenessSlots
    : new BN(maxStalenessSlots);

  // #1 front-run gate: init is restricted to the program's UPGRADE AUTHORITY, so
  // the instruction requires the program + its ProgramData account (Anchor may not
  // auto-resolve ProgramData across versions — pass them explicitly). `authority`
  // MUST be the deployer/upgrade-authority wallet or init reverts Unauthorized.
  const [programData] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – Anchor Program<any> deep instantiation; instruction exists post-IDL-regen
  const txSignature = await program.methods
    .initPlatformConfig(treasuryKey, oracleKey, feeBps, dispute, staleness)
    .accounts({
      platformConfig: configPda,
      authority,
      program: program.programId,
      programData,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature, platformConfig: configPda.toBase58() };
}

/**
 * Rotate any subset of the platform config fields. Admin-only (the provider
 * wallet must be the current `authority`). Omitted fields are left unchanged
 * (passed as `null` so Anchor encodes them as `Option::None`). The effective
 * post-update window pair must still satisfy dispute < staleness.
 */
export async function updatePlatformConfigTx(
  program: Program<any>,
  updates: {
    newAuthority?: PublicKey | string;
    newTreasury?: PublicKey | string;
    newOracle?: PublicKey | string;
    newFeeBps?: number;
    newDisputeWindowSlots?: number | BN;
    newMaxStalenessSlots?: number | BN;
  }
): Promise<{ txSignature: string }> {
  const authority = program.provider.publicKey!;
  const [configPda] = getPlatformConfigPda();

  const toKey = (v?: PublicKey | string) =>
    v === undefined ? null : typeof v === "string" ? new PublicKey(v) : v;
  const toBN = (v?: number | BN) =>
    v === undefined ? null : BN.isBN(v) ? v : new BN(v);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore – Anchor Program<any> deep instantiation; instruction exists post-IDL-regen
  const txSignature = await program.methods
    .updatePlatformConfig(
      toKey(updates.newAuthority),
      toKey(updates.newTreasury),
      toKey(updates.newOracle),
      updates.newFeeBps === undefined ? null : updates.newFeeBps,
      toBN(updates.newDisputeWindowSlots),
      toBN(updates.newMaxStalenessSlots)
    )
    .accounts({
      platformConfig: configPda,
      authority,
    })
    .rpc({ commitment: "confirmed" });

  return { txSignature };
}
