import type { MutationCtx } from "../_generated/server";

/**
 * Replay protection primitive (JOB-85).
 *
 * Consumes an on-chain payment proof (`txSignature`) exactly once across the
 * entire system. Call this INSIDE the same mutation transaction that credits a
 * balance / mints / invests / tops-up a budget, BEFORE applying the credit:
 *
 *   await consumeSignature(ctx, { txSignature, purpose: "invest", ref: mint, amount });
 *   // ...apply the credit...
 *
 * If the signature was already consumed (by this or any other path) it throws
 * `Transaction already processed` and the whole mutation rolls back, so a
 * replayed proof can never double-credit.
 *
 * Race safety: Convex mutations are serializable. Two concurrent attempts to
 * consume the same signature conflict on the optimistic-concurrency check; one
 * commits, the other retries and then observes the existing row and throws.
 */
export async function consumeSignature(
  ctx: MutationCtx,
  args: {
    txSignature: string;
    purpose: string;
    ref?: string;
    amount?: number;
  },
): Promise<void> {
  const sig = args.txSignature?.trim();
  if (!sig) throw new Error("Missing txSignature");

  const existing = await ctx.db
    .query("processedSignatures")
    .withIndex("by_signature", (q) => q.eq("txSignature", sig))
    .first();
  if (existing) {
    throw new Error("Transaction already processed");
  }

  await ctx.db.insert("processedSignatures", {
    txSignature: sig,
    purpose: args.purpose,
    ref: args.ref,
    amount: args.amount,
    consumedAt: Date.now(),
  });
}
