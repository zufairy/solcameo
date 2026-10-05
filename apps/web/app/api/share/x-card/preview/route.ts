import { NextRequest, NextResponse } from "next/server";
import { MID_VIDEO_FRAMES, renderShareCard, renderShareGif, type ShareAgentData, type ShareClip } from "@/lib/server/xShareCardRender";
import { videoFrames } from "@/lib/server/videoThumbnails";

export const runtime = "nodejs";
export const maxDuration = 60;

// Local sample clips (already bundled for other dev labs) standing in for
// "this agent's real recent videos" — the illustration's actual data source
// (videoThumbnails.ts) works identically on a /public path or a real https
// R2 URL, so this exercises the exact same code the live feature uses, just
// pointed at bundled files instead of a logged-in agent's uploads.
const SAMPLE_CLIPS = ["/editor-example.mp4", "/hero-bg.mp4", "/cofounder-bg.mp4", "/captions-lab-sample.mp4"];

/** Dev-only preview: renders the SAME membership card as the real /api/share/x-card
 *  route, but from synthetic stats in the query string instead of a real Convex
 *  agent — so the /dev/x-cards gallery can show every tier/layout without needing
 *  a logged-in agent with real view counts. Never reads or writes agent data.
 *  ?format=gif returns the animated card; default is the static PNG still. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const views = Math.max(0, Number(sp.get("views") ?? "0") || 0);
  const name = (sp.get("name") ?? "Preview Agent").slice(0, 40) || "Preview Agent";
  const handle = sp.get("handle")?.trim() || null;
  const videos = Math.max(0, Number(sp.get("videos") ?? "18") || 0);
  const posted = Math.max(0, Math.min(videos, Number(sp.get("posted") ?? String(Math.round(videos * 0.7))) || 0));
  const bestViews = Math.max(0, Number(sp.get("best") ?? String(Math.round(views * 0.32))) || 0);
  const platforms = (sp.get("platforms") ?? "tiktok,youtube,instagram,x").split(",").map((s) => s.trim()).filter(Boolean);
  const seed = (sp.get("seed") ?? "preview").slice(0, 40);
  const nonce = (sp.get("nonce") ?? "0").slice(0, 32);

  // Only the bundled sample image — never fetch an arbitrary URL from a public route.
  const avatarUrl = sp.get("avatar") === "sample" ? "/vello-flash-mascot.png" : null;
  // Same shape the live route builds: the best clip gets a short frame run
  // (the middle card's pixel video), the others one still each.
  const clips = sp.get("thumbs") === "none"
    ? []
    : (await Promise.all(SAMPLE_CLIPS.map(async (c, i): Promise<ShareClip | null> => {
        const frames = await videoFrames(c, i === 0 ? MID_VIDEO_FRAMES : 1);
        return frames ? { frames, views: Math.round(bestViews / (i + 1)) } : null;
      }))).filter((c): c is ShareClip => !!c);

  const data: ShareAgentData = {
    mint: `preview-${seed}`,
    avatarUrl,
    clips,
    stats: { name, handle, views, videos, posted, bestViews, platforms },
  };
  try {
    if (sp.get("format") !== "gif") return await renderShareCard(data, nonce);
    const bytes = await renderShareGif(data, nonce);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/gif", "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("[share/x-card/preview] render failed", error);
    return NextResponse.json({ error: "Could not generate the preview" }, { status: 500 });
  }
}
