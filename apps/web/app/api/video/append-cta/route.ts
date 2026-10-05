import { NextRequest, NextResponse } from "next/server";
import { appendCtaFromUrls } from "@/lib/server/ctaAppend";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Append the operator's "Video Call To Action" clip to the END of a produced
 * video. Called server-to-server from the render pipelines (render-step,
 * videoJobs) after the final video URL exists.
 *
 * Fail-safe contract (mirrors overlay-burn): ALWAYS returns HTTP 200. On any
 * failure it returns the ORIGINAL `videoUrl` so a produced video is never lost.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }

  let body: { videoUrl?: string; ctaUrl?: string; transition?: { id?: string; durationSec?: number } };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON", videoUrl: "" }, { status: 200 }); }

  const videoUrl = String(body.videoUrl ?? "");
  const ctaUrl = String(body.ctaUrl ?? "");
  if (!videoUrl) return NextResponse.json({ ok: false, error: "videoUrl required", videoUrl }, { status: 200 });
  // No CTA configured — nothing to do, return the original untouched.
  if (!ctaUrl) return NextResponse.json({ ok: true, videoUrl }, { status: 200 });

  // Optional Transitions pick — cross-fade the CTA in instead of a hard cut.
  const transition = body.transition && typeof body.transition.id === "string" && typeof body.transition.durationSec === "number"
    ? { id: body.transition.id, durationSec: body.transition.durationSec }
    : undefined;
  const finalUrl = await appendCtaFromUrls(videoUrl, ctaUrl, transition);
  return NextResponse.json({ ok: finalUrl !== videoUrl, videoUrl: finalUrl }, { status: 200 });
}
