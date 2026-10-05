import { describe, it, expect } from "vitest";
import { parseYtdlpProgress, buildYtdlpArgs } from "./downloader";

describe("buildYtdlpArgs modes", () => {
  it("full: 1080p video + merge + size cap", () => {
    const a = buildYtdlpArgs("u", "/o.mp4");
    expect(a).toContain("--merge-output-format");
    expect(a.join(" ")).toMatch(/height<=1080/);
    expect(a).toContain("--max-filesize");
    expect(a).not.toContain("--download-sections");
  });

  it("audio: audio-only, no video format / merge, same size ceiling as full (not a tighter 200M)", () => {
    const a = buildYtdlpArgs("u", "/o.m4a", { mode: "audio" });
    expect(a.join(" ")).toMatch(/ba\[ext=m4a\]/);
    expect(a.join(" ")).not.toMatch(/height<=1080/);
    expect(a).not.toContain("--merge-output-format");
    expect(a).toContain("--max-filesize");
    // A 200M cap made yt-dlp silently skip (exit 0) progressive-only sources whose
    // `/b` fallback is a ~240 MB/hour video file — see downloader.test.ts.
    const f = buildYtdlpArgs("u", "/o.mp4", { mode: "full" });
    expect(a[a.indexOf("--max-filesize") + 1]).toBe(f[f.indexOf("--max-filesize") + 1]);
  });

  it("segment: download-sections with force-keyframes + 1080p", () => {
    const a = buildYtdlpArgs("u", "/o.mp4", { mode: "segment", section: { start: 12.5, end: 47.2 } });
    expect(a).toContain("--download-sections");
    expect(a).toContain("*12.50-47.20");
    expect(a).toContain("--force-keyframes-at-cuts");
    expect(a.join(" ")).toMatch(/height<=1080/);
  });

  it("segment without section falls back to full (no sections flag)", () => {
    const a = buildYtdlpArgs("u", "/o.mp4", { mode: "segment" });
    expect(a).not.toContain("--download-sections");
    expect(a).toContain("--max-filesize");
  });

  it("passes proxy + cookies when set", () => {
    const a = buildYtdlpArgs("u", "/o.mp4", { proxy: "http://p:1", cookiesPath: "/c.txt" });
    expect(a).toContain("--proxy"); expect(a).toContain("http://p:1");
    expect(a).toContain("--cookies"); expect(a).toContain("/c.txt");
  });

  it("pins the android_vr,web_safari,ios player-client chain (web/tv 403 or serve DRM through the proxy)", () => {
    expect(buildYtdlpArgs("u", "/o.mp4")).toContain("youtube:player_client=android_vr,web_safari,ios");
    expect(buildYtdlpArgs("u", "/o.mp4", { playerClient: "tv" })).toContain("youtube:player_client=tv");
  });
});

describe("parseYtdlpProgress", () => {
  it("parses a mid-download line with speed", () => {
    const p = parseYtdlpProgress("[download]  12.3% of   42.00MiB at  512.00KiB/s ETA 01:20");
    expect(p).not.toBeNull();
    expect(p!.pct).toBe(12.3);
    expect(p!.totalBytes).toBe(Math.round(42 * 1024 ** 2));
    expect(p!.downloadedBytes).toBe(Math.round(42 * 1024 ** 2 * 0.123));
    expect(p!.speed).toBe("512.00KiB/s");
  });

  it("parses an estimated (~) total", () => {
    const p = parseYtdlpProgress("[download]   1.5% of ~  42.34MiB at  100.00KiB/s ETA 07:10");
    expect(p!.pct).toBe(1.5);
    expect(p!.totalBytes).toBe(Math.round(42.34 * 1024 ** 2));
  });

  it("parses the final 100% line (no speed)", () => {
    const p = parseYtdlpProgress("[download] 100% of   42.34MiB in 00:42");
    expect(p!.pct).toBe(100);
    expect(p!.speed).toBeUndefined();
  });

  it("handles GiB and KiB units", () => {
    expect(parseYtdlpProgress("[download]  50.0% of 1.50GiB at 2.00MiB/s ETA 10:00")!.totalBytes).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseYtdlpProgress("[download]  50.0% of 800.00KiB at 2.00MiB/s")!.totalBytes).toBe(Math.round(800 * 1024));
  });

  it("returns null for non-progress lines", () => {
    expect(parseYtdlpProgress("[info] Downloading 1 format(s): 137+140")).toBeNull();
    expect(parseYtdlpProgress("[Merger] Merging formats into \"src.mp4\"")).toBeNull();
    expect(parseYtdlpProgress("")).toBeNull();
  });
});
