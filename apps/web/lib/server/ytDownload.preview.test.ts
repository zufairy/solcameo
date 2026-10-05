// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFfmpegPath } from "./ffmpegBin";

const query = vi.fn(async (reference: unknown, args: { sourceUrl: string; mode: string; sectionKey?: string }) => {
  void reference;
  void args;
  return null as null | { sourceUrl: string; url: string; storageId: string; durationSeconds: number };
});
const mutation = vi.fn(async () => "row-id");
let previewBytes = Buffer.alloc(0);
let storedSourcePath = "";
const fetchSource = vi.fn(async (_url: string, opts: { workDir: string }) => {
  void _url;
  const path = join(opts.workDir, "stored.mov");
  await copyFile(storedSourcePath, path);
  return { path, mime: "video/quicktime" };
});
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = query; mutation = mutation; } }));
vi.mock("@/lib/server/downloader", () => ({ resolveDownloader: () => ({ kind: "direct", fetchSource }) }));
vi.mock("@/lib/clip/sourceMedia", () => ({ storedFileExists: async () => true }));
vi.mock("@/lib/server/videoStorage", () => ({
  r2Configured: () => true,
  putVideoFile: async (path: string) => {
    previewBytes = await readFile(path);
    return { url: "https://media.example/previews/test.mp4", storageId: "r2:previews/test.mp4" };
  },
  putVideo: vi.fn(),
}));

const dirs: string[] = [];
beforeEach(() => { process.env.R2_PUBLIC_BASE_URL = ""; });
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  query.mockClear();
  mutation.mockClear();
  fetchSource.mockClear();
});

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = resolveFfmpegPath();
  if (!bin) throw new Error("ffmpeg unavailable for preview test");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: "ignore" });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    proc.on("error", reject);
  });
}

describe("Drive editor preview", () => {
  it("prepares an uncached short source as playable H.264 without uploading the raw segment", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    const dir = await mkdtemp(join(tmpdir(), "vello-segment-preview-test-"));
    dirs.push(dir);
    storedSourcePath = join(dir, "source.mov");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "12", "-c:v", "mpeg4", storedSourcePath]);
    const { downloadAndStore } = await import("./ytDownload");
    const result = await downloadAndStore("https://drive.google.com/file/d/1AbCdEf12345/view", {
      mode: "segment", section: { start: 0, end: 10 }, editorPreview: true, mintAddress: "agent",
    });
    expect(result.url).toContain("/previews/");
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(previewBytes.indexOf("avc1")).toBeGreaterThan(0);
    expect(mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sectionKey: "editor-h264-0-10" }));
  }, 20_000);

  it("converts a stored non-browser MOV to a fast-start, playable 10-second H.264 preview without contacting Drive", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    const dir = await mkdtemp(join(tmpdir(), "vello-preview-test-"));
    dirs.push(dir);
    const source = join(dir, "source.mov");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "12", "-c:v", "mpeg4", source]);
    expect((await stat(source)).size).toBeGreaterThan(1024);
    const { ensureEditorPreview } = await import("./ytDownload");
    const result = await ensureEditorPreview("https://drive.google.com/file/d/1AbCdEf12345/view", "agent", source, 12);
    expect(result.url).toBe("https://media.example/previews/test.mp4");
    expect(result.durationSeconds).toBe(12); // preserves original length for clip pricing
    expect(previewBytes.indexOf("avc1")).toBeGreaterThan(0);
    expect(previewBytes.indexOf("moov")).toBeLessThan(previewBytes.indexOf("mdat"));
    const playable = join(dir, "playable.mp4");
    await writeFile(playable, previewBytes);
    await runFfmpeg(["-v", "error", "-i", playable, "-t", "1", "-f", "null", "-"]);
    expect(mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mode: "segment", sectionKey: "editor-h264-0-10", mintAddress: "agent",
    }));
  }, 20_000);

  it("repairs an older full download from stored media, never the Drive link", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    const dir = await mkdtemp(join(tmpdir(), "vello-preview-cache-test-"));
    dirs.push(dir);
    storedSourcePath = join(dir, "source.mov");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "12", "-c:v", "mpeg4", storedSourcePath]);
    const driveUrl = "https://drive.google.com/file/d/1AbCdEf12345/view";
    query.mockImplementation(async (_reference, args) => args.mode === "full" ? {
      sourceUrl: driveUrl, url: "https://media.example/sources/stored.mov", storageId: "r2:sources/stored.mov", durationSeconds: 12,
    } : null);
    const { ensureEditorPreview } = await import("./ytDownload");
    const result = await ensureEditorPreview(driveUrl, "agent");
    expect(result.url).toContain("/previews/");
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toBe("https://media.example/sources/stored.mov");
  }, 20_000);

  it("repairs an older raw 0-10 segment from storage instead of downloading Drive again", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    const dir = await mkdtemp(join(tmpdir(), "vello-old-segment-test-"));
    dirs.push(dir);
    storedSourcePath = join(dir, "old.mov");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "10", "-c:v", "mpeg4", storedSourcePath]);
    const driveUrl = "https://drive.google.com/file/d/1AbCdEf12345/view";
    query.mockImplementation(async (_reference, args) => args.mode === "segment" && args.sectionKey === "0-10" ? {
      sourceUrl: driveUrl, url: "https://media.example/sources/old.mov", storageId: "r2:sources/old.mov", durationSeconds: 10,
    } : null);
    const { downloadAndStore } = await import("./ytDownload");
    const result = await downloadAndStore(driveUrl, { mode: "segment", section: { start: 0, end: 10 }, editorPreview: true });
    expect(result.url).toContain("/previews/");
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toBe("https://media.example/sources/old.mov");
  }, 20_000);

  it("forces replacement of an existing but unplayable cached preview from stored source media", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
    const dir = await mkdtemp(join(tmpdir(), "vello-forced-preview-test-"));
    dirs.push(dir);
    storedSourcePath = join(dir, "source.mov");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "12", "-c:v", "mpeg4", storedSourcePath]);
    const driveUrl = "https://drive.google.com/file/d/1AbCdEf12345/view";
    query.mockImplementation(async (_reference, args) => {
      if (args.mode === "segment" && args.sectionKey === "editor-h264-0-10") return {
        sourceUrl: driveUrl, url: "https://media.example/previews/broken.mp4", storageId: "r2:previews/broken.mp4", durationSeconds: 10,
      };
      if (args.mode === "full") return {
        sourceUrl: driveUrl, url: "https://media.example/sources/stored.mov", storageId: "r2:sources/stored.mov", durationSeconds: 12,
      };
      return null;
    });
    const { ensureEditorPreview } = await import("./ytDownload");
    const result = await ensureEditorPreview(driveUrl, "agent", undefined, undefined, undefined, true);
    expect(result.url).toBe("https://media.example/previews/test.mp4");
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchSource.mock.calls[0][0]).toBe("https://media.example/sources/stored.mov");
    expect(query.mock.calls.every(([, args]) => args.sectionKey !== "editor-h264-0-10")).toBe(true);
    expect(mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sectionKey: "editor-h264-0-10" }));
  }, 20_000);
});
