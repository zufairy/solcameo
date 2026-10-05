import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Poll a download job (started by /api/video/download-start). */
export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  // No agent to scope — require a valid SIWS session for user callers (internal skip).
  if (!auth.internal) {
    const siwsError = requireSiwsSession(auth);
    if (siwsError) return siwsError;
  }
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex URL not set" }, { status: 500 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const job = await convex.query(api.downloadJobs.get, { id: jobId as Id<"downloadJobs"> });
  if (!job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  // While downloading, the `error` slot carries JSON progress (see setProgress).
  // Only surface it as a real error once the job actually failed.
  const downloading = job.status === "downloading";
  let progress: unknown;
  if (downloading && job.error) { try { progress = JSON.parse(job.error); } catch { /* not progress json */ } }
  return NextResponse.json({
    ok: true,
    status: job.status,
    url: job.url,
    durationSeconds: job.durationSeconds,
    error: downloading ? undefined : job.error,
    progress,
  });
}
