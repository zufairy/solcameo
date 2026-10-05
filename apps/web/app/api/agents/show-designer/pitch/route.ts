import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { generatePitches } from "@/lib/server/showDesigner";
import { createNftTask } from "@/lib/server/nftKie";
import { getArchetype } from "@/lib/builder/showArchetypes";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 60;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * PITCH step of the Show Designer: builder's raw description (+ optional
 * uploaded reference images) → 3 concrete show pitches, each with a KIE
 * style-frame image task kicked off (client polls /collect). Split
 * create/collect like character-design so the request never outlives the proxy
 * window while KIE renders.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  try {
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
    const body = await req.json() as { mintAddress?: string; concept?: string; refUrls?: string[]; archetypeHint?: string };
    const { mintAddress, concept } = body;
    const refUrls = (Array.isArray(body.refUrls) ? body.refUrls : [])
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, 4);
    if (!mintAddress || !concept?.trim()) {
      return NextResponse.json({ error: "mintAddress and concept required" }, { status: 400 });
    }
    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, agent);
      if (ownershipError) return ownershipError;
    }

    const pitches = await generatePitches({
      concept,
      agent: { name: agent.name, niche: agent.niche, description: agent.description, language: agent.language },
      hasRefImages: refUrls.length > 0,
      archetypeHint: typeof body.archetypeHint === "string" ? body.archetypeHint : undefined,
    });
    if (!pitches.length) {
      return NextResponse.json({ error: "Couldn't pitch from that description — add a bit more detail and retry" }, { status: 502 });
    }

    // One style-frame image task per pitch. Builder ref images ride along for
    // realistic archetypes (the frame should look like THEM), never for
    // stylized ones (the sheet look comes from the prompt, and AI-vs-real ref
    // mixing muddies the style). Best-effort per task — a failed kick leaves
    // that card frameless, still pickable.
    const tasks = await Promise.all(pitches.map(async (p, i) => {
      const stylized = getArchetype(p.archetype)?.refPolicy === "stylized";
      try {
        const taskId = await createNftTask(
          `${p.styleFramePrompt} — single frame, 9:16 vertical, no text overlays`,
          stylized ? undefined : (refUrls.length ? refUrls : undefined),
        );
        return { i, taskId };
      } catch (e) {
        console.warn(`[show-designer] style frame kick failed for pitch ${i}:`, e instanceof Error ? e.message : e);
        return { i, taskId: null };
      }
    }));

    return NextResponse.json({ pitches, tasks });
  } catch (err) {
    console.error("[show-designer/pitch]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "pitch failed" }, { status: 500 });
  }
}
