import { describe, expect, it, vi } from "vitest";
import { prepareClipSource, resolveClipRunSources } from "./sourceMedia";

describe("saved video clipping", () => {
  it("accepts an already-downloaded video even when its original URL is rejected by the classifier", async () => {
    const sourceUrl = "https://x.com/creator/status/123";
    const resolveOriginal = vi.fn(async () => ({ videos: [] }));
    const resolved = await resolveClipRunSources({ sourceUrl, clipAll: false,
      lookupFull: async () => ({ url: "https://media.example/downloaded.mp4" }), resolveOriginal });
    expect(resolved.videos).toEqual([{ url: sourceUrl, name: "Downloaded video" }]);
    expect(resolveOriginal).not.toHaveBeenCalled();
  });
  it("still expands a collection when clip-all is explicitly requested", async () => {
    const resolveOriginal = vi.fn(async () => ({ videos: [{ url: "https://video.example/one.mp4", name: "One" }] }));
    await resolveClipRunSources({ sourceUrl: "https://video.example/folder", clipAll: true,
      lookupFull: async () => ({ url: "https://media.example/downloaded.mp4" }), resolveOriginal });
    expect(resolveOriginal).toHaveBeenCalledOnce();
  });
  it("skips downloading and preserves a saved video's storage object", async () => {
    const saved = { url: "https://media.example/video.mp4", storageId: "shared-video", durationSeconds: 600 };
    const downloadAudio = vi.fn();
    const onReuse = vi.fn(async () => {});
    const source = await prepareClipSource({ lookupFull: async () => saved, downloadAudio, onReuse });
    expect(downloadAudio).not.toHaveBeenCalled();
    expect(onReuse).toHaveBeenCalledOnce();
    expect(source).toMatchObject({ ok: true, url: saved.url, durationSeconds: 600, cached: true });
    expect(source.storageId).toBeUndefined();
  });
  it.each(["missing", "unavailable"])("downloads audio when the saved source is %s", async (state) => {
    const downloadAudio = vi.fn(async () => ({ ok: true, url: "https://media.example/audio.m4a", storageId: "temporary" }));
    const source = await prepareClipSource({
      lookupFull: async () => { if (state === "unavailable") throw new Error("cache offline"); return null; },
      downloadAudio, onReuse: vi.fn(),
    });
    expect(downloadAudio).toHaveBeenCalledOnce();
    expect(source.storageId).toBe("temporary");
  });
});
