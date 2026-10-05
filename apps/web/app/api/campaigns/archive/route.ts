import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Archive a campaign: take it off every board WITHOUT deleting anything.
 *
 * The delete route cascade-deletes submissions, and for a FUNDED campaign it also
 * strands the on-chain vault — the row is what the reclaim flow reads. Archiving sets
 * the status to "closed", which every surface treats as gone, while the vault address
 * and the audit trail survive so the creator can still reclaim their USDC.
 *
 * Body: { campaignId }
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: { campaignId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const campaignId = String(body.campaignId ?? "").trim();
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const campaign = await convex.query(api.campaigns.getById, { id: campaignId as Id<"campaigns"> });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, (campaign as { creatorWallet?: string }).creatorWallet);
    if (err) return err;
  }

  const result = await convex.mutation(api.campaigns.archive, {
    id: campaignId as Id<"campaigns">,
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  return NextResponse.json(result);
}
