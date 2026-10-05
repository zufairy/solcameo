import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Persist a finished CANVAS (local "demo run") clip batch to the Convex `clips`
 * table so the clips show in the builder ClipsQueue, sync across devices, and
 * (via Feature 2) surface on the public Creations tab. The canvas runs entirely
 * client-side and only saved clips to browser localStorage; the relational rows
 * were missing.
 *
 * The Convex mutation clipJobs.recordCanvasClips is secret-gated, so the client
 * can't call it directly. This route authenticates the operator (Privy Bearer),
 * ownership-scopes the mint to the logged-in owner (exactly like
 * /api/clips/skip and /api/economy/set-cap), then forwards the internal secret.
 * Body: { mintAddress, sourceUrl?, clips: [...] }.
 */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { mintAddress, sourceUrl, clips } = (await req.json()) as {
    mintAddress?: string;
    sourceUrl?: string;
    clips?: Array<{
      title?: unknown;
      reason?: unknown;
      clipUrl?: unknown;
      viralScore?: unknown;
      captionText?: unknown;
      startSeconds?: unknown;
      endSeconds?: unknown;
    }>;
  };
  if (!mintAddress) return NextResponse.json({ error: "missing mintAddress" }, { status: 400 });
  // A zero-clip run is a no-op, never an error (a run where every clip failed
  // still reaches here). Don't 400 — just record nothing.
  if (!Array.isArray(clips) || clips.length === 0) {
    return NextResponse.json({ ok: true, jobId: null, clipIds: [] });
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";

  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  // Sanitize each clip server-side (coerce numbers, default strings) so a
  // malformed client body can't throw the Convex validator. captionText/reason
  // are REQUIRED v.string() columns — always supply a string.
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cleanClips = clips.map((c) => ({
    title: typeof c.title === "string" ? c.title : "Clip",
    reason: typeof c.reason === "string" ? c.reason : "",
    clipUrl: typeof c.clipUrl === "string" ? c.clipUrl : "",
    viralScore: num(c.viralScore),
    captionText: typeof c.captionText === "string" ? c.captionText : "",
    startSeconds: num(c.startSeconds),
    endSeconds: num(c.endSeconds),
  }));

  const { jobId, clipIds } = await convex.mutation(api.clipJobs.recordCanvasClips, {
    mintAddress,
    sourceUrl: typeof sourceUrl === "string" ? sourceUrl : "",
    clips: cleanClips,
    authSecret: secret,
  });
  return NextResponse.json({ ok: true, jobId, clipIds });
}
