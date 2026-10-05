import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { analyzeWebsite, WebsiteUnreadableError } from "@/lib/server/launch/analyzeWebsite";

// Admin UGC-Sample step 1: crawl + understand the client's website and pitch
// exactly 3 sample-video concepts (one per fixed format — reaction / cartoon
// soft-sell / realistic review). Pure analysis, no video spend: the operator
// reviews the breakdown before firing the generate route. The analysis itself
// lives in lib/server/launch/analyzeWebsite.ts (shared with the public Launch
// funnel); this route is the admin auth wrapper.
export const runtime = "nodejs";
export const maxDuration = 150;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");

async function isAuthorized(req: NextRequest, accessToken?: string): Promise<boolean> {
  if (checkInternalSecret(req)) return true;
  if (!accessToken || !CONVEX_URL) return false;
  const convex = new ConvexHttpClient(CONVEX_URL);
  const chk = (await convex.action(CHECK_ADMIN, { accessToken }).catch(() => null)) as { admin: boolean } | null;
  return !!chk?.admin;
}

export async function POST(req: NextRequest) {
  let body: { websiteUrl?: string; notes?: string; accessToken?: string; clientType?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const websiteUrl = String(body.websiteUrl ?? "").trim();
  if (!/^https?:\/\//i.test(websiteUrl)) {
    return NextResponse.json({ ok: false, error: "Enter a full website URL (https://…)" }, { status: 400 });
  }
  if (!(await isAuthorized(req, body.accessToken))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const clientType = body.clientType === "physical" || body.clientType === "service" ? body.clientType : "app";

  try {
    const a = await analyzeWebsite({ websiteUrl, clientType, notes: String(body.notes ?? "") });
    return NextResponse.json({
      ok: true,
      productSummary: a.productSummary,
      concepts: a.concepts,
      identity: a.identity,
      screenshotUrl: a.screenshotUrl || null,
      productImageUrl: a.productImageUrl || null,
      productImageUrls: a.productImageUrls,
      websiteText: a.websiteText,
    });
  } catch (e) {
    if (e instanceof WebsiteUnreadableError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    return NextResponse.json(
      { ok: false, error: `Analysis failed: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }
}
