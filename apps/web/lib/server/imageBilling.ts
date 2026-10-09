import { refreshAgentFunds } from "./agentWallet";
import { payForCharge } from "./generationPayment";
import { topUpAgentFromSol } from "./solSwap";
import { holderDiscountForMint } from "./holderTier";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { imageRetailPriceUsd, type ImageEngine } from "@/lib/builder/imageEngines";

const SERVICE = "gen_image";
const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";
const convex = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const imagePriceUsd = (engine: Pick<ImageEngine, "pricePerImageUsdc">) => imageRetailPriceUsd(engine);

export type ImageCharge = { ok: true; costUsdc: number } | { ok: false; reason: string };

/** Charge one image to the agent: provider price plus 15%, paid on-chain to the generation collection wallet before the image is made. */
export async function chargeImage(mint: string, runId: string, engine: Pick<ImageEngine, "pricePerImageUsdc">): Promise<ImageCharge> {
  const qty = Math.max(1, Math.round(imagePriceUsd(engine) * 1000));
  try {
    await refreshAgentFunds(mint);
    const book = async () => convex().mutation(api.usage.recordUsage, { mintAddress: mint, service: SERVICE, qty, idemKey: `${runId}:skill:${SERVICE}`, walletOnly: true, requireTransfer: true, holderDiscountPct: await holderDiscountForMint(mint), authSecret: secret() });
    let r = await book();
    if (!r.ok && r.reason === "needs_funding" && (await topUpAgentFromSol(mint, imagePriceUsd(engine) * 1.15)).ok) { await refreshAgentFunds(mint); r = await book(); }
    if (!r.ok) return { ok: false, reason: r.reason ?? "needs_funding" };
    if (!("paymentConfirmed" in r && r.paymentConfirmed)) {
      const paid = await payForCharge(mint, { requireTransfer: true });
      if (!paid.ok) { await refundImage(mint, runId); return { ok: false, reason: "payment_failed" }; }
    }
    return { ok: true, costUsdc: r.costUsdc };
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }
}

export async function refundImage(mint: string, runId: string): Promise<void> {
  try { await convex().mutation(api.usage.refundRunFees, { mintAddress: mint, jobId: runId, authSecret: secret() }); } catch { /* the keeper reconciles stranded tabs */ }
}
