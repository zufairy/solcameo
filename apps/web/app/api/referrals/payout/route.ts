import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { getCurrentBlockHeight, getSignatureStatus, getUsdcBalanceStrict, loadKeypair, transferUsdc } from "@/lib/trader/usdcTransfer";
import { feePayerReady } from "@/lib/server/solSwap";
import { PAYOUT_MIN_USDC } from "@/lib/referrals/program";

export const runtime = "nodejs";
export const maxDuration = 60;

type Outcome = { wallet: string; result: "paid" | "pending" | "failed" | "skipped"; usdc?: number; sig?: string; reason?: string };

/**
 * Pays referral earnings out, on-chain, in USDC. Driven by a cron every few hours (internal secret only). For every referrer whose
 * pending earnings reached the minimum: lease the earnings, send one USDC transfer from the payout wallet, wait for it to confirm, and only
 * then mark the earnings paid with the transaction signature. A transfer that is not yet confirmed is verified on later runs and is
 * never sent twice; one that provably never landed (its blockhash has expired) is released and retried.
 * Source wallet: REFERRAL_PAYOUT_SECRET, else the platform revenue wallet. Network fees come from the shared fee payer when it has SOL.
 */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL, authSecret = process.env.INTERNAL_CRON_SECRET ?? "";
  const source = (process.env.REFERRAL_PAYOUT_SECRET ?? process.env.TREASURY_WALLET_SECRET ?? "").trim();
  if (!url || !authSecret) return NextResponse.json({ error: "not configured" }, { status: 500 });
  if (!source) return NextResponse.json({ ok: false, error: "No payout wallet configured. Set REFERRAL_PAYOUT_SECRET." }, { status: 503 });
  const convex = new ConvexHttpClient(url);
  const from = loadKeypair(source).publicKey.toBase58();
  const sponsor = (await feePayerReady()) ? process.env.PLATFORM_FEE_PAYER_SECRET?.trim() : undefined;
  const outcomes: Outcome[] = [];
  const wallets = await convex.query(api.referrals.payoutWork, { minUsdc: PAYOUT_MIN_USDC, authSecret });
  const deadline = Date.now() + 45_000;

  for (const wallet of wallets) {
    if (Date.now() > deadline) break;
    try {
      const lease = await convex.mutation(api.referrals.beginPayout, { referrerWallet: wallet, minUsdc: PAYOUT_MIN_USDC, authSecret });
      if (lease.kind === "none") { outcomes.push({ wallet, result: "skipped", reason: "below the minimum" }); continue; }

      if (lease.kind === "resume") {
        // An earlier run left a payout unfinished: look at the chain before doing anything else.
        if (lease.sig) {
          const status = await getSignatureStatus(lease.sig);
          if (status === "landed") { await convex.mutation(api.referrals.finishPayout, { id: lease.id, sig: lease.sig, authSecret }); outcomes.push({ wallet, result: "paid", usdc: lease.usdc, sig: lease.sig }); continue; }
          const height = await getCurrentBlockHeight();
          const expired = status === "failed" || (lease.lastValidBlockHeight !== null && height !== null && height > lease.lastValidBlockHeight);
          if (!expired) { outcomes.push({ wallet, result: "pending", usdc: lease.usdc, sig: lease.sig, reason: "waiting for confirmation" }); continue; }
          await convex.mutation(api.referrals.failPayout, { id: lease.id, error: "transfer never landed; released for retry", authSecret });
        } else if (lease.ageMs < 10 * 60_000) { outcomes.push({ wallet, result: "pending", usdc: lease.usdc, reason: "another run is sending it" }); continue; }
        else await convex.mutation(api.referrals.failPayout, { id: lease.id, error: "no signature after 10 minutes; released for retry", authSecret });
        outcomes.push({ wallet, result: "skipped", reason: "released; retried next run" });
        continue;
      }

      const balance = await getUsdcBalanceStrict(from);
      if (balance === null || balance < lease.usdc) {
        await convex.mutation(api.referrals.failPayout, { id: lease.id, error: "payout wallet has too little USDC", authSecret });
        outcomes.push({ wallet, result: "skipped", usdc: lease.usdc, reason: `payout wallet ${from.slice(0, 4)}… needs USDC` });
        continue;
      }
      const sent = await transferUsdc({ fromSecretBase64: source, fromPubkey: from, toPubkey: wallet, amountUsdc: lease.usdc, ...(sponsor ? { feePayerSecretBase64: sponsor } : {}) });
      if (sent.txSignature) await convex.mutation(api.referrals.recordPayoutSig, { id: lease.id, sig: sent.txSignature, ...(sent.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: sent.lastValidBlockHeight } : {}), authSecret });
      if (sent.ok && sent.txSignature) {
        await convex.mutation(api.referrals.finishPayout, { id: lease.id, sig: sent.txSignature, authSecret });
        outcomes.push({ wallet, result: "paid", usdc: lease.usdc, sig: sent.txSignature });
      } else if (sent.txSignature) {
        outcomes.push({ wallet, result: "pending", usdc: lease.usdc, sig: sent.txSignature, reason: "sent, confirming" });
      } else {
        await convex.mutation(api.referrals.failPayout, { id: lease.id, error: sent.error ?? "transfer failed before sending", authSecret });
        outcomes.push({ wallet, result: "failed", usdc: lease.usdc, reason: sent.error });
      }
    } catch (e) {
      outcomes.push({ wallet, result: "failed", reason: e instanceof Error ? e.message.slice(0, 160) : "error" });
    }
  }
  return NextResponse.json({ ok: true, from, sponsored: !!sponsor, outcomes }, { headers: { "Cache-Control": "no-store" } });
}
