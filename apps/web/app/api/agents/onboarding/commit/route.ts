import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { normalizeShowBible } from "@/lib/builder/showBible";
import { VIDEO_ENGINES } from "@/lib/builder/agentTypes";

export const runtime = "nodejs";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Persist the onboarding wizard's mapped bible. The client maps draft→bible
 *  (lib/builder/onboardingDraft); this route re-normalizes server-side and
 *  writes through the secret-gated setShowBible so the client never holds
 *  the secret. */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
  const { mintAddress, bible, videoEngine, aspectRatio } = (await req.json().catch(() => ({}))) as {
    mintAddress?: string; bible?: unknown; videoEngine?: string; aspectRatio?: string;
  };
  if (!mintAddress || !bible) return NextResponse.json({ error: "mintAddress and bible required" }, { status: 400 });
  if (!normalizeShowBible(bible)) return NextResponse.json({ error: "bible failed normalization" }, { status: 400 });
  if (videoEngine !== undefined && !VIDEO_ENGINES.some((e) => e.id === videoEngine)) {
    return NextResponse.json({ error: "unknown videoEngine" }, { status: 400 });
  }
  if (aspectRatio !== undefined && aspectRatio !== "9:16" && aspectRatio !== "16:9") {
    return NextResponse.json({ error: "unknown aspectRatio" }, { status: 400 });
  }
  const convex = new ConvexHttpClient(CONVEX_URL);
  const agent = await convex.query(api.influencers.getByMint, { mintAddress });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!auth.internal) {
    const ownershipError = requireOwnerWithSiws(auth, agent);
    if (ownershipError) return ownershipError;
  }
  await convex.mutation(api.influencers.setShowBible, {
    mintAddress, showBible: bible, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  // Engine choice from the wizard's Step 2 dropdown — same field the Director
  // tab's engine picker writes.
  if (videoEngine) {
    await convex.mutation(api.influencers.saveAgentConfig, {
      mintAddress, videoEngine, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
  }
  // Aspect ratio — lives on videoConfig (same field VideoDirectorTab's own
  // Portrait/Landscape picker writes), not the bible, so it's a sibling
  // write here rather than something draftToBible could carry.
  if (aspectRatio) {
    await convex.mutation(api.influencers.setVideoConfig, {
      mintAddress, videoConfig: { aspectRatio }, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
  }
  return NextResponse.json({ ok: true });
}
