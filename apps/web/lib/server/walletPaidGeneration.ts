import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getUserWallet, requireAuth, walletBelongsToUser, type AuthUser } from "./requireAuth";
import { studioTreasury } from "./studioGenBilling";
import { waitForUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { getUsdcMint } from "@/lib/solana/network";

/**
 * Generations the viewer pays for from their own wallet, with no agent wallet involved: used when someone makes a video
 * with an influencer they do not own, or with none at all. The first call answers 402 with the exact price and the Solcameo
 * wallet to pay; the client sends that USDC and calls again with the transfer signature. Here the transfer is proven (it
 * reached the Solcameo wallet, from this user, for at least the price) and claimed, so one payment buys one generation.
 */
export const walletFail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
export const roundUsd = (n: number) => Math.round(n * 100) / 100;

export type WalletPayment = {
  user: AuthUser; account: string; payer: string; signature: string;
  convex: ConvexHttpClient; secret: string;
  /** What the claimed payment already started: a render task or a provider job (so a repeat call can return it). */
  claim: { kind: "fresh" | "existing"; taskId: string | null; requestId: string | null };
};

export async function requireWalletPayment(req: NextRequest, args: { owed: number; signature: unknown; payer: unknown }): Promise<{ error: NextResponse } | WalletPayment> {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  const treasury = studioTreasury();
  if (!treasury) return { error: walletFail("Payments are not configured yet. Please try again later.", 503) };
  const signature = typeof args.signature === "string" ? args.signature.trim() : "";
  if (!signature) return { error: walletFail(`Pay $${args.owed.toFixed(2)} USDC from your wallet to generate.`, 402, { code: "payment_required", owedUsd: args.owed, treasury }) };
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) return { error: walletFail("Invalid payment signature", 400) };
  const payer = typeof args.payer === "string" ? args.payer : "";
  if (!walletBelongsToUser(auth.user, payer)) return { error: walletFail("Pay from a wallet linked to your account.", 403) };

  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!url || !secret) return { error: walletFail("Generation is not configured.", 503) };
  const convex = new ConvexHttpClient(url);
  const account = getUserWallet(auth.user) ?? `user:${auth.user.id}`;

  try { await waitForUsdcDeposit({ txSignature: signature, escrowOwner: treasury, usdcMint: process.env.NEXT_PUBLIC_USDC_MINT || getUsdcMint(), minAmountUsdc: args.owed, expectedSender: payer }); }
  catch (e) { return { error: walletFail(e instanceof Error && /funded|credited/.test(e.message) ? "That payment does not match this video." : "We could not confirm your payment yet. Try again in a moment.", 402, { code: "payment_unconfirmed" }) }; }
  try {
    const claim = await convex.mutation(api.describeVideo.claim, { authSecret: secret, account, txSignature: signature, amountUsd: args.owed });
    return { user: auth.user, account, payer, signature, convex, secret, claim };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/payment_used|already processed/i.test(message)) return { error: walletFail("That payment was already used for another video.", 409, { code: "payment_used" }) };
    return { error: walletFail("Billing is temporarily unavailable. Please try again.", 503, { code: "billing_unavailable" }) };
  }
}

/** A public influencer's portrait, for making a video with someone you do not own. Null when there is none to use. */
export async function publicPortrait(mint: string): Promise<{ name: string; imageUrl: string } | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url || !mint) return null;
  const agent = await new ConvexHttpClient(url).query(api.influencers.getByMint, { mintAddress: mint }).catch(() => null);
  if (!agent) return null;
  // The influencer's minted still first (a still face is what the engine can read), else its profile picture as a still frame.
  const stills = (await import("./identityStill")).identityStills;
  const best = agent.avatarStills?.find((u: string) => /^https:\/\//.test(u) && !/\.gif(\?|#|$)/i.test(u)) ?? (agent.avatarUrl && /^https:\/\//.test(agent.avatarUrl) ? (await stills([agent.avatarUrl], agent))[0] : "");
  return best ? { name: agent.name, imageUrl: best } : null;
}
