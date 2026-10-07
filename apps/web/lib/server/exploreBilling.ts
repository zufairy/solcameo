import { refreshAgentFunds } from "./agentWallet";
import { payOrBatch } from "./generationPayment";
import { topUpAgentFromSol } from "./solSwap";
import { holderDiscountForMint } from "./holderTier";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { estimateGenerationUsd, type GenjutsuResolution } from "@/lib/explore/generationPrice";

const SERVICE = "explore_video";
const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";
const convex = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const priceUsd = (durationSec: number, resolution: GenjutsuResolution) => estimateGenerationUsd(durationSec, resolution);

export type ChargeResult = { ok: true; costUsdc: number; duplicate?: boolean } | { ok: false; reason: string };

/**
 * Charge the agent for one render. The cost lands on the agent's tab (or its owner's credits)
 * and the agent wallet pays it on-chain to the generation collection wallet before the render starts. Idempotent per runId, so a retry never charges twice.
 */
export async function chargeExploreRun(mint: string, runId: string, priceUsdc: number): Promise<ChargeResult> {
  const qty = Math.max(1, Math.ceil(priceUsdc * 1000 - 1e-9));
  try {
    await refreshAgentFunds(mint);
    const book = async () => convex().mutation(api.usage.recordUsage, { mintAddress: mint, service: SERVICE, qty, idemKey: `${runId}:skill:${SERVICE}`, walletOnly: true, holderDiscountPct: await holderDiscountForMint(mint), authSecret: secret() });
    let r = await book();
    // Short on USDC but holding SOL: swap just the shortfall at the live best price, then charge as normal.
    if (!r.ok && r.reason === "needs_funding" && (await topUpAgentFromSol(mint, priceUsdc * 1.15)).ok) { await refreshAgentFunds(mint); r = await book(); }
    if (!r.ok) return { ok: false, reason: r.reason ?? "needs_funding" };
    const duplicate = "duplicate" in r && r.duplicate;
    // Pay first: the USDC reaches the generation wallet on-chain before any provider is called. A retry of a run that
    // was already booked has already paid, so it is not charged again.
    if (!duplicate) {
      const paid = await payOrBatch(mint, r.costUsdc);
      if (!paid.ok) { console.error(`[exploreBilling] on-chain payment failed for ${mint}: ${paid.reason}`); await refundExploreRun(mint, runId); return { ok: false, reason: paid.reason === "wallet_signing_unavailable" ? "wallet_signing_unavailable" : "payment_failed" }; }
    }
    return { ok: true, costUsdc: r.costUsdc, ...(duplicate ? { duplicate: true } : {}) };
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }
}

/** Void the charge when Higgsfield rejects or fails the render. */
export async function refundExploreRun(mint: string, runId: string): Promise<void> {
  try { await convex().mutation(api.usage.refundRunFees, { mintAddress: mint, jobId: runId, authSecret: secret() }); } catch { /* the keeper reconciles stranded tabs */ }
}

export const CHARGE_MESSAGES: Record<string, string> = {
  needs_funding: "Not enough funds in this agent's wallet. Add USDC (or SOL, which is swapped to USDC for you) and try again.",
  wallet_busy: "A withdrawal is settling for this agent. Try again shortly.",
  daily_cap: "This agent hit its daily spend cap. Raise the cap or try again tomorrow.",
  suspended: "This agent is suspended.",
  billing_unavailable: "Billing is temporarily unavailable. Please try again.",
  wallet_signing_unavailable: "This agent wallet cannot sign its payment because the server wallet encryption key does not match. The operator must restore the original encryption key before generation can continue.",
  payment_failed: "The on-chain payment from this agent wallet did not confirm, so nothing was generated or charged. Please try again.",
};
