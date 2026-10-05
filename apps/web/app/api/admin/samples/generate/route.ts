import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { downloadAndStore } from "@/lib/server/ytDownload";
import { streamFetchToFile } from "@/lib/server/downloader";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import { selectClipMoments } from "@/lib/server/clipMomentSelector";
import { normalizeClipConfig } from "@/lib/builder/clipConfig";
import { renderClipFromFile } from "@/lib/server/clipRender";
import { hookText, hookOverlayOp } from "@/lib/builder/clipSkillsCatalog";
import { transformHookText } from "@/lib/server/hookTransform";
import { reactionSfxPackById, reactionSfxUrl, REACTION_SFX_BUCKETS, type ReactionSfxBucket } from "@/lib/server/reactionSfxPack";
import { stickerUrl, DEFAULT_STICKER_ID } from "@/lib/server/stickerPack";
import { searchStockPhoto } from "@/lib/server/imageSearch";
import { searchTrendingSfx } from "@/lib/server/audioSearch";
import { isKeyword, isEmphasis } from "@/lib/server/captionRenderer";
import { generateMotionBeats, type MotionBeat } from "@/lib/server/motionGraphics";
import { generateBrollCues, type BrollCue } from "@/lib/server/brollCues";
import type { EditOp } from "@/lib/server/clipEditOps";
import type { Transcript, TranscriptWord } from "@/lib/server/clipTypes";
import type { ClipMoment } from "@/lib/server/clipTypes";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const KIE_KEY = process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim() || "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
// String refs (not the generated `api` import) — this route stays resilient
// even if the sampleRuns table/functions haven't been pushed to the deployment
// yet: a missing function just throws, caught below, and the run still returns
// its clips to the caller (history is best-effort, never blocks generation).
const RECORD_RUN = makeFunctionReference<"mutation">("sampleRuns:record");

/** Extra per-moment context templates need beyond the moment itself: the clip's
 *  OWN word timings (clip-relative — same as `relWords` in the render loop, so
 *  a template can trigger effects on the exact second a keyword is SPOKEN). */
interface TemplateCtx {
  words: TranscriptWord[];
  /** Podcast only: KIE-picked B-roll cutaway cues (lib/server/brollCues.ts),
   *  each paired 1:1 (by index) with `brollUrls` — the resolved photo for that
   *  cue's query, or "" if the search came up empty (that cue is then skipped,
   *  not replaced with something irrelevant). */
  brollCues?: BrollCue[];
  brollUrls?: string[];
  /** Ali Abdaal only: KIE-generated motion-graphics beats (see motionGraphics.ts),
   *  already snapped to real word timings in this clip. */
  motionBeats?: MotionBeat[];
  /** Gen Z only: one extra trending SFX URL per emotion bucket (lib/server/
   *  audioSearch.ts, keyless internet search), widening the reaction-sting pool
   *  beyond the 3 fixed bundled sounds. "" if that bucket's search came up empty. */
  trendingSfx?: Record<ReactionSfxBucket, string>;
}

/** Three fixed, visually-distinct templates the admin picks from — each pairs a
 *  real caption preset (lib/builder/captionPresets.ts ids) with a supporting op
 *  so the 3 sample clips never look like the same render with different text.
 *  `ops` takes the ASSIGNED moment, its `hookLine` — a KIE-generated hook (see
 *  the call site) rather than the raw hookText() truncation, so a moment whose
 *  LLM ranking fell back to the generic evenly-spaced picker (empty
 *  captionText, title "Clip 1"/"Clip 2"/...) never burns that placeholder
 *  literally onto the video as the hook — and `ctx` (words + resolved photo). */
const TEMPLATES: Record<string, { label: string; ops: (m: ClipMoment, hookLine: string, ctx: TemplateCtx) => EditOp[] }> = {
  podcast: {
    label: "Podcast Clean",
    ops: (m, hookLine, ctx) => {
      // FULL-FRAME video the whole clip — no permanent split-screen pane. B-roll
      // is instead a handful of TIMED cutaways (broll_overlay: full-bleed photo,
      // fade in → Ken Burns hold → fade out, burned over the live video) at
      // moments KIE picked from THIS clip's own transcript (brollCues, see the
      // call site) — "the image changes, follows the transcription" instead of
      // one static photo pinned up for the whole clip. Each cue paired 1:1 with
      // its resolved photo URL; a cue whose search came up empty is just
      // skipped (never forces an irrelevant image in).
      const brollOps: EditOp[] = (ctx.brollCues ?? []).flatMap((cue, i) => {
        const url = ctx.brollUrls?.[i];
        if (!url) return [];
        return [{ op: "broll_overlay" as const, imageUrl: url, atSec: cue.atSec, durationSec: 3.2, fadeSec: 0.6 }];
      });
      return [
        { op: "reframe", mode: "crop" },
        // Zoom to face + auto-fit-to-face: pans/frames the crop on the detected
        // speaker instead of dead center.
        { op: "face_reframe", mode: "auto" },
        { op: "emphasis", kind: "zoom_punch", atSec: 0, amount: 1.15 },
        // "Super HD" grade (lib/server/clipFilterGraph.ts FILTER_PRESETS.superhd)
        // — the CapCut-style "4K enhance" look: denoise then a two-pass
        // clarity/sharpen unsharp + vibrance + a contrast/gamma lift. Right after
        // reframe (color grade always runs before overlays/captions), so the
        // broll cutaways and hook/captions burn on TOP of the graded picture.
        { op: "color_filter", preset: "superhd" },
        ...brollOps,
        // Premium gold caption preset (lib/builder/captionPresets.ts "gold").
        { op: "subtitles", style: { mode: "line", fontColor: "#EAC15A", fontSize: 62, position: "bottom", preset: "gold" } },
        hookOverlayOp(hookLine, 3),
        // Podcast mic audio runs hot — turn the source track down under the hook/captions.
        { op: "audio_gain", gainDb: -8 },
      ];
    },
  },
  genz: {
    label: "Gen Z",
    ops: (m, _hookLine, ctx) => {
      const ops: EditOp[] = [
        { op: "reframe", mode: "crop" },
        { op: "face_reframe", mode: "zoom" },
        { op: "subtitles", style: { mode: "karaoke", fontColor: "#FFFFFF", fontSize: 78, position: "center", uppercase: true, preset: "karaoke" } },
      ];
      const dur = Math.max(1, m.endSeconds - m.startSeconds);
      const pack = reactionSfxPackById(undefined);
      // FULL-CLIP coverage, not just wherever real keywords happen to cluster
      // (podcast hooks/intros are keyword-dense, the back half of a clip often
      // isn't — a pure keyword scan left the Gen Z edit style visible only in
      // the first few seconds). Bin the clip into ~4s slots spanning its WHOLE
      // duration; each bin picks a keyword/emphasis word if ONE actually falls
      // in it (still content-aware, still "on the beat"), else the bin's own
      // midpoint word — so every bin contributes a hit and the effect visibly
      // runs the entire clip, not just the open.
      const BIN_SEC = 4;
      const numBins = Math.max(1, Math.round(dur / BIN_SEC));
      const binSize = dur / numBins;
      const hitTimes: number[] = [];
      for (let b = 0; b < numBins; b++) {
        const binStart = Math.max(0.2, b * binSize);
        const binEnd = Math.min(dur - 0.5, (b + 1) * binSize);
        if (binEnd <= binStart) continue;
        const inBin = ctx.words.filter((w) => w.start >= binStart && w.start < binEnd);
        if (inBin.length === 0) continue;
        const kw = inBin.find((w) => isKeyword(w.word) || isEmphasis(w.word));
        const pick = kw ?? inBin[Math.floor(inBin.length / 2)];
        if (hitTimes.length > 0 && pick.start - hitTimes[hitTimes.length - 1] < 1.2) continue;
        hitTimes.push(pick.start);
      }
      if (hitTimes.length === 0) hitTimes.push(Math.min(0.15, dur - 0.5)); // never a bare clip
      // Reaction-SFX pool per bucket: the bundled sound (vine-boom/bruh/fah)
      // PLUS a fetched trending internet sting (lib/server/audioSearch.ts —
      // keyless Openverse search, see the call site), so repeated hits on the
      // same bucket don't all play the identical sound.
      const pool: Record<ReactionSfxBucket, string[]> = { shock: [], funny: [], hype: [] };
      for (const bucket of REACTION_SFX_BUCKETS) {
        const bundled = reactionSfxUrl(pack.stings[bucket]);
        if (bundled) pool[bucket].push(bundled);
        const trending = ctx.trendingSfx?.[bucket];
        if (trending) pool[bucket].push(trending);
      }
      hitTimes.forEach((atSec, i) => {
        ops.push({ op: "emphasis", kind: "zoom_punch", atSec, amount: 1.25 });
        const bucket = REACTION_SFX_BUCKETS[i % REACTION_SFX_BUCKETS.length];
        const candidates = pool[bucket];
        if (candidates.length === 0) return;
        const sfxUrl = candidates[Math.floor(i / REACTION_SFX_BUCKETS.length) % candidates.length];
        ops.push({ op: "audio_overlay", audioUrl: sfxUrl, atSec, gainDb: -3 });
      });
      // "Pouting sticker" burned on the detected face — anchors on the clip's
      // one detected face point (image_overlay position:"face"). No-ops when
      // STICKER_BASE_URL / the Supabase bucket fallback isn't configured.
      const stkUrl = stickerUrl(DEFAULT_STICKER_ID);
      if (stkUrl) ops.push({ op: "image_overlay", imageUrl: stkUrl, mode: "overlay", position: "face", opacity: 0.95 });
      return ops;
    },
  },
  aliabdaal: {
    label: "Ali Abdaal Intro",
    ops: (m, hookLine, ctx) => {
      // Cinematic top/bottom gradient scrim (stays on for the WHOLE clip, so it's
      // under the title too, not just a flash at open), then a cascading intro —
      // up to 4 words from the moment's own DYNAMIC title (clipMomentSelector's
      // per-moment `title`, unique to what's actually said in this window; falls
      // back to the KIE-generated hook on the rare empty/placeholder title), each
      // popping in its own font/size for a beat before the next — the "aesthetic
      // text, one word at a time, mixed fonts" cold open Ali Abdaal-style videos
      // open on — before settling into the mono captions for the rest of the clip.
      const titleSrc = (m.title || "").trim().replace(/^Clip \d+$/i, "") || hookLine;
      const words = titleSrc.split(/\s+/).filter(Boolean).slice(0, 4);
      const FONTS: { font: string; upper?: boolean }[] = [
        { font: "fraunces" }, { font: "montserrat" }, { font: "space" }, { font: "anton", upper: true },
      ];
      const PER_WORD_SEC = 0.65;
      const introOps: EditOp[] = words.map((w, i) => ({
        op: "text_overlay",
        text: FONTS[i % FONTS.length].upper ? w.toUpperCase() : w,
        position: "center",
        startSec: i * PER_WORD_SEC,
        endSec: (i + 1) * PER_WORD_SEC,
        style: { fontColor: "#FFFFFF", fontSize: 84 - i * 6, bold: false, outlineColor: "#000000", outlineWidth: 0, font: FONTS[i % FONTS.length].font },
      }));
      // Motion-graphics beats (see the call site — generateMotionBeats, KIE):
      // callout cards timed to what's actually SAID in this window, each pushing
      // the video down into a bottom PIP while its headline/subtext holds in the
      // revealed top card — the "explainer" texture Ali Abdaal-style videos cut
      // to mid-clip. MULTIPLE through the video (generateMotionBeats targets ~1
      // every 12s), each held longer (4.5s, was 3s) so there's real time to read
      // it. Alternates a cream and a near-black card design (bg/accent swap)
      // beat-to-beat for visual variety instead of every card looking identical.
      // Sequenced strictly after the intro AND after the previous card's own
      // exit (a beat nudged later than the LLM's pick could otherwise land
      // mid-way through the prior card's hold).
      const CARD_DURATION_SEC = 4.5;
      const CARD_GAP_SEC = 0.6; // clear air between one card's exit and the next's entrance
      const introEnd = words.length * PER_WORD_SEC;
      const PALETTES = [
        { bg: "#F4E9D8", accent: "#1A1A1A" }, // cream card, near-black text
        { bg: "#161616", accent: "#F4E9D8" }, // near-black card, cream text
      ];
      let nextFree = introEnd + 0.3;
      const motionCardOps: EditOp[] = (ctx.motionBeats ?? []).map((beat, i) => {
        const atSec = Math.max(beat.atSec, nextFree);
        nextFree = atSec + CARD_DURATION_SEC + CARD_GAP_SEC;
        const palette = PALETTES[i % PALETTES.length];
        return {
          op: "motion_card",
          atSec,
          durationSec: CARD_DURATION_SEC,
          headline: beat.headline,
          subtext: beat.subtext,
          bg: palette.bg,
          accent: palette.accent,
        };
      });
      return [
        { op: "reframe", mode: "crop" },
        { op: "face_reframe", mode: "auto" },
        // Stronger scrim (was opacity 0.6 / heightFrac 0.22 — too thin/light), and
        // no fade-IN: full strength from frame 1 (fadeInSec: 0). Holds through the
        // whole word-cascade intro (holdSec matches words.length * PER_WORD_SEC),
        // THEN fades out — the only animated moment is the removal, timed to clear
        // right as the intro finishes and the mono captions take over.
        { op: "gradient_overlay", edges: ["top", "bottom"], opacity: 0.8, heightFrac: 0.4, fadeInSec: 0, holdSec: words.length * PER_WORD_SEC, fadeOutSec: 2 },
        ...introOps,
        ...motionCardOps,
        { op: "subtitles", style: { mode: "line", fontColor: "#FFFFFF", fontSize: 70, position: "bottom", uppercase: true, preset: "mono" } },
        { op: "color_filter", preset: "cinematic" },
      ];
    },
  },
};

/** Join the transcript's own segment text overlapping [start,end] — used as the
 *  KIE hook-writer's context INSTEAD OF moment.captionText, which is empty on a
 *  moment that fell back to the generic evenly-spaced picker (LLM ranking
 *  unavailable). The transcript segments always exist (the route already 422s
 *  earlier if they don't), so this keeps the hook grounded in what was actually
 *  said even when the ranking step itself degraded. */
function windowTranscriptText(transcript: Transcript, start: number, end: number): string {
  return transcript.segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => s.text)
    .join(" ")
    .trim();
}

async function isAuthorized(req: NextRequest, accessToken?: string): Promise<boolean> {
  if (checkInternalSecret(req)) return true;
  if (!accessToken || !CONVEX_URL) return false;
  const convex = new ConvexHttpClient(CONVEX_URL);
  const chk = (await convex.action(CHECK_ADMIN, { accessToken }).catch(() => null)) as { admin: boolean } | null;
  return !!chk?.admin;
}

export async function POST(req: NextRequest) {
  // Route-wide deadline (maxDuration=300 above), with margin reserved for
  // transcription + moment selection + rendering that happen AFTER the source
  // pull. The full-source resolution ladder below checks this before starting
  // each rung — 3 rungs with no shared cap could otherwise run well past this
  // route's own timeout, which gets the request killed by the platform gateway
  // mid-flight (a raw "upstream error" text body instead of our JSON error
  // shape — that's what broke the client's res.json() parse).
  const routeDeadline = Date.now() + 220_000;
  let body: { sourceUrl?: string; templates?: string[]; accessToken?: string; clipLength?: { min?: number; max?: number } };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const sourceUrl = String(body.sourceUrl ?? "").trim();
  if (!sourceUrl) return NextResponse.json({ ok: false, error: "sourceUrl required" }, { status: 400 });
  const templateIds = Array.isArray(body.templates) ? body.templates.slice(0, 3) : [];
  if (templateIds.length !== 3 || templateIds.some((t) => !TEMPLATES[t])) {
    return NextResponse.json({ ok: false, error: "templates must name exactly 3 valid template ids" }, { status: 400 });
  }
  // Operator's clip-length pick (the "how many seconds" range selector on the
  // samples page). normalizeClipConfig clamps both ends to [5,90]s and forces
  // max>=min, so a malformed/missing range just falls back to the 15-45s default.
  const clipLengthInput = body.clipLength && typeof body.clipLength === "object" ? body.clipLength : undefined;

  if (!(await isAuthorized(req, body.accessToken))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1a. Pull just the AUDIO via yt-dlp (mode:"audio") and stash it in Convex
    //    storage. transcribe-clip's own audio-fetch only handles Drive links or an
    //    already-direct media URL (safeFetchToBuffer, a plain HTTP GET) — a raw
    //    youtube.com/watch?v= URL isn't fetchable that way and 429s (YouTube
    //    bot-blocks a bare GET on the watch page; it needs yt-dlp's extraction).
    //    downloadAndStore also checks downloadCache first, so a repeat of the same
    //    link skips this pull entirely too.
    let audioUrl: string | undefined;
    try {
      const aud = await downloadAndStore(sourceUrl, { mode: "audio" });
      audioUrl = aud.url;
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Audio fetch failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }

    // 1b. Cheap transcript: the existing STT route (audio-only extraction, capped
    //    to 20min without an ElevenLabs key) — one call, no per-window re-downloads.
    //    campaignSource:true opts into transcriptCache (convex/transcriptCache.ts,
    //    keyed by sourceKey(sourceUrl)) — re-submitting the SAME link skips a fresh
    //    transcribe+analyze entirely (the "use the video already in the database,
    //    save credit" ask). Safe here specifically: this is an internal admin tool
    //    hitting the same handful of links repeatedly, not the general user
    //    paste-URL flow that policy deliberately excludes from caching.
    const sttRes = await fetch(`${APP_URL}/api/video/transcribe-clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET ?? "" },
      body: JSON.stringify({ sourceUrl, audioUrl, campaignSource: true }),
    });
    const stt = await sttRes.json().catch(() => null);
    if (!sttRes.ok || !stt) {
      return NextResponse.json({ ok: false, error: `Transcription failed: ${stt?.error ?? sttRes.status}` }, { status: 502 });
    }
    const transcript: Transcript = {
      segments: Array.isArray(stt.segments) ? stt.segments : [],
      words: Array.isArray(stt.words) ? stt.words : [],
      durationSeconds: Number(stt.durationSeconds) || 0,
    };
    if (transcript.segments.length === 0) {
      return NextResponse.json({ ok: false, error: "No speech detected in source — can't pick sample moments." }, { status: 422 });
    }

    // 2. Rank moments, capped to exactly 3 (one per template slot). The LLM picker
    //    already returns the MOST viral moments sorted by viralScore (clipMomentSelector
    //    sorts descending before slicing) — top 3 here are genuinely the 3 best, each a
    //    DIFFERENT window, and every cut lands on a real word/sentence boundary
    //    (snapEndToWordBoundary), never a mid-word "sudden end".
    const config = normalizeClipConfig({ maxClipsPerSource: 3, clipLength: clipLengthInput ?? { min: 15, max: 45 } });
    const moments = (await selectClipMoments(transcript, config, { apiKey: KIE_KEY, genre: "auto" })).slice(0, 3);
    if (moments.length < 3) {
      return NextResponse.json({ ok: false, error: `Only found ${moments.length} usable moment(s) — source may be too short.` }, { status: 422 });
    }

    // 3. Per moment: cut its window from ONE shared full-source pull, rendered
    //    with its assigned template. Independent failures don't kill the other
    //    two slots.
    //
    // Previously this attempted a per-window segment download FIRST (yt-dlp
    // --download-sections) and only fell back to the full-pull+local-cut path
    // below on failure — but --download-sections rides on ffmpeg's SINGLE HTTP
    // connection to googlevideo, the flakiest path through the residential
    // proxy (403/5XX per-connection failures kill the whole slot), and this
    // whole route runs inside ONE synchronous 300s request (maxDuration=300,
    // above). Three segment attempts × yt-dlp's own 5-minute wall-clock ×
    // retries could burn the entire request budget before ever reaching the
    // fallback, surfacing as a stalled/proxy yt-dlp error on generate. The
    // fallback — one full-video pull (Convex-cached, shared across all 3
    // moments via getFullSource's memoized promise) then a local ffmpeg cut
    // per window — is also exactly the mechanism the builder's reliable clip
    // pipeline (clip-batch-start) uses. Made it the ONLY path.
    // Resolution FALLBACK ladder — same mechanism clip-batch-start uses. A
    // fixed maxHeight:720 with no fallback kept 403ing even WITH the proxy
    // retrying 3x on fresh sticky sessions (YTDLP_PROXY is confirmed set in
    // prod — /api/health/config); some formats/itags stay blocked at a given
    // height regardless of exit IP. Trying progressively lighter formats gives
    // the pull another real way to succeed instead of exhausting all 3 proxy
    // retries against the same stubborn 720p format every time.
    // Was ALWAYS starting at 720p — capping every sample below HD even for a
    // short source that could easily afford 1080p. clip-batch-start (the
    // builder's pipeline) only drops to 720p first for LONG sources (>25min,
    // CLIP_LONG_SOURCE_SEC), attempting 1080p first otherwise — mirrored here
    // using the source duration already known from the transcript (step 1b),
    // so samples get the same HD-when-reasonable policy the builder gets.
    const CLIP_LONG_SOURCE_SEC = Number(process.env.CLIP_LONG_SOURCE_SEC) || 25 * 60;
    const startHeight = transcript.durationSeconds > CLIP_LONG_SOURCE_SEC ? 720 : 1080;
    let fullSourcePromise: Promise<{ url: string }> | null = null;
    const getFullSource = () => (fullSourcePromise ??= (async () => {
      const ladder = startHeight === 1080 ? [1080, 720, 480] : [720, 480, 360];
      let lastErr: unknown;
      for (const height of ladder) {
        if (routeDeadline - Date.now() < 20_000) {
          throw lastErr instanceof Error ? lastErr : new Error("Ran out of time pulling the source before trying every resolution");
        }
        try {
          // Pass the ACTUAL remaining route time, not the downloader's own 3-min
          // default — otherwise a rung starting late in the route still gets a
          // fresh full allowance regardless of how little is really left, which
          // is what kept blowing this route's maxDuration and surfacing as the
          // platform gateway's raw "upstream error" response.
          const res = await downloadAndStore(sourceUrl, { mode: "full", maxHeight: height, retryBudgetMs: routeDeadline - Date.now() });
          if (height !== ladder[0]) console.warn(`[admin/samples] full-source pull succeeded at ${height}p after a higher rung failed`);
          return res;
        } catch (e) {
          lastErr = e;
          console.warn(`[admin/samples] full-source pull at ${height}p failed (${e instanceof Error ? e.message.slice(0, 140) : e}) — trying lighter…`);
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    })());
    const cutWindowLocally = async (workDir: string, startSec: number, endSec: number): Promise<{ path: string }> => {
      const ffmpeg = resolveFfmpegPath();
      if (!ffmpeg) throw new Error("ffmpeg unavailable for the local segment cut");
      const { url } = await getFullSource();
      const full = join(workDir, "full-src.mp4");
      await streamFetchToFile(url, full, { requireVideo: true });
      const out = join(workDir, "cut.mp4");
      // -ss before -i + re-encode = frame-accurate cut (keyframe seek, then
      // decode forward), so segment-relative caption word offsets stay synced.
      await execFileP(ffmpeg, [
        "-y", "-ss", startSec.toFixed(2), "-to", endSec.toFixed(2), "-i", full,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", out,
      ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
      return { path: out };
    };
    const results = await Promise.all(
      moments.map(async (moment, i) => {
        const templateId = templateIds[i];
        const template = TEMPLATES[templateId];
        const workDir = await mkdtemp(join(tmpdir(), "vello-sample-"));
        try {
          const seg = await cutWindowLocally(workDir, moment.startSeconds, moment.endSeconds);
          const relWords: TranscriptWord[] = transcript.words
            .filter((w) => w.end > moment.startSeconds && w.start < moment.endSeconds)
            .map((w) => ({ word: w.word, start: w.start - moment.startSeconds, end: w.end - moment.startSeconds }));
          // KIE-generated hook, grounded in this window's OWN transcript text (not
          // moment.captionText, which is empty when moment ranking fell back to the
          // generic evenly-spaced picker) — falls back to the deterministic
          // hookText() truncation only if the LLM call itself fails.
          const hookLine = (await transformHookText(
            windowTranscriptText(transcript, moment.startSeconds, moment.endSeconds) || moment.captionText || moment.title || "",
            "",
            hookText(moment),
            KIE_KEY,
          )).text;
          // Podcast-only: KIE picks B-roll cutaway MOMENTS from this clip's own
          // transcript (lib/server/brollCues.ts — "follow the transcription"),
          // then each cue's query is resolved to a real photo (keyless CC search
          // — lib/server/imageSearch.ts). A handful of DIFFERENT relevant images
          // through the clip, not one static photo for the whole thing.
          const brollCues = templateId === "podcast"
            ? await generateBrollCues(relWords, moment.endSeconds - moment.startSeconds, KIE_KEY).catch(() => [])
            : undefined;
          const brollUrls = brollCues?.length
            ? await Promise.all(brollCues.map((cue) => searchStockPhoto(cue.query).catch(() => null).then((u) => u ?? "")))
            : undefined;
          // Ali Abdaal-only: motion-graphics callout beats, grounded in this
          // clip's OWN spoken words (lib/server/motionGraphics.ts, KIE) — "the
          // motion graphics animate based on what he said," not a canned effect.
          const motionBeats = templateId === "aliabdaal"
            ? await generateMotionBeats(relWords, moment.endSeconds - moment.startSeconds, KIE_KEY).catch(() => [])
            : undefined;
          // Gen Z-only: one trending internet SFX per emotion bucket (keyless
          // Openverse search — lib/server/audioSearch.ts), widening the reaction
          // pool beyond the 3 fixed bundled sounds. Fetched in parallel; a bucket
          // whose search fails just falls back to the bundled sound in the template.
          const trendingSfx = templateId === "genz"
            ? await Promise.all(REACTION_SFX_BUCKETS.map((b) => searchTrendingSfx(b).catch(() => null)))
              .then((urls) => Object.fromEntries(REACTION_SFX_BUCKETS.map((b, i) => [b, urls[i] ?? ""])) as Record<ReactionSfxBucket, string>)
            : undefined;
          const rendered = await renderClipFromFile(
            seg.path,
            { startSeconds: 0, endSeconds: moment.endSeconds - moment.startSeconds, ops: template.ops(moment, hookLine, { words: relWords, brollCues, brollUrls, motionBeats, trendingSfx }), words: relWords, width: 1080, height: 1920 },
            // 90s was BELOW the 120s floor renderClipFromFile needs to even attempt
            // face-detect (lib/server/clipRender.ts: `needsFaceDetect && routeRemainingMs()
            // < 120_000` skips straight to a centered crop) — so "zoom to face" /
            // "auto-fit to face" / the Gen Z face sticker were silently no-ops the whole
            // budget. 220s clears that floor with room for the encode after, and still
            // leaves headroom under this route's own 300s function ceiling (the 3 clips
            // render in parallel, not stacked — but this was hardcoded independent
            // of the DOWNLOAD phase before it, which shares the SAME route
            // maxDuration=300 budget. Download (routeDeadline, up to 220s) + a
            // fixed 220s render regardless of how much that left could sum to
            // ~440s — well past this route's own ceiling, which the platform
            // gateway then kills mid-flight (the raw "upstream error" response
            // instead of our JSON error shape). Now derives its budget from the
            // SAME routeDeadline clock the download ladder uses, so the combined
            // download+render total can never exceed the route's real budget.
            { maxMs: Math.max(30_000, routeDeadline - Date.now()) },
          );
          return {
            ok: true as const,
            templateId, templateLabel: template.label,
            clipUrl: rendered.clipUrl,
            title: moment.title, captionText: moment.captionText, viralScore: moment.viralScore,
            startSeconds: moment.startSeconds, endSeconds: moment.endSeconds,
          };
        } catch (e) {
          return { ok: false as const, templateId, templateLabel: template.label, error: e instanceof Error ? e.message : String(e) };
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
      }),
    );

    // Best-effort history write (never blocks the response — the operator still
    // gets their clips even if this table isn't deployed yet or Convex hiccups).
    // LOGGED on failure (was a bare .catch(() => {})): a silently-swallowed
    // write is indistinguishable from "saving fine" until someone notices the
    // History list is empty days later — this is the only signal an operator
    // gets that a run's history entry didn't actually persist.
    if (CONVEX_URL) {
      const convex = new ConvexHttpClient(CONVEX_URL);
      void convex
        .mutation(RECORD_RUN, {
          sourceUrl,
          clips: results.map((r) => ({
            templateId: r.templateId,
            templateLabel: r.templateLabel,
            ok: r.ok,
            ...(r.ok
              ? { clipUrl: r.clipUrl, title: r.title, captionText: r.captionText, viralScore: r.viralScore, startSeconds: r.startSeconds, endSeconds: r.endSeconds }
              : { error: r.error }),
          })),
        })
        .catch((e) => {
          console.error(`[admin/samples] sampleRuns.record FAILED — this run will NOT show in History: ${e instanceof Error ? e.message : String(e)}`);
        });
    } else {
      console.warn("[admin/samples] NEXT_PUBLIC_CONVEX_URL not set — history write skipped entirely, this run will NOT show in History");
    }

    return NextResponse.json({ ok: true, clips: results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
