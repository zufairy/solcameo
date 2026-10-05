import { describe, it, expect, afterEach } from "vitest";
import { buildYtdlpArgs } from "./downloader";
import { apifyQualityFor } from "./managedYoutube";

const fmtOf = (args: string[]) => args[args.indexOf("-f") + 1];

describe("HD source selection", () => {
  afterEach(() => { delete process.env.YTDLP_MAX_HEIGHT; });

  it("defaults to a size-guarded 1440p tier (any codec) before the 1080p mp4 ladder", () => {
    const f = fmtOf(buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s"));
    expect(f.startsWith("bv*[height<=1440][height>1080][dynamic_range=SDR][filesize_approx<")).toBe(true);
    expect(f).toContain("[vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1440]");
    expect(f).toContain("bv*[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]");
  });

  it("an explicit low cap (long sources) skips the HD tier entirely", () => {
    const f = fmtOf(buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s", { maxHeight: 720 }));
    expect(f).not.toContain("height>1080");
    expect(f.startsWith("bv*[height<=720][ext=mp4][vcodec^=avc1]")).toBe(true);
  });

  it("YTDLP_MAX_HEIGHT overrides the default cap", () => {
    process.env.YTDLP_MAX_HEIGHT = "2160";
    expect(fmtOf(buildYtdlpArgs("https://youtu.be/abc", "/tmp/x/src.%(ext)s"))).toContain("bv*[height<=2160][height>1080]");
  });
});

describe("managed fallback quality", () => {
  it("maps our height cap to the best actor tier not above it", () => {
    expect(apifyQualityFor(1440)).toBe("1440p");
    expect(apifyQualityFor(1080)).toBe("1080p");
    expect(apifyQualityFor(900)).toBe("720p");
    expect(apifyQualityFor(4000)).toBe("2160p");
  });
});
