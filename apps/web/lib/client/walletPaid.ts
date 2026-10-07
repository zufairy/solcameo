"use client";
import type { PublicKey, Transaction } from "@solana/web3.js";
import { sendUsdc } from "./usdcClient";

/**
 * Call a wallet-paid generation route: ask for the price (402), send that USDC from the user's wallet to the Solcameo
 * wallet the route names, then call again with the transfer signature. `pending` holds the signature of a transfer that
 * was sent but not yet applied, so a retry reuses it instead of paying twice; the caller clears it once the render starts.
 */
export async function payAndPost<T extends Record<string, unknown>>(args: {
  url: string;
  payload: Record<string, unknown>;
  publicKey: PublicKey | null;
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined;
  pending: { current: string | undefined };
}): Promise<T> {
  const { url, payload, publicKey, signTransaction, pending } = args;
  if (!publicKey || !signTransaction) throw new Error("Connect your wallet to pay for this video.");
  const call = async (paymentSignature?: string) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, payer: publicKey.toBase58(), ...(paymentSignature ? { paymentSignature } : {}) }) });
    return { res, data: (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; owedUsd?: number; treasury?: string } };
  };
  let { res, data } = await call(pending.current);
  if (res.status === 402 && data.code === "payment_required" && data.treasury && data.owedUsd) {
    const pay = await sendUsdc({ publicKey, signTransaction, toPubkey: data.treasury, amountUsdc: data.owedUsd, priorSignature: pending.current });
    if (!pay.ok) {
      // A transfer that was sent but not confirmed is kept, so the next try checks it instead of paying again.
      pending.current = pay.unconfirmed ? pay.signature : undefined;
      throw new Error(pay.unconfirmed ? `${pay.error} Try again to check it.` : pay.error);
    }
    pending.current = pay.signature;
    ({ res, data } = await call(pay.signature));
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
