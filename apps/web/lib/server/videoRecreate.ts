import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { streamFetchToFile } from "@/lib/server/downloader";
import { callGeminiVision, callGeminiVideoVision, callClaudeJSON, extractClaudeJson } from "@/lib/server/kie-claude";
import { selfLoopbackBase } from "@/lib/server/fetchInternal";
import type { StoryBeat } from "@/lib/server/kie-video-pipeline";
import { SPEAKING_WORDS_PER_SEC } from "@/lib/builder/agentTypes";

const execFileP = promisify(execFile);

/** Hard input ceiling — bounds understanding cost (transcribe + per-scene vision)
 *  and the downstream Veo chain length/cost. */
export const MAX_SOURCE_SECONDS = 60;

export interface OriginalScene {
  start: number;
  end: number;
  transcript: string;
  /** Gemini-vision description: composition, action, setting, on-screen product. */
  description: string;
  hasProduct: boolean;
  /** Exact on-screen text (captions/headlines/graphics) visible in this scene, "" if none. */
  onScreenText: string;
}

function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function sampleFrame(ffmpeg: string, src: string, atSec: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      ffmpeg,
      ["-y", "-ss", String(Math.max(0, atSec)), "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
      { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
    );
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as unknown as string);
    return buf.length ? `data:image/jpeg;base64,${buf.toString("base64")}` : null;
  } catch {
    return null;
  }
}

/** Probe the source's frame size (ffmpeg -i, dimensions live on stderr's Video
 *  stream line) and map it to the nearest KIE aspect bucket, so the recreated
 *  video matches the UPLOADED video's shape instead of a hardcoded default. */
export async function probeSourceAspect(url: string): Promise<"9:16" | "16:9" | "1:1"> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return "9:16";
  let stderr = "";
  try {
    const r = await execFileP(ffmpeg, ["-hide_banner", "-i", url], { timeout: 30_000 });
    stderr = String(r.stderr ?? "");
  } catch (e) {
    // ffmpeg -i with no output always exits non-zero — the info we want is on
    // the error's stderr.
    stderr = String((e as { stderr?: string })?.stderr ?? "");
  }
  const m = /Video:[^\n]*?\s(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!m) return "9:16";
  let w = Number(m[1]);
  let h = Number(m[2]);
  // Portrait phone videos often store landscape frames + a 90° rotation flag.
  if (/rotate\s*:\s*(90|270)|displaymatrix:[^\n]*(-?90|-?270)/i.test(stderr)) [w, h] = [h, w];
  const ratio = w / h;
  if (ratio > 1.2) return "16:9";
  if (ratio < 0.84) return "9:16";
  return "1:1";
}

/** One representative frame of the source, re-hosted as a public URL so it can
 *  ride along as a KIE image reference (data URLs are rejected by Kie). Used to
 *  lock the generated presenter to the ORIGINAL video's scene: same framing,
 *  lighting and setting — only the person changes. */
export async function samplePresenterFrame(url: string, atSec = 1): Promise<string | null> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return null;
  const dataUrl = await sampleFrame(ffmpeg, url, atSec);
  if (!dataUrl) return null;
  const { hostBase64ForKie } = await import("@/lib/server/imageForKie");
  return hostBase64ForKie(dataUrl.split(",")[1] ?? "", Math.floor(Math.random() * 1e6));
}

interface TranscriptSegment { start: number; end: number; text: string }

async function transcribeSource(url: string): Promise<TranscriptSegment[]> {
  try {
    const res = await fetch(`${selfLoopbackBase()}/api/video/transcribe-clip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({ sourceUrl: url }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return [];
    const d = (await res.json().catch(() => ({}))) as { segments?: { start?: number; end?: number; text?: string }[] };
    return (d.segments ?? [])
      .filter((s) => typeof s?.text === "string" && s.text.trim())
      .map((s) => ({ start: Number(s.start ?? 0), end: Number(s.end ?? 0), text: String(s.text).trim() }));
  } catch {
    return [];
  }
}

/**
 * UNDERSTAND — download the source video once, split it into scenes via ffmpeg
 * shot-boundary detection, then describe each scene with vision + attach its
 * transcript slice. This is the "watch the whole video" step: the plan built
 * from its output mirrors the ORIGINAL's scene count, order, and pacing.
 */
export async function understandVideo(sourceUrl: string): Promise<{ scenes: OriginalScene[]; durationSeconds: number; plotSummary: string }> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg not available on this server");
  const dir = await mkdtemp(join(tmpdir(), "vello-recreate-"));
  const src = join(dir, "in.mp4");
  try {
    await streamFetchToFile(sourceUrl, src, { requireVideo: true });

    const { stderr } = await execFileP(ffmpeg, ["-i", src, "-f", "null", "-"], { maxBuffer: 2 * 1024 * 1024 }).catch((e) => ({ stderr: String(e) }));
    const duration = parseDuration(String(stderr)) ?? 0;
    if (duration <= 0) throw new Error("Could not read the source video's duration");
    if (duration > MAX_SOURCE_SECONDS + 2) {
      throw new Error(`Source video is ${Math.round(duration)}s — Recreate supports up to ${MAX_SOURCE_SECONDS}s`);
    }

    // Shot-boundary cuts → scene windows. Cap at 9 cuts (10 scenes) — matches the
    // Veo chain's ~8s-per-clip cadence for a 60s video.
    const { detectSceneCuts } = await import("@/lib/server/sceneDetect");
    const cuts = await detectSceneCuts(ffmpeg, src, 0, duration, { maxCuts: 9 });
    const bounds = [0, ...cuts, duration];

    const transcript = await transcribeSource(sourceUrl);
    const scenes: OriginalScene[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i];
      const end = bounds[i + 1];
      if (end - start < 0.3) continue; // sliver — merge into neighbor by skipping
      const mid = (start + end) / 2;
      const frame = await sampleFrame(ffmpeg, src, mid);
      let description = "";
      let hasProduct = false;
      let onScreenText = "";
      if (frame) {
        try {
          const raw = await callGeminiVision({
            system:
              "You describe one SCENE of a video for someone recreating it shot-for-shot. Reply in ONE compact line (under 55 words): exact shot size (extreme close-up/close-up/medium/wide) + camera angle (eye-level/low/high/POV/over-shoulder) + apparent camera movement + subject + action + setting + lighting + mood. If any ON-SCREEN TEXT is visible (captions, headlines, price tags, UI text, graphics), append ` [TEXT: \"the exact text, verbatim\"]`. If a distinct physical PRODUCT (bottle, box, device, package — not a person/outfit) is held or prominently shown, end the line with \" [PRODUCT]\".",
            user: "Describe this scene for a shot-for-shot recreation. Quote any visible on-screen text EXACTLY.",
            images: [frame],
            maxTokens: 160,
          });
          const textMatch = /\[TEXT:\s*"([\s\S]*?)"\s*\]/i.exec(raw);
          onScreenText = textMatch?.[1]?.trim() ?? "";
          description = raw
            .replace(/\[TEXT:\s*"[\s\S]*?"\s*\]/gi, "")
            .replace(/\s*\[PRODUCT\]\s*$/i, "")
            .trim();
          hasProduct = /\[PRODUCT\]/i.test(raw);
        } catch {
          description = "";
        }
      }
      const transcriptSlice = transcript
        .filter((s) => s.start < end && s.end > start)
        .map((s) => s.text)
        .join(" ")
        .trim();
      scenes.push({ start, end, transcript: transcriptSlice, description, hasProduct, onScreenText });
    }
    if (scenes.length === 0) throw new Error("Could not segment the source video into scenes");

    const plotSummary = await understandPlot(sourceUrl, scenes);

    return { scenes, durationSeconds: duration, plotSummary };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * WHOLE-VIDEO PLOT UNDERSTANDING — the per-scene loop above describes each shot
 * in isolation (one frame + its transcript slice), which loses the THROUGHLINE:
 * who the characters are, what actually happens across the video, and how the
 * scenes connect into one story. Without it, the replan step recreates a series
 * of disconnected shots that technically match each scene's visuals but not the
 * original's actual plot — the exact complaint with cartoon/illustrated sources,
 * where the "story" lives in character behavior across cuts, not in any single
 * frame.
 *
 * Sends the ENTIRE source video (not a sampled frame) to Gemini so it can watch
 * the whole thing and describe the plot as a throughline. Falls back to
 * summarizing the already-collected per-scene descriptions + transcript when the
 * video call fails (unsupported format, timeout, etc.) — never blocks the render.
 */
async function understandPlot(sourceUrl: string, scenes: OriginalScene[]): Promise<string> {
  const system =
    "You watch a short video and describe its PLOT/STORY as a throughline for someone recreating it shot-for-shot. Reply in plain prose, under 120 words: who/what the characters or subjects are, what actually HAPPENS across the video in order (the narrative arc — setup, turn, payoff), the tone/genre, and any running gag, twist, or emotional beat that spans multiple scenes. This is READ BY A DIRECTOR who only sees isolated per-scene descriptions otherwise — capture what connects the scenes into one story.";
  try {
    const summary = await callGeminiVideoVision({
      system,
      user: "Watch this full video and describe its plot/story as a throughline, in order.",
      videoUrl: sourceUrl,
      maxTokens: 220,
    });
    return summary.replace(/\s+/g, " ").trim().slice(0, 900);
  } catch {
    // Fallback: synthesize the throughline from what we already know (per-scene
    // vision descriptions + transcript) — still one coherent read across scenes,
    // just without watching the raw video motion.
    try {
      const scenesDigest = scenes.map((s, i) =>
        `${i + 1}. ${s.description || "(no description)"}${s.transcript ? ` — spoken: "${s.transcript}"` : ""}`
      ).join("\n");
      const brief = await callClaudeJSON<{ plot?: string }>({
        system:
          "You are given a scene-by-scene breakdown of a short video (visual description + spoken words, in order). Synthesize the PLOT/STORY as a throughline in under 120 words: who the characters/subjects are, what happens across the scenes in order, tone/genre, and anything that connects them into one story. Return ONLY {\"plot\": string}.",
        user: scenesDigest,
        maxTokens: 300,
      });
      return typeof brief.plot === "string" ? brief.plot.replace(/\s+/g, " ").trim().slice(0, 900) : "";
    } catch {
      return "";
    }
  }
}

const RACE_DESCRIPTORS: Record<string, string> = {
  malay: "Malay Southeast Asian",
  chinese: "Chinese East Asian",
  indian: "South Asian Indian",
  east_asian: "East Asian (Japanese/Korean-presenting)",
  caucasian: "Caucasian European",
  black: "Black African-descended",
  latino: "Latino/Hispanic",
  arab: "Middle Eastern Arab",
  south_asian: "South Asian",
  match_original: "matching the ethnicity/appearance of the presenter already described in the scenes",
};

export function raceDescriptor(race: string): string {
  return RACE_DESCRIPTORS[race] ?? RACE_DESCRIPTORS.match_original;
}

/** Kie's Wan Animate input cap is 10MB per file — leave headroom for container overhead. */
export const WAN_MAX_SOURCE_BYTES = 9_500_000;

/**
 * PREPARE WAN SOURCE — Kie's wan/2-2-animate-replace rejects videos over 10MB,
 * and phone-shot uploads routinely exceed that. Downloads the source once,
 * probes its duration (same ≤60s ceiling as the Grok path), and if the file is
 * too big transcodes it to fit: 720p tall, bitrate computed from the duration so
 * the output lands under the cap. Returns `bytes: null` when the original file
 * already fits (caller keeps using the original URL — no re-upload needed).
 */
export async function prepareWanSource(sourceUrl: string): Promise<{ bytes: Buffer | null; durationSeconds: number }> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg not available on this server");
  const dir = await mkdtemp(join(tmpdir(), "vello-wan-"));
  const src = join(dir, "in.mp4");
  const out = join(dir, "out.mp4");
  try {
    await streamFetchToFile(sourceUrl, src, { requireVideo: true });

    const { stderr } = await execFileP(ffmpeg, ["-i", src, "-f", "null", "-"], { maxBuffer: 2 * 1024 * 1024 }).catch((e) => ({ stderr: String(e) }));
    const duration = parseDuration(String(stderr)) ?? 0;
    if (duration <= 0) throw new Error("Could not read the source video's duration");
    if (duration > MAX_SOURCE_SECONDS + 2) {
      throw new Error(`Source video is ${Math.round(duration)}s — Recreate supports up to ${MAX_SOURCE_SECONDS}s`);
    }

    const { size } = await stat(src);
    if (size <= WAN_MAX_SOURCE_BYTES) return { bytes: null, durationSeconds: duration };

    // Total budget split video/audio: audio fixed at 96kbps, video gets the rest
    // (with 8% container/mux headroom). Floor keeps very long clips watchable.
    const totalKbps = Math.floor((WAN_MAX_SOURCE_BYTES * 8 * 0.92) / duration / 1000);
    const videoKbps = Math.max(350, totalKbps - 96);
    await execFileP(ffmpeg, [
      "-y", "-i", src,
      "-vf", "scale=-2:'min(720,ih)'",
      "-c:v", "libx264", "-preset", "veryfast",
      "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`,
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      out,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const bytes = await readFile(out);
    if (bytes.length > WAN_MAX_SOURCE_BYTES) {
      throw new Error(`Could not compress the source video under Kie's 10MB Wan limit (got ${(bytes.length / 1048576).toFixed(1)}MB)`);
    }
    return { bytes, durationSeconds: duration };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * DESCRIBE PRODUCT — one vision call on the user's uploaded product image, so
 * the replan (and every KIE prompt downstream) knows what the substitute
 * product actually IS (type, shape, colors, packaging, label/brand text)
 * instead of a generic "the user's own product". Returns "" on any failure —
 * the flow degrades to the old generic substitution rather than dying.
 */
export async function describeProductImage(productImageUrl: string): Promise<string> {
  try {
    const raw = await callGeminiVision({
      system:
        "You describe ONE product photo for a video-generation prompt. Reply in ONE compact line (under 50 words): product type + shape/form factor + dominant colors/materials + packaging style + any visible brand/label text quoted exactly. No opinions, no marketing language — literal visual description only.",
      user: "Describe this product so a video model can render this EXACT product.",
      images: [productImageUrl],
      maxTokens: 120,
    });
    return raw.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** One vision call over NUMBERED candidate images (1-indexed) — asks Gemini
 *  which of them clearly show the target product, best first. Returns the
 *  1-indexed picks; empty on any failure or when nothing qualifies. */
async function pickProductImageIndices(pool: string[], instruction: string): Promise<number[]> {
  try {
    const raw = await callGeminiVision({
      system: instruction,
      user: "Reply with ONLY the JSON, no prose.",
      images: pool,
      maxTokens: 120,
    });
    const obj = extractClaudeJson(raw);
    const picks = Array.isArray(obj?.picks) ? obj.picks : [];
    return picks.filter((n): n is number => typeof n === "number" && n >= 1 && n <= pool.length);
  } catch {
    return [];
  }
}

/**
 * RESOLVE PRODUCT REFERENCES — the "which product image do we actually send to
 * Kie" algorithm. Handles three cases:
 *  1. User uploaded a photo AND gave a product link: the upload is the PRIMARY
 *     reference; the site is scraped for 1-2 MATCHING angle/detail shots of the
 *     SAME product (vision-picked, not guessed), so Kie renders from multiple
 *     looks at the real product instead of one flat photo.
 *  2. User gave ONLY a product link (no upload): scrapes the site's images,
 *     vision-picks the ones that clearly show the actual product being sold
 *     (filtering out logos/banners/people/icons first by heuristic, then by
 *     vision), and uses up to 3 of them as references.
 *  3. User gave ONLY an upload: unchanged — single reference, described.
 * Every returned URL is re-hosted through normalizeImagesForKie so Kie can
 * actually fetch/recognize it (site images are frequently extensionless CDN
 * URLs or formats Kie rejects) — one bad ref used to fail the WHOLE request.
 * Returns null when there is nothing usable at all.
 */
export async function resolveProductReferences(args: {
  productImageUrl?: string;
  referenceUrl?: string;
}): Promise<{ productImageUrl: string; productImageUrls: string[]; productDescription: string } | null> {
  const uploaded = args.productImageUrl?.trim();
  const siteUrl = args.referenceUrl?.trim();

  let primary = uploaded || "";
  let description = primary ? await describeProductImage(primary) : "";
  const extra: string[] = [];

  if (siteUrl) {
    try {
      const { fetchWebsiteIntelligence } = await import("@/lib/builder/websiteIntelligence");
      const intel = await fetchWebsiteIntelligence(siteUrl);
      const pool = (intel?.imageCandidates ?? [])
        .filter((c) => !/logo|brand|wordmark|icon|favicon|avatar|sprite|pixel|badge/i.test(`${c.alt || ""} ${c.url}`))
        .slice(0, 10)
        .map((c) => c.url);

      if (pool.length > 0) {
        const instruction = primary
          ? `You are shown NUMBERED website product images (1-${pool.length}). The product to match is: ${description || "the same product as the reference photo"}. Pick UP TO 2 images that clearly show this SAME product (a different angle, packaging shot, or detail close-up is fine) — never people-only, lifestyle-only, or unrelated banner images. Reply ONLY {"picks": [numbers]}, best match first, or {"picks": []} if none match.`
          : `You are shown NUMBERED website images (1-${pool.length}) from a product's page. Pick UP TO 3 that clearly show the actual PRODUCT being sold — clean, recognizable product shots, not logos, banners, unrelated icons, or people-only lifestyle shots with no product visible. Reply ONLY {"picks": [numbers]}, best/clearest first, or {"picks": []} if none qualify.`;
        const picks = await pickProductImageIndices(pool, instruction);
        for (const n of picks) {
          const url = pool[n - 1];
          if (url && url !== primary) extra.push(url);
        }
      }
    } catch {
      // best-effort — a scrape failure never blocks the render, it just falls
      // back to whatever reference(s) we already have.
    }
  }

  if (!primary && extra.length > 0) {
    primary = extra.shift() as string;
    description = await describeProductImage(primary);
  }

  const candidates = [primary, ...extra]
    .filter((u): u is string => !!u)
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 3);
  if (candidates.length === 0) return null;

  const { normalizeImagesForKie } = await import("@/lib/server/imageForKie");
  const hosted = await normalizeImagesForKie(candidates);
  if (hosted.length === 0) return null;

  return { productImageUrl: hosted[0], productImageUrls: hosted, productDescription: description };
}

/**
 * RESEARCH REFERENCE — the agentic step between UNDERSTAND and REPLAN. Crawls
 * the user's link (brand/product page), then one Claude call fuses the crawl +
 * the uploaded image's vision description into a compact FOCUS BRIEF: what the
 * product/brand actually is, its real claims and tone, and how the uploaded
 * image relates — so the replan promotes what the USER sells, grounded in their
 * own site, instead of guessing. Returns "" on any failure (flow degrades to
 * image-description-only context, never dies).
 */
export async function researchReference(args: {
  referenceUrl?: string;
  productDescription?: string;
}): Promise<string> {
  const url = args.referenceUrl?.trim();
  if (!url) return "";
  try {
    const { fetchWebsiteIntelligence } = await import("@/lib/builder/websiteIntelligence");
    const intel = await fetchWebsiteIntelligence(url);
    if (!intel) return "";
    const siteDigest = [
      intel.siteName || intel.title ? `Site: ${[intel.siteName, intel.title].filter(Boolean).join(" — ")}` : "",
      intel.description ? `Description: ${intel.description}` : "",
      intel.productSignals.length ? `Product signals: ${intel.productSignals.slice(0, 8).join("; ")}` : "",
      intel.audienceHints.length ? `Audience hints: ${intel.audienceHints.slice(0, 6).join("; ")}` : "",
      intel.viralAngles.length ? `Angles: ${intel.viralAngles.slice(0, 6).join("; ")}` : "",
      intel.readableText ? `Page text: ${intel.readableText.replace(/\s+/g, " ").slice(0, 2600)}` : "",
    ].filter(Boolean).join("\n");
    if (!siteDigest) return "";

    const brief = await callClaudeJSON<{ focusBrief?: string }>({
      system:
        `You are a research analyst preparing a FOCUS BRIEF for an ad recreation. From the website crawl${args.productDescription ? " and the user's uploaded product image description" : ""}, produce ONE compact brief (under 180 words, plain prose) covering: the exact product/brand name, what it actually is/does, its 2-4 strongest REAL claims or benefits (only ones supported by the page), brand tone of voice, target audience, and the natural call to action.${args.productDescription ? " State explicitly how the uploaded image relates to the site (which product it shows)." : ""} No invented claims, no fluff. Return ONLY {"focusBrief": string}.`,
      user: `WEBSITE CRAWL of ${url}:\n${siteDigest}${args.productDescription ? `\n\nUPLOADED IMAGE (vision description): ${args.productDescription}` : ""}`,
      maxTokens: 500,
    });
    return typeof brief.focusBrief === "string" ? brief.focusBrief.replace(/\s+/g, " ").trim().slice(0, 1400) : "";
  } catch {
    return "";
  }
}

/**
 * REPLAN — one Claude call turns the original scene-by-scene understanding into
 * a StoryBeat[] recreation script: SAME scene count/order/pacing/camera as the
 * original, dialogue rewritten in the target language, presenter re-described
 * per the chosen race, and any [PRODUCT] scene's description swapped to
 * reference the user's own product image instead of the original's.
 */
export async function replanRecreation(args: {
  scenes: OriginalScene[];
  language: string;
  race: string;
  hasProductImage: boolean;
  /** Vision description of the user's uploaded product (describeProductImage).
   *  When set, [PRODUCT] scenes are rewritten around THIS exact product. */
  productDescription?: string;
  /** Research brief from the user's link + image (researchReference) — grounds
   *  dialogue/claims/on-screen text in what the user actually sells. */
  focusBrief?: string;
  /** Operator's free-text instruction — overrides defaults where it conflicts. */
  userPrompt?: string;
  /** Whole-video plot/story throughline (understandPlot) — grounds the
   *  recreation in the ACTUAL story, not just isolated per-scene visuals. */
  plotSummary?: string;
}): Promise<{ beats: StoryBeat[]; topic: string; hook: string }> {
  // Natural word budget per scene at the shared speaking rate — printed alongside
  // each scene so the model writes a line that FITS the scene's real duration
  // instead of a full sentence crammed into a 1-2s cut (the cause of unnaturally
  // fast/rushed-sounding speech in the rendered clip).
  const scenesText = args.scenes.map((s, i) => {
    const dur = s.end - s.start;
    const wordBudget = Math.max(1, Math.round(dur * SPEAKING_WORDS_PER_SEC));
    return `Scene ${i + 1} (${dur.toFixed(1)}s, ~${wordBudget} words max at natural speaking pace)${s.hasProduct ? " [ORIGINAL SHOWS A PRODUCT]" : ""}: ${s.description || "(no visual description available)"}` +
      (s.transcript ? `\n  Spoken: "${s.transcript}"` : "\n  Spoken: (none)") +
      (s.onScreenText ? `\n  On-screen text: "${s.onScreenText}"` : "");
  }).join("\n\n");

  const system = `You are a shot-for-shot video recreation director. You are given an exact scene-by-scene breakdown of an ORIGINAL video (camera framing, action, setting, spoken words per scene). Produce a RECREATION script that reproduces the SAME number of scenes, SAME order, SAME approximate pacing (seconds), and SAME camera/composition style — but:
${args.plotSummary ? `- WHOLE-VIDEO PLOT (watched end-to-end, not just per-scene stills — this is the actual story the scenes must add up to): ${args.plotSummary}
  Every scene's rewritten action and dialogue must serve THIS throughline — keep the same characters' relationships, the same narrative turn, and the same payoff, not just visually-similar disconnected shots.
` : ""}- ALL spoken dialogue must be rewritten/translated into this language: ${args.language}.
- The on-camera presenter is ${raceDescriptor(args.race)}.
- SPEECH PACE: each scene lists its natural word budget (duration × speaking rate). Write each beat's "voiceover" AT OR UNDER that scene's word budget — never a full sentence crammed into a short cut. If the idea genuinely needs more words than the original scene's duration allows, increase that beat's "seconds" instead of writing rushed, unnaturally fast dialogue; total pacing should still track the original video, but a natural, correctly-paced line beats a technically-on-time but too-fast one.
${args.hasProductImage
    ? args.productDescription
      ? `- PRODUCT SWAP: the user's replacement product is: ${args.productDescription}. Every scene marked [ORIGINAL SHOWS A PRODUCT] must be rewritten around THIS exact product — name its type, shape, colors, packaging and label text from that description in both "scene" and "videoPrompt" — held/shown/framed the same way the original product was. Never describe or name the original video's product. Adapt any dialogue and on-screen text that names the original product to fit this replacement product instead.`
      : `- Any scene marked [ORIGINAL SHOWS A PRODUCT] must have its description rewritten to feature the user's OWN product (a physical product held/shown the same way the original did) instead of describing the original product.`
    : `- Any scene marked [ORIGINAL SHOWS A PRODUCT] keeps a generic product-showcase framing (no specific product to substitute).`}
${args.focusBrief ? `- USER'S FOCUS (researched from their own link and uploaded image — this is what the recreation SELLS): ${args.focusBrief}
  Ground every spoken line, claim, product mention and on-screen text in THIS brief: the recreation promotes the user's product/brand with its REAL claims and tone, while keeping the original video's structure, pacing, camera and energy. Never invent claims the brief doesn't support; never promote the original video's brand.
` : ""}${args.userPrompt ? `- OPERATOR INSTRUCTION (obey this above all defaults, except never break the shot-for-shot structure): ${args.userPrompt}
` : ""}- Any scene with an "On-screen text" quote must be recreated WITH on-screen text: translate that text into ${args.language} (keep it verbatim if it is already in ${args.language} or is a brand/product name), keep the same style/placement/emphasis, and put the final overlay string in that beat's "onScreenText" field. Scenes without on-screen text get "" there.
Return ONLY this JSON shape, no prose: {"topic": string, "hook": string, "beats": [{"index": number, "scene": string, "voiceover": string, "camera": string, "seconds": number, "videoPrompt": string, "onScreenText": string}]}. One beat per original scene, in order. "scene" = the setting/action description. "voiceover" = the spoken line for that scene (in ${args.language}). "camera" = shot type/movement. "videoPrompt" = a complete literal AI-video-generation prompt for that scene (composition, subject, action, setting, mood, presenter appearance, product if applicable, and — when onScreenText is set — an instruction to render that exact text on screen in the same position/style as the original).`;

  const result = await callClaudeJSON<{ topic?: string; hook?: string; beats?: StoryBeat[] }>({
    system,
    user: scenesText,
    maxTokens: 3000,
  });

  const beats: StoryBeat[] = (Array.isArray(result.beats) ? result.beats : [])
    .filter((b) => b && typeof b.scene === "string")
    .map((b, i) => {
      const voiceover = typeof b.voiceover === "string" ? b.voiceover : "";
      const plannedSeconds = typeof b.seconds === "number" && b.seconds > 0
        ? b.seconds
        : (args.scenes[i]?.end ?? 0) - (args.scenes[i]?.start ?? 0);
      // SAFETY NET: even if the model ignored the word budget, never hand
      // downstream a duration shorter than this line naturally takes to say —
      // that's what forces the rendered clip to speak unnaturally fast.
      const words = voiceover.trim().split(/\s+/).filter(Boolean).length;
      const naturalSeconds = words > 0 ? words / SPEAKING_WORDS_PER_SEC : 0;
      return {
        index: i,
        scene: b.scene,
        voiceover,
        camera: typeof b.camera === "string" ? b.camera : "",
        seconds: Math.max(plannedSeconds, naturalSeconds),
        videoPrompt: typeof b.videoPrompt === "string" ? b.videoPrompt : undefined,
        onScreenText: typeof b.onScreenText === "string" && b.onScreenText.trim() ? b.onScreenText.trim() : undefined,
      };
    });
  if (beats.length === 0) throw new Error("Recreation planning produced no usable scenes");

  return {
    beats,
    topic: typeof result.topic === "string" && result.topic ? result.topic : "Recreated video",
    hook: typeof result.hook === "string" ? result.hook : "",
  };
}
