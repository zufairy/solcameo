import { NextRequest, NextResponse } from "next/server";
import { isModerationError, nextFallbackEngine, parseTried } from "@/lib/builder/moderationFallback";
import { higgsfieldConfigured } from "@/lib/server/higgsfield";
import { MOTION_SWAP_FORMAT_ID, motionReferenceFromBible, renderMotionSwap } from "@/lib/server/motionSwap";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { putVideo } from "@/lib/server/videoStorage";
import type { Id } from "@/convex/_generated/dataModel";
import {
  generateVideoFromScript,
  buildVeoChainPlan,
  renderVeoChainClip,
  type GenerateVideoArgs,
  type StoryBeat,
  type VeoChainPlan,
} from "@/lib/server/kie-video-pipeline";
import { settleAgentEconomics } from "@/lib/economy/settleAgent";
import { resolveHookBurnPayload, type HookBurnPayload } from "@/lib/builder/hookDesigns";
import { hookContentBasis } from "@/lib/server/videoContentProbe";
import { pickFromPool } from "@/lib/server/videoPool";
import { loadPool, warmPool } from "@/lib/server/videoPoolContext";
import { probeRemoteVideoDurationSeconds } from "@/lib/server/ffmpegBin";

// The render runs ENTIRELY in the Next runtime (reaches Kie + stitches in-process),
// as a chain of short sub-300s invocations. See
// docs/superpowers/specs/2026-06-03-vercel-safe-agentic-video-render-design.md.
export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_KEY = process.env.KIE_API_KEY ?? "";
// videoRenderJobs.patch/create are INTERNAL_CRON_SECRET-gated (they feed auto-posts);
// this server route injects the secret on every patch. Empty in local dev without the
// env set — the gate also requires the env to be present, so both sides stay consistent.
const SECRET = process.env.INTERNAL_CRON_SECRET ?? "";

// Per-invocation render budgets — comfortably under the 300s function cap so a
// single phase can never be killed mid-step on Vercel.
const VIDEO_BUDGET_MS = 250_000;
// Retry a failed phase several times before giving up. Each retry re-fires a
// FRESH invocation with a full ~270s budget, so a veo clip that needed more time
// (or hit a transient/probabilistic KIE hiccup) gets multiple real chances to
// finish instead of failing the whole video after a single retry.
const MAX_PHASE_ATTEMPTS = 4;

// Headers for the best-effort auto-post call to run-task (which IS auth-gated).
// The render itself authenticates via the drive token, so a missing secret only
// degrades posting — the video still renders and the campaign submission records.
const INTERNAL_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
};

/**
 * Auto Hook — transcript-free, prompt-driven, PERMANENT.
 *
 * The AppStore "Auto Hook" app stores the operator's "What kind of hook?" brief in
 * `hookText.prompt`. Previously the burn only used `hookText.text` when the operator
 * ALSO pinned a generated line (source:"custom"), otherwise it fell back to the
 * per-video script hook — so a configured-but-not-pinned prompt (or one on a video
 * with no transcription) burned NOTHING from the operator's brief. The root confusion
 * ("installed the Auto Hook, set it, but it's not burning") was that generation only
 * ran on the manual "Generate hook" click, and there was no transcript-free path here.
 *
 * Fix: whenever Auto Hook is on, a prompt is set, and no custom line is pinned, we
 * generate the hook line from that prompt via /api/agents/hook/generate
 * (official Gemini first, Kie fallback) and
 * burn it — no transcription required. The line is cached in-process (keyed by the
 * prompt) so a long-lived invoker only pays the LLM call once per prompt; a fresh
 * invoker simply regenerates once more. Any failure falls back to the script hook so
 * a hook always burns.
 */
/**
 * The BURN fallback must be a real hook line, never the render's topic/prompt.
 * run-task sets `baseArgs.hook = scriptResult.hook ?? topic` — and the topic for
 * a copilot/UGC render is the operator's WHOLE prompt, negative instructions
 * included. Falling back to it burned the literal prompt (or "[no subtitles]")
 * onto the video. A hook is only usable when it's short, differs from the
 * topic, and doesn't read like an instruction; otherwise fall back to the
 * script's own first sentence (clipped), else burn nothing.
 */
function safeBurnFallbackHook(hook: string | undefined, topic: string | undefined, scriptText: string | undefined): string | undefined {
  const h = (hook ?? "").trim();
  const t = (topic ?? "").trim();
  const instructionLike = (s: string) =>
    /^[\[({]/.test(s) || /\b(no|without|don'?t|do not|jangan|tanpa)\b[^.\n]{0,40}\b(subtitles?|captions?|sarikata|kapsyen|te(?:xt|ks))\b/i.test(s);
  if (h && h !== t && h.length <= 90 && !instructionLike(h)) return h;
  const firstSentence = (scriptText ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  const clipped = firstSentence.split(/\s+/).slice(0, 8).join(" ").replace(/[,;:]$/, "").trim();
  return clipped.length >= 8 && !instructionLike(clipped) ? clipped : undefined;
}

const hookLineCache = new Map<string, string>();
// Cap so a long-lived invoker (many agents clipping over hours/days) never
// grows this unbounded -- see the eviction note where entries are set below.
const HOOK_CACHE_MAX = 2000;
/**
 * BUG FIX: this used to be a 32-bit int hash of the key string, folded via
 * `(h*31+c)|0`. That hash space is only ~4.3B slots, and with an UNBOUNDED,
 * never-evicted Map running for days across every concurrent agent's clip
 * jobs, two DIFFERENT (prompt, topic, content) triples could collide onto the
 * same int -- serving agent A's cached hook LINE onto agent B's clip (reported
 * as "caption fetched from a different agent's video"). Fixed by keying the
 * cache on the raw string itself: Map keys can be arbitrary strings, so there
 * was never a need to hash at all -- simpler AND collision-free.
 */
function hookCacheKey(prompt: string, topic: string, content: string): string {
  return `${prompt}\u0001${topic}\u0001${content}`;
}
type OverlayHookText = {
  enabled?: boolean; source?: string; text?: string; prompt?: string;
  templateId?: string; durationSeconds?: number;
  style?: { mode?: string; fontColor?: string; fontSize?: number; position?: string };
};
async function resolveAutoHook(
  hook: OverlayHookText | undefined,
  fallbackHook: string | undefined,
  context: { topic: string; niche: string; content: string },
  origin: string,
): Promise<HookBurnPayload | null> {
  const prompt = hook?.prompt?.trim() ?? "";
  // Operator pinned a custom line → use it (no generation).
  if (hook?.source === "custom" && hook.text?.trim()) {
    return resolveHookBurnPayload(hook, fallbackHook);
  }
  // No prompt → rely on the script's own hook (existing behavior).
  if (!prompt) return resolveHookBurnPayload(hook, fallbackHook);

  const key = hookCacheKey(prompt, context.topic, context.content);
  let line = hookLineCache.get(key);
  if (!line) {
    try {
      // Transcript-free: the line is generated from the operator's brief PLUS the
      // video's content basis (script or probed transcript / vision) PLUS the
      // video's topic + niche — so each video's hook matches what it actually says
      // and shows, even when the source has no transcription / audio.
      const r = await fetch(`${origin}/api/agents/hook/generate`, {
        method: "POST",
        headers: INTERNAL_HEADERS,
        body: JSON.stringify({ prompt, topic: context.topic, niche: context.niche, content: context.content }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; hook?: string };
      line = d.ok && typeof d.hook === "string" && d.hook.trim() ? d.hook.trim() : "";
      if (line) {
        // Evict the oldest half once at cap (Map iterates in insertion order) —
        // bounds memory on a process that's been serving many agents for days.
        if (hookLineCache.size >= HOOK_CACHE_MAX) {
          let toDrop = Math.floor(HOOK_CACHE_MAX / 2);
          for (const k of hookLineCache.keys()) {
            if (toDrop-- <= 0) break;
            hookLineCache.delete(k);
          }
        }
        hookLineCache.set(key, line);
      }
    } catch (e) {
      console.warn("[render-step] prompt-hook generate failed, falling back to script hook:", e instanceof Error ? e.message : e);
      line = "";
    }
  }
  if (line) {
    return resolveHookBurnPayload({ ...hook, source: "custom", text: line }, fallbackHook);
  }
  return resolveHookBurnPayload(hook, fallbackHook);
}

/** Fire the next step without awaiting — carries the per-job drive token so the
 *  next invocation authenticates without depending on a shared env secret.
 *  Releases THIS invocation's processing lease first, so the next one can
 *  claim immediately instead of waiting out CLAIM_LEASE_MS. */
function fireNextStep(origin: string, jobId: string, driveToken: string) {
  void (async () => {
    try {
      const convex = new ConvexHttpClient(CONVEX_URL);
      await convex.mutation(api.videoRenderJobs.releaseStep, { id: jobId as Id<"videoRenderJobs">, authSecret: SECRET });
    } catch { /* best-effort — the lease still self-expires */ }
    await fetch(`${origin}/api/video/render-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, driveToken }),
    }).catch(() => { /* the failStaleTasks reaper is the backstop */ });
  })();
}

/** Stitch clips into one hosted MP4 via the concat route + Convex storage.
 *  Frame-chained clips (Seedance) pass no crossfade — their boundary frames match,
 *  so a hard cut is already seamless. Independent-shot engines (Grok/Kling/Gemini)
 *  pass `crossfadeSeconds` so the shots dissolve smoothly instead of hard-cutting. */
function makeStitch(origin: string) {
  return async (clipUrls: string[], opts?: { crossfadeSeconds?: number; trimSeconds?: number; headTrimSeconds?: number }): Promise<string> => {
    const res = await fetch(`${origin}/api/video/concat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
      body: JSON.stringify({ clipUrls, crossfadeSeconds: opts?.crossfadeSeconds, trimSeconds: opts?.trimSeconds, headTrimSeconds: opts?.headTrimSeconds }),
    });
    if (!res.ok) throw new Error(`concat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const bytes = await res.arrayBuffer();
    const { url } = await putVideo(bytes, { keyPrefix: "renders" });
    return url;
  };
}

export async function POST(req: NextRequest) {
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

  const { jobId, driveToken } = (await req.json().catch(() => ({}))) as { jobId?: string; driveToken?: string };
  if (!jobId || !driveToken) return NextResponse.json({ error: "jobId and driveToken required" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const job = await convex.query(api.videoRenderJobs.get, { id: jobId as Id<"videoRenderJobs"> });
  if (!job) return NextResponse.json({ error: "render job not found" }, { status: 404 });

  // Auth: the unguessable per-job drive token IS the credential. No shared env
  // secret or user token needed, so the chain never stalls on a missing secret.
  if (driveToken !== job.driveToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = job._id;
  const origin = req.nextUrl.origin;

  // Terminal — nothing to do.
  if (job.phase === "done" || job.phase === "failed") {
    return NextResponse.json({ ok: true, phase: job.phase });
  }

  // Claim this phase before doing ANY real work. Without this, two overlapping
  // invocations of the same job (a dropped response the caller retried, a
  // duplicate fire, a race between fireNextStep and something else re-kicking
  // it) would both render this step and both post it — one "Generate" click
  // yielding 2-3 finished videos. The loser no-ops immediately; the lease
  // self-expires (CLAIM_LEASE_MS in videoRenderJobs.ts) so a genuinely crashed
  // invocation never wedges the job.
  const claim = await convex.mutation(api.videoRenderJobs.claimStep, { id, authSecret: SECRET });
  if (!claim.claimed) {
    return NextResponse.json({ ok: true, phase: job.phase, skipped: "already processing" });
  }

  type OverlayConfig = {
    captions?: { enabled?: boolean; style?: { mode?: string; fontColor?: string; fontSize?: number; position?: string } };
    hookText?: { enabled?: boolean; source?: string; text?: string; prompt?: string; templateId?: string; durationSeconds?: number; style?: { mode?: string; fontColor?: string; fontSize?: number; position?: string } };
    brandLogoUrl?: string;
    music?: { enabled?: boolean; trackId?: string; autoMusic?: boolean; volumePct?: number; customUrl?: string };
    ctaVideo?: string;
    transition?: { id: string; durationSec: number };
    /** Hook Videos app: pool to draw this video's opener from. */
    hookVideos?: string[];
    /** Main Content app: pool to publish from when generation is skipped. */
    mainVideos?: string[];
    /** Main Content app: "No clip / UGC needed". */
    mainVideosOnly?: boolean;
    /** News Commentary app: the captured article-headline screenshot (or
     *  search-photo fallback) to burn as a bottom-corner reference card —
     *  see lib/server/articleScreenshot.ts + the Editor tab's Specials
     *  toggle (newsImageOverlayEnabled). Engine-independent: set by
     *  run-task's create_video executor regardless of which video model
     *  rendered the clip. */
    newsImageUrl?: string;
    /** The Editor's Solcameo watermark setting (agent clipConfig, default on). */
    velloWatermark?: boolean;
  };
  const baseArgs = JSON.parse(job.renderArgs) as GenerateVideoArgs & { overlays?: OverlayConfig; renderCostUsdc?: number };
  // After a moderation fallback the job runs on a different engine than the one the render was first planned for.
  if (job.kieModel && (baseArgs as { videoModel?: string }).videoModel !== job.kieModel) (baseArgs as { videoModel?: string }).videoModel = job.kieModel;

  // FAIL-SAFE overlays: only re-route through the "overlay" phase when an overlay
  // is actually enabled. No overlays → the render→posting/done flow is unchanged.
  // Trending Audio (music) also routes here so its bed gets mixed in.
  // A hook video counts as an overlay: the join happens in that phase, so without
  // this a video with only the Hook Videos app installed would skip the phase and
  // publish with no hook.
  const wantsOverlay = !!(baseArgs.overlays && (baseArgs.overlays.hookText?.enabled || baseArgs.overlays.captions?.enabled || baseArgs.overlays.music?.enabled || baseArgs.overlays.ctaVideo || baseArgs.overlays.hookVideos?.length || baseArgs.overlays.newsImageUrl || baseArgs.overlays.velloWatermark));

  // Mark the agentTask failed + the job failed; preserve the storyboard if we have one.
  const failAll = async (message: string) => {
    await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 120)}` });
    const partial = job.storyboardImageUrl
      ? { topic: baseArgs.topic, storyboardImageUrl: job.storyboardImageUrl, videoError: message, generatedAt: Date.now() }
      : undefined;
    await convex.mutation(api.agentTasks.fail, {
      id: job.taskId,
      errorMessage: message.slice(0, 300),
      cost: partial ? 0.04 : undefined,
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });
    // Re-record the partial output so the card can still show the storyboard.
    if (partial) {
      await convex.mutation(api.agentTasks.succeed, { id: job.taskId, output: JSON.stringify(partial), cost: 0.04, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" }).catch(() => {});
      // Settle the storyboard floor on-chain too (same as finishAll) so a failed
      // render's partial spend reflects immediately rather than lingering unswept.
      await settleAgentEconomics(job.mintAddress, { immediate: true }).catch(() => {});
    }
  };

  // The raw pre-overlay clip URL for this request (set by the overlay phase
  // before it burns anything; posting-phase requests read the persisted
  // job.rawVideoUrl instead).
  let rawVideoUrlForOutput: string | undefined = job.rawVideoUrl ?? undefined;

  // Mark both the job and the agentTask done with the final output. `post`
  // (when the video was auto-posted) carries the platforms/account/link so the
  // Generations card can show exactly where it went.
  const finishAll = async (
    videoUrl: string,
    videoNote: string | undefined,
    post?: { status?: string; platforms?: string[]; account?: string; url?: string; caption?: string; note?: string },
  ) => {
    const output = {
      topic: baseArgs.topic,
      script: { hook: baseArgs.hook, script: baseArgs.scriptText, caption: job.autoPost?.caption ?? "" },
      videoModel: job.kieModel,
      storyBeats: job.beats ? (JSON.parse(job.beats) as StoryBeat[]) : undefined,
      storyboardImageUrl: job.storyboardImageUrl,
      videoUrl,
      // The pre-overlay original (set at overlay-phase entry; this request's
      // local capture wins over the refetched job field when both exist).
      // Only included when it actually differs from the final video.
      ...((rawVideoUrlForOutput || job.rawVideoUrl) && (rawVideoUrlForOutput || job.rawVideoUrl) !== videoUrl
        ? { rawVideoUrl: rawVideoUrlForOutput || job.rawVideoUrl }
        : {}),
      videoNote,
      post,
      generatedAt: Date.now(),
    };
    await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "done", statusMessage: "Done." });
    // Charge the REAL per-clip cost for this generation (storyboard floor + KIE
    // per-clip render, computed at kickoff from the engine + duration), not a flat
    // fee — so it scales with clip count. Falls back to 0.2 for legacy jobs with no
    // stored cost. succeed() debits the agent's on-chain tab (idemKey task:<id>, so
    // each generation is its own charge).
    // "No clip / UGC needed" (mainVideosOnly) publishes an UPLOADED video — nothing
    // was rendered, so it is NEVER billed a generation cost (run-task already sends
    // renderCostUsdc:0 for these; this guard also covers a legacy job that carried
    // one). The script floor is billed separately by the task's own cost.
    const ugcRun = baseArgs.overlays?.mainVideosOnly === true;
    const renderCost = !ugcRun && typeof baseArgs.renderCostUsdc === "number" && baseArgs.renderCostUsdc > 0
      ? baseArgs.renderCostUsdc
      : ugcRun ? 0 : 0.2;
    await convex.mutation(api.agentTasks.succeed, { id: job.taskId, output: JSON.stringify(output), cost: renderCost, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
    // Sweep the tab on-chain NOW (mirrors run-task's post-task settle at line ~2409).
    // The deferred render is the one task path that returns `async` before that
    // settle runs, so without this a video-only operator accrues the tab but never
    // settles it on-chain after the first — the "only deducts the first time" bug.
    await settleAgentEconomics(job.mintAddress, { immediate: true }).catch(() => {});
  };

  // On any thrown error: retry the same phase up to MAX_PHASE_ATTEMPTS, else fail.
  const retryOrFail = async (message: string) => {
    // The engine's content filter said no. Never drop the face to get past it: hand the same references to the next engine
    // in the moderation ladder (the storyboard and every reference stay as they are), and only fail once none is left.
    if (job.phase === "video" && isModerationError(message)) {
      const tried = [...new Set([...parseTried(job.triedEngines), job.kieModel])];
      const next = nextFallbackEngine({ current: job.kieModel, tried, seconds: Number(baseArgs.durationSeconds) || 5, hasHiggsfield: higgsfieldConfigured() });
      if (next) {
        console.warn(`[render-step] ${job.kieModel} rejected the render (${message.slice(0, 120)}); keeping the references and moving to ${next.kieModel}`);
        await convex.mutation(api.videoRenderJobs.patch, {
          authSecret: SECRET, id, kieModel: next.kieModel, triedEngines: JSON.stringify(tried), attempts: 0, clipIndex: 0, seedanceState: "", veoTaskId: "",
          statusMessage: `That engine's filter declined it. Retrying on ${next.label}, keeping your face reference…`,
        });
        fireNextStep(origin, jobId, job.driveToken);
        return NextResponse.json({ ok: true, phase: job.phase, fallback: next.kieModel });
      }
      await failAll("Every video engine's content filter declined this reference. Try a different, clearer photo of the face (front-facing, no text or logos) and generate again. You were not charged.");
      return NextResponse.json({ ok: false, phase: "failed", error: message });
    }
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts < MAX_PHASE_ATTEMPTS) {
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, attempts, statusMessage: `Hiccup — retrying (${attempts})…` });
      fireNextStep(origin, jobId, job.driveToken);
      return NextResponse.json({ ok: true, phase: job.phase, retrying: attempts });
    }
    await failAll(message);
    return NextResponse.json({ ok: false, phase: "failed", error: message });
  };

  /**
   * Pick one video from an uploaded pool for THIS job.
   *
   * The clipper cycles by loop index; a single-video job has no such counter. The
   * draw is RANDOM per run, so a fresh upload actually airs (a deterministic jobId
   * hash made the same pool video play on every run — the "hook never changes"
   * report). Contextual transcript matching still wins when the pool is warm;
   * randomness only picks the fallback when nothing matches.
   */
  const pickPoolVideo = async (urls: string[] | undefined, clipText: string): Promise<string | undefined> => {
    if (!urls?.length) return undefined;
    const pool = await loadPool(urls);
    warmPool(pool, origin, SECRET);
    const index = Math.floor(Math.random() * 1_000_000);
    return pickFromPool({ pool, clipText, index })?.url;
  };

  try {
    // ── BYPASS ("No clip / UGC needed") ─────────────────────────────────────
    // Publish an operator-uploaded video instead of generating one. Entered before
    // the storyboard so neither the storyboard nor the video model is ever billed;
    // the job still flows through the overlay phase, so captions, hook text and the
    // CTA apply exactly as they would to a generated video.
    if (job.phase === "storyboard" && baseArgs.overlays?.mainVideosOnly) {
      const main = await pickPoolVideo(baseArgs.overlays.mainVideos, `${baseArgs.topic ?? ""} ${baseArgs.hook ?? ""}`.trim());
      if (!main) {
        return await retryOrFail("No clip / UGC needed is on, but the Main Content app has no usable uploads");
      }
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET,
        id, videoUrl: main, attempts: 0,
        phase: wantsOverlay ? "overlay" : (job.autoPost ? "posting" : "done"),
        statusMessage: wantsOverlay ? "Using your uploaded video — adding overlays…" : "Using your uploaded video.",
      });
      if (wantsOverlay || job.autoPost) {
        fireNextStep(origin, jobId, job.driveToken);
        return NextResponse.json({ ok: true, phase: wantsOverlay ? "overlay" : "posting" });
      }
      await finishAll(main, undefined);
      return NextResponse.json({ ok: true, phase: "done" });
    }

    // ── STORYBOARD ──────────────────────────────────────────────────────────
    if (job.phase === "storyboard") {
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, statusMessage: "Generating the storyboard…" });
      const sb = await generateVideoFromScript({ ...baseArgs, apiKey: KIE_KEY, phase: "storyboard" });
      const beats = sb.storyBeats ?? [];
      // Plan the Veo clip chain so the video phase renders ONE clip per invocation
      // and can extend up to the full script length (≤60s). Feed the rendered
      // storyboard image in as a Veo reference so clips follow the planned shots.
      const plan = buildVeoChainPlan({ ...baseArgs, storyboardImageUrl: sb.storyboardImageUrl, personaKernel: sb.personaKernel }, beats);
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET,
        id, phase: "video", attempts: 0, clipIndex: 0,
        storyboardImageUrl: sb.storyboardImageUrl,
        storyboardPrompt: sb.storyboardPrompt,
        beats: JSON.stringify(beats),
        ...(plan.isVeo ? {
          segmentPrompts: JSON.stringify(plan.segmentPrompts),
          standalonePrompts: JSON.stringify(plan.standalonePrompts ?? plan.segmentPrompts),
          refImages: JSON.stringify(plan.refImages),
          totalSegments: plan.totalSegments,
        } : {}),
        statusMessage: plan.isVeo
          ? `Storyboard ready — rendering clip 1/${plan.totalSegments} on ${job.kieModel}…`
          : `Storyboard ready — rendering the video on ${job.kieModel}…`,
      });
      fireNextStep(origin, jobId, job.driveToken);
      return NextResponse.json({ ok: true, phase: "video" });
    }

    // ── VIDEO ───────────────────────────────────────────────────────────────
    if (job.phase === "video") {
      // Veo path: render ONE clip this invocation, extend the chain next time.
      if (job.segmentPrompts) {
        const plan: VeoChainPlan = {
          isVeo: true,
          model: job.kieModel === "veo3" ? "veo3" : job.kieModel === "veo3_lite" ? "veo3_lite" : "veo3_fast",
          segmentPrompts: JSON.parse(job.segmentPrompts) as string[],
          standalonePrompts: job.standalonePrompts ? (JSON.parse(job.standalonePrompts) as string[]) : undefined,
          refImages: job.refImages ? (JSON.parse(job.refImages) as string[]) : [],
          totalSegments: job.totalSegments ?? 1,
          // Veo accepts 16:9 / 9:16 only; 1:1 / unset fall back to 9:16.
          aspectRatio: (baseArgs.aspectRatio === "16:9" || baseArgs.aspectRatio === "9:16") ? baseArgs.aspectRatio : "9:16",
        };
        const clipIndex = job.clipIndex ?? 0;
        const total = plan.totalSegments;
        await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, statusMessage: `Rendering clip ${clipIndex + 1}/${total} on ${job.kieModel}…` });

        let clip: { url: string; taskId: string; canExtend: boolean; seed?: number; isStandalone: boolean };
        try {
          clip = await renderVeoChainClip({ plan, clipIndex, parentTaskId: job.veoTaskId, baseSeed: job.veoSeed, stitchMode: job.stitchMode, apiKey: KIE_KEY });
        } catch (err) {
          // First clip failed → no video yet, retry/fail. Later clip failed →
          // finish with the clips we already have (shorter but complete).
          if (clipIndex === 0 || !job.videoUrl) {
            return await retryOrFail(err instanceof Error ? err.message : String(err));
          }
          // We already have a (shorter but complete) videoUrl on the job → burn
          // overlays first if wanted, otherwise post/finish as before.
          if (wantsOverlay) {
            await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "overlay", attempts: 0, videoNote: `Rendered ${clipIndex}/${total} clips.`, statusMessage: "Adding captions / hook text…" });
            fireNextStep(origin, jobId, job.driveToken);
            return NextResponse.json({ ok: true, phase: "overlay" });
          }
          if (job.autoPost) {
            await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "posting", attempts: 0, videoNote: `Rendered ${clipIndex}/${total} clips.` });
            fireNextStep(origin, jobId, job.driveToken);
            return NextResponse.json({ ok: true, phase: "posting" });
          }
          await finishAll(job.videoUrl, `Rendered ${clipIndex} of ${total} clips — extend stopped.`);
          return NextResponse.json({ ok: true, phase: "done" });
        }

        const nextIndex = clipIndex + 1;
        // STITCH FALLBACK: renderVeoChainClip returned a fresh STANDALONE continuation
        // clip (native /veo/extend was blocked by the safety filter). QUEUE it — we
        // concat the queued clips onto the extend-chain cumulative video ONCE when the
        // chain finishes, rather than re-encoding the growing video on every fallback
        // (that was O(N) re-encodes + compounding generation loss). While queuing,
        // videoUrl stays the extend-chain cumulative; a standalone clip must NOT become
        // the next extend parent (it would duplicate into a later cumulative result).
        const prevQueue: string[] = job.stitchClips ? (JSON.parse(job.stitchClips) as string[]) : [];
        const stitchQueue = clip.isStandalone ? [...prevQueue, clip.url] : prevQueue;
        const stitchModeToStore = clip.isStandalone ? true : (job.stitchMode ?? false);
        // Extend / clip-0 advance the cumulative video; a fallback clip leaves it as-is.
        const cumulativeUrl = clip.isStandalone ? (job.videoUrl ?? clip.url) : clip.url;

        const moreToDo = nextIndex < total && clip.canExtend;
        await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET,
          id, videoUrl: cumulativeUrl, clipIndex: nextIndex, attempts: 0,
          // Only advance the extend chain's parent taskId when we actually extended.
          ...(clip.isStandalone ? {} : { veoTaskId: clip.taskId }),
          // Persist the base clip's seed (minted on clip 0) so every subsequent
          // extend reuses it as the face-consistency anchor. `patch` drops undefined,
          // so this only writes on clip 0 and is a harmless no-op thereafter.
          veoSeed: clip.seed,
          ...(stitchModeToStore ? { stitchMode: true } : {}),
          ...(clip.isStandalone ? { stitchClips: JSON.stringify(stitchQueue) } : {}),
          statusMessage: moreToDo ? `Clip ${nextIndex}/${total} done — ${stitchModeToStore ? "stitching" : "extending"}…` : "Video ready.",
        });
        if (moreToDo) {
          fireNextStep(origin, jobId, job.driveToken);
          return NextResponse.json({ ok: true, phase: "video", clip: nextIndex });
        }
        // Chain finished. If fresh fallback clips were queued, concat them onto the
        // extend-chain cumulative ONCE (single re-encode) with a small crossfade.
        let finalUrl = cumulativeUrl;
        if (stitchQueue.length > 0) {
          try {
            await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, statusMessage: `Stitching ${stitchQueue.length} continuation clip${stitchQueue.length === 1 ? "" : "s"}…` });
            finalUrl = await makeStitch(origin)([cumulativeUrl, ...stitchQueue], { crossfadeSeconds: 0.3 });
            await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, videoUrl: finalUrl, statusMessage: "Video ready." });
          } catch (e) {
            // Concat failed — keep the extend-chain cumulative rather than lose the video.
            console.warn(`[render-step] final stitch concat failed, keeping extend-only video: ${e instanceof Error ? e.message : e}`);
            finalUrl = cumulativeUrl;
          }
        }
        // Final clip done + videoUrl persisted (above) → burn overlays first if wanted.
        if (wantsOverlay) {
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "overlay", attempts: 0, statusMessage: "Adding captions / hook text…" });
          fireNextStep(origin, jobId, job.driveToken);
          return NextResponse.json({ ok: true, phase: "overlay" });
        }
        if (job.autoPost) {
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "posting", attempts: 0, statusMessage: "Video ready — publishing…" });
          fireNextStep(origin, jobId, job.driveToken);
          return NextResponse.json({ ok: true, phase: "posting" });
        }
        await finishAll(finalUrl, undefined);
        return NextResponse.json({ ok: true, phase: "done" });
      }

      // Non-Veo (Seedance / other) — render + stitch. Seedance chains persist
      // per-clip progress (seedanceState) so a timed-out invocation RESUMES
      // instead of regenerating keyframe + every clip — the fix for one 30s
      // request producing a pile of unused paid Kie renders across retries.
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, statusMessage: `Rendering the video on ${job.kieModel}…` });
      type SeedanceState = { clipUrls?: string[]; nextIndex?: number; firstFrame?: string; keyframeUrl?: string; pendingTaskId?: string; pendingClipIndex?: number };
      let seedanceStateLocal: SeedanceState = (() => {
        try { return job.seedanceState ? (JSON.parse(job.seedanceState) as SeedanceState) : {}; } catch { return {}; }
      })();
      // Motion Swap is a Higgsfield Genjutsu render (library clip's motion → the
      // character), not a script-driven Kie render — so it bypasses the pipeline.
      const runMotionSwap = async (): Promise<{ videoUrl?: string; videoNote?: string; videoError?: string }> => {
        try {
          const doc = await convex.query(api.influencers.getByMint, { mintAddress: job.mintAddress });
          const referenceVideoUrl = motionReferenceFromBible((doc as { showBible?: unknown } | null)?.showBible);
          if (!referenceVideoUrl) return { videoError: "Motion Swap needs a reference move — pick one in the Director tab." };
          const videoUrl = await renderMotionSwap({
            referenceVideoUrl,
            characterImageUrl: baseArgs.avatarUrl,
            timeoutMs: VIDEO_BUDGET_MS,
            idempotencyPrefix: String(id),
          });
          return { videoUrl, videoNote: "Motion Swap rendered on Higgsfield Genjutsu." };
        } catch (e) {
          return { videoError: e instanceof Error ? e.message : String(e) };
        }
      };
      const result = baseArgs.formatId === MOTION_SWAP_FORMAT_ID ? await runMotionSwap() : await generateVideoFromScript({
        ...baseArgs,
        apiKey: KIE_KEY,
        phase: "video",
        resume: {
          storyboardImageUrl: job.storyboardImageUrl ?? "",
          storyboardPrompt: job.storyboardPrompt ?? "",
          beats: job.beats ? (JSON.parse(job.beats) as StoryBeat[]) : [],
        },
        ...(seedanceStateLocal.clipUrls?.length || seedanceStateLocal.keyframeUrl || seedanceStateLocal.pendingTaskId
          ? { seedanceResume: { clipUrls: seedanceStateLocal.clipUrls ?? [], nextIndex: seedanceStateLocal.nextIndex ?? (seedanceStateLocal.clipUrls?.length ?? 0), firstFrame: seedanceStateLocal.firstFrame, keyframeUrl: seedanceStateLocal.keyframeUrl, pendingTaskId: seedanceStateLocal.pendingTaskId, pendingClipIndex: seedanceStateLocal.pendingClipIndex } }
          : {}),
        onSeedanceProgress: async (partial) => {
          seedanceStateLocal = { ...seedanceStateLocal, ...partial };
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, seedanceState: JSON.stringify(seedanceStateLocal) }).catch(() => {});
        },
        timeBudgetMs: VIDEO_BUDGET_MS,
        stitchClips: makeStitch(origin),
      });
      if (!result.videoUrl) {
        return await retryOrFail(result.videoError ?? "Video render produced no clip");
      }
      await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET,
        id, videoUrl: result.videoUrl, videoNote: result.videoNote,
        statusMessage: job.autoPost ? "Video ready — publishing…" : "Video ready.",
      });
      // Final stitched video persisted (above) → burn overlays first if wanted.
      if (wantsOverlay) {
        await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "overlay", attempts: 0, statusMessage: "Adding captions / hook text…" });
        fireNextStep(origin, jobId, job.driveToken);
        return NextResponse.json({ ok: true, phase: "overlay" });
      }
      if (job.autoPost) {
        await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "posting", attempts: 0 });
        fireNextStep(origin, jobId, job.driveToken);
        return NextResponse.json({ ok: true, phase: "posting" });
      }
      await finishAll(result.videoUrl, result.videoNote);
      return NextResponse.json({ ok: true, phase: "done" });
    }

    // ── OVERLAY (fail-safe) ───────────────────────────────────────────────────
    // Burn hook text / captions onto the already-persisted base video. The base
    // MP4 is COMPLETE before this runs; overlays are best-effort. Any failure (or
    // an unexpected error anywhere in this handler) finalizes with the base video
    // so the job is NEVER lost or left stuck.
    if (job.phase === "overlay") {
      let videoUrl = job.videoUrl ?? "";
      // The MAIN generated clip's own URL, captured before a Hook Video pool
      // (below) may prepend a completely different uploaded clip onto the
      // front and reassign `videoUrl` to the joined file. Captions must be
      // transcribed from the agent's own generated voice only — a prepended
      // hook video can carry its own (different) speech/voice, and
      // overlay-burn has no way to know `videoUrl` stopped being "just the
      // generated clip" unless told separately. See voiceSourceUrl below.
      const generatedClipUrl = videoUrl;
      // Persist the raw original BEFORE any burn — the Editor's "Original"
      // download and un-burn re-edits need the pre-overlay file, which is
      // otherwise unrecoverable once hooks/captions bake into the pixels.
      if (generatedClipUrl) {
        rawVideoUrlForOutput = generatedClipUrl;
        await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, rawVideoUrl: generatedClipUrl }).catch(() => {});
      }
      try {
        const ov = baseArgs.overlays;
        console.log(`[render-step] overlay phase for job ${jobId}: hookVideos=${(ov?.hookVideos ?? []).length} mainVideos=${(ov?.mainVideos ?? []).length} mainVideosOnly=${ov?.mainVideosOnly} hookText=${ov?.hookText?.enabled} captions=${ov?.captions?.enabled} base=${videoUrl.slice(0, 80)}`);

        // HOOK VIDEO: joined BEFORE the burn below, so an Auto Hook text line lands
        // on the hook footage rather than on the body. Best-effort — a failed concat
        // keeps the original video instead of losing the whole render.
        const hookVideo = await pickPoolVideo(ov?.hookVideos, `${baseArgs.topic ?? ""} ${baseArgs.hook ?? ""}`.trim());
        let hookJoined = false;
        // How far into the JOINED video the generated clip's own audio
        // actually starts — captions transcribed from `generatedClipUrl`
        // (below) are timestamped from ITS OWN t=0, so they need shifting
        // forward by exactly this much to land in the right place once
        // burned onto the joined (hook + main) video. A probe miss (null)
        // just means the caption offset is skipped — never blocks the render.
        let voiceOffsetSeconds = 0;
        if (hookVideo && videoUrl) {
          try {
            // makeStitch owns the concat → storage-upload round trip the render path
            // already uses, so the joined video lands in storage the same way.
            const [joined, hookDuration] = await Promise.all([
              makeStitch(origin)([hookVideo, videoUrl]),
              probeRemoteVideoDurationSeconds(hookVideo),
            ]);
            videoUrl = joined;
            hookJoined = true;
            voiceOffsetSeconds = hookDuration ?? 0;
            await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, videoUrl: joined }).catch(() => {});
          } catch (e) {
            // Never lose the render — but DON'T hide the failure. Surface it in the
            // status so a dropped hook is explainable instead of looking like "no
            // hook configured" (the silent-degradation that hid the resolution bug).
            const why = e instanceof Error ? e.message : String(e);
            console.warn(`[render-step] hook video join failed, continuing without it: ${why}`);
            await convex.mutation(api.videoRenderJobs.patch, {
              authSecret: SECRET, id,
              statusMessage: `Hook video join failed (${why.slice(0, 120)}) — publishing base video`,
            }).catch(() => {});
          }
        }

        // The prepended hook VIDEO already IS the hook, and the script's hook line
        // is spoken over it — burning the SAME line as text on top is redundant, so
        // it is skipped when a hook video made it in. A configured hook-video POOL
        // also disables the text slate entirely (even if the join fails): the
        // black-screen "must watch" opener reads as broken and kills retention — the
        // operator chose a VIDEO opener, not a text card. The text hook only applies
        // when NO hook-video app is configured at all.
        const hasHookPool = Array.isArray(ov?.hookVideos) && (ov!.hookVideos!.length ?? 0) > 0;
        // Auto-Hook content basis: enrich the generated line with what the video is
        // actually about — the script (generated videos, free) or a probe of the
        // video itself (transcript → vision frames) for uploaded main content. Only
        // probed when a line will actually be auto-generated (prompt set, custom
        // line not pinned); cached per video in-process.
        const contentBasis = (
          ov?.hookText?.enabled && !hookJoined && !hasHookPool
          && ov?.hookText?.source !== "custom" && !!ov?.hookText?.prompt?.trim()
        )
          ? await hookContentBasis({ scriptText: baseArgs.scriptText ?? "", videoUrl }, origin)
          : "";
        const hookText = ov?.hookText?.enabled && !hookJoined && !hasHookPool
          ? (await resolveAutoHook(ov?.hookText, safeBurnFallbackHook(baseArgs.hook, baseArgs.topic, baseArgs.scriptText), {
              topic: baseArgs.topic ?? "",
              niche: baseArgs.agentNiche ?? "",
              content: contentBasis,
            }, origin)) ?? undefined
          : undefined;

        const capEnabled = ov?.captions?.enabled;
        const captions = capEnabled ? {
          mode: ov!.captions!.style?.mode === "line" ? "line" : "karaoke",
          fontColor: ov!.captions!.style?.fontColor,
          fontSize: ov!.captions!.style?.fontSize,
          position: ov!.captions!.style?.position,
          // OpusClip-parity look — carry the operator's preset (falls back to the
          // clipper's karaoke word-sync engine in overlay-burn) so builder/hire
          // captions render exactly like the AI Clipper, not the plain legacy style.
          preset: (ov!.captions!.style as { preset?: string } | undefined)?.preset,
          // Editor Captions tool language picks (clip.captions config → videoDirector).
          languageCode: (ov!.captions!.style as { languageCode?: string } | undefined)?.languageCode,
          subtitleLanguageCode: (ov!.captions!.style as { subtitleLanguageCode?: string } | undefined)?.subtitleLanguageCode,
          // Was missing: overlay-burn's ONLY fallback when ElevenLabs returns
          // zero words (network hiccup, key issue, or a genuinely silent
          // clip) is `synthesizeWordsFromScript(captions.scriptText, ...)` —
          // without this field, this render path had no fallback at all and
          // silently shipped the video with NO captions on any STT miss,
          // instead of degrading to an estimate the way the sample-worker
          // path (lib/server/ugcSampleWorkers.ts) already does.
          scriptText: baseArgs.scriptText,
        } : undefined;

        // Trending Audio bed — overlay-burn resolves the track + mixes it under
        // the voiceover at `volumePct` loudness (default 30%).
        const music = ov?.music?.enabled ? {
          trackId: ov.music.trackId,
          autoMusic: ov.music.autoMusic ?? true,
          volumePct: typeof ov.music.volumePct === "number" ? ov.music.volumePct : 30,
          customUrl: ov.music.customUrl,
        } : undefined;

        // Burn route is HTTP 200 + fail-safe by contract — on any failure it
        // returns the ORIGINAL url. Keep the base video if anything goes wrong.
        let finalUrl = videoUrl;
        try {
          const r = await fetch(`${origin}/api/video/overlay-burn`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
            body: JSON.stringify({
              videoUrl, hookText, captions, music,
              // Only set when a hook video actually changed videoUrl — tells
              // overlay-burn to transcribe THIS url for captions instead of
              // the (possibly hook-joined) `videoUrl` it's burning into, and
              // to shift the resulting word timestamps forward by the hook
              // video's own duration so they land correctly on the joined file.
              ...(hookJoined && generatedClipUrl ? { voiceSourceUrl: generatedClipUrl, voiceOffsetSeconds } : {}),
              imageOverlay: ov?.newsImageUrl ? { url: ov.newsImageUrl } : undefined,
              // The Editor's watermark switch applies to every produced video, not only to edits made in the Editor.
              ...(ov?.velloWatermark ? { specials: { velloWatermark: true } } : {}),
            }),
          });
          const d = (await r.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string };
          if (d?.ok && d?.videoUrl) finalUrl = d.videoUrl;
        } catch { /* keep original */ }

        // Video Call To Action — append the operator's uploaded clip to the very
        // end. Best-effort + fail-safe by contract (keeps finalUrl on any failure).
        if (ov?.ctaVideo) {
          try {
            const r = await fetch(`${origin}/api/video/append-cta`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}) },
              body: JSON.stringify({ videoUrl: finalUrl, ctaUrl: ov.ctaVideo, ...(ov.transition ? { transition: ov.transition } : {}) }),
            });
            const d = (await r.json().catch(() => ({}))) as { ok?: boolean; videoUrl?: string };
            if (d?.ok && d?.videoUrl) finalUrl = d.videoUrl;
          } catch { /* keep current */ }
        }

        if (finalUrl !== videoUrl) {
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, videoUrl: finalUrl, statusMessage: "Overlays applied." });
        }

        // Same posting/done decision the video phase would have made.
        if (job.autoPost) {
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "posting", attempts: 0, statusMessage: "Video ready — publishing…" });
          fireNextStep(origin, jobId, job.driveToken);
          return NextResponse.json({ ok: true, phase: "posting" });
        }
        await finishAll(finalUrl, job.videoNote ?? undefined);
        return NextResponse.json({ ok: true, phase: "done" });
      } catch {
        // NEVER leave the job stuck — finalize with the base video. Even posting
        // is attempted via its own phase so the overlay step can't lose the video.
        if (job.autoPost) {
          await convex.mutation(api.videoRenderJobs.patch, { authSecret: SECRET, id, phase: "posting", attempts: 0, statusMessage: "Video ready — publishing…" }).catch(() => {});
          fireNextStep(origin, jobId, job.driveToken);
          return NextResponse.json({ ok: true, phase: "posting" });
        }
        await finishAll(videoUrl, job.videoNote ?? undefined);
        return NextResponse.json({ ok: true, phase: "done" });
      }
    }

    // ── POSTING ─────────────────────────────────────────────────────────────
    if (job.phase === "posting") {
      const videoUrl = job.videoUrl ?? "";
      const ap = job.autoPost!;
      const caption = ap.caption?.trim() || baseArgs.topic;
      const allConnected = ap.platforms.length === 0;
      let postInfo: { status?: string; platforms?: string[]; account?: string; url?: string; caption?: string; note?: string } | undefined;
      try {
        // Posting to socials (upload-post) can run several minutes — far past what
        // this invocation can spare without hitting maxDuration and getting KILLED
        // mid-await. A killed render-step leaves the render job on "posting" and the
        // create_video task on "running" FOREVER — the "stuck at PostRunning"
        // report. Bound the wait: the post_content run-task keeps executing
        // server-side after we stop awaiting, and completes on its own; the video
        // always finishes here. The link is captured when the response arrives in
        // time; otherwise the video completes with a "posting in progress" note.
        const postRes = await Promise.race([
          fetch(`${origin}/api/agents/run-task`, {
            method: "POST",
            headers: INTERNAL_HEADERS,
            body: JSON.stringify({
              mintAddress: job.mintAddress,
              taskType: "post_content",
              title: `Auto-post video → ${allConnected ? "all connected" : ap.platforms.join(", ")}`,
              input: {
                ...(allConnected ? {} : { platforms: ap.platforms }),
                contentType: "video",
                mediaUrl: videoUrl,
                campaignId: ap.campaignId,
                title: baseArgs.topic,
                text: caption,
                niche: baseArgs.agentNiche,
              },
              triggeredBy: "autopost",
            }),
          }),
          // 150s of runway (post may still be in flight server-side — the task
          // completes itself; the video must not wait on it).
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error("post await timed out (post may still be publishing server-side)")), 150_000),
          ),
        ]);
        const data = (await postRes.json().catch(() => ({}))) as { output?: { status?: string; note?: string; result?: unknown; platforms?: string[]; account?: string; postUrl?: string; postUrls?: Record<string, string>; platformPostId?: string; uploadPostRequestId?: string; failed?: { platform: string; error: string }[] } };
        const out = data.output ?? {};
        const postedPlatforms = Array.isArray(out.platforms) ? out.platforms : [];
        const linkPlatform = ap.platforms.find((p: string) => postedPlatforms.includes(p)) ?? postedPlatforms[0] ?? ap.platforms[0];
        // Use the REAL published post link the executor extracted — prefer the
        // campaign platform's link, then the best, then (last resort) a regex.
        const postUrl = (linkPlatform && out.postUrls?.[linkPlatform]) || out.postUrl
          || JSON.stringify(out.result ?? "").match(/https?:\/\/[^\s"'\\]+/)?.[0];
        const posted = out.status === "posted" && !!postUrl;
        // Durable post ids the oracle needs to settle the deliverable (a bare
        // postUrl isn't analytics-queryable on its own — see dueForVerification).
        const platformPostId = typeof out.platformPostId === "string" ? out.platformPostId : undefined;
        const uploadPostRequestId = typeof out.uploadPostRequestId === "string" ? out.uploadPostRequestId : undefined;

        // Capture where it went so the Generations card can show it.
        postInfo = {
          status: out.status,
          platforms: postedPlatforms,
          account: typeof out.account === "string" ? out.account : undefined,
          url: postUrl,
          caption,
          // The executor's real per-platform reason (e.g. "TikTok: token expired —
          // reconnect TikTok…"). Surfaced below instead of the generic message so a
          // failed post says WHICH account to fix.
          note: typeof out.note === "string" ? out.note : undefined,
        };

        // Record the campaign submission (join + link) — reuses the verified flow.
        if (ap.campaignId) {
          await convex.mutation(api.submissions.submitForCampaign, {
            campaignId: ap.campaignId,
            influencerMint: job.mintAddress,
            influencerName: baseArgs.agentName,
            submitterWallet: ap.ownerWallet ?? job.mintAddress,
            authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
            ...(posted ? { postUrl: postUrl as string, platform: linkPlatform, ...(platformPostId ? { platformPostId } : {}), ...(uploadPostRequestId ? { uploadPostRequestId } : {}), postedAt: Date.now() } : {}),
          }).catch(() => { /* non-fatal */ });
        }
      } catch (e) {
        console.warn("[render-step] auto-post failed:", e instanceof Error ? e.message : e);
        // Posting is best-effort — the video still succeeded.
      }
      // Surface WHY a post did/didn't go out on the generation itself, so a silent
      // "no social post" is diagnosable instead of looking like posting is broken.
      // The most common cause is the agent having no accounts CONNECTED server-side.
      let postNote = job.videoNote;
      if (postInfo && postInfo.status !== "posted") {
        const reason = postInfo.status === "needs_connection"
          ? "Not posted — no social accounts are connected for this agent. Link an account in the builder Connections tab, then generate again."
          : postInfo.status === "skipped"
            ? "Not posted — social posting is unavailable (check UPLOAD_POST_API_KEY / the Upload-Post app)."
            // Prefer the executor's real per-platform reason (which account failed and
            // why — usually a stale OAuth token needing reconnect). Only fall back to
            // the generic line when the executor gave no note.
            : postInfo.note
              ? `Not posted — ${postInfo.note}`
              : `Not posted — publishing did not complete (status: ${postInfo.status ?? "unknown"}). Re-check the agent's connected accounts.`;
        postNote = [job.videoNote, reason].filter(Boolean).join(" · ");
        console.warn(`[render-step] auto-post did not publish for ${job.mintAddress}: ${reason}`);
      }
      await finishAll(videoUrl, postNote, postInfo);
      return NextResponse.json({ ok: true, phase: "done" });
    }

    return NextResponse.json({ error: `unknown phase ${job.phase}` }, { status: 400 });
  } catch (err) {
    return await retryOrFail(err instanceof Error ? err.message : String(err));
  }
}
