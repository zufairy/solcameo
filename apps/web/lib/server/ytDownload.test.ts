// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// ── Regression for the storage-upload 502 chunked-encoding bug (commit e0c9e65,
// lib/server/ytDownload.ts) ──
// A streaming fetch() body makes undici send Transfer-Encoding: chunked and DROP
// Content-Length; Convex's storage gateway rejected that as HTTP 502, silently
// breaking every clip run. The fix: a SMALL (<=64MiB) artifact is read into a
// Buffer/Uint8Array and POSTed as a FIXED-LENGTH, non-chunked body; only a
// genuinely large file streams from disk. Plus a bounded 502/503 retry that mints
// a FRESH upload URL each attempt and throws after 3.
//
// downloadAndStore wires the real downloader + ffmpeg + ConvexHttpClient, so we
// mock those and capture exactly how the upload fetch() is invoked.

// resolveDownloader → a fake that writes a tiny artifact to workDir.
let artifactBytes = Buffer.from("tiny-audio-bytes");
const fetchSource = vi.fn(async (_url: string, opts: { workDir: string }) => {
  const path = join(opts.workDir, "src");
  await writeFile(path, artifactBytes);
  return { path, mime: "audio/mp4" };
});
vi.mock("@/lib/server/downloader", () => ({
  resolveDownloader: () => ({ kind: "social", fetchSource }),
}));

vi.mock("@/lib/server/ffmpegBin", () => ({ resolveFfmpegPath: () => "/fake/ffmpeg" }));

// ConvexHttpClient: generateUploadUrl mints a fresh URL each call (so we can
// assert a fresh URL per retry); resolveStorageUrl returns a public URL.
const generatedUrls: string[] = [];
const mutation = vi.fn(async (ref: unknown) => {
  const name = String((ref as { name?: string })?.name ?? ref);
  if (name.includes("generateUploadUrl")) {
    const u = `https://upload.convex.test/slot-${generatedUrls.length}`;
    generatedUrls.push(u);
    return u;
  }
  if (name.includes("resolveStorageUrl")) return "https://files.convex.test/final.mp4";
  return null;
});
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class { mutation = mutation; },
}));

// api refs — only their identity matters; stamp a `name` we can match above.
vi.mock("@/convex/_generated/api", () => ({
  api: {
    clipStorage: {
      generateUploadUrl: { name: "clipStorage:generateUploadUrl" },
      resolveStorageUrl: { name: "clipStorage:resolveStorageUrl" },
    },
    downloadCache: {
      put: { name: "downloadCache:put" },
    },
  },
}));

// Import AFTER mocks are registered.
import { downloadAndStore } from "./ytDownload";

// probeDuration spawns real ffmpeg on "/fake/ffmpeg" → its proc.on("error")
// resolves 0, which is fine (we don't assert duration here).

type UploadCall = { url: string; init: RequestInit };
let uploadCalls: UploadCall[] = [];

beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://bold-ram-3.convex.cloud";
  generatedUrls.length = 0;
  uploadCalls = [];
  artifactBytes = Buffer.from("tiny-audio-bytes");
  mutation.mockClear();
  fetchSource.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stub fetch to record upload POSTs and reply with the queued statuses. */
function stubUpload(statuses: number[]) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    uploadCalls.push({ url, init: init ?? {} });
    const status = statuses[Math.min(i, statuses.length - 1)];
    i++;
    if (status >= 200 && status < 300) {
      return new Response(JSON.stringify({ storageId: "stor_123" }), { status, headers: { "content-type": "application/json" } });
    }
    return new Response("upstream error", { status });
  }));
}

describe("downloadAndStore — small-artifact upload (502 chunked regression)", () => {
  it("POSTs a SMALL artifact as a fixed-length Uint8Array body — no Transfer-Encoding: chunked, with byte-length content", async () => {
    stubUpload([200]);
    const out = await downloadAndStore("https://youtube.com/watch?v=abc", { mode: "audio" });
    expect(out.storageId).toBe("stor_123");
    expect(uploadCalls).toHaveLength(1);

    const init = uploadCalls[0].init;
    // The body must be a fixed-length binary view (undici then emits Content-Length,
    // never Transfer-Encoding: chunked). It must NOT be a stream.
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((init.body as Uint8Array).byteLength).toBe(artifactBytes.byteLength);
    // No caller-set chunked encoding header.
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("content-type")).toBe("audio/mp4");
    // duplex:"half" (the streaming-body marker) must be absent on the small path.
    expect((init as { duplex?: string }).duplex).toBeUndefined();
  });

  // NOTE: these two exercise the real 1500ms×attempt retry backoff (no fake
  // timers — the function's ffmpeg-spawn microtask chain doesn't settle cleanly
  // under fake timers), so each takes ~4.5s. The explicit timeout keeps them green.
  it("retries on 502/503, minting a FRESH upload URL each attempt, then succeeds", async () => {
    stubUpload([502, 503, 200]);
    const out = await downloadAndStore("https://youtube.com/watch?v=abc", { mode: "audio" });
    expect(out.storageId).toBe("stor_123");
    expect(uploadCalls).toHaveLength(3);
    // A fresh upload URL per attempt (no reuse of a consumed slot).
    const urls = uploadCalls.map((c) => c.url);
    expect(new Set(urls).size).toBe(3);
    expect(urls[0]).not.toBe(urls[1]);
  }, 15000);

  it("throws after 3 failed attempts (does not hang or return a bad URL)", async () => {
    stubUpload([502, 502, 502]);
    await expect(downloadAndStore("https://youtube.com/watch?v=abc", { mode: "audio" }))
      .rejects.toThrow(/storage upload failed: HTTP 502/);
    expect(uploadCalls).toHaveLength(3);
  }, 15000);
});
