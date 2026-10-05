import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { generateIdeas } from "@/lib/server/ideation";
import { normalizeShowBible } from "@/lib/builder/showBible";

export const runtime = "nodejs";
export const maxDuration = 120;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const SECRET = () => process.env.INTERNAL_CRON_SECRET ?? "";

/**
 * POST /api/agents/ideas — generate ideas NOW, nothing else.
 *
 * The full autonomy loop (ideate → select → produce → post) is the heartbeat's
 * job; the Ideas tab and the Home "Get ideas" button need JUST the ideation
 * stage, fast and predictable: expire stale news ideas, run the ideation LLM
 * against the show bible (+ live web search per news query), insert the batch.
 * Owner-gated (SIWS) for user callers, internal secret for server callers.
 *
 * Body: { mintAddress }
 * Returns: { ok, ideated, fresh } — `fresh` is the actionable pool size after.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const { mintAddress } = (await req.json().catch(() => ({}))) as { mintAddress?: string };
  if (!mintAddress) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const agent = await convex.query(api.influencers.getByMint, { mintAddress });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!auth.internal) {
    const ownershipError = requireOwnerWithSiws(auth, agent);
    if (ownershipError) return ownershipError;
  }

  const bible = normalizeShowBible((agent as { showBible?: unknown }).showBible);
  if (!bible) {
    return NextResponse.json(
      { error: "No show plan yet — finish the Director tab's setup wizard first, then ideas can be generated." },
      { status: 409 },
    );
  }

  // Expire stale news ideas so the fresh count below is honest.
  await convex.mutation(api.contentIdeas.expireStalePublic, { mintAddress, authSecret: SECRET() }).catch(() => null);

  // Anti-repetition context: existing ideas + recently produced video topics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentIdeas: any[] = await convex.query(api.contentIdeas.listForMint, { mintAddress, limit: 50 }).catch(() => []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentTasks: any[] = await convex.query(api.agentTasks.listByMint, { mintAddress, limit: 15 }).catch(() => []);
  const recentScriptTopics = (Array.isArray(recentTasks) ? recentTasks : [])
    .filter((t) => t?.type === "create_video")
    .map((t) => String(t?.title ?? "").replace(/^(Create video|Idea):\s*/i, "").trim())
    .filter(Boolean);
  const recentIntents = recentIdeas
    .filter((i) => i.status === "produced" || i.status === "producing")
    .map((i) => String(i.intent ?? "entertain"))
    .slice(0, 8);

  try {
    const candidates = await generateIdeas({
      bible,
      tasteProse: String((agent as { tasteProfile?: { prose?: string } }).tasteProfile?.prose ?? ""),
      recentHeadlines: recentIdeas.map((i: { headline: string }) => i.headline),
      recentScriptTopics,
      recentIntents,
    });
    let ideated = 0;
    if (candidates.length) {
      const r = await convex.mutation(api.contentIdeas.insertBatch, {
        mintAddress, ideas: candidates, authSecret: SECRET(),
      });
      ideated = r.inserted;
    }
    const fresh = await convex.query(api.contentIdeas.listFreshProposed, { mintAddress }).catch(() => []);
    // ideated:0 used to come back as a bare `{ ok: true }` with no explanation —
    // the click looked broken even though the request genuinely succeeded.
    // Two distinct zero cases, worth telling apart: the ideation LLM call
    // itself returned nothing (generateIdeas swallows its own failures into
    // [] — see lib/server/ideation.ts), vs. it DID pitch ideas but every one
    // was too similar to something already in the pool (contentIdeas.ts's
    // insertBatch dedup, a real and expected outcome, not a bug).
    const message = ideated > 0
      ? undefined
      : candidates.length === 0
        ? "Couldn't come up with new ideas this time — try again in a moment."
        : "The new ideas were too similar to ones you already have — nothing new added. Try again for a different batch.";
    return NextResponse.json({ ok: true, ideated, fresh: Array.isArray(fresh) ? fresh.length : 0, ...(message ? { message } : {}) });
  } catch (e) {
    console.error("[agents/ideas] ideation failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Idea generation failed — please try again." }, { status: 500 });
  }
}
