import { NextRequest, NextResponse } from "next/server";
import { submitContentRewardLink } from "@/lib/server/contentRewardSubmit";
import { registerMeasurementHandle } from "@/lib/server/registerMeasurementHandle";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { isRestrictedCampaign } from "@/lib/restrictedCampaigns";
import { isAccountAllowedForRestricted } from "@/lib/server/restrictedCampaignsAuth";

export const runtime = "nodejs";

/**
 * Record a Vello agent's generated video link into jobtepi-web's content-rewards
 * submissions. Called after a video is posted so the deliverable is tracked on
 * the main platform.
 *
 * Body: { contentRewardId, ownerWallet, contentUrl, videoUrl?, platform,
 *         title?, description?, views? }
 */
export async function POST(req: NextRequest) {
  // Accept the server-to-server cron caller (X-Internal-Secret, e.g. clipJobs'
  // auto-submit) OR a SIWS user. The old bearer-only requireAuth rejected the
  // internal call → every cloud reward submission silently 401'd.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const contentRewardId = String(body.contentRewardId ?? "").trim();
  const ownerWallet = String(body.ownerWallet ?? "").trim();
  const contentUrl = String(body.contentUrl ?? body.postUrl ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  if (!contentRewardId || !ownerWallet || !contentUrl || !platform) {
    return NextResponse.json(
      { ok: false, error: "contentRewardId, ownerWallet, contentUrl and platform are required" },
      { status: 400 },
    );
  }

  // A user caller may only submit under a wallet they SIWS-proved they control —
  // otherwise body.ownerWallet is forgeable (insert a payable row under a victim's
  // wallet). Internal (cron/clipJobs) callers are trusted; they set ownerWallet
  // server-side from the job's ownerWallet.
  if (!auth.internal) {
    const ownErr = requireOwnerWithSiws(auth, ownerWallet);
    if (ownErr) return ownErr;
  }

  // RESTRICTED campaigns: only the single allowed account may join/submit. This
  // check applies to EVERY caller type — including trusted internal (cron /
  // clipJobs auto-submit / drip) callers — because a NON-allowed user's agent
  // could otherwise auto-submit a clip of a restricted source. The gate is on the
  // submission's ownerWallet: it MUST belong to the allowed account, else 403 and
  // NOTHING is recorded. Non-restricted campaigns are unaffected (internal
  // auto-approve etc. behave exactly as before).
  if (isRestrictedCampaign({ contentRewardId })) {
    const allowed = await isAccountAllowedForRestricted({ wallet: ownerWallet });
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: "This campaign is restricted." },
        { status: 403 },
      );
    }
  }

  let result: Awaited<ReturnType<typeof submitContentRewardLink>>;
  try {
    result = await submitContentRewardLink({
      contentRewardId,
      ownerWallet,
      ownerName: typeof body.ownerName === "string" ? body.ownerName : undefined,
      ownerAvatar: typeof body.ownerAvatar === "string" ? body.ownerAvatar : undefined,
      contentUrl,
      videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : undefined,
      platform,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      views: typeof body.views === "number" ? body.views : undefined,
      // Auto-approve ONLY trusted internal (cron/clipJobs = AI-agent) submissions.
      // A SIWS user posting their own clip is NOT auto-approved (keeps the normal
      // review path for human submitters).
      autoApprove: auth.internal === true,
    });
  } catch (err) {
    console.error("[content-rewards/submit] failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to record submission" },
      { status: 502 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }

  // Register the upload-post analytics handle so the view-sync worker can later
  // resolve this clip's live views + real permalink by request_id — the durable
  // recovery path when the submitted contentUrl was the raw clip/CDN url (the
  // permalink hadn't resolved at post time). Best-effort; needs a durable id +
  // the agent mint (callers that have them pass them; others simply skip).
  const uploadPostRequestId = typeof body.uploadPostRequestId === "string" ? body.uploadPostRequestId : undefined;
  const platformPostId = typeof body.platformPostId === "string" ? body.platformPostId : undefined;
  const mintAddress = typeof body.mintAddress === "string" ? body.mintAddress : "";
  if ((uploadPostRequestId || platformPostId) && mintAddress) {
    await registerMeasurementHandle({
      contentRewardId,
      contentRewardSubmissionId: result.submissionId,
      mintAddress,
      platform,
      uploadPostRequestId,
      platformPostId,
    });
  }

  return NextResponse.json(result);
}
