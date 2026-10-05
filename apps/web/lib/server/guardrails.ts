import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "./ffmpegBin";
import { resolveDownloader } from "./downloader";
import { extractClaudeJson } from "./kie-claude";

/**
 * "Guardrails" — a pre-post video QA gate for AI Clipper + AI Influencer (UGC)
 * agents. Runs right before a post-worthy video is handed to upload-post
 * (see lib/server/uploadPost.ts's two callers), so a video that trips a
 * guardrail never reaches a platform in the first place.
 *
 * Two tiers, matching the skill's pricing (free base checks + an opt-in paid
 * vision pass):
 *  - FREE: profanity (checkProfanity) + technical quality (checkTechnicalQuality)
 *    — both deterministic, no LLM call, effectively instant.
 *  - PAID (opt-in via the skill's `visionCheck` config): checkVisionSignals —
 *    samples a few frames and asks KIE Gemini vision whether the video already
 *    has burned-in captions (so a caption skill wouldn't double them up) and
 *    whether it reads as obviously AI-generated. Real per-call API cost, so
 *    it's gated separately from the free tier.
 */

// ─── Skill install gate ────────────────────────────────────────────────────

/** The two catalog ids this skill is registered under — video.guardrails for
 *  UGC/influencer agents (lib/builder/skillsCatalog.ts), clip.guardrails for
 *  AI Clipper agents (lib/builder/clipSkillsCatalog.ts). Either one installed
 *  turns Guardrails on for that agent's posts. */
export const GUARDRAILS_SKILL_IDS = ["video.guardrails", "clip.guardrails"];

export function hasGuardrailsInstalled(installedSkills?: string[] | null): boolean {
  return !!installedSkills?.some((id) => GUARDRAILS_SKILL_IDS.includes(id));
}

/** A clip skill as stored in the `agentSkillFiles` table (one row per installed
 *  AI-Clipper app). `wired` is canvas-synced: false = the node was removed from
 *  the graph, undefined = legacy row, treated as wired. */
export interface ClipSkillRow {
  skillId: string;
  wired?: boolean;
}

/**
 * THE INSTALL GATE, for BOTH agent types.
 *
 * The two agent families store an install in DIFFERENT places:
 *  - AI Influencer (UGC): `influencers.installedSkills` — an id array patched by
 *    the App Store tab (skillsCatalog / video.guardrails).
 *  - AI Clipper: an `agentSkillFiles` ROW per app, written by the clipping App
 *    Store + canvas (clipSkillsCatalog / clip.guardrails). It never touches
 *    `installedSkills`.
 *
 * Checking only `installedSkills` therefore meant a clipper could install AND
 * wire Guardrails and have the gate silently never run — the card was in the App
 * Store, the node sat on the canvas, and nothing was enforced at post time.
 * Both stores are consulted here, and a clip row whose canvas node was removed
 * (`wired: false`) does NOT count — same rule the render path applies to every
 * other clip skill.
 */
export function guardrailsEnabled(args: {
  installedSkills?: string[] | null;
  clipSkillRows?: ClipSkillRow[] | null;
}): boolean {
  if (hasGuardrailsInstalled(args.installedSkills)) return true;
  // Defensive: this comes straight off a Convex query, so never assume it is an
  // array — a null/object response must read as "not installed", not throw and
  // 502 the whole post.
  if (!Array.isArray(args.clipSkillRows)) return false;
  return args.clipSkillRows.some(
    (r) => GUARDRAILS_SKILL_IDS.includes(r?.skillId) && r?.wired !== false,
  );
}

// ─── Profanity (free, deterministic) ───────────────────────────────────────

// Deliberately short + conservative — unambiguous slurs/profanity only, to
// keep false positives near zero. Word-boundary matched, case-insensitive.
const BAD_WORDS = [
  "fuck", "shit", "bitch", "asshole", "cunt", "nigger", "nigga", "faggot",
  "retard", "whore", "slut", "motherfucker", "dumbass", "bastard",
];
const BAD_WORDS_RE = new RegExp(`\\b(${BAD_WORDS.join("|")})\\b`, "gi");

export interface ProfanityResult {
  pass: boolean;
  hits: string[];
}

/** Scan caption/script text for profanity. Pure + synchronous — no network,
 *  no file I/O, so it's free to run on every post regardless of tier. */
export function checkProfanity(text: string | undefined | null): ProfanityResult {
  if (!text) return { pass: true, hits: [] };
  const hits = [...new Set((text.match(BAD_WORDS_RE) ?? []).map((w) => w.toLowerCase()))];
  return { pass: hits.length === 0, hits };
}

/**
 * Mask profanity in caption/script text by replacing each flagged word with its
 * first letter + asterisks ("fuck" → "f***"), word-boundary matched so benign
 * substrings (assassin) are untouched. Pure + synchronous.
 *
 * WHY THIS EXISTS: when Guardrails is installed, a clip whose caption has a
 * flagged word would be BLOCKED at the post-time gate (status guardrail_rejected)
 * — dropping it from the requested clip count. Scrubbing the caption BEFORE
 * posting keeps the requested number of clips flowing out AND lets every clip
 * pass the word guardrail, so nothing is blocked (and the caption is already
 * clean for the platform). Callers apply it right after the caption is final.
 */
export function scrubProfanity(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(BAD_WORDS_RE, (w) => `${w[0]}${"*".repeat(Math.max(0, w.length - 1))}`);
}

// ─── Technical quality (free, deterministic) ───────────────────────────────

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** `ffmpeg -i` stderr probe — same pattern as ctaAppend.ts's local probeVideo
 *  (duration/resolution/audio-stream presence), just exported for reuse here. */
function probeVideo(bin: string, path: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const dur = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      const durationSec = dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : 0;
      const res = err.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
      const width = res ? parseInt(res[1], 10) : 0;
      const height = res ? parseInt(res[2], 10) : 0;
      const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(err);
      resolve({ durationSec, width, height, hasAudio });
    });
    proc.on("error", () => resolve({ durationSec: 0, width: 0, height: 0, hasAudio: false }));
  });
}

export interface QualityResult {
  pass: boolean;
  reasons: string[];
  probe: VideoProbe;
}

// Thresholds are deliberately loose — this is a corrupt/broken-render safety
// net, not a taste filter. A real, watchable clip should always clear these.
const MIN_DURATION_SEC = 2;
const MIN_DIMENSION_PX = 360;

export function evaluateQuality(probe: VideoProbe): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (probe.durationSec < MIN_DURATION_SEC) reasons.push(`too short (${probe.durationSec.toFixed(1)}s)`);
  if (probe.width < MIN_DIMENSION_PX || probe.height < MIN_DIMENSION_PX) {
    reasons.push(`resolution too low (${probe.width}x${probe.height})`);
  }
  if (probe.width === 0 || probe.height === 0) reasons.push("unreadable/corrupt video file");
  return { pass: reasons.length === 0, reasons };
}

/** Downloads `videoUrl` to a local temp file and probes it. Caller owns the
 *  returned workDir cleanup (or use `checkTechnicalQuality` which cleans up
 *  itself when it doesn't need to hand the file off for a vision pass). */
async function downloadForProbe(videoUrl: string, workDir: string): Promise<string> {
  const dl = resolveDownloader(videoUrl);
  const { path } = await dl.fetchSource(videoUrl, { workDir });
  return path;
}

export async function checkTechnicalQuality(videoUrl: string): Promise<QualityResult> {
  const ffmpegBin = resolveFfmpegPath();
  if (!ffmpegBin) return { pass: true, reasons: [], probe: { durationSec: 0, width: 0, height: 0, hasAudio: false } };
  const workDir = await mkdtemp(join(tmpdir(), "vello-guardrails-"));
  try {
    const localPath = await downloadForProbe(videoUrl, workDir);
    const probe = await probeVideo(ffmpegBin, localPath);
    const { pass, reasons } = evaluateQuality(probe);
    return { pass, reasons, probe };
  } catch (e) {
    // A download/probe failure is infrastructure flakiness, not a video defect —
    // never block a post over it.
    console.warn(`[guardrails] technical-quality check failed, passing by default: ${e instanceof Error ? e.message : e}`);
    return { pass: true, reasons: [], probe: { durationSec: 0, width: 0, height: 0, hasAudio: false } };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Vision (paid, opt-in) ──────────────────────────────────────────────────

const KIE_GEMINI = "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions";
const VISION_TIMEOUT_MS = Math.max(15_000, Math.min(110_000, Number(process.env.GUARDRAILS_VISION_TIMEOUT_MS) || 60_000));

const VISION_SYSTEM =
  "You are a pre-publish QA reviewer for short-form social video (TikTok/Reels/Shorts). " +
  "Look at the sampled frames (in chronological order) and answer ONLY with JSON: " +
  '{"hasBurnedCaptions":<bool>,"looksAiGenerated":<bool>,"reasoning":"<one short sentence>"}. ' +
  '"hasBurnedCaptions" = true only if the video ALREADY shows on-screen subtitle/caption text burned into the picture (not a logo, not a UI element). ' +
  '"looksAiGenerated" = true only if the footage has clear AI-generation artifacts (warped hands/faces, melting backgrounds, uncanny motion, inconsistent physics) that would read as obviously synthetic to a casual viewer — NOT true for legitimate stylized/animated content or real footage.';

export interface VisionResult {
  pass: boolean;
  hasBurnedCaptions: boolean;
  looksAiGenerated: boolean;
  reasoning: string;
}

async function extractFrames(localPath: string, workDir: string, ffmpegBin: string, count = 4): Promise<string[]> {
  const paths: string[] = [];
  const fractions = Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  for (let i = 0; i < fractions.length; i++) {
    const fp = join(workDir, `frame${i}.jpg`);
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, [
          "-y", "-i", localPath,
          "-vf", `select='eq(n\\,0)+gte(t\\,${fractions[i]}*999999)',scale=480:-2`,
          "-frames:v", "1", "-q:v", "4", fp,
        ], { stdio: "ignore" });
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
        proc.on("error", reject);
      });
      paths.push(fp);
    } catch {
      // Skip an unreadable frame rather than failing the whole check.
    }
  }
  return paths;
}

/** Vision QA pass over a few sampled frames — mirrors faceTrack.ts's
 *  detectFaceCenter call shape (same KIE Gemini vision endpoint, same
 *  base64 image_url content array). Best-effort: any failure PASSES rather
 *  than blocking a post on an infra hiccup — this tier is a bonus signal,
 *  not a hard requirement. */
export async function checkVisionSignals(videoUrl: string, apiKey: string): Promise<VisionResult> {
  const pass_default: VisionResult = { pass: true, hasBurnedCaptions: false, looksAiGenerated: false, reasoning: "" };
  if (!apiKey) return pass_default;
  const ffmpegBin = resolveFfmpegPath();
  if (!ffmpegBin) return pass_default;

  const workDir = await mkdtemp(join(tmpdir(), "vello-guardrails-vision-"));
  try {
    const localPath = await downloadForProbe(videoUrl, workDir);
    const framePaths = await extractFrames(localPath, workDir, ffmpegBin);
    if (framePaths.length === 0) return pass_default;

    const images = await Promise.all(
      framePaths.map(async (p) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${(await readFile(p)).toString("base64")}` },
      })),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const res = await fetch(KIE_GEMINI, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gemini-3-6-flash-openai",
          stream: false,
          include_thoughts: false,
          temperature: 0,
          max_tokens: 300,
          messages: [
            { role: "system", content: VISION_SYSTEM },
            { role: "user", content: [...images, { type: "text", text: `${framePaths.length} frames, chronological order. JSON only.` }] },
          ],
        }),
      });
      if (!res.ok) throw new Error(`guardrails vision HTTP ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      const content: string =
        data?.choices?.[0]?.message?.content ??
        (Array.isArray(data?.candidates?.[0]?.content?.parts)
          ? data.candidates[0].content.parts.map((p: { text?: string }) => p?.text ?? "").join("")
          : "") ?? "";
      const parsed = content ? (extractClaudeJson(content) as Record<string, unknown> | null) : null;
      const hasBurnedCaptions = parsed?.hasBurnedCaptions === true;
      const looksAiGenerated = parsed?.looksAiGenerated === true;
      const reasoning = typeof parsed?.reasoning === "string" ? parsed.reasoning : "";
      return { pass: !hasBurnedCaptions && !looksAiGenerated, hasBurnedCaptions, looksAiGenerated, reasoning };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn(`[guardrails] vision check failed, passing by default: ${e instanceof Error ? e.message : e}`);
    return pass_default;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface GuardrailsResult {
  pass: boolean;
  reasons: string[];
  checked: string[];
}

export async function runGuardrails(args: {
  videoUrl: string;
  captionText?: string;
  visionEnabled?: boolean;
  kieApiKey?: string;
}): Promise<GuardrailsResult> {
  const reasons: string[] = [];
  const checked: string[] = [];

  checked.push("profanity");
  const profanity = checkProfanity(args.captionText);
  if (!profanity.pass) reasons.push(`caption contains flagged language: ${profanity.hits.join(", ")}`);

  checked.push("technical_quality");
  const quality = await checkTechnicalQuality(args.videoUrl);
  if (!quality.pass) reasons.push(...quality.reasons);

  if (args.visionEnabled && args.kieApiKey) {
    checked.push("vision");
    const vision = await checkVisionSignals(args.videoUrl, args.kieApiKey);
    if (vision.hasBurnedCaptions) reasons.push("video already has burned-in captions — skip adding more");
    if (vision.looksAiGenerated) reasons.push(`looks AI-generated${vision.reasoning ? `: ${vision.reasoning}` : ""}`);
  }

  return { pass: reasons.length === 0, reasons, checked };
}
