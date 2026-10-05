import { describe, it, expect } from "vitest";
import { resolveDownloader, buildYtdlpArgs, planDriveFetch, buildAudioExtractArgs, stickyProxy, isMaxFilesizeAbort, ytdlpAudioNeedsExtract } from "./downloader";

describe("resolveDownloader", () => {
  it("uses directFetch for direct video URLs", () => {
    expect(resolveDownloader("https://cdn.brand.com/asset/video.mp4").kind).toBe("direct");
    expect(resolveDownloader("https://x.supabase.co/storage/v1/object/public/v/a.mov").kind).toBe("direct");
  });

  it("routes youtube/tiktok/instagram to the social downloader", () => {
    expect(resolveDownloader("https://www.youtube.com/watch?v=abc12345678").kind).toBe("social");
    expect(resolveDownloader("https://youtu.be/abc12345678").kind).toBe("social");
    expect(resolveDownloader("https://www.tiktok.com/@x/video/123").kind).toBe("social");
    expect(resolveDownloader("https://www.instagram.com/reel/abc/").kind).toBe("social");
  });
});

describe("buildYtdlpArgs", () => {
  it("downloads a single capped-resolution mp4 to the given output path", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("mp4");
    // -o immediately precedes the output path; url is the final positional arg
    const oIdx = args.indexOf("-o");
    expect(oIdx).toBeGreaterThanOrEqual(0);
    expect(args[oIdx + 1]).toBe("/tmp/x/src.%(ext)s");
    expect(args[args.length - 1]).toBe("https://youtu.be/abc");
    // a height cap keeps memory/time bounded
    expect(args.some((a) => /height<=\d+/.test(a))).toBe(true);
  });

  it("passes --ffmpeg-location when given, so merges work without system ffmpeg", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { ffmpegLocation: "/bundled/ffmpeg" });
    const i = args.indexOf("--ffmpeg-location");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("/bundled/ffmpeg");
    expect(args[args.length - 1]).toBe("https://youtu.be/abc"); // url still last
  });

  it("omits --ffmpeg-location when not provided", () => {
    expect(buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/out.mp4")).not.toContain("--ffmpeg-location");
  });

  it("passes --cookies and --proxy when given (YouTube bot-check bypass)", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { cookiesPath: "/tmp/x/cookies.txt", proxy: "http://user:pw@proxy:8080" });
    expect(args[args.indexOf("--cookies") + 1]).toBe("/tmp/x/cookies.txt");
    expect(args[args.indexOf("--proxy") + 1]).toBe("http://user:pw@proxy:8080");
    expect(args[args.length - 1]).toBe("https://youtu.be/abc"); // url still last
  });

  it("omits --cookies/--proxy by default", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/out.mp4");
    expect(args).not.toContain("--cookies");
    expect(args).not.toContain("--proxy");
  });

  it("passes a MULTI-CLIENT player_client chain so one bot-walled client falls back to the next", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s");
    const i = args.indexOf("--extractor-args");
    expect(i).toBeGreaterThanOrEqual(0);
    const val = args[i + 1];
    expect(val).toContain("youtube:player_client=");
    // more than one client → real fallback, not a single point of failure
    const clients = val.split("player_client=")[1].split(",");
    expect(clients.length).toBeGreaterThan(1);
    expect(clients).toContain("android_vr");
    // the `tv` client is DRM-poisoned by YouTube — it must NOT be in the default chain
    expect(clients).not.toContain("tv");
  });

  it("honors an explicit playerClient override (YTDLP_PLAYER_CLIENT)", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { playerClient: "tv,ios" });
    expect(args[args.indexOf("--extractor-args") + 1]).toBe("youtube:player_client=tv,ios");
  });

  it("bypasses YouTube's per-connection throttle with chunked HTTP + parallel fragments (speed)", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s");
    // --http-chunk-size defeats the ~50KB/s single-stream throttle that made
    // downloads crawl / look 'stuck at 1%'.
    expect(args[args.indexOf("--http-chunk-size") + 1]).toBe("10M");
    expect(args.indexOf("--concurrent-fragments")).toBeGreaterThanOrEqual(0);
    // A short socket timeout lets a hung proxy connection fail fast into the retry.
    expect(args.indexOf("--socket-timeout")).toBeGreaterThanOrEqual(0);
  });

  it("caps video height when maxHeight is set (lighter pull for a long source)", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { maxHeight: 720 });
    expect(args.some((a) => /height<=720/.test(a))).toBe(true);
    expect(args.some((a) => /height<=1080/.test(a))).toBe(false);
    // default stays 1080 when unset
    expect(buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s").some((a) => /height<=1080/.test(a))).toBe(true);
  });

  it("audio mode fetches the SMALLEST audio (fast STT source), not bestaudio", () => {
    const args = buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { mode: "audio" });
    const fmt = args[args.indexOf("-f") + 1];
    // worst-audio-first selector — roughly halves the bytes vs bestaudio.
    expect(fmt.startsWith("wa")).toBe(true);
    expect(args).not.toContain("--merge-output-format"); // no video, no merge
    expect(args[args.length - 1]).toBe("https://youtu.be/abc");
  });
});

// ── Regression for the Google-Drive campaign clip timeout ──
// The cloud pipeline downloads the whole source as mode:"audio" with NO section
// (convex/clipJobs.ts). For Drive that fell through `wantWindow = (segment|audio)
// && !!section` → a FULL video download + a full-video re-encode, blowing past the
// 290s budget → "timeout after 290000ms calling /api/video/download". A no-section
// audio request must instead take the audio-EXTRACT path (whole source, video
// stripped → a tiny artifact), never a full video pull.
describe("planDriveFetch — Drive fetch-mode decision", () => {
  it("audio + NO section → audioExtract (the campaign-timeout fix; was 'full')", () => {
    expect(planDriveFetch("audio", false)).toBe("audioExtract");
  });
  it("audio + section → rangeWindow (one clip window, audio-only)", () => {
    expect(planDriveFetch("audio", true)).toBe("rangeWindow");
  });
  it("segment + section → rangeWindow", () => {
    expect(planDriveFetch("segment", true)).toBe("rangeWindow");
  });
  it("segment + NO section → full (route guards this; nothing to window)", () => {
    expect(planDriveFetch("segment", false)).toBe("full");
  });
  it("full mode → full regardless of section", () => {
    expect(planDriveFetch("full", false)).toBe("full");
    expect(planDriveFetch("full", true)).toBe("full");
  });
});

// ── Sticky proxy session (the multi-stream full-source pull IP-lock fix) ──
// googlevideo media URLs are IP-locked to the exit IP that resolved them; a
// rotating proxy fetches the audio stream (f140) through a DIFFERENT IP than its
// URL was locked to → the fragment drops → yt-dlp's final rename throws ENOENT.
// stickyProxy pins one exit IP for the whole invocation by tagging the username.
describe("stickyProxy — pin one residential exit IP for the whole yt-dlp run", () => {
  it("injects a __sessid-<id> tag into the proxy username", () => {
    expect(stickyProxy("http://user:pw@gw.proxy.net:8080", "abc123")).toBe(
      "http://user__sessid-abc123:pw@gw.proxy.net:8080",
    );
  });
  it("preserves scheme, password, host and port (https + DataImpulse-style creds)", () => {
    expect(stickyProxy("https://user-country-us:pa55w0rd@gw.example.net:9000", "s1")).toBe(
      "https://user-country-us__sessid-s1:pa55w0rd@gw.example.net:9000",
    );
  });
  it("returns undefined when no proxy is configured", () => {
    expect(stickyProxy(undefined, "s1")).toBeUndefined();
    expect(stickyProxy("", "s1")).toBeUndefined();
    expect(stickyProxy("   ", "s1")).toBeUndefined();
  });
  it("returns a credential-less proxy unchanged (nothing to tag → stays rotating)", () => {
    expect(stickyProxy("http://gw.proxy.net:8080", "s1")).toBe("http://gw.proxy.net:8080");
  });
  it("different session ids yield different sticky strings (retries rotate the IP)", () => {
    const base = "http://user:pw@gw:8080";
    expect(stickyProxy(base, "a")).not.toBe(stickyProxy(base, "b"));
  });
});

describe("buildAudioExtractArgs — strip video, mono 16k (tiny STT-ready artifact)", () => {
  it("drops video (-vn) and downmixes to mono 16kHz, output last", () => {
    const args = buildAudioExtractArgs("pipe:0", "/tmp/x/audio.mp3");
    expect(args[0]).toBe("-y");                          // overwrite
    expect(args[args.indexOf("-i") + 1]).toBe("pipe:0"); // stream-extract input
    expect(args).toContain("-vn");                       // no video → tiny
    expect(args[args.indexOf("-ac") + 1]).toBe("1");     // mono
    expect(args[args.indexOf("-ar") + 1]).toBe("16000"); // 16kHz for STT
    expect(args[args.length - 1]).toBe("/tmp/x/audio.mp3"); // output is the final arg
  });
  it("accepts a file-path input too (the disk-fallback extract)", () => {
    const args = buildAudioExtractArgs("/work/full.mp4", "/work/audio.mp3");
    expect(args[args.indexOf("-i") + 1]).toBe("/work/full.mp4");
    expect(args[args.length - 1]).toBe("/work/audio.mp3");
  });
});

// ── Semangkuk regression: a YouTube source that exposes ONLY a progressive
// 360p mp4 (itag 18, ~238 MB for a 58-min video; every audio-only stream was
// SABR-gated). The audio-first pull's selector fell through to `b`, hit the old
// hardcoded 200M --max-filesize at 81%, and yt-dlp ABORTED WITH EXIT 0 — which
// surfaced as the cryptic "yt-dlp produced no output file".
describe("audio-first pull — progressive-only sources (yt-dlp exit-0 max-filesize abort)", () => {
  it("audio mode does NOT carry a 200M cap tighter than the shared download ceiling", () => {
    const args = buildYtdlpArgs("https://youtu.be/5k1ixizQPfM", "/tmp/x/src.%(ext)s", { mode: "audio" });
    const i = args.indexOf("--max-filesize");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).not.toBe("200M");
    // Same ceiling as full/segment (2GB default, CLIP_MAX_DOWNLOAD_BYTES-overridable).
    const full = buildYtdlpArgs("https://youtu.be/5k1ixizQPfM", "/tmp/x/src.%(ext)s", { mode: "full" });
    expect(args[i + 1]).toBe(full[full.indexOf("--max-filesize") + 1]);
  });

  it("recognises yt-dlp's silent max-filesize abort line (exit 0, only a .part left)", () => {
    expect(isMaxFilesizeAbort("[download]  81.7% of  238.17MiB at    6.83MiB/s ETA 00:06\n[download] File is larger than max-filesize (214160527 bytes > 209715200 bytes). Aborting.\n")).toBe(true);
    expect(isMaxFilesizeAbort("[download] 100% of 20.1MiB in 00:00:03")).toBe(false);
  });

  it("a progressive video container produced in audio mode must be stripped to audio", () => {
    expect(ytdlpAudioNeedsExtract("src.mp4")).toBe(true);
    expect(ytdlpAudioNeedsExtract("src.webm")).toBe(true);
    expect(ytdlpAudioNeedsExtract("src.mkv")).toBe(true);
    expect(ytdlpAudioNeedsExtract("src.m4a")).toBe(false);
    expect(ytdlpAudioNeedsExtract("src.mp3")).toBe(false);
    expect(ytdlpAudioNeedsExtract("src.opus")).toBe(false);
    expect(ytdlpAudioNeedsExtract("src.weba")).toBe(false);
  });
});

// ── Direct-first download policy + PO-token provider ──────────────────────────
// Prod used the residential proxy on EVERY attempt (100% of bandwidth billed).
// With cookies + a PO-token provider a datacenter IP fetches most videos fine,
// so attempt 1 is DIRECT and the proxy is the fallback for bot-walled videos.
import { planYtdlpAttempts, youtubeVideoKey } from "./downloader";

describe("planYtdlpAttempts — proxy is the fallback, not the default", () => {
  it("with a proxy: try two direct player clients before one proxy fallback", () => {
    expect(planYtdlpAttempts({ hasProxy: true, proxyKnownNeeded: false })).toEqual([
      { useProxy: false }, { useProxy: false }, { useProxy: true },
    ]);
  });
  it("stale proxy memory never suppresses direct attempts", () => {
    expect(planYtdlpAttempts({ hasProxy: true, proxyKnownNeeded: true })).toEqual([
      { useProxy: false }, { useProxy: false }, { useProxy: true },
    ]);
  });
  it("without a proxy: direct attempts only (two, for client rotation)", () => {
    expect(planYtdlpAttempts({ hasProxy: false, proxyKnownNeeded: false })).toEqual([
      { useProxy: false }, { useProxy: false },
    ]);
  });
  it("operator can force proxy-always (YTDLP_DIRECT_FIRST=0)", () => {
    expect(planYtdlpAttempts({ hasProxy: true, proxyKnownNeeded: false, directFirst: false })).toEqual([
      { useProxy: true }, { useProxy: true }, { useProxy: true },
    ]);
  });
});

describe("youtubeVideoKey", () => {
  it("normalises watch / youtu.be / shorts URLs to the video id; other hosts fall back to the URL", () => {
    expect(youtubeVideoKey("https://www.youtube.com/watch?v=5k1ixizQPfM&t=10")).toBe("yt:5k1ixizQPfM");
    expect(youtubeVideoKey("https://youtu.be/5k1ixizQPfM?si=x")).toBe("yt:5k1ixizQPfM");
    expect(youtubeVideoKey("https://www.youtube.com/shorts/5k1ixizQPfM")).toBe("yt:5k1ixizQPfM");
    expect(youtubeVideoKey("https://www.tiktok.com/@a/video/123")).toBe("https://www.tiktok.com/@a/video/123");
  });
});

describe("buildYtdlpArgs — PO-token provider + plugin dir", () => {
  it("points yt-dlp at the bgutil HTTP provider and loads plugins from the given dir", () => {
    const a = buildYtdlpArgs("https://youtu.be/abc", "/o.%(ext)s", { potProviderUrl: "http://127.0.0.1:4416", pluginDirs: "/app/bin/yt-dlp-plugins" });
    expect(a).toContain("--plugin-dirs");
    expect(a[a.indexOf("--plugin-dirs") + 1]).toBe("/app/bin/yt-dlp-plugins");
    const eaIdx = a.map((x, i) => (x === "--extractor-args" ? i : -1)).filter((i) => i >= 0);
    const eaVals = eaIdx.map((i) => a[i + 1]);
    expect(eaVals).toContain("youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416");
  });
  it("with a provider and no explicit client, prefers the token-capable web clients", () => {
    const a = buildYtdlpArgs("https://youtu.be/abc", "/o.%(ext)s", { potProviderUrl: "http://127.0.0.1:4416" });
    const yt = a[a.indexOf("--extractor-args") + 1];
    expect(yt).toMatch(/^youtube:player_client=web_safari,mweb,tv/);
  });
  it("enables an external JS runtime for the n-challenge solver (web clients need it since yt-dlp 2025.11)", () => {
    const a = buildYtdlpArgs("https://youtu.be/abc", "/o.%(ext)s", { jsRuntime: "node" });
    expect(a[a.indexOf("--js-runtimes") + 1]).toBe("node");
    expect(buildYtdlpArgs("https://youtu.be/abc", "/o.%(ext)s", {})).not.toContain("--js-runtimes");
  });
  it("without a provider nothing changes (no plugin-dirs, default chain)", () => {
    const a = buildYtdlpArgs("https://youtu.be/abc", "/o.%(ext)s", {});
    expect(a).not.toContain("--plugin-dirs");
    expect(a[a.indexOf("--extractor-args") + 1]).toMatch(/^youtube:player_client=android_vr,web_safari,ios/);
  });
});

describe("planYtdlpAttempts — free WARP egress", () => {
  it("with WARP: one direct pull, then WARP, then WARP on a fresh identity, then the paid proxy last", () => {
    expect(planYtdlpAttempts({ hasProxy: true, proxyKnownNeeded: false, hasWarp: true })).toEqual([
      { useProxy: false },
      { useProxy: false, warp: true },
      { useProxy: false, warp: true, rotate: true },
      { useProxy: true },
    ]);
  });
  it("skips the direct pull while our own IP is known-walled", () => {
    expect(planYtdlpAttempts({ hasProxy: false, proxyKnownNeeded: false, hasWarp: true, directWalled: true })).toEqual([
      { useProxy: false, warp: true },
      { useProxy: false, warp: true, rotate: true },
    ]);
  });
  it("without WARP the plans are unchanged", () => {
    expect(planYtdlpAttempts({ hasProxy: false, proxyKnownNeeded: false, hasWarp: false })).toEqual([{ useProxy: false }, { useProxy: false }]);
  });
});
