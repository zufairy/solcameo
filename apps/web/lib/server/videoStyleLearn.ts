import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { streamFetchToFile } from "@/lib/server/downloader";
import { callGeminiVision, callClaudeJSON } from "@/lib/server/kie-claude";
import { selfLoopbackBase } from "@/lib/server/fetchInternal";

const execFileP = promisify(execFile);

// ─── Learn tab: agentic style analysis of an operator-uploaded example video ──
// The agent "studies" the example: sampled frames → vision description of the
// LOOK, transcript → the VOICE, then one fusion call writes a dense STYLE
// PROFILE the render pipeline can obey (prompt block + frame reference).

export interface StyleAnalysis {
  transcript: string;
  styleProfile: string;
  /** Sampled frames as data URLs (start / mid / end) — caller hosts them. */
  frameDataUrls: string[];
  durationSeconds: number;
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
      ["-y", "-ss", String(Math.max(0, atSec)), "-i", src, "-frames:v", "1", "-vf", "scale=720:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
      { encoding: "buffer", maxBuffer: 6 * 1024 * 1024 },
    );
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as unknown as string);
    return buf.length ? `data:image/jpeg;base64,${buf.toString("base64")}` : null;
  } catch {
    return null;
  }
}

async function transcribe(url: string): Promise<string> {
  try {
    const res = await fetch(`${selfLoopbackBase()}/api/video/transcribe-clip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
      },
      body: JSON.stringify({ sourceUrl: url }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return "";
    const d = (await res.json().catch(() => ({}))) as { segments?: { text?: string }[] };
    return (d.segments ?? [])
      .map((s) => String(s?.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 4000);
  } catch {
    return "";
  }
}

/**
 * ANALYZE — download once, sample 3 frames (15% / 50% / 85%), transcribe, then:
 *  1. vision call describes the LOOK across all 3 frames in concrete detail;
 *  2. fusion call (vision + transcript) writes the STYLE PROFILE the render
 *     pipeline consumes — dense, imperative, everything a director needs to
 *     reproduce the style on a NEW topic.
 */
export async function analyzeStyleVideo(videoUrl: string): Promise<StyleAnalysis> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg not available on this server");
  const dir = await mkdtemp(join(tmpdir(), "vello-learn-"));
  const src = join(dir, "in.mp4");
  try {
    await streamFetchToFile(videoUrl, src, { requireVideo: true });
    const { stderr } = await execFileP(ffmpeg, ["-i", src, "-f", "null", "-"], { maxBuffer: 2 * 1024 * 1024 }).catch((e) => ({ stderr: String(e) }));
    const duration = parseDuration(String(stderr)) ?? 0;
    if (duration <= 0) throw new Error("Could not read the example video's duration");

    const at = [duration * 0.15, duration * 0.5, duration * 0.85];
    const frames = (await Promise.all(at.map((t) => sampleFrame(ffmpeg, src, t)))).filter((f): f is string => Boolean(f));
    if (frames.length === 0) throw new Error("Could not sample frames from the example video");

    const transcript = await transcribe(videoUrl);

    const visual = await callGeminiVision({
      system:
        "You are a film analyst studying frames from ONE short-form video so its style can be reproduced. Describe in concrete, specific detail (under 180 words, plain prose): camera framing + lens feel, subject and how they present (energy, wardrobe, expression), setting/background, lighting direction + quality, color grade/palette, any on-screen text/caption style (font feel, placement, casing), editing/production polish level, and overall genre/format. No opinions about quality — literal observations only.",
      user: "These are frames from the start, middle, and end of the video. Describe its visual style for reproduction.",
      images: frames,
      maxTokens: 400,
    });

    const fused = await callClaudeJSON<{ styleProfile?: string }>({
      system:
        `You are a creative director writing a STYLE PROFILE from an example video, so future AI-generated videos on NEW topics reproduce its style exactly. You get a visual analysis of its frames and its transcript. Write ONE dense profile (under 220 words, imperative voice — "open with…", "cut every…", "speak in…") covering: format/genre; hook mechanics (how the first seconds grab); pacing and cut rhythm; camera framing + movement; lighting and color grade; setting; presenter energy and delivery; speech style — sentence length, vocabulary register, catchphrase patterns, language (quote 1-2 short characteristic phrases from the transcript); caption/on-screen-text style; how it ends (CTA style). Describe STYLE, never this video's specific topic/product. Return ONLY {"styleProfile": string}.`,
      user: `VISUAL ANALYSIS:\n${visual}\n\nTRANSCRIPT:\n${transcript || "(no speech detected)"}`,
      maxTokens: 600,
    });

    const styleProfile = typeof fused.styleProfile === "string" ? fused.styleProfile.replace(/\s+/g, " ").trim() : "";
    if (!styleProfile) throw new Error("Style analysis produced no profile");

    return { transcript, styleProfile, frameDataUrls: frames, durationSeconds: duration };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Prompt block for the render pipeline — appended to standingOrders so it rides
 * EVERY clip prompt (script, storyboard, base and extend clips alike).
 */
export function styleReferenceBlock(refs: Array<{ styleProfile?: string | null; title?: string | null }>): string {
  const profiles = refs
    .map((r) => (r.styleProfile ?? "").trim())
    .filter(Boolean)
    .slice(0, 2); // two examples max — more dilutes rather than sharpens
  if (profiles.length === 0) return "";
  return (
    `LEARNED STYLE (from the operator's example videos — REPRODUCE this style, adapted to the new topic):\n` +
    profiles.map((p, i) => `${profiles.length > 1 ? `Example ${i + 1}: ` : ""}${p}`).join("\n")
  );
}
