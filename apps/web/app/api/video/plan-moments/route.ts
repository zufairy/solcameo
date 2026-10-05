import { NextRequest, NextResponse } from "next/server";
import { boundCutWindow } from "@/lib/clip/cutWindow";
import { dedupeOverlappingInOrder, selectClipMoments, snapEndToWordBoundary } from "@/lib/server/clipMomentSelector";
import { planClipEdits } from "@/lib/server/clipEditPlanner";
import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import type { EditOp } from "@/lib/server/clipEditOps";
import type { Transcript, TranscriptSegment, TranscriptWord } from "@/lib/server/clipTypes";
import type { AnalyzedMoment } from "@/lib/server/clipAnalysis";
import { selectMomentsByPrompt } from "@/lib/server/promptSelect";
import { genreScore } from "@/lib/builder/clipGenres";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

// Picks ONE highlight moment + an edit plan (captions etc.) for the local
// "demo run" the Flow tab orchestrates from the browser. The browser can't call
// these server libs directly (they use the KIE key), so this route exposes them.
// Mirrors the moment-selection + edit-planning steps of convex/clipJobs.process,
// minus the Convex job tracking. Tolerant of an empty transcript (no-speech
// source) — it falls back to a sensible fixed window.
export const runtime = "nodejs";
export const maxDuration = 300;

const KIE_KEY = process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";

export async function POST(req: NextRequest) {
  // Gate it like every sibling KIE route — this calls the paid server KIE key
  // (selectClipMoments + planClipEdits). Without auth it was an unauthenticated
  // cost-amplification drain on the shared key.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }
  let body: {
    transcript?: Partial<Transcript>;
    clipConfig?: unknown;
    // Extra per-node config fields (framingMode, sticker*, bg*, audio*, gainDb) ride
    // each object at runtime and are forwarded to planClipEdits unchanged. They are
    // intentionally NOT listed here: PlanArgs.skills types several of them as literal
    // unions, and re-declaring them as `string` here would break assignability (TS2719).
    skills?: { skillId?: string; name: string; instructions: string; captionPreset?: string; captionPrompt?: string; hookDurationSec?: number; hookTemplateId?: string }[];
    analysis?: { moments?: AnalyzedMoment[] };
    /** Preferred clip feel (Source node) — matching emotions rank first. */
    clipFeel?: string;
    /** Content genre (Source node) — re-weights virality sub-scores. */
    genre?: string;
    /** "Let AI decide" — use the analyzer's natural windows + moment count
        instead of the length/count sliders. */
    autoPlan?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  // Pre-ranked moments from the one-time analysis (the master cache). When
  // present we use them directly — already scored by virality — and skip the
  // redundant live moment-selection KIE call (OpusClip-style auto-pick).
  const analysisMoments = Array.isArray(body.analysis?.moments)
    ? body.analysis!.moments!.filter((m) => typeof m?.startSeconds === "number" && typeof m?.endSeconds === "number")
    : [];

  const skills = Array.isArray(body.skills)
    ? body.skills.filter((s) => s && typeof s.name === "string" && typeof s.instructions === "string")
    : [];

  const t = body.transcript ?? {};
  const segments = (Array.isArray(t.segments) ? t.segments : []) as TranscriptSegment[];
  const words = (Array.isArray(t.words) ? t.words : []) as TranscriptWord[];
  let durationSeconds = Number(t.durationSeconds ?? 0);
  if (!(durationSeconds > 0)) {
    durationSeconds = Math.max(segments.at(-1)?.end ?? 0, words.at(-1)?.end ?? 0, 0);
  }
  const transcript: Transcript = { segments, words, durationSeconds };

  // Local run: never auto-post, and STAY CAPPED LOW. This route runs planClipEdits
  // per clip SYNCHRONOUSLY inside the function time budget, so it must not attempt
  // the operator's full "Number of clips" (now up to 60) — 60 sequential KIE calls
  // would blow maxDuration → 502. The high count (and the per-moment variations that
  // reach it) is a CLOUD-ONLY path (clipJobs.process → clip-batch-start, off-wall).
  // Here we hard-cap: autoPlan at 12, manual at LOCAL_RUN_CLIP_CAP. The canvas run
  // logs when it capped the requested count so it's never silent.
  const LOCAL_RUN_CLIP_CAP = 12;
  const autoPlan = body.autoPlan === true;
  const requestedClips = autoPlan
    ? // "as many strong moments as the source supports" — capped so the per-moment
      // edit-planning (a KIE call each) finishes inside the function time budget.
      Math.min(LOCAL_RUN_CLIP_CAP, analysisMoments.length > 0 ? analysisMoments.length : LOCAL_RUN_CLIP_CAP)
    : // Manual count: honor the slider but CLAMP to the local cap (cloud does the
      // full up-to-60). Kept at 5 historically; raised to the shared local cap so a
      // local preview can surface a few more without risking a 502.
      Math.min(
        LOCAL_RUN_CLIP_CAP,
        Math.max(1, Math.round(Number((body.clipConfig as Record<string, unknown> | undefined)?.maxClipsPerSource) || 1)),
      );
  const config = normalizeClipConfig({
    ...(body.clipConfig && typeof body.clipConfig === "object" ? (body.clipConfig as Record<string, unknown>) : {}),
    maxClipsPerSource: requestedClips,
    autoPost: false,
  });

  try {
    // Prompt-to-Clip: an operator prompt (clip.prompt skill node) steers the
    // selection — only matching moments get clipped. Falls back to the default
    // ranking when nothing matches.
    const promptSkill = skills.find((s) => s.skillId === "clip.prompt" && s.instructions.trim().length > 0);
    type LooseMoment = { startSeconds: number; endSeconds: number; title?: string; reason?: string; viralScore?: number; captionText?: string; emotion?: string };
    let rawMoments: LooseMoment[] = [];
    let promptSteered = false;
    if (promptSkill) {
      const matched = await selectMomentsByPrompt({
        transcript, prompt: promptSkill.instructions.trim(), config,
        candidates: analysisMoments, apiKey: KIE_KEY,
      });
      if (matched.length > 0) { rawMoments = matched; promptSteered = true; }
    }
    // Prefer the cached, pre-ranked analysis moments; else select live.
    // Genre re-weights the analysis sub-scores (hook/flow/value/trend) before
    // sorting — deterministic, cache-safe (the analysis itself stays
    // genre-neutral), zero extra LLM cost. "auto" = default virality weights.
    const genre = String(body.genre ?? "auto").toLowerCase();
    if (!promptSteered) {
      rawMoments = analysisMoments.length > 0
        ? [...analysisMoments].sort((a, b) => genreScore(b, genre) - genreScore(a, genre))
        : await selectClipMoments(transcript, config, { apiKey: KIE_KEY, genre });
    }
    // Clip Feel: moments matching the requested emotion rank FIRST (stable —
    // virality order kept within each group). "any"/unknown = no reordering.
    // Skipped when prompt-steered: an explicit operator prompt outranks feel,
    // and reshuffling its relevance ordering would betray the request.
    const feel = String(body.clipFeel ?? "any").toLowerCase();
    if (!promptSteered && feel !== "any" && feel.length > 0) {
      const match = rawMoments.filter((m) => (m.emotion ?? "").toLowerCase() === feel);
      if (match.length > 0) rawMoments = [...match, ...rawMoments.filter((m) => (m.emotion ?? "").toLowerCase() !== feel)];
    }
    const usedAnalysis = promptSteered || analysisMoments.length > 0;
    // Never cut the same moment twice (the analysis can return same-start picks
    // with slightly different ends) — fewer clips beats duplicate posts.
    const picked = dedupeOverlappingInOrder(rawMoments).slice(0, requestedClips);
    if (picked.length === 0) picked.push(undefined as never); // fallback window below

    // Normalize every picked moment to a valid cut window: guarantee end>start
    // even with no transcript, and enforce the configured minimum (LLM moments
    // are advisory and often come back too short on best-effort timings).
    // autoPlan: relax the minimum so the analyzer's natural windows pass through
    // untouched (it already picks self-contained moments); otherwise honor the slider.
    const minLen = autoPlan ? 8 : config.clipLength.min;
    const clampWindow = (top?: (typeof rawMoments)[number]) => {
      let start = Math.max(0, Math.floor(top?.startSeconds ?? 0));
      let end = Math.ceil(top?.endSeconds ?? 0);
      if (!(end > start)) {
        start = 0;
        const want = Math.max(minLen, Math.min(config.clipLength.max, 20));
        end = durationSeconds > 1 ? Math.min(durationSeconds, want) : want;
      }
      if (end - start < minLen) {
        end = durationSeconds > 1 ? Math.ceil(Math.min(durationSeconds, start + minLen)) : start + minLen;
        if (end - start < minLen) start = Math.max(0, Math.floor(end - minLen));
      }
      // Cap the MAX window so a long or hallucinated moment can't become a giant
      // segment download + giant in-RAM buffer at the cut step (×concurrency).
      // autoPlan allows slightly longer natural windows; manual honors the slider.
      const maxLen = autoPlan ? Math.max(config.clipLength.max, 90) : config.clipLength.max;
      if (end - start > maxLen) end = start + maxLen;
      // The window above is picked purely by TIME (LLM/analysis timestamps,
      // clamped to the length slider) — snap the end onto a real word boundary
      // so the clip finishes its sentence instead of cutting mid-word.
      end = snapEndToWordBoundary(words, end, { minEnd: start + minLen, maxEnd: start + maxLen });
      return {
        ...boundCutWindow(start, end, durationSeconds, { min: minLen, max: maxLen }),
        title: top?.title || "Highlight",
        reason: top?.reason || "",
        viralScore: top?.viralScore ?? 50,
        emotion: (top as Partial<AnalyzedMoment> | undefined)?.emotion || "",
        captionText: top?.captionText || "",
      };
    };

    // Per-moment edit plan. Agentic path (skill nodes present) runs the LLM
    // editor per clip — its overlays/zooms are timed to that clip's window. Each
    // plan is independent, so run them CONCURRENTLY (concurrency-capped to avoid
    // hammering KIE) — N sequential KIE calls on a multi-moment autoPlan was the
    // 502 timeout. Order is preserved (plans[0] = the best moment).
    const planOne = async (top: (typeof picked)[number]): Promise<{ moment: ReturnType<typeof clampWindow>; ops: EditOp[] }> => {
      const moment = clampWindow(top);
      const window = segments.filter((s) => s.end > moment.startSeconds && s.start < moment.endSeconds);
      let ops: EditOp[];
      if (skills.length > 0) {
        ops = await planClipEdits({ skills, config, window, words, moment }, { apiKey: KIE_KEY });
      } else {
        ops = [{ op: "reframe", mode: "crop" }];
        if (config.captionsOn && words.length > 0) ops.push({ op: "subtitles", style: config.captionStyle });
      }
      return { moment, ops };
    };
    const CONCURRENCY = 5;
    const plans: { moment: ReturnType<typeof clampWindow>; ops: EditOp[] }[] = new Array(picked.length);
    for (let i = 0; i < picked.length; i += CONCURRENCY) {
      const results = await Promise.all(picked.slice(i, i + CONCURRENCY).map(planOne));
      results.forEach((r, j) => { plans[i + j] = r; });
    }

    // `moment`/`ops` mirror plans[0] for backward compatibility.
    return NextResponse.json({
      ok: true,
      moment: plans[0].moment,
      ops: plans[0].ops,
      plans,
      durationSeconds,
      agentic: skills.length > 0,
      usedAnalysis,
      promptSteered,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
