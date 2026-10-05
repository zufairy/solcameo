import { describe, it, expect, vi } from "vitest";
import { buildEditorVideoDownloadRequest, buildInitialTimelineItem, capPreviewWindow, extractBrollQuery, fmtEta, previewSrc, resolveVideoDuration, sourceDisplayName } from "./VideoEditorTab";

/** Minimal HTMLVideoElement stand-in: an EventTarget with a mutable `duration`
 *  and `currentTime`, where seeking past a `seekableEnd` clamps and fires
 *  `timeupdate` — the same shape browsers give a headerless/streamed mp4. */
function fakeVideo(seekableEnd: number): HTMLVideoElement {
  const target = new EventTarget() as unknown as HTMLVideoElement & { duration: number; _t?: number };
  target.duration = Infinity;
  Object.defineProperty(target, "currentTime", {
    get() { return (target as unknown as { _t?: number })._t ?? 0; },
    set(value: number) {
      (target as unknown as { _t?: number })._t = Math.min(value, seekableEnd);
      if (value >= seekableEnd) target.duration = seekableEnd; // browsers learn duration from the clamp
      target.dispatchEvent(new Event("timeupdate"));
    },
  });
  return target;
}

describe("downloaded source playback", () => {
  it("does not force a media-fragment seek on a first-ten-second preview", () => {
    expect(previewSrc("https://media.example/previews/clip.mp4", 0)).toBe("https://media.example/previews/clip.mp4");
    expect(previewSrc("https://media.example/full.mp4", 30)).toBe("https://media.example/full.mp4#t=30,40");
  });

  it("shows video names rather than share links", () => {
    expect(sourceDisplayName("https://drive.google.com/file/d/1AbCdEf12345/view", "Interview.mp4")).toBe("Interview.mp4");
    expect(sourceDisplayName("https://drive.google.com/file/d/1AbCdEf12345/view")).toBe("Google Drive video");
    expect(sourceDisplayName("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YouTube video");
  });

  it("resolves duration immediately when the browser already knows it", () => {
    const video = fakeVideo(12);
    Object.defineProperty(video, "duration", { value: 12, writable: true });
    const known = vi.fn();
    resolveVideoDuration(video, 0, known);
    expect(known).toHaveBeenCalledWith(12);
  });

  it("recovers duration for a headerless clip that reports Infinity (never stuck at 0:00)", () => {
    const video = fakeVideo(9.6);
    const known = vi.fn();
    resolveVideoDuration(video, 2, known);
    expect(known).toHaveBeenCalledWith(9.6);
    expect(video.currentTime).toBe(2); // seeks back to where playback should resume, not left at the far-seek
  });

  it("formats a download ETA the way a browser download tray would", () => {
    expect(fmtEta(3)).toBe("finishing…");
    expect(fmtEta(42)).toBe("42s left");
    expect(fmtEta(65)).toBe("1m 05s left");
    expect(fmtEta(3725)).toBe("1h 2m left");
  });
});

describe("Text Hook visibility", () => {
  it("does not assume a Videos-tab task already has hook pixels burned in", () => {
    const item = buildInitialTimelineItem("https://cdn.example.com/generated.mp4", "Generated clip", "task-123");
    expect(item.taskId).toBe("task-123");
    expect(item.hookBurned).toBe(false);
  });
});

describe("buildEditorVideoDownloadRequest", () => {
  it.each([
    "https://drive.google.com/file/d/1AbC_dEf/view",
    "https://drive.google.com/drive/folders/1AbC_dEf",
    "https://docs.google.com/file/d/1AbC_dEf/view",
  ])("previews Drive sources from a short browser-safe segment: %s", (sourceUrl) => {
    expect(buildEditorVideoDownloadRequest(sourceUrl, "agent-1")).toEqual({
      sourceUrl,
      mode: "segment",
      section: { start: 0, end: 10 },
      mintAddress: "agent-1",
      editorPreview: true,
    });
  });

  it("keeps a fast preview segment for a normal video URL", () => {
    const sourceUrl = "https://cdn.example.com/video.mp4";
    expect(buildEditorVideoDownloadRequest(sourceUrl, "agent-1")).toEqual({
      sourceUrl,
      mode: "segment",
      section: { start: 0, end: 10 },
      mintAddress: "agent-1",
      editorPreview: true,
    });
  });
});

/** The B-Roll drawer auto-searches from the clip's own transcript/title —
 *  this guesses a short, usable stock-search query from that longer text. */
describe("extractBrollQuery", () => {
  it("strips stopwords and keeps up to 4 content words", () => {
    expect(extractBrollQuery("the video is about how to fix your car engine")).toBe("fix car engine");
  });

  it("lowercases and drops URLs entirely", () => {
    expect(extractBrollQuery("https://www.youtube.com/watch?v=abc123 amazing sunset photography")).toBe("amazing sunset photography");
  });

  it("drops pure-digit tokens and very short words", () => {
    expect(extractBrollQuery("2024 top 10 tips for a healthy morning routine")).toBe("top tips healthy morning");
  });

  it("returns '' for text that's entirely stopwords/junk", () => {
    expect(extractBrollQuery("the a an is are")).toBe("");
  });

  it("returns '' for empty input", () => {
    expect(extractBrollQuery("")).toBe("");
  });

  it("caps at 4 words even with a long, dense sentence", () => {
    const q = extractBrollQuery("street food vendors cooking spicy noodles in a busy night market");
    expect(q.split(" ").length).toBeLessThanOrEqual(4);
  });

  it("handles a short, already-clean title (typical clip.title case)", () => {
    expect(extractBrollQuery("Sunrise Over Mountains")).toBe("sunrise over mountains");
  });
});

describe("capPreviewWindow", () => {
  it("caps a full-length clip to the first 10s", () => {
    expect(capPreviewWindow({ duration: 600, trimIn: 0, trimOut: 600 }).trimOut).toBe(10);
  });
  it("caps old saved projects whose trimOut spans the whole video", () => {
    expect(capPreviewWindow({ duration: 95, trimIn: 0, trimOut: 95 }).trimOut).toBe(10);
  });
  it("keeps short clips whole", () => {
    const item = { duration: 6, trimIn: 0, trimOut: 6 };
    expect(capPreviewWindow(item)).toBe(item);
  });
  it("leaves not-yet-loaded items alone", () => {
    const item = { duration: 0, trimIn: 0, trimOut: 0 };
    expect(capPreviewWindow(item)).toBe(item);
  });
});
