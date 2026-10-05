import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { getContentRewardById } from "@/lib/content-rewards";

export const runtime = "nodejs";

/**
 * Return a jobtepi content_reward's PUBLIC posting rules
 * (`content_requirements: string[]`) so an AI clipper can COMPLY with them when it
 * posts a clip. The brief text is public, but the read still goes through
 * `requireInternalOrUserAuth` (same gate the sibling /api/content-rewards/submit
 * route uses): server-to-server callers (clipJobs auto-post) present the internal
 * secret; user callers present a Privy bearer. No ownership gate — the brief is
 * readable by any signed-in caller.
 *
 * Body: { contentRewardId: string } → { ok: true, requirements: string[] }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const contentRewardId = String(body.contentRewardId ?? "").trim();
  if (!contentRewardId) {
    return NextResponse.json({ ok: false, error: "contentRewardId is required" }, { status: 400 });
  }

  try {
    const reward = await getContentRewardById(contentRewardId);
    const requirements = reward && Array.isArray(reward.content_requirements)
      ? reward.content_requirements.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : [];
    return NextResponse.json({ ok: true, requirements });
  } catch (err) {
    console.error("[campaigns/requirements] failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to load requirements" }, { status: 502 });
  }
}
