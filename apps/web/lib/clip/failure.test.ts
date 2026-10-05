import { describe, it, expect } from "vitest";
import { explainClipFailure, explainClipFailureLine } from "./failure";

describe("explainClipFailure", () => {
  it("maps proxy TRAFFIC_EXHAUSTED to a user-facing YouTube-blocked message + upload/Drive hint", () => {
    const r = explainClipFailure("yt-dlp exited 1: ...TRAFFIC_EXHAUSTED... proxy quota");
    expect(r.message).toBe("YouTube is blocking our download servers right now.");
    expect(r.hint).toMatch(/Upload the video file/);
    expect(r.hint).toMatch(/Google Drive/);
    expect(r.hint).not.toMatch(/YTDLP_PROXY/);
  });

  it("maps HTTP 407 to the same message", () => {
    const r = explainClipFailure("HTTP Error 407: Proxy Authentication Required");
    expect(r.message).toBe("YouTube is blocking our download servers right now.");
  });

  it("maps a DRM-protected video to a clear can't-download message (not the bot-check)", () => {
    for (const raw of [
      "source download failed: yt-dlp exited 1: ERROR: [youtube] XyhhwVJB9Z4: This video is DRM protected",
      "Some tv client https formats have been skipped as they are DRM protected",
    ]) {
      const r = explainClipFailure(raw);
      expect(r.message).toMatch(/DRM-protected/i);
      expect(r.hint).toMatch(/different video|Google Drive|\.mp4/i);
    }
  });

  it("maps 403 / Forbidden / bot check to the YouTube-blocked message + cookies hint", () => {
    for (const raw of [
      "yt-dlp exited 1: HTTP Error 403: Forbidden",
      "Sign in to confirm you're not a bot",
      "unable to download video data: HTTP Error 403",
    ]) {
      const r = explainClipFailure(raw);
      expect(r.message).toBe("YouTube blocked the download (bot check).");
      expect(r.hint).toMatch(/YTDLP_COOKIES/);
      expect(r.hint).toMatch(/Google Drive \/ \.mp4/);
    }
  });

  it("preserves an already-actionable 'Fix:' message verbatim (no re-genericizing)", () => {
    // The downloader crafts this rich message for the bot-check case — it contains
    // BOTH "bot" and "Fix:", so the Fix-preservation must win over the bot pattern.
    const rich =
      "YouTube blocked the server's IP (bot check). Fix: set YTDLP_COOKIES on the server to a cookies.txt export from a browser signed into YouTube (base64 ok), or set YTDLP_PROXY to a residential proxy. Direct .mp4 and Google Drive links are unaffected.";
    const r = explainClipFailure(rich);
    expect(r.message).toContain("Fix: set YTDLP_COOKIES");
    expect(r.message).toContain("residential proxy");
    expect(r.hint).toBeUndefined();
  });

  it("maps rename / ENOENT / no-such-file to a dropped-mid-stream message", () => {
    for (const raw of [
      "ENOENT: Unable to rename src.f140.m4a",
      "Error: ENOENT: no such file or directory, open '/tmp/src'",
    ]) {
      const r = explainClipFailure(raw);
      expect(r.message).toBe("Source download dropped mid-stream (flaky proxy).");
      expect(r.hint).toMatch(/Retry/);
    }
  });

  it("maps ffmpeg / render errors and keeps the raw detail in the hint", () => {
    const raw = "ffmpeg exited 1: Invalid argument: height not divisible by 2 (codec libx264)";
    const r = explainClipFailure(raw);
    expect(r.message).toBe("Render failed while cutting the clip.");
    // Raw detail survives so the codec/dimension specifics aren't lost.
    expect(r.hint).toContain("height not divisible by 2");
  });

  it("maps timeout to the timed-out message + shorter-source hint", () => {
    for (const raw of ["yt-dlp exceeded 290000ms wall clock — timed out", "request timeout after 240000ms"]) {
      const r = explainClipFailure(raw);
      expect(r.message).toBe("The step timed out.");
      expect(r.hint).toMatch(/shorter source/);
    }
  });

  it("falls back to the trimmed raw error — NOT a generic 'see the card' pointer", () => {
    const raw = "Something weird went sideways in the analyzer stage";
    const r = explainClipFailure(raw);
    expect(r.message).toBe(raw);
    expect(r.hint).toBeUndefined();
    expect(r.message).not.toMatch(/run card|see the/i);
  });

  it("caps a very long fallback message to ~200 chars and never returns empty/pointer text", () => {
    const long = "x".repeat(500);
    const r = explainClipFailure(long);
    expect(r.message.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(r.message.endsWith("…")).toBe(true);
    expect(r.message).not.toMatch(/run card|see the/i);
  });

  it("never returns an empty message for null/undefined/blank input", () => {
    for (const raw of [null, undefined, "", "   "]) {
      const r = explainClipFailure(raw);
      expect(r.message.trim().length).toBeGreaterThan(0);
      expect(r.message).not.toMatch(/run card|see the/i);
    }
  });

  it("explainClipFailureLine joins message + hint with an em dash", () => {
    expect(explainClipFailureLine("HTTP Error 403: Forbidden")).toBe(
      "YouTube blocked the download (bot check). — Use a Google Drive / .mp4 source, or set YTDLP_COOKIES (a signed-in cookies export).",
    );
    // No hint → message only.
    expect(explainClipFailureLine("weird analyzer failure")).toBe("weird analyzer failure");
  });
});
