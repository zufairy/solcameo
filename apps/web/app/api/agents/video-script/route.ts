import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { generateVideoScript } from "@/lib/server/videoScript";
import { resolveVideoDirectives } from "@/lib/builder/videoDirector";
import { normalizeShowBible, normalizeRotationState, resolveBibleDirectives, matchVideoStyle, bibleVideoStyles } from "@/lib/builder/showBible";
import { generateIdeas } from "@/lib/server/ideation";
import { resolveAgentDirectives, applyDirectivesToBrief, isEmptyDirective } from "@/lib/server/agentDirectives";
import {
  getVideoEngine,
  clipsForLength,
  MIN_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS,
} from "@/lib/builder/agentTypes";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Script preview — generates the video script (Claude Haiku 4.5) WITHOUT touching
 * the wallet or creating a task. The builder shows it on a confirm card; only when
 * the operator taps Generate does /api/agents/run-task run the (paid) render.
 */
export async function POST(req: NextRequest) {
  try {
    // AUTH GATE — this route runs paid LLM script generation (Claude Haiku / Gemini)
    // on the platform KIE key. Require an internal secret or a logged-in user; user
    // callers must also prove SIWS ownership of the agent (below) so only the owner
    // can preview its script + private knowledge. Mirrors app/api/agents/chat.
    // Browser callers carry the Privy bearer + SIWS session via the global /api/
    // fetch interceptor (transparent siws_required retry), so the UI is unchanged.
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

    const body = (await req.json()) as { mintAddress?: string; topic?: string; durationSeconds?: number; refinement?: string; styleId?: string };
    const { mintAddress, topic, durationSeconds, refinement } = body;
    if (!mintAddress) return NextResponse.json({ error: "mintAddress required" }, { status: 400 });

    const convex = new ConvexHttpClient(CONVEX_URL);
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    // Owned agent → require the SIWS-proven owner (internal cron callers skip).
    if (!auth.internal) {
      const ownerErr = requireOwnerWithSiws(auth, agent);
      if (ownerErr) return ownerErr;
    }

    const draft = await convex.query(api.nftAgents.getDraftByMint, { mintAddress });
    const sessionId = draft?.sessionId ?? "";
    const [knowledgeRaw, memoriesRaw] = await Promise.all([
      sessionId ? convex.query(api.agentKnowledge.listBySession, { sessionId }) : Promise.resolve([]),
      convex.query(api.agentTasks.recallMemories, { mintAddress, limit: 12 }),
    ]);

    const ctx = {
      knowledge: (knowledgeRaw ?? []).map((k: Doc<"agentKnowledge">) => ({ title: k.title, content: k.content })),
      memories: (memoriesRaw ?? []).map((m: Doc<"agentMemory">) => ({ kind: m.kind, summary: m.summary, importance: m.importance })),
      draft: draft
        ? {
            questionnaire: draft.questionnaire as Record<string, unknown> | undefined,
            characterBible: draft.characterBible,
          }
        : null,
    };

    // Resolve the Video Director directives so the preview matches the real render:
    //  - brief: the persona-aware style (format/angle/structureNotes from the
    //    config — talking-head vs commercial vs OOTD, energy, CTA, custom direction)
    //  - default duration: the config's length range (used when no length is picked)
    // An EXPLICIT length pick from the card is respected verbatim (so picking a
    // longer time actually rewrites a longer script); only the no-pick first write
    // falls back to the config length.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directives = resolveVideoDirectives(agent as any, {}, `${mintAddress}:${topic ?? ""}:${durationSeconds ?? "auto"}`);
    let effectiveSeconds = typeof durationSeconds === "number" ? durationSeconds : directives.durationSeconds;

    // SHOW BIBLE WINS: when the operator has compiled a bible, the preview script
    // must be written to ITS format/voice/world — not the videoConfig fallback —
    // or the card (and the render that reuses the card's script verbatim) tells a
    // different show than the one the operator just designed. Same resolver the
    // heartbeat pipeline uses; rotation state is read-only here (the heartbeat
    // owns advancing it), so previewing never perturbs the rotation.
    const bible = normalizeShowBible((agent as { showBible?: unknown }).showBible);
    // The operator's raw ask ("make a video about X") becomes the actual video
    // topic below — resolveBibleDirectives only ever set format/duration/voice,
    // never premise, which is why a bible-configured agent's ad-hoc videos used
    // to ignore the show's actual premise ("Ask Lisa Lah" etc) entirely.
    let resolvedTopic = topic;
    let styleUsed: { id: string; name: string } | null = null;
    if (bible) {
      // Style targeting: an EXPLICIT styleId (Videos-tab picker / copilot action)
      // wins; else the operator naming a style in their ask ("make a Street
      // Interview about rent") pins that style's recipe. No match → weighted
      // rotation, same as the heartbeat.
      const pinnedStyle = (typeof body.styleId === "string" && body.styleId.trim()
        ? bibleVideoStyles(bible).find((s) => s.id === body.styleId!.trim())
        : undefined)
        ?? (topic ? matchVideoStyle(bible, topic) : undefined);
      if (pinnedStyle) styleUsed = { id: pinnedStyle.id, name: pinnedStyle.name };
      const bd = resolveBibleDirectives(bible, normalizeRotationState((agent as { rotationState?: unknown }).rotationState), {
        durationSeconds: typeof durationSeconds === "number" ? durationSeconds : undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        engine: (agent as any).videoEngine,
        ...(pinnedStyle ? { styleId: pinnedStyle.id } : {}),
      });
      directives.brief = bd.brief;
      if (typeof durationSeconds !== "number") effectiveSeconds = bd.durationSeconds;

      // Ideate a topic from the bible ONLY when the operator gave none ("just
      // make a video"). When the copilot ask CARRIES a topic ("a video about X"),
      // that topic is the subject, verbatim — we used to feed it through
      // generateIdeas as a requestedAngle and adopt the LLM's "headline — angle"
      // rewrite, which routinely drifted off the operator's idea, so the script
      // (and every KIE clip prompt downstream) was "not what I asked for". The
      // bible still fully drives the video via directives.brief above (format,
      // structure, voice, visual world, duration) — it just never swaps the
      // SUBJECT out from under the operator.
      // Read-only against contentIdeas (no pool writes here — this previews a
      // script, it doesn't consume/advance the heartbeat's idea queue).
      // Best-effort: a failure here falls back to a niche-update topic.
      // Skipped on a refinement pass — the topic was already resolved on the
      // initial preview; re-ideating on every tweak would swap the subject out
      // from under the operator mid-edit.
      if (!refinement && !topic?.trim()) try {
        const [recentIdeasRaw, recentTasksRaw] = await Promise.all([
          convex.query(api.contentIdeas.listForMint, { mintAddress, limit: 20 }).catch(() => []),
          convex.query(api.agentTasks.listByMint, { mintAddress, limit: 15 }).catch(() => []),
        ]);
        const recentHeadlines = (Array.isArray(recentIdeasRaw) ? recentIdeasRaw : [])
          .map((i: { headline?: string }) => String(i?.headline ?? "")).filter(Boolean);
        const recentScriptTopics = (Array.isArray(recentTasksRaw) ? recentTasksRaw : [])
          .filter((t: { type?: string }) => t?.type === "create_video")
          .map((t: { title?: string }) => String(t?.title ?? "").replace(/^Create video:\s*/i, "").trim())
          .filter(Boolean);
        const [idea] = await generateIdeas({
          bible,
          tasteProse: String((agent as { tasteProfile?: { prose?: string } }).tasteProfile?.prose ?? ""),
          recentHeadlines,
          recentScriptTopics,
          count: 1,
        });
        if (idea) {
          resolvedTopic = `${idea.headline} — ${idea.angle}`;
          // The idea is stamped with the video style it was written FOR — resolve
          // that style's full recipe so the script matches the style, not just
          // its format label.
          const ideaStyle = bibleVideoStyles(bible).find((s) => s.id === idea.styleId);
          if (ideaStyle) {
            styleUsed = { id: ideaStyle.id, name: ideaStyle.name };
            const sbd = resolveBibleDirectives(bible, normalizeRotationState((agent as { rotationState?: unknown }).rotationState), {
              styleId: ideaStyle.id,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              engine: (agent as any).videoEngine,
            });
            directives.brief = sbd.brief;
          } else {
            directives.brief = { ...directives.brief, format: idea.format || directives.brief.format };
          }
          if (typeof durationSeconds !== "number") effectiveSeconds = idea.suggestedDurationSec;
        }
      } catch (e) {
        console.warn("[agents/video-script] bible-aware topic resolution skipped:", e instanceof Error ? e.message : e);
      }
    }

    // ── STANDING ORDERS — the SAME resolver run-task uses. Without this the
    // preview script ignored every chat directive ("no speaking", "switch to
    // Malay", "commercial style"): the card's script was written with spoken
    // lines, then rendered verbatim, so the order never took effect anywhere.
    const manualConfigAt = (agent as { videoConfig?: { manualUpdatedAt?: number } }).videoConfig?.manualUpdatedAt;
    const orders = resolveAgentDirectives(ctx.memories, manualConfigAt);
    // BIBLE-AUTHORED INTENT — same as run-task: "no speaking" typed in the
    // onboarding premise/tunables binds the preview script too. Chat orders win.
    if (bible && !orders.speech) {
      const { parseDirectives } = await import("@/lib/server/agentDirectives");
      const tunableText = (bible.videoStyles ?? []).flatMap((s) => Object.values(s.tunables ?? {})).join(". ");
      const bibleIntent = parseDirectives([bible.premise, tunableText].filter(Boolean).join("\n"));
      if (bibleIntent.speech) orders.speech = bibleIntent.speech;
    }
    if (!isEmptyDirective(orders)) {
      directives.brief = applyDirectivesToBrief(directives.brief, orders);
    }
    // PER-FORMAT SCRIPT RECIPE — same injection as run-task, so the preview
    // card's script matches what the render's script stage would write.
    {
      const { formatById: formatForRecipe } = await import("@/lib/builder/formatCatalog");
      const recipe = formatForRecipe(directives.brief.format)?.scriptRecipe;
      if (recipe) {
        directives.brief = {
          ...directives.brief,
          structureNotes: [`FORMAT SCRIPT RECIPE (follow this structure exactly): ${recipe}`, directives.brief.structureNotes].filter(Boolean).join(". "),
        };
      }
    }

    // Active authored skills (e.g. a "Malaysian Malay" skill) so the script obeys them.
    const skillFilesRaw = await convex.query(api.agentSkillFiles.listByMint, { mintAddress }).catch(() => []);
    const skills = (skillFilesRaw ?? [])
      .slice(0, 8)
      .map((s: Doc<"agentSkillFiles">) => ({ name: s.title || s.skillId, instructions: (s.markdown ?? "").replace(/^---[\s\S]*?---\s*/, "").trim() }))
      .filter((s: { name: string; instructions: string }) => s.instructions.length > 0);

    const script = await generateVideoScript(
      // A chat "speak in X" directive wins over the onboarding-time language.
      { name: agent.name, niche: agent.niche, language: orders.language || agent.language, archetype: agent.archetype },
      ctx,
      {
        topic: resolvedTopic, targetSeconds: effectiveSeconds, brief: directives.brief, skills, refinement,
        // "No speaking" standing order → the script itself pivots to on-screen
        // text + visual beats (not just the render).
        ...(orders.speech === "silent" ? { speech: "silent" as const } : {}),
        // The compiled show bible IS the persona — replaces the old draft persona
        // wholesale in the prompt so scripts follow the show, not the onboarding
        // questionnaire.
        ...(bible ? {
          bible: {
            premise: bible.premise,
            voiceTone: bible.voice.tone,
            language: bible.voice.language,
            catchphrases: bible.voice.catchphrases,
            visualStyle: bible.visualWorld.style,
            cast: bible.cast,
          },
        } : {}),
      },
    );

    // Engine-aware estimate so the card matches what the pipeline will render.
    // Report the REQUESTED length (not a re-estimate of the script), so the card's
    // "~Xs" updates the moment a new length is picked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = getVideoEngine(((agent as any).videoEngine) as any);
    const estSeconds = Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, Math.round(effectiveSeconds)));
    const clipCount = clipsForLength(engine, estSeconds);

    return NextResponse.json({
      ok: true,
      topic: script.topic,
      ...(styleUsed ? { styleId: styleUsed.id, styleName: styleUsed.name } : {}),
      hook: script.hook,
      script: script.scriptText,
      caption: script.caption,
      hashtags: script.hashtags,
      raw: script.raw,
      estSeconds,
      clipCount,
      durationSeconds: estSeconds,
      engine: { id: engine.id, label: engine.label, maxClipSeconds: engine.maxClipSeconds },
    });
  } catch (err) {
    console.error("[agents/video-script]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Script generation failed" }, { status: 500 });
  }
}
