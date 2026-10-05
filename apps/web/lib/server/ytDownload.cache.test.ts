// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── downloadToLocal must REUSE an already-downloaded source (downloadCache hit)
// instead of re-pulling the original URL through yt-dlp. The cloud clip job
// (/api/video/clip-batch-start → pullSource → downloadToLocal) used to ignore
// the cache entirely, so a video the operator had already downloaded in the
// editor was fetched AGAIN from YouTube via the residential proxy — and any
// proxy hiccup (SSL RECORD_LAYER_FAILURE, bot wall, quota) failed the whole run.

const fetchSource = vi.fn(async (url: string, opts: { workDir: string }) => {
  const path = join(opts.workDir, "src");
  await writeFile(path, Buffer.from(`bytes-from:${url}`));
  return { path, mime: "video/mp4" };
});
const resolveDownloader = vi.fn((url: string) => ({
  kind: /youtube\.com/.test(url) ? "social" : "direct",
  fetchSource,
}));
vi.mock("@/lib/server/downloader", () => ({ resolveDownloader: (u: string) => resolveDownloader(u) }));
vi.mock("@/lib/server/ffmpegBin", () => ({ resolveFfmpegPath: () => "/fake/ffmpeg" }));

let cacheHit: { url: string; storageId: string; durationSeconds?: number } | null = null;
const query = vi.fn(async (reference: unknown, args: { sourceUrl: string }) => {
  void reference;
  void args;
  return cacheHit;
});
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class { query = query; mutation = vi.fn(async () => null); },
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { downloadCache: { getByKey: { name: "downloadCache:getByKey" }, put: { name: "downloadCache:put" } } },
}));

const YT = "https://www.youtube.com/watch?v=abc123";
const R2 = "https://media.example-r2.dev/videos/abc123.mp4";
const DRIVE_SHARE = "https://drive.google.com/open?id=1AbCdEf12345&usp=sharing";
const DRIVE_CANONICAL = "https://drive.google.com/file/d/1AbCdEf12345/view";

describe("downloadToLocal downloadCache reuse", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    fetchSource.mockClear();
    resolveDownloader.mockClear();
    query.mockClear();
    cacheHit = null;
  });

  it("pulls the cached stored copy (not the original social URL) on a full-mode hit", async () => {
    cacheHit = { url: R2, storageId: "r2:videos/abc123.mp4", durationSeconds: 123 };
    const { downloadToLocal } = await import("./ytDownload");
    const workDir = await mkdtemp(join(tmpdir(), "vello-test-"));
    const out = await downloadToLocal(YT, { workDir, mode: "full", maxHeight: 1080 });
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toBe(R2);
    expect(out.path).toBe(join(workDir, "src"));
  });

  it("finds a Drive file already cached under its canonical URL", async () => {
    cacheHit = { url: R2, storageId: "r2:videos/abc123.mp4", durationSeconds: 123 };
    query.mockImplementationOnce(async () => null).mockImplementationOnce(async () => cacheHit);
    const { downloadToLocal, downloadCacheSourceUrl } = await import("./ytDownload");
    const workDir = await mkdtemp(join(tmpdir(), "vello-test-"));
    await downloadToLocal(DRIVE_SHARE, { workDir, mode: "full" });
    expect(downloadCacheSourceUrl(DRIVE_SHARE)).toBe(DRIVE_CANONICAL);
    expect(query.mock.calls.map((c) => c[1].sourceUrl)).toEqual([DRIVE_SHARE, DRIVE_CANONICAL]);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toBe(R2);
  });

  it("falls back to the original URL when the cache misses", async () => {
    cacheHit = null;
    const { downloadToLocal } = await import("./ytDownload");
    const workDir = await mkdtemp(join(tmpdir(), "vello-test-"));
    await downloadToLocal(YT, { workDir, mode: "full" });
    expect(fetchSource.mock.calls[0][0]).toBe(YT);
  });

  it("falls back to the original URL when the cached copy is dead", async () => {
    cacheHit = { url: R2, storageId: "r2:dead" };
    fetchSource.mockImplementationOnce(async () => { throw new Error("HTTP 404"); });
    const { downloadToLocal } = await import("./ytDownload");
    const workDir = await mkdtemp(join(tmpdir(), "vello-test-"));
    await downloadToLocal(YT, { workDir, mode: "full" });
    expect(fetchSource.mock.calls.map((c) => c[0])).toEqual([R2, YT]);
  });

  it("never consults the cache for segment pulls", async () => {
    cacheHit = { url: R2, storageId: "r2:x" };
    const { downloadToLocal } = await import("./ytDownload");
    const workDir = await mkdtemp(join(tmpdir(), "vello-test-"));
    await downloadToLocal(YT, { workDir, mode: "segment", section: { start: 1, end: 5 } });
    expect(query).not.toHaveBeenCalled();
    expect(fetchSource.mock.calls[0][0]).toBe(YT);
  });
});
