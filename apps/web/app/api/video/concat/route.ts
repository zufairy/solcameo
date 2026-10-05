import { NextRequest, NextResponse } from "next/server";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { resolveXfadeName } from "@/lib/server/transitionsPack";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { streamFetchToFile } from "@/lib/server/downloader";
// Resolved binary (not the raw ffmpeg-static export — the dev bundler can
// rewrite that path into .next where no binary exists).
const ffmpegPath = resolveFfmpegPath();
const execFileP = promisify(execFile);

// Concatenating a 60s 720p video runs in seconds with stream-copy, but allow
// headroom for downloading several clips over the network.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Stitch multiple finished clip URLs into one MP4 and return the raw bytes.
 *
 * Used by the Convex video job (`convex/videoJobs.ts`) to merge frame-chained
 * Seedance clips — Kie has no native Seedance extend/merge, and ffmpeg.wasm is
 * browser-only, so the binary concat lives here in the Node runtime where
 * `ffmpeg-static` reliably runs. The Convex action stores the returned bytes in
 * Convex storage.
 *
 * Uses ffmpeg's concat FILTER with a RE-ENCODE (libx264 + aac), normalizing each
 * clip's fps / SAR / pixel-format / audio-rate first. Stream-copy (`-c copy`) was
 * used before, but independently-generated Kie clips do NOT share identical codec
 * params or timestamps (each starts at PTS 0 with its own SPS/PPS + GOP), so a
 * copy-concat played the first clip fine then GLITCHED/froze at every join (the
 * "video goes crashy after ~10s" bug — 10s being the end of clip 1). Re-encoding
 * rebuilds one continuous timeline, so the stitched video plays clean end-to-end.
 */
export async function POST(req: NextRequest) {
  // Gate: server-to-server (X-Internal-Secret, from render-step / videoJobs) or a
  // SIWS user. Was previously open to anyone — it downloads arbitrary URLs + ffmpegs.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }
  let body: { clipUrls?: unknown; crossfadeSeconds?: unknown; transition?: unknown; trimSeconds?: unknown; headTrimSeconds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Optional Transitions pick — the ffmpeg xfade style used between stitched clips
  // (clip.transitions "between videos" seam). Unknown/absent → the classic fade.
  const xfadeName = resolveXfadeName(typeof body.transition === "string" ? body.transition : undefined);

  const clipUrls = Array.isArray(body.clipUrls)
    ? body.clipUrls.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
    : [];
  // Optional crossfade (seconds) — independent-shot engines (Grok/Kling/Gemini)
  // pass this so shots DISSOLVE into each other instead of hard-cutting. Frame-
  // chained clips (Seedance) omit it (boundary frames already match). Clamped
  // below to stay well under the shortest clip so the transition can't overrun.
  const crossfadeSeconds = typeof body.crossfadeSeconds === "number" && body.crossfadeSeconds > 0
    ? Math.min(1.5, body.crossfadeSeconds)
    : 0;

  // Optional trim (seconds): cut the FINAL output down to this length. With a
  // single clipUrl this route acts as a pure trimmer — used for Grok short
  // takes (operator asked 1-5s; Kie's grok API floor is 6s, so we render 6s
  // and cut it here).
  const trimSeconds = typeof body.trimSeconds === "number" && body.trimSeconds > 0
    ? Math.min(60, body.trimSeconds)
    : 0;

  // Optional per-clip HEAD trim (seconds): cut this much off the START of every
  // clip AFTER the first before joining. Independent-take engines (Gemini Omni)
  // tend to re-establish/replay the previous clip's opening beat — a small head
  // cut removes the "replicated" first moments at each seam. Clamped small so it
  // can never eat meaningful content.
  const headTrimSeconds = typeof body.headTrimSeconds === "number" && body.headTrimSeconds > 0
    ? Math.min(2, body.headTrimSeconds)
    : 0;

  if (clipUrls.length < 2 && !(clipUrls.length === 1 && trimSeconds > 0)) {
    return NextResponse.json(
      { error: `Need at least 2 clip URLs to concat (got ${clipUrls.length})` },
      { status: 400 },
    );
  }
  if (!ffmpegPath) {
    return NextResponse.json({ error: "ffmpeg binary unavailable (ffmpeg-static)" }, { status: 500 });
  }

  // Single-clip TRIM fast path — no concat graph needed: download, `-t` cut
  // (re-encode for an exact frame-accurate cut), return the bytes.
  if (clipUrls.length === 1 && trimSeconds > 0) {
    const workDir = await mkdtemp(join(tmpdir(), "vello-trim-"));
    try {
      const src = join(workDir, "in.mp4");
      const out = join(workDir, "out.mp4");
      await streamFetchToFile(clipUrls[0], src);
      await execFileP(ffmpegPath, [
        "-y", "-i", src, "-t", String(trimSeconds),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        out,
      ], { maxBuffer: 8 * 1024 * 1024 });
      const bytes = await readFile(out);
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "video/mp4" } });
    } catch (e) {
      return NextResponse.json({ error: `trim failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }, { status: 500 });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), "vello-concat-"));
  try {
    // 1. Download each clip to a local file. Streams to DISK (never buffers in
    //    RAM) so a large uploaded hook/main clip is NOT capped by the 500MB
    //    safeFetchToBuffer heap limit — the #1 silent reason a hook video
    //    "didn't show": the concat download threw, the join failed, and the
    //    fail-safe kept the main-only video. 2GB disk ceiling matches the rest
    //    of the pipeline's downloader.
    const clipPaths: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const p = join(workDir, `clip-${String(i).padStart(2, "0")}.mp4`);
      // SSRF-guarded + size-capped per clip (streams to the caller-owned temp file).
      await streamFetchToFile(clipUrls[i], p);
      clipPaths.push(p);
    }

    // 2. Probe every clip for its canvas + duration. ffmpeg's concat/xfade filters
    //    require IDENTICAL width×height across all inputs, but pooled uploads (Hook
    //    Videos / Main Content / CTA) routinely differ — a 720p hook + a 1080p main
    //    made the join throw and the hook silently vanish (the "hook not burned in
    //    front" bug). Every input is cover-scaled + cropped to the LARGEST canvas in
    //    the batch, so any resolution combo concatenates instead of failing.
    const probes = await Promise.all(clipPaths.map((p) => probeVideo(ffmpegPath, p)));
    const evenDim = (n: number, def: number) => { const v = Math.max(120, Math.round(n > 0 ? n : def)); return v % 2 === 0 ? v : v - 1; };
    const targetW = evenDim(Math.max(...probes.map((p) => p.width)), 1080);
    const targetH = evenDim(Math.max(...probes.map((p) => p.height)), 1920);

    // 3. Build the filter graph. Every clip is first normalized to the shared canvas
    //    (cover-scale + crop, the same transform the clipper's stitch uses) and an
    //    identical timebase (fps 30 / SAR 1 / yuv420p) + audio format (48kHz stereo
    //    fltp) — this is what makes the join seamless (the old copy-concat left each
    //    clip's mismatched timestamps in place and glitched at every join).
    const n = clipPaths.length;
    // A SILENT clip (a hook opener without an audio track) has no [i:a] — the
    // graph would throw "Stream specifier ':a' matches no streams" and silently
    // drop the hook. Each such clip gets a lavfi anullsrc input at its real
    // duration, and aNorm references THAT input for that clip. Probe audio first
    // (default to present — a misread just plays the real audio, never an error).
    const inputArgs = clipPaths.flatMap((p) => ["-i", p]);
    const silentToInput: Record<number, number> = {};
    let nextInput = n;
    for (let i = 0; i < n; i++) {
      if (probes[i].hasAudio === false) {
        inputArgs.push(
          "-f", "lavfi", "-t", String(Math.max(1, probes[i].duration || 1)),
          "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        );
        silentToInput[i] = nextInput++;
      }
    }
    const encodeArgs = [
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
    ];
    const outPath = join(workDir, "out.mp4");

    // Per-clip head cut: clips after the first drop their opening headTrimSeconds
    // (bounded to <40% of the clip so a short clip is never gutted).
    const headCutFor = (i: number): number => {
      if (i === 0 || headTrimSeconds <= 0) return 0;
      const dur = probes[i].duration;
      return dur > 0 ? Math.min(headTrimSeconds, dur * 0.4) : headTrimSeconds;
    };
    const vNorm = (i: number, tail: string) => {
      const cut = headCutFor(i);
      const head = cut > 0 ? `trim=start=${cut.toFixed(3)},setpts=PTS-STARTPTS,` : "";
      return `[${i}:v]${head}scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},fps=30,setsar=1,format=yuv420p${tail}[v${i}]`;
    };
    const aNorm = (i: number) => {
      const srcIdx = silentToInput[i] ?? i;
      const cut = headCutFor(i);
      const head = cut > 0 ? `atrim=start=${cut.toFixed(3)},asetpts=PTS-STARTPTS,` : "";
      return `[${srcIdx}:a]${head}aresample=async=1:first_pts=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`;
    };

    // Hard-cut concat graph — the default, and the fail-safe fallback for crossfade.
    const buildConcatFilter = (): string => {
      const norm: string[] = [];
      for (let i = 0; i < n; i++) {
        norm.push(vNorm(i, ""));
        norm.push(aNorm(i));
      }
      const pairs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join("");
      return `${norm.join(";")};${pairs}concat=n=${n}:v=1:a=1[v][a]`;
    };

    const runWith = (filter: string) => runFfmpeg(ffmpegPath, [
      "-y", ...inputArgs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", ...encodeArgs, outPath,
    ]);

    // 4. Crossfade path (opt-in): dissolve each shot into the next. Needs each
    //    clip's real duration to place the xfade offsets; if probing, the filter
    //    build, or the ffmpeg run fails for ANY reason, fall back to the proven
    //    hard-cut concat so a stitched video is NEVER lost to a transition error.
    let stitched = false;
    if (crossfadeSeconds > 0 && n >= 2) {
      try {
        // Effective durations after any per-clip head cut (xfade offsets must
        // track the TRIMMED stream lengths or every transition lands late).
        const durations = probes.map((p, i) => p.duration > 0 ? p.duration - headCutFor(i) : p.duration);
        const minDur = Math.min(...durations);
        // Keep the transition well under the shortest clip (≤40% of it) so it can
        // never consume a whole clip; require every duration to be known (>0).
        const t = durations.every((d) => d > 0) ? Math.min(crossfadeSeconds, minDur * 0.4) : 0;
        if (t >= 0.1) {
          // Normalize to the shared canvas, then chain xfade (video) + acrossfade
          // (audio). The xfade offset for step k is Σ(prev clip durations) − k·t
          // (each transition overlaps the streams by t, shortening the running
          // total by t).
          const norm: string[] = [];
          for (let i = 0; i < n; i++) {
            norm.push(vNorm(i, ",settb=AVTB"));
            norm.push(aNorm(i));
          }
          const chain: string[] = [];
          let vCur = "v0";
          let aCur = "a0";
          let acc = durations[0];
          for (let i = 1; i < n; i++) {
            const offset = acc - t;
            const vOut = i === n - 1 ? "v" : `vx${i}`;
            const aOut = i === n - 1 ? "a" : `ax${i}`;
            chain.push(`[${vCur}][v${i}]xfade=transition=${xfadeName}:duration=${t.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`);
            chain.push(`[${aCur}][a${i}]acrossfade=d=${t.toFixed(3)}[${aOut}]`);
            vCur = vOut; aCur = aOut;
            acc = acc + durations[i] - t;
          }
          await runWith(`${norm.join(";")};${chain.join(";")}`);
          stitched = true;
        }
      } catch (e) {
        console.warn(`[video/concat] crossfade failed, falling back to hard cut: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Default / fallback: re-encoded hard-cut concat (one continuous timeline).
    if (!stitched) await runWith(buildConcatFilter());

    // 5. Return the merged bytes.
    const merged = await readFile(outPath);
    return new NextResponse(new Uint8Array(merged), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(merged.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[video/concat]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Wall-clock ceiling for a single ffmpeg invocation. Under the 300s maxDuration
// so a hung remux is SIGKILLed (freeing the pinned CPU core on the long-lived
// Railway process) before the request itself is force-terminated.
const FFMPEG_WALL_MS = 280_000;

/** Probe a media file's duration + canvas dims + audio presence by parsing
 *  ffmpeg's -i stderr. Returns 0/0/false on failure (the caller then falls back
 *  to defaults, and a clip with NO audio stream gets an injected anullsrc so the
 *  concat graph never references a missing [i:a]). */
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

/** Run ffmpeg, rejecting on non-zero exit with the tail of stderr. */
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    // Wall-clock kill: SIGKILL a hung remux, then reject (propagates into the
    // outer finally{ rm(workDir) }). Cleared on close/error so a normal exit
    // never fires it.
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
