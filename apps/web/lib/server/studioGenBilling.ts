import { ConvexHttpClient } from "convex/browser";
import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { requireAuth, getUserWallet, walletBelongsToUser, type AuthUser } from "./requireAuth";
import { dbcTreasury } from "./dbcTreasury";
import { verifyUsdcDeposit } from "@/lib/trader/verifyUsdcDeposit";
import { getUsdcMint } from "@/lib/solana/network";
import { STUDIO_IMAGE_USD, studioCostUsd } from "@/lib/studio/pricing";

const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";
const convex = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
/** The Solcameo wallet that collects studio payments: the platform wallet, else the DBC treasury (address, or derived from its key). */
export function studioTreasury(): string {
  for (const name of ["SOLCAMEO_PLATFORM_WALLET", "SOLCAMEO_DBC_TREASURY_WALLET"]) {
    const value = process.env[name]?.trim();
    if (value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return value;
  }
  try { return dbcTreasury().publicKey.toBase58(); } catch { return ""; }
}

/** The allowance belongs to the account's primary wallet; wallet-less (Google) accounts fall back to their user id. */
export const studioAccountKey = (user: AuthUser) => getUserWallet(user) ?? `user:${user.id}`;

export async function studioQuota(user: AuthUser) {
  return convex().query(api.studioGen.quota, { authSecret: secret(), account: studioAccountKey(user) });
}

export type StudioReserve = { error: NextResponse; refund?: never } | { error?: never; refund: () => Promise<void> };

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Cover `runIds` (one per image): free allowance when `useFree`, then refunded credits, then the on-chain
 * payment named by `paymentSignature` (a USDC transfer from the user's wallet to the Solcameo treasury).
 * Answers 402 `payment_required` with the exact amount when a payment is still owed.
 */
export async function reserveStudioImages(req: NextRequest, args: { runIds: string[]; useFree: boolean; fresh?: boolean; paymentSignature?: unknown; payer?: unknown }): Promise<StudioReserve> {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  const account = studioAccountKey(auth.user);
  const base = { authSecret: secret(), account, runIds: args.runIds, useFree: args.useFree, fresh: args.fresh, amountUsd: STUDIO_IMAGE_USD };
  const refund = async () => { await Promise.all(args.runIds.map(runId => convex().mutation(api.studioGen.refund, { authSecret: secret(), runId }).catch(() => undefined))); };
  try {
    let r = await convex().mutation(api.studioGen.reserve, base);
    if (!r.ok) {
      const owed = studioCostUsd(r.needPaid);
      const treasury = studioTreasury();
      if (!treasury) return { error: fail("Payments are not configured yet. Please try again later.", 503) };
      const signature = typeof args.paymentSignature === "string" ? args.paymentSignature.trim() : "";
      const payer = typeof args.payer === "string" ? args.payer : "";
      if (!signature) return { error: fail(`Pay $${owed.toFixed(2)} USDC from your wallet to generate.`, 402, { code: "payment_required", owedUsd: owed, images: r.needPaid, treasury }) };
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) return { error: fail("Invalid payment signature", 400) };
      if (!walletBelongsToUser(auth.user, payer)) return { error: fail("Pay from a wallet linked to your account.", 403) };
      let verified = false;
      for (let attempt = 0; attempt < 4 && !verified; attempt++) {
        try { await verifyUsdcDeposit({ txSignature: signature, escrowOwner: treasury, usdcMint: process.env.NEXT_PUBLIC_USDC_MINT || getUsdcMint(), minAmountUsdc: owed, expectedSender: payer }); verified = true; }
        catch (e) { if (attempt === 3) return { error: fail(e instanceof Error && /funded|credited/.test(e.message) ? "That payment does not match this generation." : "We could not confirm your payment on-chain yet. Retry in a moment, you will not be charged twice.", 402, { code: "payment_unconfirmed" }) }; await sleep(1200); }
      }
      r = await convex().mutation(api.studioGen.reserve, { ...base, txSignature: signature });
      if (!r.ok) return { error: fail("Payment could not be applied.", 402, { code: "payment_unconfirmed" }) };
    }
    return { refund };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (/already billed/i.test(message)) return { error: fail("This generation was already started.", 409, { code: "run_used" }) };
    if (/already processed/i.test(message)) return { error: fail("That payment was already used for another generation.", 409, { code: "payment_used" }) };
    return { error: fail("Billing is temporarily unavailable. Please try again.", 503, { code: "billing_unavailable" }) };
  }
}

export async function refundStudioRun(runId: string) {
  try { await convex().mutation(api.studioGen.refund, { authSecret: secret(), runId }); } catch { /* the ledger keeps the row; support can reconcile */ }
}
