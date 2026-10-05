import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import { replyToComment, resolveUsername, isConfigured, COMMENTABLE_PLATFORMS } from "@/lib/server/uploadPost";

export const runtime = "nodejs";
export const maxDuration = 20;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Reply to one comment from the /analytics comments panel. Ownership is
 *  enforced server-side: the mint must resolve to one of the caller's own
 *  agents — the client can't reply as someone else's agent. */
export async function POST(req: NextRequest) {
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  if (!isConfigured()) return NextResponse.json({ ok: false, error: "Upload-post not configured" }, { status: 503 });

  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const mintAddress = String(body.mintAddress ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  const commentId = String(body.commentId ?? "").trim();
  const message = String(body.message ?? "").trim();
  if (!mintAddress || !platform || !commentId || !message) {
    return NextResponse.json({ ok: false, error: "mintAddress, platform, commentId, and message are required" }, { status: 400 });
  }
  if (!COMMENTABLE_PLATFORMS.includes(platform)) {
    return NextResponse.json({ ok: false, error: "Replies aren't supported on this platform" }, { status: 400 });
  }

  const wallets = (auth.user.walletAddresses ?? []).filter(Boolean);
  const convex = new ConvexHttpClient(CONVEX_URL);
  const agents = (await convex
    .query(api.influencers.listByCreators, { creatorWallets: wallets })
    .catch(() => [])) as Array<{ mintAddress: string }>;
  if (!agents.some((a) => a.mintAddress === mintAddress)) {
    return NextResponse.json({ ok: false, error: "Not your agent" }, { status: 403 });
  }

  const username = resolveUsername(mintAddress);
  const result = await replyToComment(username, platform, commentId, message);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
