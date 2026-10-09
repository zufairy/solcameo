import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { downloadToLocal } from "@/lib/server/ytDownload";
import { withTimeout } from "@/lib/server/withTimeout";
import { renderClipFromFile, renderStitchedClip, probeDurationSec } from "@/lib/server/clipRender";
import { outputDimsFor } from "@/lib/builder/clipConfig";
import { pickFromPool } from "@/lib/server/videoPool";
import { buildClipDescription, clipDescriptionInstruction, fallbackClipLabel } from "@/lib/server/clipDescription";
import { loadPool, warmPool } from "@/lib/server/videoPoolContext";
import { selfOrigin } from "@/lib/server/selfOrigin";
import { appendCtaFromUrls } from "@/lib/server/ctaAppend";
import { retimeStitchedWords } from "@/lib/server/clipMomentSelector";
import { planClipEdits, type PlanArgs } from "@/lib/server/clipEditPlanner";
import type { ClipConfig, ClipMoment, TranscriptSegment, TranscriptWord } from "@/lib/server/clipTypes";

export const runtime = "nodejs";
// Only the 202 must land in-window; the fire-and-forget IIFE runs on past it in
// the persistent Railway process (same pattern as /api/video/download-start).
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const SECRET = () => process.env.INTERNAL_CRON_SECRET ?? "";
// 1 = protect the shared Railway CPU (each ffmpeg already pins a core). 2 is safe
// on a multi-core box. Tuned via CLIP_CUT_CONCURRENCY.
const CONCURRENCY = Number(process.env.CLIP_CUT_CONCURRENCY) || 1;
// Per-clip render ceiling — mirrors the canvas /api/video/clip maxDuration.
const PER_CLIP_MAX_MS = 300_000;
// Batch's OWN overall deadline, mirroring clipJobs CLIP_CUT_MAX_MS, so the batch
// can't outlive cutPoll's straggler-fail (fix: deadline parity). The exact
// absolute instant is passed in the body (computed alongside cutPoll's deadline);
// this is only the fallback when absent.
const CLIP_BATCH_MAX_MS = Number(process.env.CLIP_CUT_MAX_MS) || 45 * 60_000;
// UPPER bound on the whole-source pull — a backstop against a genuinely dead stream
// (the yt-dlp idle watchdog + per-IP retries catch most stalls far sooner). The
// EFFECTIVE budget is derived from the shared cutPoll deadline (see pullBudget), so
// a long 1 h+ source gets most of the run's time instead of a fixed short wall.
// Raised from 10 → 30 min: a 1 h video at 720p through a proxy needs ~15-25 min.
// Env-tunable.
const CLIP_PULL_MAX_MS = Number(process.env.CLIP_PULL_MAX_MS) || 30 * 60_000;
// Time reserved (before the shared deadline) to actually CUT the clips after the
// pull — so the pull can't eat the whole budget and strand every clip on "rendering".
const CLIP_PULL_RENDER_RESERVE_MS = Number(process.env.CLIP_PULL_RENDER_RESERVE_MS) || 8 * 60_000;
// A source longer than this pulls at 720p (≈half the bytes) so it lands in time;
// shorter sources keep 1080p. Env-tunable.
const CLIP_LONG_SOURCE_SEC = Number(process.env.CLIP_LONG_SOURCE_SEC) || 25 * 60;

// A clip to cut. `configOverride` + `reframeMode` are present ONLY for a per-moment
// VARIATION (a reuse of a strong moment with a different edit-plan config) — the
// pristine one-per-moment cut carries neither and renders with the run config as-is.
type ClipPlan = {
  clipId: string;
  moment: ClipMoment;
  /** Merged over the run config for THIS clip (varies hook style + caption look). */
  configOverride?: Partial<ClipConfig>;
  /** Forces the reframe op's framing for THIS clip (crop=fill 9:16, pad=fit). */
  reframeMode?: "crop" | "pad";
  /** CROSS-VIDEO FILL (fill-short): present ONLY when this clip is assembled from a
   *  SHORT primary + sibling-video moments. Ordered sub-windows (subSegments[0] = the
   *  primary lead), each in its OWN source's seconds + carrying that source's caption
   *  words; `segments` are the retimed (0-based) stitched segments for edit-planning.
   *  When present the batch renders via renderStitchedClip (multi-file stitch). */
  assembled?: {
    subSegments: { sourceUrl: string; start: number; end: number; words?: TranscriptWord[] }[];
    segments?: TranscriptSegment[];
  };
};

/**
 * Fire-and-forget batch cut: pull the whole VIDEO source ONCE to local disk, then
 * cut ALL clips from that single file via renderClipFromFile (ffmpeg input-seek
 * per clip — RAM-safe, no per-clip re-pull). The per-clip planClipEdits LLM calls
 * run HERE (off the Convex action wall), then each result is written back to its
 * clips row. clipJobs.cutPoll polls the rows + finalizes. Mirrors download-start.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  // INTERNAL-ONLY. This route writes to caller-supplied clipId/jobId rows using the
  // server's INTERNAL_CRON_SECRET. Its ONLY caller is clipJobs.process (server-to-
  // server with X-Internal-Secret). Admitting a SIWS user would let any logged-in
  // wallet POST a victim's clipId (clipIds are exposed by the PUBLIC postingFeed
  // query) and overwrite that clip row under the trusted identity — either pointing
  // it at attacker content (auto-posted under the victim in finalizeJob) or marking
  // it failed. Reject anything that isn't the internal secret.
  if (!auth.internal) return NextResponse.json({ error: "internal only" }, { status: 403 });
  let body: {
    jobId?: string; sourceUrl?: string; kieApiKey?: string;
    skills?: PlanArgs["skills"]; config?: ClipConfig;
    context?: { agentName?: string; niche?: string; campaignId?: string; sourceUrl?: string };
    segments?: TranscriptSegment[]; words?: TranscriptWord[];
    clips?: ClipPlan[]; deadlineMs?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { jobId, sourceUrl, config, kieApiKey } = body;
  const clips = body.clips ?? [];
  const skills = body.skills ?? [];
  const segments = body.segments ?? [];
  const words = body.words ?? [];
  if (!jobId || !sourceUrl || clips.length === 0 || !config) {
    return NextResponse.json({ error: "jobId+sourceUrl+clips+config required" }, { status: 400 });
  }
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex URL not set" }, { status: 500 });

  // Cloud clipping already booked these fees; confirm the same idempotent charges before rendering.
  const paymentClient = new ConvexHttpClient(CONVEX_URL);
  const billedJob = await paymentClient.query(api.clipJobs.getJob, { jobId: jobId as Id<"clipJobs"> });
  if (!billedJob) return NextResponse.json({ error: "Clip job not found" }, { status: 404 });
  const bookedFees = await paymentClient.query(api.usage.runChargesForPayment, { mintAddress: billedJob.mintAddress, runId: jobId, authSecret: SECRET() });
  for (const fee of bookedFees) {
    const payment = await chargeAgentGeneration(billedJob.mintAddress, jobId, fee.service, fee.qty);
    if (!payment.ok) return NextResponse.json({ error: `Agent payment failed (${payment.reason})` }, { status: 503 });
  }

  // Shared absolute deadline with cutPoll (passed by process); fall back to our own.
  const deadlineAt = typeof body.deadlineMs === "number" ? body.deadlineMs : Date.now() + CLIP_BATCH_MAX_MS;

  void (async () => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    // Write a clip row's terminal state with a small RETRY: a swallowed transient
    // blip here would leave the clip on "rendering", so cutPoll would wait out the
    // whole deadline before failing it (the job appears "stuck" long after the clips
    // are actually done). 3 attempts; cutPoll's deadline is still the final backstop.
    const setClip = async (clipId: string, patch: { status?: string; clipUrl?: string; failReason?: string; endSeconds?: number; captionText?: string }) => {
      for (let a = 0; a < 3; a++) {
        try { await convex.mutation(api.clipJobs.setClip, { clipId: clipId as Id<"clips">, ...patch, authSecret: SECRET() }); return; }
        catch { if (a < 2) await new Promise((r) => setTimeout(r, 1000 * (a + 1))); }
      }
    };
    const beat = (note: string, pct?: number) =>
      convex.mutation(api.clipJobs.appendLog, { jobId: jobId as Id<"clipJobs">, phase: "clipping", note, ...(pct != null ? { pct } : {}), authSecret: SECRET() }).catch(() => {});
    const workDir = await mkdtemp(join(tmpdir(), "vello-batch-"));
    try {
      // Estimate the SOURCE length from the clip windows (last moment's end ≈ source
      // duration) so we can pull a long video at a lower resolution and give it a
      // bigger, deadline-derived time budget.
      const estSourceSec = Math.max(
        0,
        ...clips.map((c) => c.moment?.endSeconds ?? 0),
        ...clips.flatMap((c) => (c.assembled?.subSegments ?? []).map((s) => s.end)),
      );
      const primaryHeight = estSourceSec > CLIP_LONG_SOURCE_SEC ? 720 : 1080;
      // The pull's time budget tracks the SHARED deadline (reserving time to cut),
      // capped by CLIP_PULL_MAX_MS — so a 1 h+ source uses most of the run instead of
      // a fixed 10-min wall. Floored so a dead stream still fails eventually.
      const pullBudget = () => Math.max(
        90_000,
        Math.min(CLIP_PULL_MAX_MS, deadlineAt - Date.now() - CLIP_PULL_RENDER_RESERVE_MS),
      );
      // Pull ONE source to disk (RAM-safe), with a RESOLUTION FALLBACK: if the pull
      // stalls/fails at the chosen height, retry at a smaller one (fewer bytes → more
      // likely to land in the remaining budget) before giving up. Guarantees we try
      // hard to get SOMETHING to cut from, rather than failing every clip on one stall.
      // EVERY download must land in its OWN directory. The downloaders all write to
      // a FIXED basename (`<workDir>/src`), so two pulls sharing a work dir silently
      // overwrite each other and every later reference resolves to whichever file
      // landed last. That is what made a UGC render play the hook twice: the main
      // video was fetched first, the hook overwrote it, and both stitch inputs
      // pointed at the same file — 8s + 6s of hook, the right DURATION with the
      // wrong footage, which is why it looked like the main content "wasn't added".
      let pullSeq = 0;
      const freshPullDir = async (): Promise<string> => {
        const dir = join(workDir, `pull-${pullSeq++}`);
        await mkdir(dir, { recursive: true });
        return dir;
      };

      const pullSource = async (url: string, label: string): Promise<string> => {
        const ladder = primaryHeight === 720 ? [720, 480, 360] : [1080, 720, 480];
        let lastErr: unknown;
        for (const height of ladder) {
          const budget = pullBudget();
          if (budget < 60_000) break; // no time left to try a smaller rung
          try {
            const { path } = await withTimeout(
              downloadToLocal(url, { workDir: await freshPullDir(), mode: "full", maxHeight: height }),
              budget,
              `${label} stalled at ${height}p — no completion in ${Math.round(budget / 60000)}min`,
            );
            if (height !== ladder[0]) await beat(`Retried source at ${height}p (lighter) — got it.`);
            return path;
          } catch (e) {
            lastErr = e;
            await beat(`Source pull at ${height}p failed: ${String(e instanceof Error ? e.message : e).slice(0, 90)} — trying lighter…`);
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      };

      // UGC RUN ("No clip / UGC needed"): the operator's uploads ARE the content, so
      // there is no source to pull. Skipping the pull is the whole point — otherwise
      // the run still pays to download a video it never cuts from.
      const ugcRun = config.mainOnly === true && (config.mainVideos?.length ?? 0) > 0;
      if (!ugcRun) await beat(`Pulling source for cutting (${primaryHeight}p${estSourceSec ? `, ~${Math.round(estSourceSec / 60)}min source` : ""})…`, 0);
      const srcPath = ugcRun ? "" : await pullSource(sourceUrl, "whole-source pull");
      // CROSS-VIDEO FILL: any assembled clip references SIBLING sources beyond the
      // primary. Pull each additional source ONCE (dedup) into a url→path map — the
      // primary keeps its already-pulled path. A sibling pull failure is best-effort:
      // the stitch clip needing it fails below with a clear reason (others proceed).
      const srcPaths = new Map<string, string>(srcPath ? [[sourceUrl, srcPath]] : []);
      const extraSources = new Set<string>();
      for (const c of clips) for (const ss of c.assembled?.subSegments ?? []) {
        if (ss.sourceUrl && !srcPaths.has(ss.sourceUrl)) extraSources.add(ss.sourceUrl);
      }
      for (const url of extraSources) {
        try {
          const p = await pullSource(url, "sibling-source pull");
          srcPaths.set(url, p);
        } catch (e) {
          await beat(`Sibling source pull failed: ${String(e instanceof Error ? e.message : e).slice(0, 100)}`);
          // leave unset — the stitch clip that needs it fails with a clear reason
        }
      }
      // ── Video POOLS: Hook Videos (clip.hookvideos) + Main Content (clip.maincontent).
      // Transcripts come from the shared cache when warm; misses are warmed in the
      // BACKGROUND, so a freshly uploaded pool cycles this run and matches the next
      // one instead of stalling this render behind N transcriptions.
      const [hookPool, mainPool] = await Promise.all([loadPool(config.hookVideos), loadPool(config.mainVideos)]);
      if (hookPool.length || mainPool.length) warmPool([...hookPool, ...mainPool], selfOrigin(), SECRET());
      // Pool videos are pulled ONCE per batch and reused across clips.
      const poolPaths = new Map<string, { path: string; durationSec: number }>();
      const ensurePoolVideo = async (url: string): Promise<{ path: string; durationSec: number } | null> => {
        const hit = poolPaths.get(url);
        if (hit) return hit;
        try {
          const { path } = await withTimeout(
            downloadToLocal(url, { workDir: await freshPullDir(), mode: "full", maxHeight: 1080 }),
            Math.max(60_000, Math.min(pullBudget(), 5 * 60_000)),
            "uploaded video pull stalled",
          );
          const durationSec = await probeDurationSec(path);
          if (durationSec <= 0) throw new Error("uploaded video has no readable duration");
          const entry = { path, durationSec };
          poolPaths.set(url, entry);
          return entry;
        } catch (e) {
          // Best-effort: a bad upload must never fail the whole run. The clip renders
          // without the hook (or, in bypass mode, is marked failed with this reason).
          await beat(`Uploaded video unavailable: ${String(e instanceof Error ? e.message : e).slice(0, 90)}`);
          return null;
        }
      };
      // SMART CAPTIONS: write each clip's description at render time, so the same
      // line appears on the Generations card, in the queue and on the published post.
      // Only runs when the app is wired; otherwise the row keeps its existing text.
      const describes = !!clipDescriptionInstruction(skills as { skillId?: string }[]);
      // What the clip is "about" when it carries no words of its own: the campaign
      // it serves, else the persona. Used BOTH as the generation basis and as the
      // fallback label, so a caption-less clip still reads as this agent's clip
      // rather than "Untitled".
      const ctx = body.context ?? {};
      const personaContext = [ctx.agentName, ctx.niche].filter(Boolean).join(" · ");
      /**
       * Every clip gets a label. Smart Captions writes it when wired; otherwise (or
       * when the model returns nothing) a deterministic persona/campaign label is
       * used. The one thing never returned is an empty string — that is what the
       * gallery rendered as "Untitled clip".
       */
      const describeClip = async (i: number, title: string, captionText: string, transcriptText: string): Promise<string> => {
        const generated = describes
          ? await buildClipDescription({
              skills: skills as { skillId?: string }[],
              transcriptText, captionText, title,
              fallbackContext: personaContext,
              apiKey: kieApiKey,
            })
          : "";
        if (generated) return generated;
        // Keep a real, non-placeholder title the analyzer produced.
        const existing = [captionText, title].map((t) => (t ?? "").trim())
          .find((t) => t && !/^\s*(clip|upload)\s*\d*\s*$/i.test(t));
        return existing ?? fallbackClipLabel({ index: i, agentName: ctx.agentName, niche: ctx.niche });
      };

      /** The clip's own words — what a pool pick is matched against. */
      // Row LABELS ("Clip 2", "Upload 1") describe nothing, so they must not be used
      // as the match text — they would score against a pool transcript as noise.
      const isRowLabel = (t: string | undefined) => /^\s*(clip|upload)\s*\d*\s*$/i.test(t ?? "");
      const clipTextFor = (c: ClipPlan): string =>
        [c.moment?.captionText, isRowLabel(c.moment?.title) ? "" : c.moment?.title]
          .filter(Boolean).join(" ").trim();
      /** Resolve this clip's hook video, if the app is installed and usable. */
      const hookForClip = async (c: ClipPlan, i: number) => {
        if (hookPool.length === 0) return null;
        const pick = pickFromPool({ pool: hookPool, clipText: clipTextFor(c), index: i });
        return pick ? await ensurePoolVideo(pick.url) : null;
      };

      let done = 0;
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= clips.length) return;
          // Stop starting clips with less than one full per-clip budget left before
          // the shared deadline — so a clip we START always finishes BEFORE the
          // deadline, never AFTER cutPoll has already failed it (eliminates the
          // deadline race). cutPoll fails any never-started "rendering" rows + finalizes.
          if (Date.now() > deadlineAt - PER_CLIP_MAX_MS) return;
          const c = clips[i];
          const m = c.moment;
          try {
            // ── BYPASS ("No clip / UGC needed"): publish an uploaded main video
            // instead of cutting from the source. The pool cycles to fill the run's
            // clip count, each output gets its matched hook in front, and the render
            // still runs the normal overlay stage so captions/filters/CTA apply.
            if (config.mainOnly && mainPool.length > 0) {
              const mainPick = pickFromPool({ pool: mainPool, clipText: clipTextFor(c), index: i });
              const main = mainPick ? await ensurePoolVideo(mainPick.url) : null;
              if (!main) throw new Error("no usable uploaded main video (check the Main Content app's uploads)");
              const hook = await hookForClip(c, i);
              // Defensive: two inputs resolving to the SAME file renders the same
              // footage twice at the right total duration — a failure that looks like
              // "the main content is missing" rather than like an error. Cheap to
              // assert, and it was invisible for a whole release without it.
              if (hook && hook.path === main.path) {
                console.warn("[clip-batch] hook and main resolved to the same file — dropping the hook for this clip");
              }
              const usableHook = hook && hook.path !== main.path ? hook : null;
              const inputs = [
                ...(usableHook ? [{ srcPath: usableHook.path, start: 0, end: usableHook.durationSec, words: [] }] : []),
                { srcPath: main.path, start: 0, end: main.durationSec, words: [] },
              ];
              const clipConfig = c.configOverride ? { ...config, ...c.configOverride } : config;
              // The uploaded video IS the content, so there is no transcript to plan
              // against — ask for the styling ops only (captions have no words to
              // burn; filters/logo/reframe still apply).
              const ops = await planClipEdits(
                { skills, config: clipConfig, window: [], words: [], moment: { ...m, startSeconds: 0, endSeconds: main.durationSec + (hook?.durationSec ?? 0) } },
                { apiKey: kieApiKey },
              );
              // Say what actually applied. On a UGC render the uploads are not
              // transcribed, so a `subtitles` op has no words to burn — the app is
              // installed and did nothing, which reads as a bug unless it is stated.
              const opKinds = [...new Set((ops as { op: string }[]).map((o) => o.op))];
              const captionsNoop = opKinds.includes("subtitles");
              await beat(
                `Building post ${i + 1}: ${usableHook ? "hook + " : ""}uploaded video` +
                `${opKinds.filter((k) => k !== "reframe" && k !== "subtitles").length ? ` · applying ${opKinds.filter((k) => k !== "reframe" && k !== "subtitles").join(", ")}` : ""}` +
                `${captionsNoop ? " · captions skipped (uploaded videos aren't transcribed)" : ""}`,
              );
              const { clipUrl } = await renderStitchedClip(inputs, { ops }, { maxMs: PER_CLIP_MAX_MS });
              const finalUrl = config.ctaVideo ? await appendCtaFromUrls(clipUrl, config.ctaVideo, config.transition) : clipUrl;
              // A UGC row was inserted with a 0..0 window (only the renderer can know
              // the uploaded file's length) — report it so the queue shows a duration.
              // An uploaded video has no transcript, so the description comes from
              // the operator's instruction alone — which is exactly what Smart
              // Captions is for.
              const ugcDesc = await describeClip(i, m.title ?? "", m.captionText ?? "", "");
              await setClip(c.clipId, {
                status: "ready",
                clipUrl: finalUrl,
                endSeconds: Math.round(main.durationSec + (usableHook?.durationSec ?? 0)),
                ...(ugcDesc ? { captionText: ugcDesc } : {}),
              });
              continue;
            }

            const stitch = c.assembled && Array.isArray(c.assembled.subSegments) && c.assembled.subSegments.length > 0
              ? c.assembled : null;
            if (stitch) {
              // ── CROSS-VIDEO FILL branch: assemble ONE clip from sub-windows spanning
              // multiple sources. Resolve each sub-window to its already-pulled path,
              // plan on the RETIMED stitched transcript (moment window is 0..totalLen),
              // then render via the multi-file stitch (aspect/fps/audio-normalized).
              const missing = stitch.subSegments.find((ss) => !srcPaths.has(ss.sourceUrl));
              if (missing) throw new Error(`cross-video fill: sibling source unavailable (${missing.sourceUrl.slice(0, 80)})`);
              const hook = await hookForClip(c, i);
              const stitchInputs = [
                // Hook first: renderStitchedClip retimes every following segment's
                // words by the hook's length, so captions stay in sync and an Auto
                // Hook overlay at t=0 burns over the hook video.
                ...(hook ? [{ srcPath: hook.path, start: 0, end: hook.durationSec, words: [] as TranscriptWord[] }] : []),
                ...stitch.subSegments.map((ss) => ({
                  srcPath: srcPaths.get(ss.sourceUrl)!, start: ss.start, end: ss.end, words: ss.words ?? [],
                })),
              ];
              // Retime words to the concatenated 0-based timeline for planning (the
              // SAME pure math renderStitchedClip re-applies internally).
              const stitchedWords = retimeStitchedWords(stitchInputs.map((s) => ({ start: s.start, end: s.end, words: s.words })));
              const clipConfig = c.configOverride ? { ...config, ...c.configOverride } : config;
              let ops = await planClipEdits({ skills, config: clipConfig, window: stitch.segments ?? [], words: stitchedWords, moment: m }, { apiKey: kieApiKey });
              if (c.reframeMode) ops = ops.map((o) => (o.op === "reframe" ? { ...o, mode: c.reframeMode! } : o));
              const { clipUrl } = await renderStitchedClip(stitchInputs, { ops }, { maxMs: PER_CLIP_MAX_MS });
              // Video Call To Action — append the uploaded clip to the end (fail-safe).
              const finalUrl = config.ctaVideo ? await appendCtaFromUrls(clipUrl, config.ctaVideo, config.transition) : clipUrl;
              const stitchDesc = await describeClip(i, m.title ?? "", m.captionText ?? "", stitchedWords.map((w) => w.word).join(" "));
              await setClip(c.clipId, { status: "ready", clipUrl: finalUrl, ...(stitchDesc ? { captionText: stitchDesc } : {}) });
            } else {
            // Window the transcript to this moment (ABSOLUTE coords). planClipEdits
            // wants segments + words; the render gets the same absolute words and
            // input-seeks to m.startSeconds — canvas-identical render path.
            const window = segments.filter((s) => s.end > m.startSeconds && s.start < m.endSeconds);
            const wWords = words.filter((w) => w.end > m.startSeconds && w.start < m.endSeconds);
            // Per-clip VARIATION override: merge the varied hook/caption config for
            // THIS clip so planClipEdits styles it differently from the pristine cut.
            const clipConfig = c.configOverride ? { ...config, ...c.configOverride } : config;
            let ops = await planClipEdits({ skills, config: clipConfig, window, words: wWords, moment: m }, { apiKey: kieApiKey });
            // Force the variation's framing onto the reframe op (planClipEdits reads no
            // config field for crop/pad). Applied to the existing reframe op so no
            // duplicate is introduced; validateEditPlan already guarantees exactly one.
            if (c.reframeMode) ops = ops.map((o) => (o.op === "reframe" ? { ...o, mode: c.reframeMode! } : o));
            // A hook video turns a single-file cut into a two-segment stitch: hook
            // first, then the clip window. The stitch pre-pass normalizes both to the
            // same canvas and retimes the clip's words past the hook, so the overlay
            // stage sees one continuous video and burns text over the hook.
            const hook = await hookForClip(c, i);
            const { clipUrl } = hook
              ? await renderStitchedClip(
                  [
                    { srcPath: hook.path, start: 0, end: hook.durationSec, words: [] },
                    { srcPath, start: m.startSeconds, end: m.endSeconds, words: wWords },
                  ],
                  { ops },
                  { maxMs: PER_CLIP_MAX_MS },
                )
              : await renderClipFromFile(
                  srcPath,
                  // Output canvas from the persisted aspect — renders defaulted to 1080x1920
                  // because the cloud path never carried width/height.
                  { startSeconds: m.startSeconds, endSeconds: m.endSeconds, ops, words: wWords, cameraTransitions: !!config.transition, transition: config.transition, ...outputDimsFor(config.outputAspect) },
                  { maxMs: PER_CLIP_MAX_MS },
                );
            // Video Call To Action — append the uploaded clip to the end (fail-safe).
            const finalUrl = config.ctaVideo ? await appendCtaFromUrls(clipUrl, config.ctaVideo, config.transition) : clipUrl;
            const desc = await describeClip(i, m.title ?? "", m.captionText ?? "", wWords.map((w) => w.word).join(" "));
            await setClip(c.clipId, { status: "ready", clipUrl: finalUrl, ...(desc ? { captionText: desc } : {}) });
            }
          } catch (e) {
            await setClip(c.clipId, { status: "failed", failReason: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
          } finally {
            done++;
            await beat(`Cut ${done}/${clips.length}`, Math.round((done / clips.length) * 100));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, clips.length) }, worker));
    } catch (e) {
      // Whole-source pull failed → mark EVERY clip failed so the poller sees all
      // rows terminal and finalizes (instead of waiting out the deadline).
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await beat(`Source download for cutting failed: ${reason.slice(0, 120)}`);
      for (const c of clips) await setClip(c.clipId, { status: "failed", failReason: `source download failed: ${reason}` });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  })();

  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
