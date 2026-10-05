import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { compileShowBible } from "@/lib/server/bibleCompiler";
import { normalizeShowBible, type ShowBibleVisualRef } from "@/lib/builder/showBible";
import type { ShowPitch } from "@/lib/server/showDesigner";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 60;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * COMMIT step of the Show Designer: the chosen pitch (+ optional remix note,
 * style frame, and builder reference images) becomes the agent's full Show
 * Bible. Also seeds the PILOT: the pitch's first sample idea lands approved in
 * the idea queue and the agent flips to "review-video" autonomy, so the first
 * render waits for the builder's approval before anything free-runs.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  try {
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
    const body = await req.json() as {
      mintAddress?: string;
      pitch?: ShowPitch;
      styleFrameUrl?: string;
      refUrls?: string[];
      remix?: string;
    };
    const { mintAddress, pitch } = body;
    if (!mintAddress || !pitch?.name || !pitch?.premise) {
      return NextResponse.json({ error: "mintAddress and pitch required" }, { status: 400 });
    }
    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, agent);
      if (ownershipError) return ownershipError;
    }

    const secret = process.env.INTERNAL_CRON_SECRET ?? "";
    const remix = (body.remix ?? "").trim();
    const concept = [
      `Show: "${pitch.name}" — ${pitch.premise}`,
      `Formats: ${pitch.formatKinds.join(", ")}.`,
      remix ? `Builder's adjustment: ${remix}` : "",
    ].filter(Boolean).join(" ");

    const visualRefs: ShowBibleVisualRef[] = [];
    if (typeof body.styleFrameUrl === "string" && /^https?:\/\//i.test(body.styleFrameUrl)) {
      visualRefs.push({ url: body.styleFrameUrl, kind: "style-frame", role: "style", locked: true });
    }
    for (const u of (Array.isArray(body.refUrls) ? body.refUrls : []).slice(0, 4)) {
      if (typeof u === "string" && /^https?:\/\//i.test(u)) {
        // The builder chose these images themselves — real material, locked.
        visualRefs.push({ url: u, kind: "real-photo", role: "style", locked: true });
      }
    }

    const compiled = await compileShowBible({
      concept,
      existing: normalizeShowBible(agent.showBible),
      agent: { name: agent.name, niche: agent.niche, archetype: agent.archetype, description: agent.description, language: agent.language },
    });
    if (!compiled) return NextResponse.json({ error: "Bible compilation failed — try again" }, { status: 502 });
    // The pitch's choices are the builder's word — they win over the compiler's.
    const bible = normalizeShowBible({
      ...compiled,
      archetype: pitch.archetype,
      format: { ...compiled.format, kinds: pitch.formatKinds.length ? pitch.formatKinds : compiled.format.kinds },
      visualRefs: [...(compiled.visualRefs ?? []), ...visualRefs],
    });
    if (!bible) return NextResponse.json({ error: "Bible normalization failed" }, { status: 500 });

    await convex.mutation(api.influencers.setShowBible, { mintAddress, showBible: bible, authSecret: secret });

    // Pilot: first sample idea pre-approved, autonomy in review mode.
    const pilot = pitch.sampleIdeas?.[0];
    if (pilot?.headline && pilot?.angle) {
      await convex.mutation(api.contentIdeas.insertBatch, {
        mintAddress,
        ideas: [{ headline: pilot.headline, angle: pilot.angle, source: "user", format: pitch.formatKinds[0] ?? "", score: 95 }],
        authSecret: secret,
      }).catch((e) => console.warn("[show-designer/commit] pilot seed failed:", e instanceof Error ? e.message : e));
    }
    await convex.mutation(api.influencers.setAutonomyMode, { mintAddress, mode: "review-video", authSecret: secret })
      .catch((e) => console.warn("[show-designer/commit] autonomy set failed:", e instanceof Error ? e.message : e));

    return NextResponse.json({ bible, pilotHeadline: pilot?.headline ?? null });
  } catch (err) {
    console.error("[show-designer/commit]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "commit failed" }, { status: 500 });
  }
}
