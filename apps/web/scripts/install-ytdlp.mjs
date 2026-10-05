#!/usr/bin/env node
/**
 * Postinstall: fetch the right standalone yt-dlp binary for this platform into
 * ./bin so social-URL clip ingestion works on fresh installs / deploys without
 * a manual step. Self-contained (no Python). Idempotent (skips if present) and
 * RESILIENT — if the download fails (offline CI, blocked egress) it warns and
 * exits 0 so it never breaks `npm install`; clipping then surfaces a clear
 * "install yt-dlp" message at runtime instead.
 *
 * Override the binary location at runtime with YTDLP_PATH; otherwise the
 * downloader auto-detects ./bin/yt-dlp (see lib/server/downloader.ts).
 */
import { createWriteStream, existsSync, chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "bin");
const isWin = process.platform === "win32";
const dest = join(binDir, isWin ? "yt-dlp.exe" : "yt-dlp");

// Map platform/arch → the release asset name yt-dlp publishes.
function assetName() {
  if (process.platform === "darwin") return "yt-dlp_macos";          // universal (arm64 + x86_64)
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux") return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return "yt-dlp";                                                    // generic python-zip fallback
}
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName()}`;

if (existsSync(dest)) {
  // A stale binary silently rots: YouTube changes its player/signature scheme
  // every few weeks and an old yt-dlp starts 403ing on googlevideo media URLs
  // (surfaced as "ffmpeg exited with code 1 … 403 Forbidden" on segment pulls).
  // Standalone builds self-update in place, so keep it current on every
  // install. Best-effort: offline/blocked egress just warns and keeps the
  // existing binary.
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(dest, ["-U"], { encoding: "utf8", timeout: 120_000 });
    console.log(`[yt-dlp] ${out.trim().split("\n").pop()}`);
  } catch (e) {
    console.warn(`[yt-dlp] self-update failed (keeping existing binary): ${e?.message ?? e}`);
  }
  process.exit(0);
}

function download(u, file, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(u, { headers: { "User-Agent": "vello-postinstall" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 6) {
          res.resume();
          resolve(download(res.headers.location, file, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const out = createWriteStream(file);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

try {
  mkdirSync(binDir, { recursive: true });
  console.log(`[yt-dlp] downloading ${url}`);
  // Retry transient failures (GitHub release CDN ETIMEDOUT/5xx/429 from CI egress)
  // — a single attempt was flaky enough to fail Docker builds. 3 tries, backoff.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await download(url, dest); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      try { if (existsSync(dest)) unlinkSync(dest); } catch { /* drop partial file before retry */ }
      if (attempt < 3) {
        console.warn(`[yt-dlp] attempt ${attempt} failed (${e?.message ?? e}) — retrying…`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  if (lastErr) throw lastErr;
  if (!isWin) chmodSync(dest, 0o755);
  console.log(`[yt-dlp] installed → ${dest}`);
} catch (err) {
  try { if (existsSync(dest)) unlinkSync(dest); } catch { /* ignore partial file */ }
  console.warn(`[yt-dlp] skipped (download failed: ${err?.message ?? err}). Social-URL clipping will prompt to install yt-dlp at runtime.`);
  process.exit(0);
}
