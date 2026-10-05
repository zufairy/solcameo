import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAuth } from "@/lib/server/requireAuth";
import { analyzeStyleVideo } from "@/lib/server/videoStyleLearn";

// Learn tab: agentic analysis of ONE uploaded example video — transcript +
// vision style study fused into a styleProfile, plus a hosted mid-frame the
// engines can use as a visual reference. Synchronous (frames + transcript +
// two model calls) — comfortably inside the route budget.
export const runtime = "nodejs";
export const maxDuration = 280;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { refId?: string; videoUrl?: string };
  const refId = (body.refId ?? "").trim();
  const videoUrl = (body.videoUrl ?? "").trim();
  if (!refId || !videoUrl) return NextResponse.json({ ok: false, error: "refId and videoUrl are required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL || !secret) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const id = refId as Id<"agentStyleReferences">;

  try {
    const analysis = await analyzeStyleVideo(videoUrl);

    // Host the MID frame (the most representative) so it's a stable https URL
    // the render engines can fetch as a visual reference.
    const frameUrls: string[] = [];
    const mid = analysis.frameDataUrls[Math.floor(analysis.frameDataUrls.length / 2)];
    if (mid) {
      try {
        const bytes = Buffer.from(mid.split(",")[1] ?? "", "base64");
        const uploadUrl = await convex.mutation(api.clipStorage.generateUploadUrl, {});
        const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(bytes) });
        if (up.ok) {
          const { storageId } = (await up.json()) as { storageId: string };
          const url = await convex.mutation(api.clipStorage.resolveStorageUrl, { storageId: storageId as Id<"_storage"> });
          if (url) frameUrls.push(url);
        }
      } catch { /* frame hosting is best-effort — the profile alone still works */ }
    }

    await convex.mutation(api.agentStyleReferences.patchAnalysis, {
      id,
      authSecret: secret,
      status: "ready",
      transcript: analysis.transcript,
      styleProfile: analysis.styleProfile,
      frameUrls,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "analysis failed";
    await convex.mutation(api.agentStyleReferences.patchAnalysis, {
      id, authSecret: secret, status: "failed", error: message.slice(0, 300),
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
