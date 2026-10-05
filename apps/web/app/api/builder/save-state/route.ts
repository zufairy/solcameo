import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { formatAgentDescription } from "@/lib/agentDescription";

export const maxDuration = 30;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export async function POST(req: NextRequest) {
  try {
    if (!CONVEX_URL) {
      return NextResponse.json({ error: "Convex URL not configured" }, { status: 500 });
    }

    const body = await req.json() as {
      sessionId: string;
      creatorWallet?: string;
      agentType?: string;
      persona?: {
        name?: string;
        handle?: string;
        niche?: string;
        audience?: string;
        backstory?: string;
        traits?: string[];
        beliefs?: string[];
        catchphrase?: string;
        dreamCollab?: string;
        contentPillars?: string[];
        voiceArchetype?: string;
        language?: string;
        avoidTopics?: string[];
      };
      avatarUrls?: string[];
      characterBible?: string;
      mintAddress?: string;
    };

    const { sessionId, creatorWallet, agentType, persona, characterBible, mintAddress } = body;
    // Strip base64 data URIs — Convex rejects fields > 1 MiB
    const avatarUrls = (body.avatarUrls ?? []).filter((u) => /^https?:\/\//i.test(u));

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    const convex = new ConvexHttpClient(CONVEX_URL);

    // Patching a minted influencer mutates owner-scoped data — require SIWS ownership.
    if (mintAddress && !auth.internal) {
      const influencer = await convex.query(api.influencers.getByMint, { mintAddress });
      const ownerErr = requireOwnerWithSiws(auth, influencer);
      if (ownerErr) return ownerErr;
    }

    // 1) Save/update working state in nftDrafts (always)
    const questionnaire = {
      backstory: persona?.backstory,
      traits: persona?.traits,
      beliefs: persona?.beliefs,
      catchphrase: persona?.catchphrase,
      dreamCollab: persona?.dreamCollab,
      contentPillars: persona?.contentPillars,
      voiceArchetype: persona?.voiceArchetype,
      language: persona?.language,
      avoidTopics: persona?.avoidTopics,
      audience: persona?.audience,
    };

    const draftId = await convex.mutation(api.nftAgents.saveWorkingState, {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      sessionId,
      creatorWallet,
      name: persona?.name,
      handle: persona?.handle,
      niche: persona?.niche,
      characterBible,
      avatarUrls,
      questionnaire,
    });

    // 2) If already minted, also patch the influencer record with latest persona data
    let updatedInfluencer = false;
    let influencerWarning: string | undefined;
    if (mintAddress) {
      try {
        const result = await convex.mutation(api.nftAgents.updateInfluencerPersona, {
          authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
          mintAddress,
          name: persona?.name,
          handle: persona?.handle,
          avatarUrl: avatarUrls?.[0],
          niche: persona?.niche,
          language: persona?.language,
          archetype: persona?.voiceArchetype,
          description: formatAgentDescription({
            name: persona?.name,
            niche: persona?.niche,
            archetype: persona?.voiceArchetype,
            agentType,
            audience: persona?.audience,
            contentPillars: persona?.contentPillars,
          }),
          agentType: agentType === "influencer" || agentType === "trader" || agentType === "worker" ? agentType : undefined,
        });
        updatedInfluencer = result !== null;
      } catch (err) {
        console.error("[save-state] influencer update failed:", err);
        influencerWarning = "Draft saved but influencer persona update failed — changes may not reflect on /agents until next save.";
      }
    }

    return NextResponse.json({ ok: true, draftId, updatedInfluencer, ...(influencerWarning ? { warning: influencerWarning } : {}) });
  } catch (err) {
    console.error("[save-state]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 },
    );
  }
}
