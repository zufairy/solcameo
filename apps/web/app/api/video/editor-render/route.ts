import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
import { buildClipGraph } from "@/lib/server/clipFilterGraph";
import { resolveFontFile } from "@/lib/server/videoFont";
import { putVideo } from "@/lib/server/videoStorage";

const ffmpegPath = resolveFfmpegPath();
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const runtime = "nodejs";
export const maxDuration = 300;

// Wall-clock ceiling per ffmpeg invocation — mirrors concat/route.ts.
const FFMPEG_WALL_MS = 280_000;

type EditorItem = { url: string; trimIn: number; trimOut: number };
type EditorOverlay = { text: string; startSec: number; endSec: number; position?: "top" | "center" | "bottom" };

/**
 * Renders a Timeline-tab export: an ordered list of (already-rendered) clip
 * URLs, each with an in/out trim, concatenated into one canvas, with optional
 * burned-in text overlays spanning the ASSEMBLED (post-concat) timeline.
 *
 * Two ffmpeg passes:
 *  1. Trim + normalize + concat every clip onto one canvas (same normalize
 *     approach as /api/video/concat — cover-scale + crop to a shared canvas,
 *     re-encoded so independently-generated clips join cleanly).
 *  2. If overlays are present, re-run buildClipGraph (the SAME text_overlay
 *     renderer /api/video/overlay-burn uses) over the concatenated file so
 *     overlay timing, fonts, and styling stay byte-identical to the rest of
 *     the app instead of a second bespoke drawtext implementation.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }

  let body: { items?: unknown; overlays?: unknown; aspectRatio?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items: EditorItem[] = Array.isArray(body.items)
    ? body.items
        .filter((it): it is { url: unknown; trimIn: unknown; trimOut: unknown } =>
          !!it && typeof it === "object" && typeof (it as { url?: unknown }).url === "string")
        .map((it) => {
          const url = it.url as string;
          const trimIn = typeof it.trimIn === "number" && it.trimIn >= 0 ? it.trimIn : 0;
          const trimOutRaw = typeof it.trimOut === "number" ? it.trimOut : trimIn + 1;
          const trimOut = Math.max(trimOutRaw, trimIn + 0.1);
          return { url, trimIn, trimOut };
        })
        .filter((it) => /^https?:\/\//i.test(it.url))
    : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Need at least one timeline clip to render" }, { status: 400 });
  }

  const overlays: EditorOverlay[] = Array.isArray(body.overlays)
    ? body.overlays
        .filter((o): o is { text: unknown; startSec: unknown; endSec: unknown; position?: unknown } =>
          !!o && typeof o === "object" && typeof (o as { text?: unknown }).text === "string")
        .map((o) => ({
          text: String(o.text).slice(0, 200),
          startSec: typeof o.startSec === "number" && o.startSec >= 0 ? o.startSec : 0,
          endSec: typeof o.endSec === "number" ? o.endSec : 3,
          position: o.position === "top" || o.position === "center" || o.position === "bottom" ? o.position : "bottom",
        }))
    : [];

  const aspectRatio = body.aspectRatio === "16:9" || body.aspectRatio === "1:1" ? body.aspectRatio : "9:16";

  if (!ffmpegPath) {
    return NextResponse.json({ error: "ffmpeg binary unavailable (ffmpeg-static)" }, { status: 500 });
  }

  const workDir = await mkdtemp(join(tmpdir(), "vello-editor-"));
  try {
    // 1. Download every timeline clip to disk.
    const clipPaths: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const p = join(workDir, `clip-${String(i).padStart(2, "0")}.mp4`);
      await streamFetchToFile(items[i].url, p);
      clipPaths.push(p);
    }

    // 2. Probe every clip so the shared canvas + audio-presence normalization
    //    matches (see /api/video/concat for the same reasoning).
    const probes = await Promise.all(clipPaths.map((p) => probeVideo(ffmpegPath!, p)));
    const evenDim = (n: number, def: number) => { const v = Math.max(120, Math.round(n > 0 ? n : def)); return v % 2 === 0 ? v : v - 1; };
    const [targetW, targetH] = aspectRatio === "16:9"
      ? [evenDim(Math.max(...probes.map((p) => p.width)), 1920), evenDim(Math.round(evenDim(Math.max(...probes.map((p) => p.width)), 1920) * 9 / 16), 1080)]
      : aspectRatio === "1:1"
      ? [1080, 1080]
      : [1080, 1920];

    const n = clipPaths.length;
    const inputArgs = clipPaths.flatMap((p) => ["-i", p]);
    const silentToInput: Record<number, number> = {};
    let nextInput = n;
    for (let i = 0; i < n; i++) {
      const dur = Math.max(0.1, items[i].trimOut - items[i].trimIn);
      if (probes[i].hasAudio === false) {
        inputArgs.push("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
        silentToInput[i] = nextInput++;
      }
    }

    const vNorm = (i: number) => {
      const { trimIn, trimOut } = items[i];
      return `[${i}:v]trim=start=${trimIn.toFixed(3)}:end=${trimOut.toFixed(3)},setpts=PTS-STARTPTS,` +
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},fps=30,setsar=1,format=yuv420p[v${i}]`;
    };
    const aNorm = (i: number) => {
      const { trimIn, trimOut } = items[i];
      const srcIdx = silentToInput[i] ?? i;
      const trimStage = silentToInput[i] != null ? "" : `atrim=start=${trimIn.toFixed(3)}:end=${trimOut.toFixed(3)},asetpts=PTS-STARTPTS,`;
      return `[${srcIdx}:a]${trimStage}aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`;
    };

    const norm: string[] = [];
    for (let i = 0; i < n; i++) { norm.push(vNorm(i)); norm.push(aNorm(i)); }
    const pairs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("");
    const concatFilter = `${norm.join(";")};${pairs}concat=n=${n}:v=1:a=1[v][a]`;

    const encodeArgs = [
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    ];
    const concatOutPath = join(workDir, "concat.mp4");
    await runFfmpeg(ffmpegPath, [
      "-y", ...inputArgs, "-filter_complex", concatFilter, "-map", "[v]", "-map", "[a]", ...encodeArgs, concatOutPath,
    ]);

    // 3. Overlay pass (only if there's something to burn) — reuses the SAME
    //    text_overlay renderer as /api/video/overlay-burn for visual parity.
    let finalPath = concatOutPath;
    if (overlays.length > 0) {
      const totalDuration = items.reduce((s, it) => s + Math.max(0.1, it.trimOut - it.trimIn), 0);
      const graph = buildClipGraph({
        ops: overlays.map((o) => ({
          op: "text_overlay" as const,
          text: o.text,
          position: o.position ?? "bottom",
          startSec: o.startSec,
          endSec: Math.min(o.endSec, totalDuration),
          style: { fontColor: "#ffffff", fontSize: 64, bold: true },
        })),
        startSeconds: 0,
        endSeconds: totalDuration,
        logoPaths: [],
        audioPaths: [],
        width: targetW,
        height: targetH,
        hasAudio: true,
        fps: 30,
        fontFile: resolveFontFile(),
      });
      graph.warnings.forEach((w) => console.warn(`[video/editor-render] ${w}`));
      const overlayOutPath = join(workDir, "overlay.mp4");
      await runFfmpeg(ffmpegPath, [
        "-y", "-i", concatOutPath,
        ...graph.inputArgs, ...graph.filterArgs,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", overlayOutPath,
      ]);
      finalPath = overlayOutPath;
    }

    // 4. Upload to Convex storage and return a public URL — same convention as
    //    /api/video/overlay-burn (never hand back raw bytes for a large asset
    //    the UI needs to re-reference later, e.g. to post or re-download).
    const out = await readFile(finalPath);
    const { url: videoUrl } = await putVideo(out, { keyPrefix: "renders", convexUrl: CONVEX_URL });

    return NextResponse.json({ ok: true, videoUrl }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[video/editor-render]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function probeVideo(bin: string, path: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", () => {
      const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      const vm = err.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
      resolve({
        duration: dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0,
        width: vm ? parseInt(vm[1], 10) : 0,
        height: vm ? parseInt(vm[2], 10) : 0,
        hasAudio: /Stream #\d+:\d+.*: Audio:/.test(err),
      });
    });
    proc.on("error", () => resolve({ duration: 0, width: 0, height: 0, hasAudio: false }));
  });
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(wall); fn(); };
    const wall = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      settle(() => reject(new Error(`ffmpeg killed: exceeded ${FFMPEG_WALL_MS}ms wall clock. ${stderr.slice(-600)}`)));
    }, FFMPEG_WALL_MS);
    proc.on("error", (err) => settle(() => reject(err)));
    proc.on("close", (code) => settle(() => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    }));
  });
}
