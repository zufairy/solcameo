import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { getLatestPostLink, resolveUsername } from "@/lib/server/uploadPost";

/**
 * Resolve a POSTED clip's permalink after the fact.
 *
 * A platform does not always expose the post URL by the time the upload returns —
 * TikTok in particular indexes a video a few seconds later. The post path polls
 * three times and then gives up, so a clip can be genuinely posted with no link
 * yet, which leaves the gallery unable to offer "View post".
 *
 * This looks the link up again from the DURABLE identities recorded at post time
 * (the platform's own post id, or the upload request id) — never "the account's
 * newest post", which on a busy account is somebody else's video — and writes it
 * onto the clip row so every surface picks it up.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });

  let body: { mintAddress?: string; clipUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const mintAddress = (body.mintAddress ?? "").trim();
  const clipUrl = (body.clipUrl ?? "").trim();
  if (!mintAddress || !clipUrl) return NextResponse.json({ error: "mintAddress and clipUrl are required" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  // Ownership: this reads an agent's post identities, so the caller must own it.
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  // The clip's recorded post identity. Read from the agent's own clips, so a caller
  // can never resolve a link for a clip they don't own.
  const clips = (await convex.query(api.clipJobs.listClipsByMint, { mintAddress })) as Array<{
    clipUrl?: string; status: string; platform?: string; postUrl?: string;
    platformPostId?: string; uploadPostRequestId?: string;
  }> | null;
  const clip = (clips ?? []).find((c) => c.clipUrl === clipUrl);
  if (!clip) return NextResponse.json({ error: "clip not found on this agent" }, { status: 404 });
  if (clip.postUrl) return NextResponse.json({ ok: true, postUrl: clip.postUrl });
  if (clip.status !== "posted") return NextResponse.json({ ok: false, reason: "not_posted" }, { status: 409 });

  const platform = clip.platform;
  if (!platform || (!clip.platformPostId && !clip.uploadPostRequestId)) {
    // Nothing durable to look it up BY. Saying so beats returning a link that might
    // belong to a different video.
    return NextResponse.json({ ok: false, reason: "no_post_identity" }, { status: 422 });
  }

  try {
    const postUrl = await getLatestPostLink(resolveUsername(mintAddress), platform, {
      platformPostId: clip.platformPostId,
      requestId: clip.uploadPostRequestId,
    });
    if (!postUrl) return NextResponse.json({ ok: false, reason: "not_indexed_yet" }, { status: 202 });
    await convex.mutation(api.clipJobs.markClipPostedByUrl, {
      mintAddress, clipUrl, status: "posted", postUrl, platform, authSecret: secret,
    });
    return NextResponse.json({ ok: true, postUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 502 });
  }
}
