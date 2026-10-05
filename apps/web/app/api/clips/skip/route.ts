import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Skip a clip in the Clips queue. The Convex mutation clipJobs.setClip is
 * secret-gated, so the client can no longer call it directly. This route
 * authenticates the operator (Privy Bearer), resolves the clip's owning mint
 * server-side (clipJobs.getClipMintServer) so a caller can't skip another
 * agent's clip by id, ownership-scopes that mint, then forwards the internal
 * secret. Body: { clipId, mintAddress }.
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { clipId, mintAddress } = (await req.json()) as { clipId?: string; mintAddress?: string };
  if (!clipId) return NextResponse.json({ error: "missing clipId" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  // Resolve clip → mint server-side; never trust the client's mintAddress alone.
  const clip = await convex.query(api.clipJobs.getClipMintServer, { clipId: clipId as Id<"clips">, authSecret: secret });
  if (!clip) return NextResponse.json({ error: "clip not found" }, { status: 404 });
  if (mintAddress && mintAddress !== clip.mintAddress) {
    return NextResponse.json({ error: "Forbidden — clip belongs to a different agent" }, { status: 403 });
  }

  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress: clip.mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  await convex.mutation(api.clipJobs.setClip, { clipId: clipId as Id<"clips">, status: "skipped", authSecret: secret });
  return NextResponse.json({ ok: true });
}
