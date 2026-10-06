import { beginAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { generateVideoScript } from "@/lib/server/videoScript";
import { planNextEpisode, seriesEnabled } from "@/lib/server/seriesRun";
import { resolveVideoDirectives } from "@/lib/builder/videoDirector";
import { getVideoEngine, clipsForLength, MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS } from "@/lib/builder/agentTypes";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

type SeriesConfig = { enabled?: boolean; premise?: string; world?: string; themes?: string[]; cast?: Array<{ name: string; role?: string; designPrompt?: string; refImages?: string[] }> };

/**
 * Series episode IDEATION — plans the next episode (planNextEpisode, same path
 * run-task uses) and writes its script, WITHOUT touching the wallet or creating
 * a task. The operator reviews this on cards; only when they tap "Create
 * episode" does /api/agents/run-task run the (paid) render — passed the SAME
 * premise + script this route returned, so what's created matches what was
 * previewed exactly (see run-task's `inputScript` short-circuit).
 */
export async function POST(req: NextRequest) {
  let refund: (() => Promise<void>) | undefined;
  try {
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

    const body = (await req.json()) as { mintAddress?: string; prompt?: string };
    const { mintAddress, prompt } = body;
    if (!mintAddress) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });

    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    if (!auth.internal) {
      const ownerErr = requireOwnerWithSiws(auth, agent);
      if (ownerErr) return ownerErr;
    }

    const seriesCfg = (agent as { videoConfig?: { series?: SeriesConfig } }).videoConfig?.series;
    if (!seriesEnabled(seriesCfg)) {
      return NextResponse.json({ error: "Series mode is off — turn it on first." }, { status: 400 });
    }

    const billing = await beginAgentGeneration(req, mintAddress, "llm_message");
    if (billing.error) return billing.error;
    refund = billing.refund;
    const draft = await convex.query(api.nftAgents.getDraftByMint, { mintAddress });
    const sessionId = draft?.sessionId ?? "";
    const [knowledgeRaw, memoriesRaw] = await Promise.all([
      sessionId ? convex.query(api.agentKnowledge.listBySession, { sessionId }) : Promise.resolve([]),
      convex.query(api.agentTasks.recallMemories, { mintAddress, limit: 12 }),
    ]);
    const memories = (memoriesRaw ?? []).map((m: Doc<"agentMemory">) => ({ kind: m.kind, summary: m.summary, importance: m.importance }));

    const episode = await planNextEpisode({
      mintAddress,
      series: seriesCfg!,
      persona: {
        name: agent.name,
        characterBible: draft?.characterBible,
        niche: agent.niche,
        pillars: Array.isArray(draft?.questionnaire?.contentPillars) ? (draft!.questionnaire!.contentPillars as string[]) : undefined,
        memories: memories.map((m: { summary: string }) => m.summary),
      },
      operatorPrompt: prompt?.trim() || undefined,
    });

    const ctx = {
      knowledge: (knowledgeRaw ?? []).map((k: Doc<"agentKnowledge">) => ({ title: k.title, content: k.content })),
      memories,
      draft: draft ? { questionnaire: draft.questionnaire as Record<string, unknown> | undefined, characterBible: draft.characterBible } : null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directives = resolveVideoDirectives(agent as any, {}, `${mintAddress}:${episode.topic}:series`);

    const skillFilesRaw = await convex.query(api.agentSkillFiles.listByMint, { mintAddress }).catch(() => []);
    const skills = (skillFilesRaw ?? [])
      .slice(0, 8)
      .map((s: Doc<"agentSkillFiles">) => ({ name: s.title || s.skillId, instructions: (s.markdown ?? "").replace(/^---[\s\S]*?---\s*/, "").trim() }))
      .filter((s: { name: string; instructions: string }) => s.instructions.length > 0);

    const script = await generateVideoScript(
      { name: agent.name, niche: agent.niche, language: agent.language, archetype: agent.archetype },
      ctx,
      { topic: episode.topic, targetSeconds: directives.durationSeconds, brief: directives.brief, skills },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = getVideoEngine(((agent as any).videoEngine) as any);
    const estSeconds = Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, Math.round(directives.durationSeconds)));
    const clipCount = clipsForLength(engine, estSeconds);

    return NextResponse.json({
      ok: true,
      episodeNumber: episode.episodeNumber,
      intent: episode.intent,
      reason: episode.reason,
      premise: episode.topic,
      cast: episode.cast.map((c) => ({ name: c.name, role: c.role, refImage: c.refImages?.[0] })),
      hook: script.hook,
      script: script.scriptText,
      caption: script.caption,
      sceneBeats: Array.isArray((script.raw as Record<string, unknown> | undefined)?.scene_beats)
        ? (script.raw as Record<string, unknown>).scene_beats
        : [],
      estSeconds,
      clipCount,
      engine: { id: engine.id, label: engine.label },
    });
  } catch (err) {
    await refund?.();
    console.error("[series/preview-episode]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Episode ideation failed" }, { status: 500 });
  }
}
