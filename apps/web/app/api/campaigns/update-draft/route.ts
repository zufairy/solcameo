import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { getCampaignPda, getEscrowConnection } from "@/lib/escrow";
import { z } from "zod";

export const runtime = "nodejs";

const draftPatch = z.object({
  brandName: z.string().max(120).optional(),
  title: z.string().max(180).optional(),
  brief: z.string().max(10000).optional(),
  budget: z.number().finite().positive().optional(),
  ratePerThousandViews: z.number().finite().positive().optional(),
  rewardPerCompletion: z.number().finite().nonnegative().optional(),
  deliverables: z.string().max(10000).optional(),
  deadline: z.string().optional(),
  campaignImageUrl: z.string().url().optional(),
  contentFileUrls: z.array(z.string().url()).max(3).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => null) as { campaignId?: string; patch?: Record<string, unknown> } | null;
  if (!body?.campaignId || !body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    return NextResponse.json({ error: "Campaign and changes are required" }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "Campaign service unavailable" }, { status: 503 });
  const convex = new ConvexHttpClient(url);
  const id = body.campaignId as Id<"campaigns">;
  const campaign = await convex.query(api.campaigns.getById, { id }).catch(() => null);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.pdaAddress) return NextResponse.json({ error: "Funded campaigns cannot be edited" }, { status: 409 });
  if (!auth.internal) {
    const error = requireOwnerWithSiws(auth, campaign.creatorWallet);
    if (error) return error;
  }
  try {
    const [pda] = getCampaignPda(body.campaignId, campaign.creatorWallet);
    if (await getEscrowConnection().getAccountInfo(pda)) {
      return NextResponse.json({ error: "Escrow was already deposited. Retry finalization instead of editing its terms." }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "Could not verify escrow state. Try again shortly." }, { status: 503 });
  }
  const parsed = draftPatch.safeParse(body.patch);
  if (!parsed.success) return NextResponse.json({ error: "Invalid campaign changes" }, { status: 400 });
  try {
    await convex.mutation(api.campaigns.updateDraft, {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "", id, patch: parsed.data,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update campaign" }, { status: 400 });
  }
}
