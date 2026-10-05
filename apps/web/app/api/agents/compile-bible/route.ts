import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { compileShowBible } from "@/lib/server/bibleCompiler";
import { normalizeShowBible } from "@/lib/builder/showBible";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const maxDuration = 60;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * POST /api/agents/compile-bible
 * Body: { mintAddress, concept, save? }
 * Compiles the operator's free-form show concept into a structured Show Bible
 * (merging over the existing bible on recompiles); `save: true` persists it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  try {
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
    const { mintAddress, concept, save } = await req.json() as { mintAddress?: string; concept?: string; save?: boolean };
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
    const bible = await compileShowBible({
      concept,
      existing: normalizeShowBible(agent.showBible),
      agent: {
        name: agent.name,
        niche: agent.niche,
        archetype: agent.archetype,
        description: agent.description,
        language: agent.language,
      },
    });
    if (!bible) return NextResponse.json({ error: "Bible compilation failed — try rephrasing the concept" }, { status: 502 });
    if (save) {
      await convex.mutation(api.influencers.setShowBible, {
        mintAddress, showBible: bible, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
    }
    return NextResponse.json({ bible });
  } catch (err) {
    console.error("[compile-bible]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "compile failed" }, { status: 500 });
  }
}
