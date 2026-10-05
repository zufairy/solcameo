import { describe, it, expect } from "vitest";
import {
  looksLikeGoogleDrive,
  looksLikeDriveFolder,
  driveFileIdentity,
  looksLikeYoutube,
  looksLikeYoutubeChannel,
  looksExpandableSource,
  mergeFolderVideos,
  hasClipSource,
} from "./driveFolder";

describe("looksLikeGoogleDrive", () => {
  it.each([
    "https://drive.google.com/file/d/1AbC_dEf/view?usp=sharing",
    "https://drive.google.com/drive/folders/1AbC_dEf",
    "https://drive.google.com/open?id=1AbC_dEf",
    "https://drive.google.com/uc?export=download&id=1AbC_dEf",
    "https://docs.google.com/file/d/1AbC_dEf/view",
  ])("recognizes Drive file and folder shapes: %s", (u) => {
    expect(looksLikeGoogleDrive(u)).toBe(true);
  });

  it.each([
    "https://example.com/drive.google.com/file/d/fake",
    "https://docs.example.com/file/d/123",
    "https://youtube.com/watch?v=abc",
    "not a url",
    "",
  ])("rejects non-Drive URLs: %s", (u) => {
    expect(looksLikeGoogleDrive(u)).toBe(false);
  });
});

describe("driveFileIdentity", () => {
  it("matches the same file across common share-link forms", () => {
    expect(driveFileIdentity("https://drive.google.com/file/d/1AbC_dEf/view?usp=sharing")).toBe("1AbC_dEf");
    expect(driveFileIdentity("https://drive.google.com/open?id=1AbC_dEf")).toBe("1AbC_dEf");
    expect(driveFileIdentity("https://drive.google.com/uc?export=download&id=1AbC_dEf")).toBe("1AbC_dEf");
  });
  it("does not mistake a folder or unrelated URL for a video file", () => {
    expect(driveFileIdentity("https://drive.google.com/drive/folders/1AbC_dEf")).toBeNull();
    expect(driveFileIdentity("https://example.com/open?id=1AbC_dEf")).toBeNull();
  });
});

describe("looksLikeDriveFolder", () => {
  it("is true for a Drive folder link", () => {
    expect(looksLikeDriveFolder("https://drive.google.com/drive/folders/1AbC_dEf")).toBe(true);
  });
  it("is true regardless of case / query params", () => {
    expect(looksLikeDriveFolder("https://DRIVE.GOOGLE.COM/drive/folders/xyz?usp=sharing")).toBe(true);
  });
  it("is false for a single Drive FILE link", () => {
    expect(looksLikeDriveFolder("https://drive.google.com/file/d/1AbC_dEf/view")).toBe(false);
  });
  it("is false for a YouTube / TikTok / .mp4 link", () => {
    expect(looksLikeDriveFolder("https://youtube.com/watch?v=abc")).toBe(false);
    expect(looksLikeDriveFolder("https://tiktok.com/@u/video/123")).toBe(false);
    expect(looksLikeDriveFolder("https://cdn.example.com/clip.mp4")).toBe(false);
  });
  it("is false for a non-Drive host that happens to contain /folders/", () => {
    expect(looksLikeDriveFolder("https://example.com/folders/123")).toBe(false);
  });
  it("is false for a blank string", () => {
    expect(looksLikeDriveFolder("")).toBe(false);
  });
});

// The three YouTube helpers mirror the server's classifyYoutubeUrl
// (lib/server/campaignSources.ts) and the clip-canvas inspector's
// looksLikeYoutubeChannel — kept in lock-step so the campaign form, the inspector
// and the server never disagree on what expands vs stays a single source.
describe("looksLikeYoutube — any valid YouTube URL (video | channel | playlist)", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=abc123",
    "https://m.youtube.com/watch?v=abc123",
    "https://music.youtube.com/watch?v=abc123",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/abc123DEF45",
    "https://www.youtube.com/embed/abc123DEF45",
    "https://www.youtube.com/live/abc123DEF45",
    "https://www.youtube.com/watch?v=abc123&list=PL123456", // watch w/ list is still a video
    "https://www.youtube.com/@SomeHandle",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/user/LegacyUserName",
    "https://www.youtube.com/c/CustomName",
    "https://www.youtube.com/playlist?list=PLabc123def456",
    "https://www.youtube.com/watch?list=PLabc123def456", // bare list = playlist
  ])("is true for YouTube link: %s", (u) => {
    expect(looksLikeYoutube(u)).toBe(true);
  });

  it.each([
    "https://vimeo.com/12345",
    "https://tiktok.com/@u/video/123",
    "https://cdn.example.com/clip.mp4",
    "https://drive.google.com/drive/folders/1AbC",
    "https://www.youtube.com/results?search_query=cats", // unrecognized YT page
    "https://www.youtube.com/", // bare home
    "",
    "not a url",
  ])("is false for non-YouTube / unrecognized page: %s", (u) => {
    expect(looksLikeYoutube(u)).toBe(false);
  });
});

describe("looksLikeYoutubeChannel — channel/playlist ONLY (an expandable collection)", () => {
  it.each([
    "https://www.youtube.com/@SomeHandle",
    "https://www.youtube.com/@Some.Handle/videos",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos",
    "https://www.youtube.com/user/LegacyUserName",
    "https://www.youtube.com/c/CustomName",
    "https://www.youtube.com/playlist?list=PLabc123def456",
    "https://www.youtube.com/watch?list=PLabc123def456", // bare list, no v
  ])("is true for channel/playlist: %s", (u) => {
    expect(looksLikeYoutubeChannel(u)).toBe(true);
  });

  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=abc123&list=PL123456", // list present but v wins → video
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/abc123DEF45",
    "https://vimeo.com/12345",
    "https://drive.google.com/drive/folders/1AbC",
    "",
  ])("is false for a single video / non-collection: %s", (u) => {
    expect(looksLikeYoutubeChannel(u)).toBe(false);
  });
});

describe("looksExpandableSource — Drive folder OR YouTube channel/playlist", () => {
  it("is true for a Drive FOLDER link", () => {
    expect(looksExpandableSource("https://drive.google.com/drive/folders/1AbC")).toBe(true);
  });
  it("is true for a YouTube channel and playlist", () => {
    expect(looksExpandableSource("https://www.youtube.com/@Handle")).toBe(true);
    expect(looksExpandableSource("https://www.youtube.com/playlist?list=PLxyz")).toBe(true);
  });
  it("is false for a single YouTube video, Drive file, .mp4 and blank", () => {
    expect(looksExpandableSource("https://youtu.be/dQw4w9WgXcQ")).toBe(false);
    expect(looksExpandableSource("https://drive.google.com/file/d/1AbC/view")).toBe(false);
    expect(looksExpandableSource("https://cdn.example.com/clip.mp4")).toBe(false);
    expect(looksExpandableSource("")).toBe(false);
  });
});

describe("mergeFolderVideos", () => {
  it("concatenates existing then resolved, order-preserving", () => {
    expect(mergeFolderVideos(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("de-dupes across and within both lists", () => {
    expect(mergeFolderVideos(["a", "b"], ["b", "c", "c", "a"])).toEqual(["a", "b", "c"]);
  });
  it("trims and drops blank / whitespace-only entries", () => {
    expect(mergeFolderVideos(["  a  ", ""], [" ", "b"])).toEqual(["a", "b"]);
  });
  it("returns [] for two empty lists", () => {
    expect(mergeFolderVideos([], [])).toEqual([]);
  });
});

describe("hasClipSource", () => {
  it("is false with no links and no folder videos (blocks launch)", () => {
    expect(hasClipSource({ contentLinks: [] })).toBe(false);
    expect(hasClipSource({ contentLinks: [""] })).toBe(false);
    expect(hasClipSource({ contentLinks: ["  ", "\n\t"] })).toBe(false);
  });
  it("is true for a single non-empty source/reference link", () => {
    expect(hasClipSource({ contentLinks: ["https://youtube.com/watch?v=abc"] })).toBe(true);
  });
  it("is true for a Drive FOLDER link even before its preview resolves", () => {
    expect(hasClipSource({ contentLinks: ["https://drive.google.com/drive/folders/1AbC"] })).toBe(true);
  });
  it("ignores surrounding blank rows when a real link is present", () => {
    expect(hasClipSource({ contentLinks: ["", "https://cdn.example.com/clip.mp4", ""] })).toBe(true);
  });
  it("is true when folder videos resolved but the link rows read empty", () => {
    expect(hasClipSource({ contentLinks: [""], folderVideoCount: 3 })).toBe(true);
  });
  it("treats a zero folder-video count as no source", () => {
    expect(hasClipSource({ contentLinks: [""], folderVideoCount: 0 })).toBe(false);
  });
});
