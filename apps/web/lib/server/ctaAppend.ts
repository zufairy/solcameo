// Append a "Call To Action" video to the END of a produced video.
//
// Both the AI Clipper (per-clip) and the AI Influencer (per-generated-video)
// pipelines call this to stitch a short operator-uploaded CTA clip onto the tail
// of every output. The CTA is aspect-normalized to the MAIN video's canvas
// (letterbox pad — the whole CTA frame is preserved, never cropped) and both
// audio tracks play. Modeled on app/api/video/concat/route.ts (filter_complex
// concat, full re-encode — independently-produced mp4s have mismatched PTS/SPS so
// stream-copy glitches at the join) + overlay-burn's download→ffmpeg→re-upload.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { resolveXfadeName } from "@/lib/server/transitionsPack";
import { streamFetchToFile } from "@/lib/server/downloader";
import { putVideo } from "@/lib/server/videoStorage";

const ffmpegPath = resolveFfmpegPath();
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Wall-clock ceiling for the concat encode. A CTA is short, so a normal join is
// seconds; this only backstops a pathological input.
const FFMPEG_WALL_MS = 200_000;

interface Probe { hasAudio: boolean; durationSec: number; width: number; height: number }

/** Probe a file with `ffmpeg -i` (no ffprobe dependency — ffmpeg prints stream
 *  info to stderr and exits non-zero, which we ignore). Extracts audio presence,
 *  duration, and the video canvas dims. */
function probeVideo(bin: string, path: string): Promise<Probe> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 20000) e = e.slice(-20000); });
    const done = () => {
      const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(e);
      const dm = e.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSec = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + parseFloat(dm[3]) : 0;
      const vm = e.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
      resolve({
        hasAudio,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        width: vm ? parseInt(vm[1], 10) : 0,
        height: vm ? parseInt(vm[2], 10) : 0,
      });
    };
    proc.on("error", () => resolve({ hasAudio: false, durationSec: 0, width: 0, height: 0 }));
    proc.on("close", done);
  });
}

/** Run ffmpeg, SIGKILL on wall-clock overrun, reject on non-zero exit. */
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    proc.stderr.on("data", (d) => { e += d.toString(); if (e.length > 8000) e = e.slice(-8000); });
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${FFMPEG_WALL_MS}ms. ${e.slice(-400)}`)));
    }, FFMPEG_WALL_MS);
    proc.on("error", (err) => settle(() => reject(err)));
    proc.on("close", (c) => settle(() => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${e.slice(-400)}`)))));
  });
}

/** Clamp to an even, sane pixel dimension (libx264/yuv420p rejects odd sizes). */
const evenDim = (n: number, def: number) => {
  const v = Math.min(2160, Math.max(120, Math.round(n > 0 ? n : def)));
  return v % 2 === 0 ? v : v - 1;
};

/**
 * Concat `mainPath` then `ctaPath` into `outPath`. Every input is scaled to fit
 * the MAIN video's canvas and letterbox-padded (whole frame kept), forced to 30fps
 * / yuv420p, then joined with `concat=n=2:v=1:a=1`. Inputs missing an audio track
 * get synthesized silence so the audio timeline stays aligned across the join.
 */
export async function concatWithCta(bin: string, mainPath: string, ctaPath: string, outPath: string, transition?: { xfade: string; durationSec: number }): Promise<void> {
  const probes = await Promise.all([probeVideo(bin, mainPath), probeVideo(bin, ctaPath)]);
  const W = evenDim(probes[0].width, 1080);
  const H = evenDim(probes[0].height, 1920);

  const inputs: string[] = ["-i", mainPath, "-i", ctaPath];
  const vparts: string[] = [];
  const aparts: string[] = [];
  const pairs: string[] = [];
  let nextIdx = 2; // index of the next appended lavfi silence input

  // Transition (opt-in): cross-fade the CTA in instead of a hard cut. Needs the MAIN
  // clip's real duration to place the xfade offset; require it > 0 and keep the seam
  // under 40% of the main clip so it can't overrun. Anything off → hard-cut concat.
  const mainDur = probes[0].durationSec;
  const t = transition && mainDur > 0 ? Math.min(transition.durationSec, mainDur * 0.4) : 0;
  const useXfade = Boolean(transition) && t >= 0.1;
  // settb=AVTB normalizes the timebase — xfade is strict about it; harmless for concat.
  const tb = useXfade ? ",settb=AVTB" : "";

  for (let i = 0; i < 2; i++) {
    vparts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,format=yuv420p${tb}[v${i}]`,
    );
    if (probes[i].hasAudio) {
      aparts.push(`[${i}:a]aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`);
    } else {
      const dur = probes[i].durationSec > 0 ? probes[i].durationSec : 4;
      inputs.push("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      aparts.push(`[${nextIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`);
      nextIdx++;
    }
    pairs.push(`[v${i}][a${i}]`);
  }

  // Join: xfade (video) + acrossfade (audio) when a transition is set, else the
  // proven hard-cut concat. offset = mainDur − t (the transition overlaps the seam).
  const join = useXfade
    ? `[v0][v1]xfade=transition=${transition!.xfade}:duration=${t.toFixed(3)}:offset=${(mainDur - t).toFixed(3)}[v];[a0][a1]acrossfade=d=${t.toFixed(3)}[a]`
    : `${pairs.join("")}concat=n=2:v=1:a=1[v][a]`;
  const filter = `${vparts.join(";")};${aparts.join(";")};${join}`;
  await runFfmpeg(bin, [
    "-y", ...inputs,
    "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath,
  ]);
}

/**
 * Download `mainUrl` + `ctaUrl`, concat the CTA onto the end, upload the result to
 * Convex storage, and return the new URL. Fail-safe: on ANY error (bad url, ffmpeg
 * failure, storage) it returns the ORIGINAL `mainUrl` so a produced video is never
 * lost to a CTA problem.
 */
export async function appendCtaFromUrls(mainUrl: string, ctaUrl: string, transition?: { id: string; durationSec: number }): Promise<string> {
  if (!mainUrl) return "";
  if (!ctaUrl || !ffmpegPath || !CONVEX_URL) return mainUrl;
  // Resolve the clip.transitions pick → an ffmpeg xfade name (premium/WIP ids fall
  // back to their geometric xfade), so the CTA cross-fades in instead of hard-cutting.
  const xf = transition ? { xfade: resolveXfadeName(transition.id), durationSec: transition.durationSec } : undefined;
  const workDir = await mkdtemp(join(tmpdir(), "vello-cta-"));
  try {
    const mainPath = join(workDir, "main.mp4");
    const ctaPath = join(workDir, "cta.mp4");
    const outPath = join(workDir, "out.mp4");
    await Promise.all([streamFetchToFile(mainUrl, mainPath), streamFetchToFile(ctaUrl, ctaPath)]);
    await concatWithCta(ffmpegPath, mainPath, ctaPath, outPath, xf);
    const out = await readFile(outPath);
    const { url: newUrl } = await putVideo(out, { keyPrefix: "renders", convexUrl: CONVEX_URL });
    return newUrl || mainUrl;
  } catch (e) {
    console.warn("[appendCtaFromUrls] failed (keeping original video):", e instanceof Error ? e.message : e);
    return mainUrl;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
