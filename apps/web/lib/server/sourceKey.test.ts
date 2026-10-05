// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sourceKey, youtubeId, driveFileId, sourceContentChanged } from "./sourceKey";

describe("sourceKey", () => {
  it("keys YouTube by video id (ignores tracking params + host variants)", () => {
    expect(sourceKey("https://www.youtube.com/watch?v=0pgCBV8CTZY&t=30s&feature=share")).toBe("yt:0pgCBV8CTZY");
    expect(sourceKey("https://youtu.be/0pgCBV8CTZY")).toBe("yt:0pgCBV8CTZY");
    expect(sourceKey("https://youtube.com/shorts/0pgCBV8CTZY")).toBe("yt:0pgCBV8CTZY");
    // same video, different URLs -> same key (the whole point of the cache)
    expect(sourceKey("https://youtu.be/0pgCBV8CTZY")).toBe(sourceKey("https://www.youtube.com/watch?v=0pgCBV8CTZY&t=5"));
  });

  it("keys Google Drive by file id", () => {
    expect(driveFileId("https://drive.google.com/file/d/1AbCdEf12345/view?usp=sharing")).toBe("1AbCdEf12345");
    expect(driveFileId("https://drive.usercontent.google.com/download?id=1AbCdEf12345&export=download")).toBe("1AbCdEf12345");
    expect(sourceKey("https://drive.google.com/file/d/1AbCdEf12345/view")).toBe("gdrive:1AbCdEf12345");
    expect(sourceKey("https://drive.google.com/open?id=1AbCdEf12345")).toBe("gdrive:1AbCdEf12345");
  });

  it("appends modifiedTime for Drive so a replaced file invalidates", () => {
    expect(sourceKey("https://drive.google.com/file/d/1AbCdEf12345/view", { modifiedTime: 1700000000 })).toBe("gdrive:1AbCdEf12345:1700000000");
  });

  it("hashes any other URL deterministically", () => {
    const a = sourceKey("https://www.w3schools.com/html/mov_bbb.mp4");
    expect(a).toMatch(/^url:[0-9a-f]{32}$/);
    expect(a).toBe(sourceKey("https://www.w3schools.com/html/mov_bbb.mp4"));
  });

  it("ignores garbage ids", () => {
    expect(youtubeId("https://youtube.com/watch?v=")).toBeNull();
  });
});

// H08/BUG-031: a Drive-hosted campaign source can be REPLACED IN PLACE (same
// fileId/link, new bytes via Drive's "Manage versions -> Upload new version").
// The sourceKey (gdrive:<fileId>) never changes, so the only signal a cached
// transcript row is now stale is a mismatched modifiedTime. sourceContentChanged
// is the pure decision the transcribe-clip route's cache lookup uses to force a
// miss on that mismatch, without disturbing the key itself (every other caller
// keeps computing the same fileId-only key).
describe("sourceContentChanged", () => {
  it("false when neither side has a modifiedTime (non-Drive source, or no signal yet)", () => {
    expect(sourceContentChanged(undefined, undefined)).toBe(false);
    expect(sourceContentChanged(null, undefined)).toBe(false);
  });

  it("false when only one side is known (can't prove a change happened)", () => {
    expect(sourceContentChanged(undefined, "2026-02-02T00:00:00.000Z")).toBe(false);
    expect(sourceContentChanged("2026-01-01T00:00:00.000Z", undefined)).toBe(false);
  });

  it("false when both are known and equal (unchanged)", () => {
    expect(sourceContentChanged("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("true when both are known and differ (replaced in place -> force a miss)", () => {
    expect(sourceContentChanged("2026-01-01T00:00:00.000Z", "2026-02-02T00:00:00.000Z")).toBe(true);
  });
});
