import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Best-effort mirror of an on-chain `refund_remaining` (the campaign creator
 * reclaiming the unspent escrow USDC after expiry). Records the refund tx
 * signature onto the campaign so the detail page + admin history show the
 * reclaimed state across reloads.
 *
 * The MONEY already moved on-chain (the client signed + confirmed the refund tx)
 * BEFORE calling this — so this route is intentionally non-authoritative and its
 * failure never undoes or blocks the refund. The convex `campaigns.markReclaimed`
 * mutation is internal-secret gated; the only safe way to reach it is here, where
 * we SIWS-prove the caller owns the campaign's creator wallet (mirrors set-pda —
 * never an unsigned client-supplied wallet).
 *
 * Body: { campaignId, refundTxSignature }
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: { campaignId?: string; refundTxSignature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const campaignId = String(body.campaignId ?? "").trim();
  const refundTxSignature = String(body.refundTxSignature ?? "").trim();
  if (!campaignId || !refundTxSignature) {
    return NextResponse.json(
      { error: "campaignId and refundTxSignature are required" },
      { status: 400 },
    );
  }
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  // A malformed campaignId makes getById's v.id validator throw — treat as
  // not-found (clean 404) instead of a 500.
  const campaign = await convex
    .query(api.campaigns.getById, { id: campaignId as Id<"campaigns"> })
    .catch(() => null);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  // Ownership: a user caller must SIWS-prove they control the campaign's creator
  // wallet. Internal (cron) callers are trusted.
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, (campaign as { creatorWallet?: string }).creatorWallet);
    if (err) return err;
  }

  await convex.mutation(api.campaigns.markReclaimed, {
    id: campaignId as Id<"campaigns">,
    refundTxSignature,
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  return NextResponse.json({ ok: true });
}
