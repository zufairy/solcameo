import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Delete a campaign (cascade-deletes its submissions). The convex
 * `campaigns.remove` mutation is secret-gated; the only safe way to reach it is
 * here, where we SIWS-prove the caller owns the campaign before forwarding the
 * internal secret. (Was a public mutation → anyone could delete any campaign.)
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

  // Ownership: a user caller must SIWS-prove they control the campaign's creator
  // wallet. Internal (cron) callers are trusted.
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, (campaign as { creatorWallet?: string }).creatorWallet);
    if (err) return err;
  }

  const result = await convex.mutation(api.campaigns.remove, {
    id: campaignId as Id<"campaigns">,
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  return NextResponse.json(result);
}
