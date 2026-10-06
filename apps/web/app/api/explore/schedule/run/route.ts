import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { HfError, getStatus, submitVideo } from "@/lib/server/higgsfield";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Cron driver (per minute): submit due scheduled renders, then finish the ones Higgsfield has completed. */
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret || !CONVEX_URL) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
  if (req.headers.get("X-Internal-Secret") !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const stats = { submitted: 0, completed: 0, failed: 0 };
  const deadline = Date.now() + 100_000;

  const due = await convex.mutation(api.scheduledRecreations.claimDue, { authSecret: secret, limit: 10 });
  for (const row of due) {
    if (Date.now() > deadline) break;
    try {
      const requestId = await submitVideo(
        row.mode,
        { video_url: row.videoUrl, image_urls: row.imageUrls, resolution: row.resolution, ...(row.prompt.trim() ? { prompt: row.prompt } : {}) },
        `sched:${row._id}:${randomUUID()}`.slice(0, 120),
      );
      await convex.mutation(api.scheduledRecreations.markSubmitted, { authSecret: secret, id: row._id, requestId });
      stats.submitted++;
    } catch (e) {
      await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error: e instanceof HfError ? e.message : "Could not start the render." });
      stats.failed++;
    }
  }

  const { submitted, stale } = await convex.query(api.scheduledRecreations.listInFlight, { authSecret: secret });
  for (const row of stale) await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error: "The render did not start. Please schedule it again." });
  for (const row of submitted) {
    if (Date.now() > deadline || !row.requestId) continue;
    try {
      const r = await getStatus(row.requestId);
      if (["failed", "nsfw", "canceled"].includes(r.status)) {
        await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error: r.status === "nsfw" ? "Blocked by content moderation" : r.error || "Generation failed" });
        stats.failed++;
      } else if (r.status === "completed" && r.videoUrl) {
        let url = r.videoUrl;
        if (r2Configured()) {
          try {
            const res = await fetch(r.videoUrl);
            if (res.ok) {
              const buf = new Uint8Array(await res.arrayBuffer());
              if (buf.byteLength > 0 && buf.byteLength < 300_000_000) url = (await putVideo(buf, { keyPrefix: `characters/${row.mintAddress}/motion` })).url;
            }
          } catch { /* keep the Higgsfield URL */ }
        }
        await convex.mutation(api.scheduledRecreations.markCompleted, { authSecret: secret, id: row._id, resultUrl: url });
        stats.completed++;
      } else if (Date.now() - row.updatedAt > 60 * 60_000) {
        await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error: "Timed out waiting for the render." });
        stats.failed++;
      }
    } catch { /* transient: retry next tick */ }
  }
  return NextResponse.json({ ok: true, ...stats });
}
