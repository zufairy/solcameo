// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { backfillLocalClips } from "./backfillClips";
import {
  addClipToHistory,
  unsyncedClips,
  markClipsSynced,
  loadClipHistory,
  type ClipHistoryItem,
} from "./clipHistoryStorage";

const MINT = "MintAddr111";

function clip(over: Partial<ClipHistoryItem> = {}): ClipHistoryItem {
  return {
    id: over.id ?? `id-${Math.random()}`,
    clipUrl: over.clipUrl ?? "https://convex.example/clip.mp4",
    title: over.title ?? "Old Clip",
    durationSeconds: 12,
    sourceUrl: "https://youtu.be/x",
    createdAt: Date.now(),
    ...over,
  };
}

describe("clipHistoryStorage backfill helpers", () => {
  beforeEach(() => localStorage.clear());

  it("unsyncedClips lists only https clips without syncedToDb", () => {
    addClipToHistory(MINT, clip({ id: "a" }));
    addClipToHistory(MINT, clip({ id: "b", syncedToDb: true }));
    addClipToHistory(MINT, clip({ id: "c", clipUrl: "blob:local" })); // not https
    addClipToHistory(MINT, clip({ id: "d", clipUrl: "" })); // missing url
    const ids = unsyncedClips(MINT).map((c) => c.id).sort();
    expect(ids).toEqual(["a"]);
  });

  it("markClipsSynced flips the flag and removes entries from unsynced", () => {
    addClipToHistory(MINT, clip({ id: "a" }));
    addClipToHistory(MINT, clip({ id: "b" }));
    expect(unsyncedClips(MINT)).toHaveLength(2);
    markClipsSynced(MINT, ["a"]);
    expect(unsyncedClips(MINT).map((c) => c.id)).toEqual(["b"]);
    expect(loadClipHistory(MINT).find((c) => c.id === "a")?.syncedToDb).toBe(true);
  });
});

describe("backfillLocalClips", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("POSTs unsynced clips, then marks them synced so a re-run is a no-op", async () => {
    addClipToHistory(MINT, clip({ id: "a", clipUrl: "https://c/x.mp4", viralScore: 80 }));
    addClipToHistory(MINT, clip({ id: "b", clipUrl: "https://c/y.mp4" }));

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true, jobId: "j", clipIds: ["1", "2"] }) });
    vi.stubGlobal("fetch", fetchMock);

    const first = await backfillLocalClips(MINT, MINT);
    expect(first).toEqual({ synced: 2, attempted: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Body has the route-expected shape with safe defaults. (addClipToHistory
    // prepends, so order isn't index-stable - match by clipUrl.)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.mintAddress).toBe(MINT);
    expect(body.clips).toHaveLength(2);
    const sent = body.clips.find((c: { clipUrl: string }) => c.clipUrl === "https://c/x.mp4");
    expect(sent).toMatchObject({
      title: "Old Clip",
      reason: "",
      captionText: "",
      startSeconds: 0,
      endSeconds: 0,
      viralScore: 80,
      clipUrl: "https://c/x.mp4",
    });

    // Idempotency: everything is now synced, so a second run never POSTs again.
    const second = await backfillLocalClips(MINT, MINT);
    expect(second).toEqual({ synced: 0, attempted: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark synced when the POST fails (entries stay retryable)", async () => {
    addClipToHistory(MINT, clip({ id: "a", clipUrl: "https://c/x.mp4" }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(backfillLocalClips(MINT, MINT)).rejects.toThrow(/forbidden/);
    expect(unsyncedClips(MINT)).toHaveLength(1); // still unsynced → retryable
  });

  it("skips clips without a real https clipUrl", async () => {
    addClipToHistory(MINT, clip({ id: "a", clipUrl: "blob:abc" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await backfillLocalClips(MINT, MINT);
    expect(res).toEqual({ synced: 0, attempted: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
