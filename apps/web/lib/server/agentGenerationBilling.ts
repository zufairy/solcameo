import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { refreshAgentFunds } from "./agentWallet";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCharacterOwner } from "./characterAuth";
import { refundImage } from "./imageBilling";

/** Reserve the quoted service price atomically before calling a provider. */
export async function chargeAgentGeneration(mintAddress: string, runId: string, service: string, qty = 1) {
  try {
    await refreshAgentFunds(mintAddress);
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    return await convex.mutation(api.usage.recordUsage, {
      mintAddress, service, qty, walletOnly: true, idemKey: `${runId}:skill:${service}`,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
  } catch { return { ok: false as const, reason: "billing_unavailable" }; }
}

export async function beginAgentGeneration(req: NextRequest, mint: unknown, service: string, qty = 1) {
  const owner = await authorizeCharacterOwner(req, typeof mint === "string" ? mint : null);
  if (owner.error) return { error: owner.error };
  const runId = `generation:${randomUUID()}`;
  const charge = await chargeAgentGeneration(owner.mint, runId, service, qty);
  if (!charge.ok) return { error: NextResponse.json({
    error: charge.reason === "billing_unavailable" ? "Could not verify agent funds. Please retry." : "Deposit USDC to this agent wallet to generate.",
    code: charge.reason, mintAddress: owner.mint,
  }, { status: charge.reason === "billing_unavailable" ? 503 : 402 }) };
  return { error: undefined, refund: () => refundImage(owner.mint, runId) };
}
