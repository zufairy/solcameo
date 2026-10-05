/* eslint-disable @typescript-eslint/no-explicit-any */
// Program<any> until `anchor build` types are wired into the app tsconfig.
//
// Client binding for the Vello Agent Vault Anchor program
// (programs/agent-vault). Server-oriented: the platform AUTHORITY signs
// `debit_fee` with a Keypair (loaded from a platform secret), the same way
// lib/economy/settleAgent.ts currently signs USDC transfers with the agent
// keypair. This is ADDITIVE — nothing here is wired into the live custodial
// settle path yet (that is the flag-gated last step; see MIGRATION_PLAN.md).
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { getRpcUrl } from "@/lib/solana/network";
import IDL from "./agent-vault-idl.json";

export const VAULT_SEED = Buffer.from("vault");
export const FEE_SEED = Buffer.from("fee");
export const USDC_DECIMALS = 6;

/** The deployed program id. Devnet default matches the keypair committed to
 *  Anchor.toml; override per environment. */
const DEFAULT_PROGRAM_ID = "93RLwdPcyuNFFougLvRLe7912oJBfq77Y8ZNYXQZD6CP"; // deployed devnet (owner-bound seed)

// Anchor's Program<any> method/account builders trip TS2589 (excessively deep
// instantiation) — and WHICH call site trips it depends on the checker's
// cache order, so per-site @ts-expect-error directives flip between "needed"
// and "unused" between builds. One deliberate loosening here instead.
type LooseProgram = { methods: any; account: any };
function loose(program: unknown): LooseProgram {
  return program as LooseProgram;
}

export function getAgentVaultProgramId(): PublicKey {
  const fromEnv = process.env.NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID?.trim();
  if (fromEnv) return new PublicKey(fromEnv);
  // The silent devnet fallback must never reach mainnet: vault PDAs derived from
  // the wrong program id would strand real USDC. Mirrors lib/escrow.ts, which throws.
  if (process.env.NEXT_PUBLIC_SOLANA_NETWORK?.toLowerCase().startsWith("mainnet")) {
    throw new Error(
      "NEXT_PUBLIC_AGENT_VAULT_PROGRAM_ID not set on mainnet — refusing the devnet fallback id",
    );
  }
  return new PublicKey(DEFAULT_PROGRAM_ID);
}

/** RPC connection (single source of truth from lib/solana/network — devnet uses
 *  the PUBLIC endpoint because the configured Helius devnet key is suspended). */
export function getVaultConnection(disableRetryOnRateLimit = false): Connection {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK?.toLowerCase().startsWith("mainnet")
    ? "mainnet-beta"
    : "devnet";
  return new Connection(getRpcUrl(network as "mainnet-beta" | "devnet"), { commitment: "confirmed", disableRetryOnRateLimit });
}

/** Minimal Anchor-compatible wallet around a raw Keypair — anchor's `Wallet`/
 *  `NodeWallet` export is not a constructor in the bundled Next server build
 *  (surfaced as `[nft/mint] vault init failed … d.Wallet is not a constructor`),
 *  which silently blocked every agent-vault init. Same shim as escrowServer.ts. */
function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
      }
      return txs;
    },
  };
}

/** Build a Program bound to a signing Keypair (server) or any connection. */
export function buildAgentVaultProgram(signer: Keypair, connection?: Connection): Program<any> {
  const conn = connection ?? getVaultConnection();
  const provider = new AnchorProvider(conn, keypairWallet(signer) as any, { commitment: "confirmed" });
  const idlWithAddress = { ...(IDL as any), address: getAgentVaultProgramId().toBase58() };
  return new Program(idlWithAddress as any, provider);
}

// --- id helpers -----------------------------------------------------------

/** 32-byte on-chain agent id = sha256(sessionId). Matches the program's
 *  `[u8; 32]` agent_id seed and the test fixtures. */
export function agentIdFromSessionId(sessionId: string): Buffer {
  return createHash("sha256").update(sessionId).digest();
}

/** 32-byte run id = sha256(runId) — the idempotency key for debit_fee. */
export function runIdToBytes(runId: string): Buffer {
  return createHash("sha256").update(runId).digest();
}

// --- PDA derivation -------------------------------------------------------

// Owner-bound seed: `["vault", owner, agent_id]` (matches the program's seed-squat
// fix). Under platform ownership `owner` is the platform vault-authority pubkey.
export function getVaultPda(owner: PublicKey, agentId: Buffer | Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), Buffer.from(agentId)],
    getAgentVaultProgramId(),
  );
}

export function getFeeRecordPda(vault: PublicKey, runId: Buffer | Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FEE_SEED, vault.toBuffer(), Buffer.from(runId)],
    getAgentVaultProgramId(),
  );
}

export function getVaultUsdcAta(usdcMint: PublicKey, vault: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(usdcMint, vault, true); // allowOwnerOffCurve — vault is a PDA
}

const toBaseUnits = (usdc: number) => new BN(Math.round(usdc * 10 ** USDC_DECIMALS));

// --- instruction builders -------------------------------------------------

/** Create the vault PDA + its USDC ATA for an agent. `owner` (the program
 *  provider's wallet) gets withdraw/admin rights. */
export async function initVaultTx(opts: {
  program: Program<any>;
  agentId: Buffer;
  usdcMint: PublicKey;
  owner: PublicKey; // must equal the program provider's signing wallet
  authority: PublicKey;
  treasury: PublicKey;
  maxFeePerRunUsdc: number;
}): Promise<string> {
  const [vault] = getVaultPda(opts.owner, opts.agentId);
  const vaultUsdcAta = await getVaultUsdcAta(opts.usdcMint, vault);
  return loose(opts.program).methods
    .initVault([...opts.agentId], opts.authority, opts.treasury, toBaseUnits(opts.maxFeePerRunUsdc))
    .accounts({
      owner: opts.program.provider.publicKey,
      vault,
      vaultUsdcAta,
      usdcMint: opts.usdcMint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/** Deposit USDC into the vault (the provider wallet is the funder). */
export async function depositTx(opts: {
  program: Program<any>;
  agentId: Buffer;
  usdcMint: PublicKey;
  owner: PublicKey; // the vault owner (platform authority), for PDA derivation
  funderUsdcAta: PublicKey;
  amountUsdc: number;
}): Promise<string> {
  const [vault] = getVaultPda(opts.owner, opts.agentId);
  const vaultUsdcAta = await getVaultUsdcAta(opts.usdcMint, vault);
  return loose(opts.program).methods
    .deposit(toBaseUnits(opts.amountUsdc))
    .accounts({
      funder: opts.program.provider.publicKey,
      vault,
      vaultUsdcAta,
      funderUsdcAta: opts.funderUsdcAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/** Debit a capped, idempotent per-run fee to the treasury. The program
 *  provider must be the vault's `authority`. */
export async function debitFeeTx(opts: {
  program: Program<any>;
  agentId: Buffer;
  usdcMint: PublicKey;
  owner: PublicKey; // the vault owner (platform authority), for PDA derivation
  treasuryUsdcAta: PublicKey;
  amountUsdc: number;
  runId: string;
}): Promise<string> {
  const [vault] = getVaultPda(opts.owner, opts.agentId);
  const runIdBytes = runIdToBytes(opts.runId);
  const [feeRecord] = getFeeRecordPda(vault, runIdBytes);
  const vaultUsdcAta = await getVaultUsdcAta(opts.usdcMint, vault);
  const authority = opts.program.provider.publicKey!;
  return loose(opts.program).methods
    .debitFee(toBaseUnits(opts.amountUsdc), [...runIdBytes])
    .accounts({
      authority,
      vault,
      feeRecord,
      vaultUsdcAta,
      treasuryUsdcAta: opts.treasuryUsdcAta,
      payer: authority,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/** Withdraw USDC from the vault back to the owner (self-custody). The program
 *  provider must be the vault's `owner`. */
export async function withdrawTx(opts: {
  program: Program<any>;
  agentId: Buffer;
  usdcMint: PublicKey;
  owner: PublicKey; // the vault owner (== the withdraw signer), for PDA derivation
  ownerUsdcAta: PublicKey;
  amountUsdc: number;
}): Promise<string> {
  const [vault] = getVaultPda(opts.owner, opts.agentId);
  const vaultUsdcAta = await getVaultUsdcAta(opts.usdcMint, vault);
  return loose(opts.program).methods
    .withdraw(toBaseUnits(opts.amountUsdc))
    .accounts({
      owner: opts.program.provider.publicKey,
      vault,
      vaultUsdcAta,
      ownerUsdcAta: opts.ownerUsdcAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

/** Read the on-chain vault state (or null if not yet initialized). */
export async function fetchVault(program: Program<any>, owner: PublicKey, agentId: Buffer): Promise<any | null> {
  const [vault] = getVaultPda(owner, agentId);
  try {
    return await loose(program).account.vault.fetch(vault);
  } catch {
    return null;
  }
}
