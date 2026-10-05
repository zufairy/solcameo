// Render Studio server renderer: deterministic frame capture.
//
// Loads the composition in headless Chromium, and for every frame calls
// window.__seek(t) then screenshots the page, piping JPEG frames straight into
// ffmpeg (image2pipe -> libx264). The page never "plays", so a slow machine can
// not drop frames and the output is identical on every run.
//
// NODE-ONLY (spawns Chromium + ffmpeg). Never import from Convex code.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { streamFetchToFile } from "@/lib/server/downloader";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocument, clampComposition, type Composition } from "@/lib/render-studio/compose";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { putVideo, putVideoFile } from "@/lib/server/videoStorage";

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "";
const HOST = "https://studio.vello.local";
const VENDOR_DIR = join(process.cwd(), "public", "render-studio", "vendor");
const FONT_DIR = join(process.cwd(), "public", "fonts", "captions");

/** Chromium is memory-hungry; cap parallel renders per process. */
const MAX_CONCURRENT = Number(process.env.RENDER_STUDIO_CONCURRENCY ?? 2);
let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  return () => { active--; waiters.shift()?.(); };
}

export class StudioRenderError extends Error {
  constructor(message: string, readonly code: "browser" | "composition" | "encode" | "storage") {
    super(message);
    this.name = "StudioRenderError";
  }
}

/** Videos the composition actually references (by exact URL). */
function referencedVideos(comp: Composition): string[] {
  const code = `${comp.html}\n${comp.css}\n${comp.js}`;
  return (comp.assets ?? []).filter((a) => a.kind === "video" && code.includes(a.url)).map((a) => a.url);
}

const MAX_CLIP_BYTES = 400 * 1024 * 1024;

/**
 * Downloads each referenced clip (SSRF-guarded) and transcodes it to an
 * all-intra VP8 webm. Intra-only means every frame is a keyframe, so seeking to
 * an exact time is instant and frame-accurate, and Chromium can always decode it
 * (no dependency on the browser build shipping H.264).
 */
async function prepareClips(comp: Composition, dir: string, ffmpeg: string, onStatus?: (t: string) => void): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const urls = [...new Set(referencedVideos(comp))].slice(0, 6);
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++; if (idx >= urls.length) return;
      const url = urls[idx];
      const src = join(dir, `src${idx}`), dst = join(dir, `clip${idx}.webm`);
      onStatus?.(`Preparing clip ${idx + 1} of ${urls.length}`);
      try {
        await streamFetchToFile(url, src, { maxBytes: MAX_CLIP_BYTES, timeoutMs: 120_000 });
        await new Promise<void>((res, rej) => {
          const ff = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-an", "-t", "40",
            "-vf", "scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
            "-c:v", "libvpx", "-g", "1", "-crf", "14", "-b:v", "8M", "-deadline", "realtime", "-cpu-used", "8", "-threads", "2", dst], { stdio: ["ignore", "ignore", "pipe"] });
          let err = ""; ff.stderr.on("data", (d) => { err += String(d); });
          ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`clip transcode failed: ${err.slice(-200)}`))));
        });
        out.set(url, await readFile(dst));
      } catch (e) {
        throw new StudioRenderError(`Could not prepare clip "${url.slice(0, 60)}": ${e instanceof Error ? e.message : e}`, "composition");
      } finally { await rm(src, { force: true }).catch(() => {}); }
    }
  };
  await Promise.all([worker(), worker()]);
  return out;
}

async function launch() {
  const { chromium } = await import("playwright-core");
  // WebGL needs a software GL backend in a GPU-less container (SwiftShader), so
  // unlike the screenshot helper we must NOT pass --disable-software-rasterizer.
  const args = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--mute-audio",
    "--no-first-run", "--disable-extensions", "--hide-scrollbars",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--font-render-hinting=none", "--force-color-profile=srgb", "--disable-lcd-text",
  ];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  env.DBUS_SESSION_BUS_ADDRESS = "/dev/null";
  const strategies: Array<Record<string, unknown>> = [
    ...(CHROMIUM_PATH ? [{ executablePath: CHROMIUM_PATH }] : []),
    { channel: "chrome" },
    {},
  ];
  let last: unknown;
  for (const s of strategies) {
    try { return await chromium.launch({ headless: true, args, env, ...s }); } catch (e) { last = e; }
  }
  throw new StudioRenderError(`Chromium unavailable: ${last instanceof Error ? last.message : last}`, "browser");
}

type Browser = Awaited<ReturnType<typeof launch>>;

async function openPage(browser: Browser, comp: Composition, scale: number, media: Map<string, Buffer> | "stub" = new Map()) {
  // Scaled captures shrink the viewport and CSS-scale the stage, so Chromium
  // rasterises and encodes far fewer pixels (deviceScaleFactor does not help:
  // it still renders at full size and downsamples).
  const ctx = await browser.newContext({ viewport: { width: Math.max(2, Math.round(comp.width * scale)), height: Math.max(2, Math.round(comp.height * scale)) }, deviceScaleFactor: 1 });
  // Serve the self-hosted vendor libs straight from disk: no network, no CDN.
  await ctx.route(`${HOST}/render-studio/vendor/*`, async (route) => {
    const name = route.request().url().split("/").pop()?.split("?")[0] ?? "";
    if (!/^[a-z-]+\.js$/.test(name)) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(join(VENDOR_DIR, name));
      await route.fulfill({ status: 200, contentType: "application/javascript", body });
    } catch { await route.fulfill({ status: 404 }); }
  });
  await ctx.route(`${HOST}/fonts/captions/*`, async (route) => {
    const name = route.request().url().split("/").pop()?.split("?")[0] ?? "";
    if (!/^[A-Za-z-]+\.ttf$/.test(name)) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(join(FONT_DIR, name));
      await route.fulfill({ status: 200, contentType: "font/ttf", body });
    } catch { await route.fulfill({ status: 404 }); }
  });
  // Block every other request: compositions must be self-contained (and must
  // not be able to reach internal services from the render worker).
  await ctx.route(/^(?!https:\/\/studio\.vello\.local\/)(?!data:)(?!about:)(?!blob:).*/, (route) => {
    const u = route.request().url();
    // Allow remote images/fonts (agent avatars, logos) but never non-HTTPS or private hosts.
    if (/^https:\/\//.test(u) && !/\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u) && ["image", "font", "stylesheet", "media"].includes(route.request().resourceType())) return route.continue();
    return route.abort();
  });
  // Registered AFTER the catch-all so these win (Playwright matches newest first).
  const videoUrls = referencedVideos(comp);
  if (media === "stub") {
    for (const u of videoUrls) await ctx.route(u, (r) => r.abort());
  } else {
    for (const [u, buf] of media) {
      await ctx.route(u, async (route) => {
        const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers()["range"] ?? "");
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = Math.min(buf.length - 1, range[2] ? Number(range[2]) : buf.length - 1);
          return route.fulfill({ status: 206, contentType: "video/webm", body: buf.subarray(start, end + 1), headers: { "Content-Range": `bytes ${start}-${end}/${buf.length}`, "Accept-Ranges": "bytes" } });
        }
        return route.fulfill({ status: 200, contentType: "video/webm", body: buf, headers: { "Accept-Ranges": "bytes" } });
      });
    }
  }
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const html = buildDocument(comp, { libBase: `${HOST}/render-studio/vendor`, fontBase: `${HOST}/fonts/captions` });
  await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
  if (scale !== 1) await page.addStyleTag({ content: `html,body{width:${Math.round(comp.width * scale)}px;height:${Math.round(comp.height * scale)}px}#stage{transform:scale(${scale});transform-origin:0 0}` });
  await page.waitForFunction("window.__ready === true", undefined, { timeout: 20_000 }).catch(() => { errors.push("composition never became ready"); });
  const inPage = await page.evaluate("window.__errors || []").catch(() => []) as string[];
  return { ctx, page, errors: [...errors, ...inPage] };
}

export interface StillsResult { frames: Buffer[]; errors: string[] }

/** Capture a few JPEG stills (for the agent's self-check). */
export async function captureStills(input: Composition, times: number[]): Promise<StillsResult> {
  const comp = clampComposition(input);
  const release = await acquire();
  let browser: Browser | null = null;
  try {
    browser = await launch();
    const { page, errors } = await openPage(browser, comp, 0.5, "stub");
    const frames: Buffer[] = [];
    for (const t of times) {
      await page.evaluate(`window.__seek(${Number(t) || 0})`);
      frames.push(await page.screenshot({ type: "jpeg", quality: 70 }));
    }
    const post = await page.evaluate("window.__errors || []").catch(() => []) as string[];
    return { frames, errors: [...new Set([...errors, ...post])] };
  } finally {
    await browser?.close().catch(() => {});
    release();
  }
}

export interface RenderOptions {
  /** "draft" renders at half size for a fast check, "final" at full size. */
  quality?: "draft" | "final";
  onProgress?: (done: number, total: number) => void;
  onStatus?: (text: string) => void;
  /** Where to put the file. Defaults to the shared video storage. */
  keyPrefix?: string;
  signal?: AbortSignal;
}

export interface RenderResult { url: string; frames: number; ms: number; width: number; height: number; bytes: number }

export async function renderComposition(input: Composition, opts: RenderOptions = {}): Promise<RenderResult> {
  const comp = clampComposition(input);
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new StudioRenderError("ffmpeg not available", "encode");
  const scale = opts.quality === "draft" ? 0.5 : 1;
  const total = Math.max(1, Math.round(comp.duration * comp.fps));
  const outW = Math.max(2, Math.round((comp.width * scale) / 2) * 2);
  const outH = Math.max(2, Math.round((comp.height * scale) / 2) * 2);
  const started = Date.now();
  const release = await acquire();
  const dir = await mkdtemp(join(tmpdir(), "rstudio-"));
  const outPath = join(dir, "out.mp4");
  let browser: Browser | null = null;
  try {
    const media = await prepareClips(comp, dir, ffmpeg, opts.onStatus);
    browser = await launch();
    const { page, errors } = await openPage(browser, comp, scale, media);
    const fatal = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
    if (fatal.length) throw new StudioRenderError(`Composition error: ${fatal[0]}`, "composition");

    const ff = spawn(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(comp.fps), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", `scale=${outW}:${outH}:flags=lanczos`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", scale === 1 ? "17" : "23", "-pix_fmt", "yuv420p",
      "-threads", process.env.FFMPEG_THREADS ?? "2", "-movflags", "+faststart", "-r", String(comp.fps), outPath,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    ff.stderr.on("data", (d) => { ffErr += String(d); });
    const done = new Promise<number | null>((res) => ff.on("close", res));
    ff.stdin.on("error", () => { /* surfaced via exit code */ });

    for (let f = 0; f < total; f++) {
      if (opts.signal?.aborted) { ff.kill("SIGKILL"); throw new StudioRenderError("Render cancelled", "encode"); }
      await page.evaluate(`window.__seek(${(f / comp.fps).toFixed(5)})`);
      const jpg = await page.screenshot({ type: "jpeg", quality: scale === 1 ? 92 : 80 });
      if (!ff.stdin.write(jpg)) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
      if (f % 3 === 0 || f === total - 1) opts.onProgress?.(f + 1, total);
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new StudioRenderError(`ffmpeg failed: ${ffErr.slice(-300)}`, "encode");

    const info = await stat(outPath);
    let url: string;
    try {
      if (process.env.R2_BUCKET || process.env.R2_ACCESS_KEY_ID) {
        url = (await putVideoFile(outPath, info.size, { keyPrefix: opts.keyPrefix ?? "render-studio" })).url;
      } else {
        url = (await putVideo(await readFile(outPath), { keyPrefix: opts.keyPrefix ?? "render-studio" })).url;
      }
    } catch (e) {
      throw new StudioRenderError(`Upload failed: ${e instanceof Error ? e.message : e}`, "storage");
    }
    return { url, frames: total, ms: Date.now() - started, width: outW, height: outH, bytes: info.size };
  } finally {
    await browser?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    release();
  }
}

/** Test/dev helper: render to a local file instead of uploading. */
export async function renderToFile(input: Composition, outPath: string, quality: "draft" | "final" = "draft", media: Map<string, Buffer> = new Map()): Promise<{ frames: number; ms: number }> {
  const comp = clampComposition(input);
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new Error("ffmpeg not available");
  const scale = quality === "draft" ? 0.5 : 1;
  const total = Math.max(1, Math.round(comp.duration * comp.fps));
  const started = Date.now();
  const browser = await launch();
  try {
    const { page, errors } = await openPage(browser, comp, scale, media);
    if (errors.length) console.warn("composition errors:", errors);
    const ff = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(comp.fps), "-c:v", "mjpeg", "-i", "pipe:0",
      "-vf", `scale=${Math.round((comp.width * scale) / 2) * 2}:${Math.round((comp.height * scale) / 2) * 2}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", outPath], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((r) => ff.on("close", r));
    for (let f = 0; f < total; f++) {
      await page.evaluate(`window.__seek(${f / comp.fps})`);
      const jpg = await page.screenshot({ type: "jpeg", quality: 88 });
      if (!ff.stdin.write(jpg)) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
    }
    ff.stdin.end();
    await done;
    return { frames: total, ms: Date.now() - started };
  } finally {
    await browser.close().catch(() => {});
  }
}
