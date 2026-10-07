import { after } from "next/server";
import { settleAgentEconomics } from "@/lib/economy/settleAgent";

export type PaymentResult = { ok: true; credited: true } | { ok: true; txSignature: string } | { ok: false; reason: string };

/** One settlement at a time per agent, so two quick generations never both try to sweep the same tab. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Pay for a charge that was just booked: move the agent's tab from its wallet to the generation collection wallet on
 * Solana and wait for confirmation. Generation only starts when this says ok; otherwise the caller refunds the charge.
 */
export async function payForCharge(mintAddress: string): Promise<PaymentResult> {
  const previous = queues.get(mintAddress) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => settleAgentEconomics(mintAddress, { immediate: true }));
  queues.set(mintAddress, run);
  try {
    const result = await run;
    if (result.status === "credited") return { ok: true, credited: true };
    if (result.status === "settled") return { ok: true, txSignature: result.txSignature };
    return { ok: false, reason: "reason" in result ? result.reason : "payment_not_settled" };
  } finally {
    if (queues.get(mintAddress) === run) queues.delete(mintAddress);
  }
}

/** Charges at or above this are paid on-chain before the work starts. Below it the network fee would eat the charge. */
export const PAY_FIRST_MIN_USDC = Number(process.env.AGENT_PAY_FIRST_MIN_USDC ?? 0.02);
/** Small charges pile up on the agent's tab and are paid in one transfer once the tab reaches this. */
export const BATCH_SETTLE_USDC = Number(process.env.AGENT_BATCH_SETTLE_USDC ?? 0.25);

/**
 * Pay for a charge that was just booked. Videos, images and other real spend pay on-chain first, strictly. A tiny
 * charge (a text generation costs a third of a cent against a network fee of about a tenth of one) is left on the
 * agent's tab, which already counts against its spendable USDC so it cannot be overspent, and is swept in one
 * transfer once the tab reaches BATCH_SETTLE_USDC. Any later pay-first charge also sweeps the whole tab.
 */
export async function payOrBatch(mintAddress: string, costUsdc: number): Promise<PaymentResult | { ok: true; batched: true }> {
  if (costUsdc >= PAY_FIRST_MIN_USDC) return payForCharge(mintAddress);
  const sweep = async () => { await settleAgentEconomics(mintAddress, { threshold: BATCH_SETTLE_USDC }).catch(() => undefined); };
  try { after(sweep); } catch { void sweep(); }
  return { ok: true, batched: true };
}
