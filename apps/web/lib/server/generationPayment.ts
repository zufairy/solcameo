import { settleAgentEconomics } from "@/lib/economy/settleAgent";

export type PaymentResult = { ok: true; txSignature: string } | { ok: false; reason: string };

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
    if (result.status === "settled") return { ok: true, txSignature: result.txSignature };
    return { ok: false, reason: "reason" in result ? result.reason : "payment_not_settled" };
  } finally {
    if (queues.get(mintAddress) === run) queues.delete(mintAddress);
  }
}
