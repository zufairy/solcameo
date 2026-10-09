import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { HfError, getStatus, submitVideo } from "@/lib/server/higgsfield";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";
import { CHARGE_MESSAGES, chargeExploreRun, priceUsd, refundExploreRun } from "@/lib/server/exploreBilling";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
type Row = Doc<"scheduledRecreations">;
/** Immediate runs carry their billing id; scheduled runs derive a stable one from the row. */
const billingId = (row: Row) => row.billingRunId ?? `sched:${row._id}`;

/**
 * Cron driver (per minute) for explore renders:
 * 1. due scheduled rows are charged to the agent wallet, then submitted to Higgsfield;
 * 2. in-flight rows are polled, finished videos are stored, and failures are refunded;
 * 3. finished videos with auto-post on get a viral caption and go out on the agent's X account.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret || !CONVEX_URL) return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
  if (req.headers.get("X-Internal-Secret") !== secret) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const stats = { submitted: 0, completed: 0, failed: 0, posted: 0 };
  const deadline = Date.now() + 240_000;
  const fail = async (row: Row, error: string) => {
    await refundExploreRun(row.mintAddress, billingId(row));
    await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error });
    stats.failed++;
  };

  const due = await convex.mutation(api.scheduledRecreations.claimDue, { authSecret: secret, limit: 10 });
  for (const row of due) {
    if (Date.now() > deadline) break;
    const price = row.durationSec ? priceUsd(row.durationSec, row.resolution) : null;
    if (price === null) { await fail(row, "This reference can no longer be priced."); continue; }
    const charge = await chargeExploreRun(row.mintAddress, billingId(row), price);
    if (!charge.ok) { await convex.mutation(api.scheduledRecreations.markFailed, { authSecret: secret, id: row._id, error: CHARGE_MESSAGES[charge.reason] ?? "Could not charge the agent wallet." }); stats.failed++; continue; }
    try {
      const requestId = await submitVideo(
        row.mode,
        { video_url: row.videoUrl, image_urls: row.imageUrls, resolution: row.resolution, ...(row.prompt.trim() ? { prompt: row.prompt } : {}) },
        `sched:${row._id}:${randomUUID()}`.slice(0, 120),
      );
      await convex.mutation(api.scheduledRecreations.markSubmitted, { authSecret: secret, id: row._id, requestId });
      stats.submitted++;
    } catch (e) {
      await fail(row, e instanceof HfError ? e.message : "Could not start the render.");
    }
  }

  const { submitted, stale } = await convex.query(api.scheduledRecreations.listInFlight, { authSecret: secret });
  for (const row of stale) await fail(row, "The render did not start. You were not charged. Please schedule it again.");
  for (const row of submitted) {
    if (Date.now() > deadline || !row.requestId) continue;
    try {
      const r = await getStatus(row.requestId);
      if (["failed", "nsfw", "canceled"].includes(r.status)) {
        await fail(row, r.status === "nsfw" ? "Blocked by content moderation" : r.error || "Generation failed");
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
        // Mark completed first so a slow post can never cause a second render pickup.
        await convex.mutation(api.scheduledRecreations.markCompleted, { authSecret: secret, id: row._id, resultUrl: url });
        stats.completed++;
        // markCompleted atomically queues opted-in videos into the shared
        // three-a-day X schedule. The scheduler records actual posting outcomes.

      } else if (Date.now() - row.updatedAt > 60 * 60_000) {
        await fail(row, "Timed out waiting for the render.");
      }
    } catch { /* transient: retry next tick */ }
  }
  return NextResponse.json({ ok: true, ...stats });
}
