/**
 * Server-side USDC transfers signed with an agent or treasury keypair.
 *
 * Used for prediction bet escrow + payout:
 *   - placeBet: agent wallet → treasury (stake locked)
 *   - settleBet (win): treasury → agent wallet (stake + winnings)
 *   - settleBet (loss): no transfer (treasury keeps stake)
 */

import {
  Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction, createTransferInstruction,
  getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getUsdcMint, getNetwork } from "@/lib/solana/network";
import { failoverConnection } from "@/lib/solana/failoverConnection";
import { rpcCandidates } from "@/lib/solana/rpc";
import { computeBudgetInstructions, estimatePriorityPrice, landTransaction } from "@/lib/solana/landTransaction";

// Single source of truth via lib/solana/network: QuickNode first, Helius as the backup (devnet uses the public endpoint).
const NETWORK = getNetwork();

const USDC_MINT = new PublicKey(getUsdcMint(NETWORK));
const USDC_DECIMALS = 6;

/** A connection that fails over per request (QuickNode, then Helius, then the public cluster) with a deadline on each. */
export function getRpcConnection() {
  return failoverConnection({ network: NETWORK });
}

/**
 * Load a signing key from any of the formats these secrets have been stored in: base64 (agent wallets), a JSON byte
 * array (Solana CLI) or base58 (Phantom export). Throws unless it is a full 64-byte keypair, so a 32-byte public key
 * pasted by mistake fails loudly instead of being half-parsed.
 */
export function loadKeypair(secret: string): Keypair {
  const text = secret.trim();
  if (text.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  const base64 = Buffer.from(text, "base64");
  if (base64.length === 64) return Keypair.fromSecretKey(base64);
  try {
    const base58 = bs58.decode(text);
    if (base58.length === 64) return Keypair.fromSecretKey(base58);
  } catch { /* not base58 */ }
  throw new Error("Secret is not a 64-byte keypair (base64, base58 or JSON array)");
}

/**
 * STRICT USDC balance: `0` only for a genuinely-missing token account
 * (TokenAccountNotFound), and `null` when the balance could NOT be read (RPC
 * timeout / 429 / socket drop). Callers that PERSIST this value — reconcile — MUST
 * treat null as "unknown" and skip the write: swallowing an RPC error to 0 would
 * zero a funded agent's escrow/NAV mirror and flip it to needs_funding.
 */
export async function getUsdcBalanceStrict(pubkey: string): Promise<number | null> {
  const conn = getRpcConnection();
  const owner = new PublicKey(pubkey);
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
    const account = await getAccount(conn, ata, "confirmed");
    return Number(account.amount) / Math.pow(10, USDC_DECIMALS);
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return 0; // account exists-check: real 0
    return null; // RPC/read error — UNKNOWN, do not treat as 0
  }
}

/** Lenient wrapper — 0 for both missing AND unreadable. Only for best-effort
 *  display/preflight callers that must not throw; NEVER for reconcile. */
export async function getUsdcBalance(pubkey: string): Promise<number> {
  return (await getUsdcBalanceStrict(pubkey)) ?? 0;
}

/**
 * USDC balance of a SPECIFIC token account, addressed by the ATA itself (not by
 * its owner). Unlike `getUsdcBalance` — which derives the owner's ATA and so
 * rejects an off-curve (PDA) owner — this reads the given account directly, so it
 * works for a program-owned ATA such as an agent-vault vault ATA. Returns 0 for a
 * missing account (never throws), matching `getUsdcBalance`.
 */
/** STRICT variant of {@link getUsdcBalanceForAta}: `0` for a missing account,
 *  `null` when the read failed (see getUsdcBalanceStrict). */
export async function getUsdcBalanceForAtaStrict(ata: string): Promise<number | null> {
  const conn = getRpcConnection();
  try {
    const account = await getAccount(conn, new PublicKey(ata), "confirmed");
    return Number(account.amount) / Math.pow(10, USDC_DECIMALS);
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) return 0;
    return null; // RPC/read error — UNKNOWN
  }
}

/** Lenient wrapper — 0 for both missing AND unreadable. NEVER for reconcile. */
export async function getUsdcBalanceForAta(ata: string): Promise<number> {
  return (await getUsdcBalanceForAtaStrict(ata)) ?? 0;
}

export async function getSolBalance(pubkey: string): Promise<number> {
  const conn = getRpcConnection();
  try {
    const lamports = await conn.getBalance(new PublicKey(pubkey), "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  } catch { return 0; }
}

/**
 * STRICT SOL balance: `null` when the balance could NOT be read (RPC timeout / 429 /
 * socket drop), so a caller can fail-OPEN on an unknown read instead of mistaking a
 * swallowed error for `0`. Mirrors {@link getUsdcBalanceStrict}. Used by the
 * settlement fee-payer health pre-flight, which must NOT strand payouts on a flaky
 * RPC (a false 0 would falsely page + skip a perfectly-funded signer).
 */
export async function getSolBalanceStrict(pubkey: string): Promise<number | null> {
  const conn = getRpcConnection();
  try {
    const lamports = await conn.getBalance(new PublicKey(pubkey), "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return null; // RPC/read error — UNKNOWN, fail-open
  }
}

/**
 * Verify whether a tx signature landed on-chain. Used by the settlement recovery
 * keeper to disambiguate a confirm-step failure (transferUsdc returned ok:false
 * WITH a txSignature — the USDC MAY have moved): if the signature actually landed
 * we mark the settlement paid; otherwise we re-transfer. NEVER re-transfer
 * without calling this first — that would risk a double transfer.
 *
 * Returns:
 *   "landed"   — confirmed/finalized on-chain with no error → settlement is paid
 *   "failed"   — the tx is known to the cluster but errored → safe to re-transfer
 *   "unknown"  — the cluster has no record (dropped/expired) → the keeper must
 *                additionally check the blockhash expiry (current tip vs the tx's
 *                lastValidBlockHeight) before re-transferring: only an expired
 *                blockhash proves the sig can never land. See
 *                `decideUnknownSettlement` in the recovery keeper.
 */
export async function getSignatureStatus(
  signature: string,
): Promise<"landed" | "failed" | "unknown"> {
  try {
    const conn = getRpcConnection();
    const res = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
    const status = res?.value;
    if (!status) return "unknown";
    if (status.err) return "failed";
    const conf = status.confirmationStatus;
    if (conf === "confirmed" || conf === "finalized") return "landed";
    // Seen by the cluster, no error yet, but not durably confirmed — treat as
    // unknown so the keeper retries verification on a later tick rather than
    // prematurely re-transferring.
    return "unknown";
  } catch {
    // RPC error: we cannot prove the tx failed, so DO NOT signal "failed" (which
    // would green-light a re-transfer). Unknown keeps the keeper conservative —
    // it will re-verify next tick.
    return "unknown";
  }
}

/** The current cluster block height (the live tip). Used by the recovery keeper
 *  to prove a confirm-ambiguous tx's blockhash has expired: if `currentHeight >
 *  lastValidBlockHeight`, that signature can NEVER land → safe to re-transfer.
 *  Returns null on any RPC error so the keeper stays conservative (treats the
 *  height as unknown → DEFERS rather than re-transferring on uncertainty). */
export async function getCurrentBlockHeight(): Promise<number | null> {
  try {
    return await getRpcConnection().getBlockHeight("confirmed");
  } catch {
    return null;
  }
}

/** True when the cluster itself refused the transaction, which proves it was never broadcast (as opposed to a timeout). */
export function isDefiniteRejection(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /simulation failed|Blockhash not found|insufficient funds|custom program error|invalid account|AccountNotFound|Attempt to debit/i.test(msg);
}

export interface TransferResult {
  ok: boolean;
  txSignature?: string;
  error?: string;
  step?: string;
  /** Present whenever a signature was broadcast (ok, or a confirm-step failure
   *  that kept the sig). It is the blockhash's last valid block height — once the
   *  cluster tip passes it, that signature can NEVER land, so the keeper can
   *  safely re-transfer a dropped tx. Sig-less pre-broadcast failures omit it. */
  lastValidBlockHeight?: number;
}

/**
 * Transfer USDC from `from` to `to`. `from` must be a wallet we control
 * (operator agent or platform treasury) — we pass its base64 secret.
 *
 * Creates the recipient's USDC ATA if missing (payer = `from`, ~$0.002).
 */
export async function transferUsdc(opts: {
  fromSecretBase64: string;
  fromPubkey: string;
  toPubkey: string;
  amountUsdc: number;
  /** Sponsored gas: when set, this platform wallet pays the SOL fee + any ATA
   *  rent and is the tx fee payer, so `from` (the agent) needs ZERO SOL. Both
   *  sign — the agent authorizes the USDC transfer, the fee payer covers gas. */
  feePayerSecretBase64?: string;
}): Promise<TransferResult> {
  const { fromSecretBase64, fromPubkey, toPubkey, amountUsdc } = opts;
  if (amountUsdc <= 0) return { ok: false, error: "amountUsdc must be positive", step: "validate" };

  let signer: Keypair;
  try {
    signer = loadKeypair(fromSecretBase64);
  } catch (e) {
    return { ok: false, error: `Invalid keypair: ${(e as Error).message.slice(0, 80)}`, step: "load-key" };
  }
  if (signer.publicKey.toBase58() !== fromPubkey) {
    return { ok: false, error: "Keypair / pubkey mismatch", step: "load-key" };
  }

  // Sponsored gas: the fee payer (a platform wallet) pays SOL + ATA rent.
  let feePayer: Keypair | null = null;
  if (opts.feePayerSecretBase64) {
    try { feePayer = loadKeypair(opts.feePayerSecretBase64); }
    catch (e) { return { ok: false, error: `Invalid fee-payer keypair: ${(e as Error).message.slice(0, 80)}`, step: "load-feepayer" }; }
  }

  const conn = getRpcConnection();
  const fromKey = signer.publicKey;
  const toKey = new PublicKey(toPubkey);
  const gasKey = feePayer ? feePayer.publicKey : fromKey; // who pays SOL + ATA rent

  // Everything the transfer needs from the chain is independent, so it is read at once: one round trip of waiting instead of
  // five in a row. (SOL for fees, whether the recipient's USDC account exists, the sender's USDC, a market priority fee and
  // a fresh blockhash.)
  const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromKey);
  const toAta = await getAssociatedTokenAddress(USDC_MINT, toKey);
  const units = 60_000;
  let tx: Transaction;
  try {
    const missing = <T,>(p: Promise<T>) => p.then((v) => v, (e: unknown) => (e instanceof TokenAccountNotFoundError ? null : Promise.reject(e)));
    const [solBalance, recipientAcc, senderAcc, priority, latest] = await Promise.all([
      conn.getBalance(gasKey, "confirmed"),
      missing(getAccount(conn, toAta, "confirmed")),
      missing(getAccount(conn, fromAta, "confirmed")),
      estimatePriorityPrice([fromAta.toBase58(), toAta.toBase58()], units),
      conn.getLatestBlockhash("confirmed"),
    ]);
    // The GAS PAYER (fee payer if sponsored, else the sender) needs SOL for fees.
    if (solBalance < 5000) { // ~5000 lamports min for tx fee
      return {
        ok: false,
        error: `${feePayer ? "Platform fee-payer" : "Wallet"} ${gasKey.toBase58().slice(0, 8)}… has insufficient SOL for fees (${(solBalance / 1e9).toFixed(6)}). Fund with ~0.01 SOL.`,
        step: "fees",
      };
    }
    // Make sure sender has the USDC
    if (!senderAcc) return { ok: false, error: `Sender ${fromPubkey.slice(0, 8)}… has no USDC token account`, step: "balance" };
    const have = Number(senderAcc.amount) / Math.pow(10, USDC_DECIMALS);
    if (have < amountUsdc) return { ok: false, error: `Insufficient USDC. Have $${have.toFixed(2)}, need $${amountUsdc.toFixed(2)}`, step: "balance" };

    tx = new Transaction();
    // Market-rate priority fee and a compute limit sized to a plain transfer (plus the optional ATA creation), so the
    // payment lands in seconds instead of waiting behind congestion.
    tx.add(...computeBudgetInstructions(units, priority));
    // ATA rent paid by the gas payer (fee payer if sponsored, else sender).
    if (!recipientAcc) tx.add(createAssociatedTokenAccountInstruction(gasKey, toAta, toKey, USDC_MINT));
    tx.add(createTransferInstruction(
      fromAta, toAta, fromKey,
      Math.floor(amountUsdc * Math.pow(10, USDC_DECIMALS)),
      [], TOKEN_PROGRAM_ID,
    ));

    const { blockhash, lastValidBlockHeight } = latest;
    tx.feePayer = gasKey;
    tx.recentBlockhash = blockhash;
    // Agent signs (transfer authority); fee payer also signs (gas + ATA rent).
    if (feePayer) tx.sign(signer, feePayer);
    else tx.sign(signer);

    // BROADCAST. After the first send the tx is on the wire and MAY land, so anything that follows must preserve `sig`
    // unless the blockhash has provably expired (then it can never land and a retry cannot double-pay). A failure of
    // sendRawTransaction itself throws BEFORE a sig is returned, so it is handled by the outer catch as a sig-less
    // pre-broadcast failure (no USDC moved).
    const raw = tx.serialize();
    // The signature is known before anything is sent (it is the signer's own signature), so even a send that times out or
    // loses its connection cannot lose track of the transaction: it may have reached a validator, so it is landed and polled
    // instead of being written off. Only an explicit rejection (simulation failed, blockhash gone) proves it never went out.
    const localSig = tx.signature ? bs58.encode(tx.signature) : "";
    let sig = localSig;
    try {
      sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
    } catch (e) {
      if (!localSig || isDefiniteRejection(e)) throw e;
      console.warn("[usdcTransfer] send was inconclusive, landing by signature:", (e as Error).message?.slice(0, 120));
    }
    // Keep re-sending the identical signed bytes to every RPC while polling, until it confirms or the blockhash expires.
    let landed: Awaited<ReturnType<typeof landTransaction>>;
    try {
      landed = await landTransaction({ raw, signature: sig, lastValidBlockHeight, urls: rpcCandidates(NETWORK), maxMs: 60_000 });
    } catch (e) {
      // It landed and reverted on-chain. It will never move USDC, but it IS a known signature: keep it (+ lvbh) so the
      // keeper verifies rather than blindly re-transferring.
      return { ok: false, error: `Tx failed on-chain: ${(e as Error).message.slice(0, 100)}`, step: "confirm", txSignature: sig, lastValidBlockHeight };
    }
    if (landed === "expired") {
      // The blockhash window passed and the signature is not on-chain: it can never land, so nothing moved. No sig is
      // returned, which marks this as a safe-to-retry pre-confirmation failure.
      return { ok: false, error: "The transfer did not land before its blockhash expired. Nothing was moved.", step: "send" };
    }
    if (landed === "pending") {
      // Still unproven either way: keep the sig + lvbh so the keeper can verify on-chain before ever re-transferring.
      return { ok: false, error: "Confirmation is still pending", step: "confirm-timeout", txSignature: sig, lastValidBlockHeight };
    }

    return { ok: true, txSignature: sig, lastValidBlockHeight };
  } catch (e) {
    // Pre-broadcast failure (ATA build, balance fetch, sendRawTransaction itself,
    // etc.): no signature was ever produced, so no USDC moved. Stays sig-less.
    return { ok: false, error: (e as Error).message.slice(0, 120), step: "send" };
  }
}
