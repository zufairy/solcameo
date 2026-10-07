import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { refreshAgentFunds } from "./agentWallet";
import { payOrBatch } from "./generationPayment";
import { topUpAgentFromSol } from "./solSwap";
import { priceFor } from "@/lib/economy/servicePrices";
import { holderDiscountForMint } from "./holderTier";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCharacterOwner } from "./characterAuth";
import { refundImage } from "./imageBilling";

/** Reserve the quoted service price atomically before calling a provider. */
export async function chargeAgentGeneration(mintAddress: string, runId: string, service: string, qty = 1) {
  try {
    await refreshAgentFunds(mintAddress);
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const book = async () => convex.mutation(api.usage.recordUsage, {
      mintAddress, service, qty, walletOnly: true, idemKey: `${runId}:skill:${service}`, holderDiscountPct: await holderDiscountForMint(mintAddress),
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    let charged = await book();
    // Short on USDC but holding SOL: swap just the shortfall at the live best price, then charge as normal.
    if (!charged.ok && charged.reason === "needs_funding") {
      let estimate = 0;
      try { estimate = priceFor(service, qty) * 1.15; } catch { /* an unpriced service cannot be topped up */ }
      if (estimate > 0 && (await topUpAgentFromSol(mintAddress, estimate)).ok) { await refreshAgentFunds(mintAddress); charged = await book(); }
    }
    if (!charged.ok) return charged;
    if (!("paymentConfirmed" in charged && charged.paymentConfirmed)) {
      const paid = await payOrBatch(mintAddress, charged.costUsdc);
      if (!paid.ok) { await refundImage(mintAddress, runId); return { ok: false as const, reason: "payment_failed" }; }
    }
    return charged;
  } catch { return { ok: false as const, reason: "billing_unavailable" }; }
}

export async function beginAgentGeneration(req: NextRequest, mint: unknown, service: string, qty = 1) {
  const owner = await authorizeCharacterOwner(req, typeof mint === "string" ? mint : null);
  if (owner.error) return { error: owner.error };
  const runId = `generation:${randomUUID()}`;
  const charge = await chargeAgentGeneration(owner.mint, runId, service, qty);
  if (!charge.ok) return { error: NextResponse.json({
    error: charge.reason === "billing_unavailable" ? "Could not verify agent funds. Please retry."
      : charge.reason === "payment_failed" ? "The on-chain payment did not confirm, so nothing was generated or charged. Please try again."
      : "Deposit USDC or SOL to this agent wallet to generate.",
    code: charge.reason, mintAddress: owner.mint,
  }, { status: charge.reason === "billing_unavailable" || charge.reason === "payment_failed" ? 503 : 402 }) };
  return { error: undefined, refund: () => refundImage(owner.mint, runId) };
}
