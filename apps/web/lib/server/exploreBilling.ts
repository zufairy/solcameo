import { refreshAgentFunds, settleSoon } from "./agentWallet";
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
 * and the agent wallet settles it on-chain to the Solcameo treasury, exactly like every other
 * metered service. Idempotent per runId, so a retry never charges twice.
 */
export async function chargeExploreRun(mint: string, runId: string, priceUsdc: number): Promise<ChargeResult> {
  const qty = Math.max(1, Math.round(priceUsdc * 100));
  try {
    await refreshAgentFunds(mint);
    const r = await convex().mutation(api.usage.recordUsage, { mintAddress: mint, service: SERVICE, qty, idemKey: `${runId}:skill:${SERVICE}`, walletOnly: true, authSecret: secret() });
    if (r.ok) settleSoon(mint);
    if (r.ok) return { ok: true, costUsdc: r.costUsdc, ...("duplicate" in r && r.duplicate ? { duplicate: true } : {}) };
    return { ok: false, reason: r.reason ?? "needs_funding" };
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }
}

/** Void the charge when Higgsfield rejects or fails the render. */
export async function refundExploreRun(mint: string, runId: string): Promise<void> {
  try { await convex().mutation(api.usage.refundRunFees, { mintAddress: mint, jobId: runId, authSecret: secret() }); } catch { /* the keeper reconciles stranded tabs */ }
}

export const CHARGE_MESSAGES: Record<string, string> = {
  needs_funding: "Not enough funds in this agent's wallet. Add USDC to the agent wallet and try again.",
  wallet_busy: "A withdrawal is settling for this agent. Try again shortly.",
  daily_cap: "This agent hit its daily spend cap. Raise the cap or try again tomorrow.",
  suspended: "This agent is suspended.",
  billing_unavailable: "Billing is temporarily unavailable. Please try again.",
};
