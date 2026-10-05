// @vitest-environment node
// The social path shells out to yt-dlp. We can't run a real network download in
// a unit test, but we CAN prove the graceful-degradation contract: when the
// yt-dlp binary is absent, fetchSource rejects with a clear, actionable message
// (so the clip job surfaces "install yt-dlp", not a cryptic ENOENT).
import { describe, it, expect } from "vitest";
import { resolveDownloader, SOCIAL_NEEDS_YTDLP } from "./downloader";

describe("social downloader degradation", () => {
  it("rejects with a helpful message when the yt-dlp binary is missing", async () => {
    process.env.YTDLP_PATH = "/nonexistent/path/to/yt-dlp-binary";
    const d = resolveDownloader("https://www.youtube.com/watch?v=abc12345678");
    expect(d.kind).toBe("social");
    await expect(d.fetchSource("https://www.youtube.com/watch?v=abc12345678", { workDir: "/tmp/vello-test-nonexistent" })).rejects.toThrow(SOCIAL_NEEDS_YTDLP);
    delete process.env.YTDLP_PATH;
  });
});
