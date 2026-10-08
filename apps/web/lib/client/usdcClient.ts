"use client";

import { useEffect, useState, useCallback } from "react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TokenAccountNotFoundError,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getUsdcMint, getNetwork } from "@/lib/solana/network";
import { rpcTry, rpcCandidates } from "@/lib/solana/rpc";
import { computeBudgetInstructions, estimatePriorityPrice, landTransaction } from "@/lib/solana/landTransaction";

// IMPORTANT — derive BOTH the RPC and the USDC mint from the SAME source
// (network.ts → NEXT_PUBLIC_SOLANA_NETWORK) so the transaction's blockhash
// cluster always matches the mint cluster. Using the wallet-adapter connection
// for the blockhash but network.ts for the mint can disagree and make Phantom
// report a "network mismatch" (mainnet tx on a devnet wallet).
const NETWORK = getNetwork();
const USDC_MINT = new PublicKey(getUsdcMint(NETWORK));
const USDC_DECIMALS = 6;
// Candidates (public devnet → Helius): the Helius key is suspended (403), so we
// never let a single endpoint wedge a read at "Reading…" forever.
const RPC_CANDIDATES = rpcCandidates(NETWORK);

/** SOL headroom for one escrow tx + a possible ATA rent (~0.002 SOL) + fees. */
export const SOL_GAS_FLOOR = 0.01;

export type FundingCheck = {
  ok: boolean;
  needUsdc: boolean;
  needSol: boolean;
  usdcShort: number;
  solShort: number;
};

/** Pure balance gate for the pre-flight review. Null balances count as 0. */
export function checkFunding(opts: {
  usdc: number | null;
  sol: number | null;
  budget: number;
  gasFloor?: number;
}): FundingCheck {
  const gasFloor = opts.gasFloor ?? SOL_GAS_FLOOR;
  const usdc = opts.usdc ?? 0;
  const sol = opts.sol ?? 0;
  const needUsdc = usdc < opts.budget;
  const needSol = sol < gasFloor;
  return {
    ok: !needUsdc && !needSol,
    needUsdc,
    needSol,
    usdcShort: needUsdc ? opts.budget - usdc : 0,
    solShort: needSol ? gasFloor - sol : 0,
  };
}

/** Live USDC balance of the connected wallet. Polls every 20s + refetch on demand. */
export function useWalletUsdc(): { usdc: number | null; refresh: () => Promise<number | null> } {
  // Privy-aware: after the Privy migration a Google login uses an embedded wallet
  // that never appears in wallet-adapter, so reading `useWallet()` here returned
  // null and the balance showed "—". The unified hook resolves the active Privy
  // (or external) wallet, matching what the rest of the app spends from.
  const { publicKey } = useUnifiedSolanaWallet();
  const [usdc, setUsdc] = useState<number | null>(null);

  const load = useCallback(async (): Promise<number | null> => {
    if (!publicKey) { setUsdc(null); return null; }
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey);
      const acc = await rpcTry(RPC_CANDIDATES, (conn) => getAccount(conn, ata, "confirmed"));
      const v = Number(acc.amount) / 10 ** USDC_DECIMALS;
      setUsdc(v);
      return v;
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) { setUsdc(0); return 0; }
      // keep last value on transient RPC errors
      return null;
    }
  }, [publicKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling hook; setState in a polled callback is intentional (mirrors useWalletSol)
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  return { usdc, refresh: load };
}

/** Live SOL balance of the connected wallet. Polls every 20s + refetch on demand. */
export function useWalletSol(): { sol: number | null; refresh: () => Promise<number | null> } {
  const { publicKey } = useUnifiedSolanaWallet();
  const [sol, setSol] = useState<number | null>(null);

  const load = useCallback(async (): Promise<number | null> => {
    if (!publicKey) { setSol(null); return null; }
    try {
      const lamports = await rpcTry(RPC_CANDIDATES, (conn) => conn.getBalance(publicKey, "confirmed"));
      const v = lamports / 1e9;
      setSol(v);
      return v;
    } catch { return null; /* keep last value on transient RPC errors */ }
  }, [publicKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling hook mirrors useWalletUsdc; setState in a polled callback is intentional
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  return { sol, refresh: load };
}

export type SendUsdcResult =
  | { ok: true; signature: string }
  // Broadcast but confirmation timed out — the transfer MAY have landed. Carries
  // the signature so a retry checks the ledger instead of double-sending.
  | { ok: false; unconfirmed: true; signature: string; error: string }
  | { ok: false; unconfirmed?: false; error: string };

/** Decide, from a prior signature's on-ledger status, whether that transfer
 *  already landed (so a retry must NOT re-send it). Found on the ledger without an
 *  err = landed. Missing (null) = never landed → safe to resend. Errored = failed
 *  → safe to resend. Kept pure for unit testing without an RPC. */
export function priorTransferLanded(status: { err: unknown; confirmationStatus?: string } | null | undefined): boolean {
  return !!status && !status.err;
}

/**
 * Transfer USDC from the connected wallet to `toPubkey`. The transaction is built
 * and broadcast on the app's configured network (network.ts), and signed by the
 * wallet adapter (Phantom etc.). Creates the recipient ATA if missing.
 *
 * Idempotency (double-pay guard): a confirmation timeout throws even when the
 * transfer landed, so a naive retry would send a SECOND real transfer. On a
 * timeout this returns `{ unconfirmed: true, signature }`; pass that `priorSignature`
 * back on retry and we first look it up on the ledger — if it landed we return it
 * instead of re-sending.
 */
export async function sendUsdc(opts: {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  toPubkey: string;
  amountUsdc: number;
  /** Signature from a prior `unconfirmed` attempt for this SAME payment. */
  priorSignature?: string;
}): Promise<SendUsdcResult> {
  const { publicKey, signTransaction, toPubkey, amountUsdc, priorSignature } = opts;
  if (amountUsdc <= 0) return { ok: false, error: "Amount must be positive." };

  let toKey: PublicKey;
  try {
    toKey = new PublicKey(toPubkey);
  } catch {
    return { ok: false, error: "Agent has no valid payout wallet." };
  }

  try {
    // Idempotency: a prior attempt for this payment timed out unconfirmed. Check
    // the ledger (incl. history) before re-sending — if it landed, return it and
    // NEVER send a second transfer.
    if (priorSignature) {
      try {
        const st = (await rpcTry(RPC_CANDIDATES, async (c) =>
          c.getSignatureStatuses([priorSignature], { searchTransactionHistory: true }),
        )).value[0];
        if (priorTransferLanded(st)) return { ok: true, signature: priorSignature };
      } catch {
        // Status lookup failed — fall through; the funds check below still guards
        // against sending money the wallet doesn't have.
      }
    }
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, toKey);

    // Confirm sender has enough USDC.
    try {
      const senderAcc = await rpcTry(RPC_CANDIDATES, async (c) => getAccount(c, fromAta, "confirmed"));
      const have = Number(senderAcc.amount) / 10 ** USDC_DECIMALS;
      if (have < amountUsdc) {
        return { ok: false, error: `Insufficient USDC. You have $${have.toFixed(2)}, need $${amountUsdc.toFixed(2)} (${NETWORK}).` };
      }
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) {
        return { ok: false, error: `Your wallet has no USDC on ${NETWORK}. Fund it (faucet.circle.com for devnet).` };
      }
      throw e;
    }

    const tx = new Transaction();
    let makesAccount = false;

    // Create recipient ATA if needed (sender pays the ~0.002 SOL rent).
    try {
      await rpcTry(RPC_CANDIDATES, async (c) => getAccount(c, toAta, "confirmed"));
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) {
        makesAccount = true;
        tx.add(createAssociatedTokenAccountInstruction(publicKey, toAta, toKey, USDC_MINT));
      }
    }

    // A compute limit sized to a plain transfer and a market-rate priority fee, so the payment lands in seconds.
    const units = makesAccount ? 70_000 : 40_000;
    const priority = await estimatePriorityPrice([fromAta.toBase58(), toAta.toBase58()], units);
    tx.instructions.unshift(...computeBudgetInstructions(units, priority));
    tx.add(createTransferInstruction(
      fromAta, toAta, publicKey,
      Math.floor(amountUsdc * 10 ** USDC_DECIMALS),
      [], TOKEN_PROGRAM_ID,
    ));

    const { blockhash, lastValidBlockHeight } = await rpcTry(RPC_CANDIDATES, async (c) => c.getLatestBlockhash("confirmed"));
    tx.feePayer = publicKey;
    tx.recentBlockhash = blockhash;

    const signed = await signTransaction(tx);
    const raw = signed.serialize();
    const sig = await rpcTry(RPC_CANDIDATES, async (c) => c.sendRawTransaction(raw, { maxRetries: 0 }));
    try {
      // Re-broadcast the same signed bytes to every RPC while polling every node at once, instead of waiting on one socket.
      const result = await landTransaction({ raw, signature: sig, lastValidBlockHeight, urls: RPC_CANDIDATES, maxMs: 40_000 });
      if (result === "confirmed") return { ok: true, signature: sig };
      if (result === "expired") return { ok: false, error: "The payment did not reach the network in time, so nothing was deducted. Please try again." };
      return { ok: false, unconfirmed: true, signature: sig, error: "Payment sent. Confirming it on-chain…" };
    } catch (confErr) {
      const message = confErr instanceof Error ? confErr.message : String(confErr);
      if (/failed on-chain/i.test(message)) return { ok: false, error: `Payment failed on-chain: ${message.slice(0, 100)}` };
      console.warn(`[sendUsdc] confirmation unresolved for ${sig}: ${message}`);
      return { ok: false, unconfirmed: true, signature: sig, error: "Payment sent. Confirming it on-chain…" };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/network mismatch|wrong network/i.test(msg)) {
      return { ok: false, error: `Switch Phantom to ${NETWORK === "mainnet-beta" ? "Mainnet" : "Devnet"} (Settings → Developer Settings) and retry.` };
    }
    if (/unexpected error/i.test(msg)) {
      return { ok: false, error: "Your wallet refused to sign. On devnet, set Phantom to Testnet Mode → Solana Devnet (or use Solflare) and retry." };
    }
    return { ok: false, error: msg.slice(0, 140) };
  }
}
