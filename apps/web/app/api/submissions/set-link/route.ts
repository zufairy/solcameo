import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Attach a published post link to a campaign submission. The Convex mutation
 * submissions.setPostLink is secret-gated, so the browser can no longer call it
 * directly — the earlier influencerMint re-check was NOT a real ownership gate
 * (the agent mint is PUBLIC, so an attacker passed the victim's real mint and the
 * equality passed → still pinnable IDOR). This route authenticates the operator
 * (Privy Bearer), resolves the submission → its influencerMint → the agent's
 * creatorWallet SERVER-SIDE, SIWS-ownership-scopes that wallet, then forwards the
 * internal secret. Mirrors the /api/clips/delete server-twin pattern.
 * Body: { submissionId, postUrl, platform? }.
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { submissionId, postUrl, platform } = (await req.json()) as {
    submissionId?: string;
    postUrl?: string;
    platform?: string;
  };
  if (!submissionId) return NextResponse.json({ error: "missing submissionId" }, { status: 400 });
  if (!postUrl) return NextResponse.json({ error: "missing postUrl" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  // Resolve submission → its owning influencerMint server-side; never trust a
  // client-supplied mint (that was the whole hole).
  const submission = await convex.query(api.submissions.getByIdServer, {
    submissionId: submissionId as Id<"submissions">,
    authSecret: secret,
  });
  if (!submission) return NextResponse.json({ error: "submission not found" }, { status: 404 });

  const agent = await convex.query(api.influencers.getByMintServer, {
    mintAddress: submission.influencerMint,
    authSecret: secret,
  });
  if (!auth.internal) {
    // Fail CLOSED when the submission's agent has no owner wallet to check against
    // (requireOwnerWithSiws would otherwise pass on a null wallet).
    if (!agent?.creatorWallet) {
      return NextResponse.json({ error: "Forbidden — submission's agent has no owner wallet" }, { status: 403 });
    }
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  const result = await convex.mutation(api.submissions.setPostLink, {
    submissionId: submissionId as Id<"submissions">,
    influencerMint: submission.influencerMint,
    postUrl,
    ...(platform ? { platform } : {}),
    authSecret: secret,
  });
  return NextResponse.json({ ...result, ok: true });
}
