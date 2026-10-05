import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { contentControlAdmin } from "@/lib/server/contentControlAuth";
import { renderMaterial, type MaterialData } from "@/lib/server/postMaterialRender";
import { validMaterial } from "@/lib/server/postMaterialInput";
import { renderMaterialMp4 } from "@/lib/server/materialVideo";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";
import { getProfile, resolveUsername } from "@/lib/server/uploadPost";
import { MARKETING_PROFILE } from "@/lib/server/contentPublishing";
import { cleanMarketingText } from "@/lib/marketingCaption";
import { withMentions, xHandle, xMentions } from "@/lib/server/xMention";

export const runtime = "nodejs";
export const maxDuration = 120;

const postInput = z.object({ targetMint: z.string().min(1).max(150).optional(), key: z.string().uuid(), caption: z.string().min(1).max(500), mentionMints: z.array(z.string().min(1).max(150)).max(5).optional() });

/**
 * Admin-only renderer for the Content Control templates.
 *   png / gif  -> the image bytes (previews, GIF export)
 *   mp4        -> stores a looping video, returns its URL (attach to the composer)
 *   post       -> renders the video, @mentions the featured agents that have X connected and queues the X post (the publishing worker does the rest)
 */
export async function POST(req: NextRequest) {
  const auth = await contentControlAdmin(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json() as { format?: string; data?: MaterialData };
    if (!validMaterial(body.data)) return NextResponse.json({ error: "Invalid template data" }, { status: 400 });
    if (body.format === "mp4" || body.format === "post") {
      if (!r2Configured()) return NextResponse.json({ error: "Media storage is not configured" }, { status: 503 });
      let post: z.infer<typeof postInput> | undefined, mentions: string[] = [];
      if (body.format === "post") {
        const parsed = postInput.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "Invalid post request" }, { status: 400 });
        post = parsed.data;
        if (post.targetMint) {
          const agent = await auth.convex.query(api.influencers.getByMintServer, { authSecret: auth.secret, mintAddress: post.targetMint });
          if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }
        const profile = await getProfile(post.targetMint ? resolveUsername(post.targetMint) : MARKETING_PROFILE);
        if (!profile.connected.x) return NextResponse.json({ error: "Connect X on the posting account first" }, { status: 400 });
        mentions = await xMentions(auth.convex, auth.secret, post.mentionMints ?? [], xHandle(profile.connected.x));
      }
      const mp4 = await renderMaterialMp4(body.data);
      const video = await putVideo(new Uint8Array(mp4), { keyPrefix: "marketing/videos", contentType: "video/mp4" });
      if (!post) return NextResponse.json({ ok: true, url: video.url, kind: "video" });
      const base = cleanMarketingText(post.caption);
      const caption = withMentions(base, mentions);
      const id = await auth.convex.mutation(api.contentControl.queue, { authSecret: auth.secret, dedupeKey: `manual:${post.key}`, targetMint: post.targetMint, caption, mediaUrl: video.url, kind: "video", platforms: ["x"] });
      return NextResponse.json({ ok: true, id, caption, url: video.url });
    }
    const format = body.format === "gif" ? "gif" : "png";
    const bytes = await renderMaterial(body.data, format);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": `image/${format}`, "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[content-control/material] render failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not render the template" }, { status: 500 });
  }
}
