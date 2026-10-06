import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterScope, verifyCharacterJobTicket, invalidDraftJob } from "@/lib/server/characterDraft";
import { getObjectText, mirrorImageToR2 } from "@/lib/server/imageStorage";
import { refundImage } from "@/lib/server/imageBilling";
import { refundStudioRun } from "@/lib/server/studioGenBilling";
import { pollNftTaskOnce } from "@/lib/server/nftKie";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Poll one shirt edit; on success the result is mirrored to our R2 so the URL never expires. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterScope(req, q.get("mint"), q.get("draft") === "1");
  if (a.error) return a.error;
  const id = q.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || !verifyCharacterJobTicket(q.get("ticket") ?? "", a.mint, id)) return invalidDraftJob();
  const poll = await pollNftTaskOnce(id);
  const headers = { "Cache-Control": "no-store" };
  if (poll.status === "pending") return NextResponse.json({ status: "pending" }, { headers });
  if (poll.status === "fail") {
    const raw = await getObjectText(`characters/${a.mint}/jobs/${id}.json`);
    const job = raw ? JSON.parse(raw) as { billingRunId?: string; studioRunId?: string; lastEngine?: boolean } : null;
    if (job?.billingRunId) await refundImage(a.mint, job.billingRunId);
    if (job?.studioRunId && job.lastEngine) await refundStudioRun(job.studioRunId);
    return NextResponse.json({ status: "failed", error: poll.error }, { headers });
  }
  const stored = await mirrorImageToR2(poll.url, { key: `characters/${a.mint}/gen/shirt-${id}/0.webp`, optimize: true });
  if (!stored) return NextResponse.json({ status: "failed", error: "Could not store the edited portrait." }, { headers });
  return NextResponse.json({ status: "completed", url: stored.url }, { headers });
}
