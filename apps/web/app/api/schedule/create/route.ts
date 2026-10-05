import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Queue a piece of content for a future time. The Convex mutation
 * scheduledContent.schedule is secret-gated, so the client can no longer call
 * it directly. This route authenticates the operator (Privy Bearer),
 * ownership-scopes the mint, then forwards the internal secret.
 * Body mirrors scheduledContent.schedule's args (minus authSecret).
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    mintAddress?: string;
    sessionId?: string;
    scheduledFor?: number;
    topic?: string;
    script?: string;
    caption?: string;
    platforms?: string[];
    campaignId?: string;
    videoUrl?: string;
    formatId?: string;
  };
  if (!body.mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });
  if (typeof body.scheduledFor !== "number" || typeof body.topic !== "string") {
    return NextResponse.json({ error: "missing scheduledFor or topic" }, { status: 400 });
  }
  // Reject a non-finite / out-of-range scheduledFor: NaN/Infinity → a permanent
  // zombie row the cron can never drain; far-past → immediate post bypassing the
  // drip; absurd-future → calendar/forecast garbage. Small past slack for skew.
  if (!Number.isFinite(body.scheduledFor) ||
      body.scheduledFor < Date.now() - 60_000 ||
      body.scheduledFor > Date.now() + 366 * 86_400_000) {
    return NextResponse.json({ error: "scheduledFor out of range" }, { status: 400 });
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: body.mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  const id = await convex.mutation(api.scheduledContent.schedule, {
    mintAddress: body.mintAddress,
    sessionId: body.sessionId,
    scheduledFor: body.scheduledFor,
    topic: body.topic,
    script: body.script,
    caption: body.caption,
    platforms: body.platforms,
    campaignId: body.campaignId,
    videoUrl: body.videoUrl,
    formatId: body.formatId,
    authSecret: secret,
  });
  return NextResponse.json({ ok: true, id });
}
