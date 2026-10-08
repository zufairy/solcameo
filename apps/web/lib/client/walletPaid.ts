"use client";
import { PublicKey, VersionedTransaction, type Transaction } from "@solana/web3.js";
import { failoverConnection } from "@/lib/solana/failoverConnection";
import { getNetwork } from "@/lib/solana/network";
import { fetchWalletBalances, sendAndLand } from "@/lib/solana/fundWallet";
import { sendUsdc } from "./usdcClient";

/** SOL the wallet keeps for the swap's network fee and the wrapped-SOL account, on top of the SOL the swap sells. */
const SWAP_SOL_HEADROOM = 0.004;
/** Jupiter's quote endpoint takes $0.50 and up. */
const MIN_SWAP_USD = 0.5;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reply<T> = T & { error?: string; code?: string; owedUsd?: number; treasury?: string };

/**
 * Pay for a wallet-paid generation, then start it. Ask for the price (402), pay the Solcameo wallet, and call again with the
 * transfer signature. The payment is USDC straight from your wallet; when your wallet holds SOL but not enough USDC, one
 * Jupiter swap pays the exact USDC amount to Solcameo in a single signature. Once a payment is on its way the start is
 * retried by itself with the same signature (the server proves the transfer on-chain and one payment buys one video), so a
 * slow confirmation or a hiccup in starting never asks you to pay again or to press anything. `pending` holds the signature of
 * a payment that was sent but not yet used; the caller clears it once the render has started.
 */
export async function payAndPost<T extends Record<string, unknown>>(args: {
  url: string;
  payload: Record<string, unknown>;
  publicKey: PublicKey | null;
  signTransaction: (<X extends Transaction | VersionedTransaction>(tx: X) => Promise<X>) | ((tx: Transaction) => Promise<Transaction>) | undefined;
  pending: { current: string | undefined };
  /** Plain-language progress for the screen: "Paying…", "Confirming on Solana…", "Starting your video…". */
  onStatus?: (note: string) => void;
  /** Called when the visitor has to sign in or connect a wallet first, so the caller can open its login popup. */
  onAuthNeeded?: () => void;
}): Promise<T> {
  const { url, payload, publicKey, signTransaction, pending, onStatus, onAuthNeeded } = args;
  if (!publicKey || !signTransaction) { onAuthNeeded?.(); throw new Error("Sign in or connect a wallet to pay, then press Generate again."); }
  const say = (note: string) => onStatus?.(note);
  // A payment waiting to be used is remembered as the plain signature (USDC) or "swap:<signature>" (bought via Jupiter).
  const sigOf = (v?: string) => v?.replace(/^swap:/, "");
  const call = async (stored?: string) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, payer: publicKey.toBase58(), ...(stored ? { paymentSignature: sigOf(stored), payMethod: stored.startsWith("swap:") ? "swap" : "usdc" } : {}) }) });
    return { res, data: (await res.json().catch(() => ({}))) as Reply<T> };
  };

  say("Checking the price…");
  let { res, data } = await call(pending.current);
  if (res.status === 401) { onAuthNeeded?.(); throw new Error("Your session expired. Sign in again, then press Generate."); }
  if (res.status === 402 && data.code === "payment_required" && data.treasury && data.owedUsd) {
    const owed = data.owedUsd;
    const connection = failoverConnection({ network: getNetwork() });
    const mine = await fetchWalletBalances(connection, publicKey).catch(() => null);
    if (mine && mine.usdc + 1e-6 < owed && mine.sol > SWAP_SOL_HEADROOM && owed >= MIN_SWAP_USD) {
      // Not enough USDC but there is SOL: one Jupiter swap that lands the exact USDC in the Solcameo wallet.
      say("Swapping SOL to USDC with Jupiter…");
      const built = await fetch("/api/agents/fund-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "build", usdc: owed, payer: publicKey.toBase58(), agentWallet: data.treasury }) });
      const swap = (await built.json().catch(() => ({}))) as { transaction?: string; lastValidBlockHeight?: number; summary?: { maxSol: number }; error?: string };
      if (!built.ok || !swap.transaction || !swap.lastValidBlockHeight) throw new Error(swap.error ?? "Could not prepare the swap. Try again in a moment.");
      if (swap.summary && mine.sol < swap.summary.maxSol + SWAP_SOL_HEADROOM) throw new Error(`This needs about ${(swap.summary.maxSol + SWAP_SOL_HEADROOM).toFixed(4)} SOL (the swap plus network fees) and your wallet has ${mine.sol.toFixed(4)} SOL. Add some SOL or USDC and try again.`);
      say("Approve in your wallet…");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swap.transaction), (c) => c.charCodeAt(0)));
      const signed = await (signTransaction as unknown as (t: VersionedTransaction) => Promise<VersionedTransaction>)(tx);
      say("Confirming on Solana…");
      const landed = await sendAndLand(signed, swap.lastValidBlockHeight);
      if (landed.result === "expired") throw new Error("The swap did not land in time, so nothing was swapped or charged. Please try again.");
      pending.current = `swap:${landed.signature}`;
    } else {
      say("Approve in your wallet…");
      const pay = await sendUsdc({ publicKey, signTransaction: signTransaction as (tx: Transaction) => Promise<Transaction>, toPubkey: data.treasury, amountUsdc: owed, priorSignature: sigOf(pending.current) });
      if (!pay.ok && !pay.unconfirmed) { pending.current = undefined; throw new Error(pay.error); }
      // Sent but not yet seen as confirmed: keep going. The server checks the transfer on-chain itself, so there is nothing to retry by hand.
      pending.current = pay.signature;
    }
    say("Confirming on Solana…");
    ({ res, data } = await call(pending.current));
  }

  // The payment is made. Retry the start by itself while the answer is "not yet" (confirmation still settling, or a
  // transient hiccup starting the render); the same signature can only ever buy one video.
  const transient = (r: Response, d: Reply<T>) => r.status === 402 && (d.code === "payment_unconfirmed" || d.code === "payment_pending" || /could not confirm/i.test(d.error ?? "")) || r.status === 502 || r.status === 503 || r.status === 504;
  for (let attempt = 0; attempt < 8 && !res.ok && pending.current && transient(res, data); attempt++) {
    say(res.status === 402 ? "Confirming on Solana…" : "Starting your video…");
    await wait(Math.min(1200 + attempt * 700, 4500));
    ({ res, data } = await call(pending.current));
  }
  if (!res.ok) {
    if (pending.current && transient(res, data)) throw new Error("Your payment went through and is safe. The video is taking a moment to start: press Generate again and it will continue without charging you again.");
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  say("Starting your video…");
  return data;
}
