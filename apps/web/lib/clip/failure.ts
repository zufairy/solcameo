/**
 * explainClipFailure — pure, dependency-free mapper from a RAW clip-pipeline
 * error (yt-dlp stderr tail, proxy provider text, ffmpeg detail, route message)
 * to a SHORT, ACTIONABLE operator message + optional fix hint.
 *
 * Why it lives in `lib/clip/` (not `convex/`): Convex modules already import pure
 * TS from `../lib/*` (see convex/clipJobs.ts's `../lib/economy/*` imports) and the
 * client resolves the same file via the `@/lib/*` alias — so ONE module serves
 * both the cloud pipeline (convex/clipJobs.ts) and the canvas UI without
 * duplication. It has NO imports so it bundles cleanly into either runtime.
 *
 * The goal: replace generic "see the run card" pointers with the actual thing to
 * DO. Callers surface `message` (and `hint`, when present) on the job error, the
 * chat narrator, and the run log.
 */
export type ClipFailure = { message: string; hint?: string };

const MAX_MSG = 200; // fallback message cap
const MAX_TAIL = 160; // ffmpeg detail cap
const MAX_PRESERVED = 400; // already-actionable ("Fix:") message cap

/** Trim + collapse whitespace, cap length, add an ellipsis when clipped. */
function clamp(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

/**
 * Map a raw failure string to an operator-facing reason. Patterns are checked
 * most-specific first. NEVER returns an empty or pointer-only message.
 */
export function explainClipFailure(raw: string | null | undefined): ClipFailure {
  const s = (raw ?? "").trim();
  if (!s) return { message: "The clip run failed, but no error detail was captured." };

  // Already an actionable operator message (carries its own "Fix:" hint — e.g. the
  // downloader's YouTube-bot-check text at lib/server/downloader.ts). Preserve it
  // VERBATIM so a generic wrapper never overwrites a good, specific instruction.
  if (/\bfix:/i.test(s)) return { message: clamp(s, MAX_PRESERVED) };

  const lc = s.toLowerCase();

  if (/drive_quota|google drive temporarily blocked|download quota/i.test(lc)) {
    return {
      message: "Google Drive temporarily limited downloads for this file.",
      hint: "Make a copy in Drive and paste the new link, upload the file directly, or try again after Drive's limit resets.",
    };
  }

  if (/drive.*(?:private|permission|access|403|404)|share the file|service account|returned an html page/i.test(lc)) {
    return {
      message: "Vello cannot access this Google Drive file.",
      hint: "Share the private file or folder with Vello's configured Google service account. If your workspace has no service account, choose ‘Anyone with the link’ or upload the video directly.",
    };
  }

  // Proxy bandwidth exhausted — DataImpulse & co. return TRAFFIC_EXHAUSTED / HTTP 407.
  if (/traffic_exhausted/i.test(lc) || /\b407\b/.test(s)) {
    return {
      // User-facing: the operator can't fix a proxy plan — point at the paths
      // that skip YouTube's server-side download entirely. (Ops: top up
      // YTDLP_PROXY / set YTDLP_COOKIES — see docs/ops/youtube-downloads.md.)
      message: "YouTube is blocking our download servers right now.",
      hint: "Upload the video file in the Clipping tab (Upload your own video), or paste a Google Drive link — both skip YouTube.",
    };
  }

  // DRM / SABR-only video — no downloadable format exists (rental/movie, some
  // music, or a YouTube DRM experiment). Not fixable by a proxy/IP — needs a
  // different source. Checked BEFORE the bot-check (both mention "download").
  if (/drm/i.test(lc)) {
    return {
      message: "This YouTube video is DRM-protected and can't be downloaded.",
      hint: "Try a different video, or use a Google Drive / direct .mp4 source. Signed-in YTDLP_COOKIES sometimes unlocks a clean format.",
    };
  }

  // YouTube anti-bot / auth wall (hits datacenter IPs, not home connections).
  if (
    /\b403\b/.test(s) ||
    /forbidden/i.test(lc) ||
    /unable to download video data/i.test(lc) ||
    /sign in to confirm/i.test(lc) ||
    /\bbot\b/i.test(lc)
  ) {
    return {
      message: "YouTube blocked the download (bot check).",
      hint: "Use a Google Drive / .mp4 source, or set YTDLP_COOKIES (a signed-in cookies export).",
    };
  }

  // Source download dropped mid-stream (rotating proxy → rename/ENOENT before finish).
  if (/unable to rename/i.test(lc) || /enoent/i.test(lc) || /no such file/i.test(lc)) {
    return {
      message: "Source download dropped mid-stream (flaky proxy).",
      hint: "Retry, or use a Google Drive / .mp4 source.",
    };
  }

  // Render failure — keep the raw detail so codec/dimension/ffmpeg specifics survive.
  if (/ffmpeg/i.test(lc) || /\brender/i.test(lc) || /codec/i.test(lc) || /dimension/i.test(lc)) {
    return {
      message: "Render failed while cutting the clip.",
      hint: clamp(s, MAX_TAIL),
    };
  }

  // Timeout — route wall, stalled download, or an over-long source.
  if (/timed out/i.test(lc) || /timeout/i.test(lc)) {
    return {
      message: "The step timed out.",
      hint: "The source may be too long or the download stalled — try a shorter source or a Drive/.mp4.",
    };
  }

  // Fallback: the raw error, trimmed. NEVER a "see the card" pointer, never empty.
  return { message: clamp(s, MAX_MSG) };
}

/**
 * Convenience: the one-line form callers store on the job error / run log —
 * "<message> — <hint>" when a hint exists, else just the message.
 */
export function explainClipFailureLine(raw: string | null | undefined): string {
  const { message, hint } = explainClipFailure(raw);
  return hint ? `${message} — ${hint}` : message;
}
