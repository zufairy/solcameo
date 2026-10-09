"use client";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { failoverConnection } from "@/lib/solana/failoverConnection";
import { getNetwork } from "@/lib/solana/network";
import { fetchWalletBalances, sendAndLand } from "@/lib/solana/fundWallet";

/** SOL kept for the swap's network fee and the wrapped-SOL account, on top of the SOL the swap sells. */
export const SWAP_SOL_HEADROOM = 0.004;
/** Jupiter's quote endpoint takes $0.50 and up. */
export const MIN_SOL_FUND_USD = 0.5;

type Swap = { transaction?: string; lastValidBlockHeight?: number; summary?: { maxSol: number }; error?: string };

/** What paying `usdc` from SOL would cost at most, or null when it cannot be quoted. */
export async function quoteSolFund(usdc: number): Promise<{ maxSol: number } | null> {
  try {
    const res = await fetch("/api/agents/fund-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", usdc }) });
    const data = (await res.json()) as { maxSol?: number };
    return res.ok && typeof data.maxSol === "number" ? { maxSol: data.maxSol } : null;
  } catch { return null; }
}

/**
 * Fund an agent wallet from a wallet that only holds SOL: one Jupiter swap that sells SOL and lands the exact USDC straight in the
 * agent wallet, in a single wallet approval. Sent and confirmed through our own RPC (QuickNode first), so nothing waits on the
 * wallet's own connection. Throws a plain-language message on anything that stops it before it is sent.
 */
export async function fundAgentWithSol(args: {
  publicKey: PublicKey;
  signTransaction: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  agentWallet: string;
  usdc: number;
  onStatus?: (note: string) => void;
}): Promise<{ signature: string; result: "confirmed" | "expired" | "pending" }> {
  const { publicKey, signTransaction, agentWallet, usdc, onStatus } = args;
  if (getNetwork() !== "mainnet-beta") throw new Error("Paying with SOL is only available on mainnet.");
  if (usdc < MIN_SOL_FUND_USD) throw new Error(`Paying with SOL starts at $${MIN_SOL_FUND_USD.toFixed(2)}. Enter at least that, or use USDC.`);
  onStatus?.("Pricing the swap…");
  const mine = await fetchWalletBalances(failoverConnection({ network: "mainnet-beta" }), publicKey).catch(() => null);
  if (mine && mine.sol <= SWAP_SOL_HEADROOM) throw new Error("Your wallet needs a little more SOL to cover the swap and network fees.");
  const built = await fetch("/api/agents/fund-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "build", usdc, payer: publicKey.toBase58(), agentWallet }) });
  const swap = (await built.json().catch(() => ({}))) as Swap;
  if (!built.ok || !swap.transaction || !swap.lastValidBlockHeight) throw new Error(swap.error ?? "Could not prepare the swap. Try again in a moment.");
  if (mine && swap.summary && mine.sol < swap.summary.maxSol + SWAP_SOL_HEADROOM) {
    throw new Error(`This needs about ${(swap.summary.maxSol + SWAP_SOL_HEADROOM).toFixed(4)} SOL (the swap plus network fees) and your wallet has ${mine.sol.toFixed(4)} SOL. Add some SOL or lower the amount.`);
  }
  onStatus?.("Approve in your wallet…");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swap.transaction), (c) => c.charCodeAt(0)));
  const signed = await signTransaction(tx);
  onStatus?.("Confirming on Solana…");
  return sendAndLand(signed, swap.lastValidBlockHeight);
}
