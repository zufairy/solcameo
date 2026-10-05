import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const REASON_CHIPS = new Set(["style", "pace", "topic", "voice", "length"]);

/** Owner-authed front for tasteEvents.recordVideoFeedback — proves the caller
 *  owns the agent (or is an internal caller), then injects the secret so the
 *  client never holds it. Records a 👍/👎 taste event and, when a rotation
 *  format is named, nudges that format's videoStyles weight. */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
    const body = (await req.json().catch(() => ({}))) as {
      mintAddress?: string;
      verdict?: string;
      formatId?: string;
      reason?: string;
      videoTitle?: string;
    };
    const { mintAddress, verdict, formatId, reason, videoTitle } = body;
    if (!mintAddress) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });
    if (verdict !== "up" && verdict !== "down") return NextResponse.json({ error: "verdict must be 'up' or 'down'" }, { status: 400 });
    if (reason !== undefined && !REASON_CHIPS.has(reason)) return NextResponse.json({ error: "invalid reason" }, { status: 400 });
    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, agent);
      if (ownershipError) return ownershipError;
    }
    const result = await convex.mutation(api.tasteEvents.recordVideoFeedback, {
      mintAddress,
      verdict,
      formatId,
      reason,
      videoTitle,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[video-feedback] failed:", err);
    return NextResponse.json({ error: "Failed to record video feedback" }, { status: 500 });
  }
}
