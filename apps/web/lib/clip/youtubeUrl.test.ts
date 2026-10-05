import { describe, it, expect } from "vitest";
import { classifyYoutubeUrl, isYoutubeCollection, YOUTUBE_HOST_RE } from "./youtubeUrl";

/**
 * The pure YouTube URL-shape classifier is the fast gate that keeps a CHANNEL /
 * PLAYLIST link out of the single-video download rail (which would make yt-dlp walk
 * the whole channel until the 290s abort — the "1% · Starting source download" hang).
 * It's now a dependency-free module shared by the Next server AND the Convex pipeline,
 * so it gets its own direct coverage independent of campaignSources.
 */
describe("classifyYoutubeUrl — YouTube URL shape (pure, no network)", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=abc123",
    "https://m.youtube.com/watch?v=abc123",
    "https://music.youtube.com/watch?v=abc123",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
    "https://www.youtube.com/shorts/abc123DEF45",
    "https://www.youtube.com/embed/abc123DEF45",
    "https://www.youtube.com/v/abc123DEF45",
    "https://www.youtube.com/live/abc123DEF45",
    // A watch link that ALSO carries a list is still a single playable video.
    "https://www.youtube.com/watch?v=abc123&list=PL123456",
  ])("→ video: %s", (u) => {
    expect(classifyYoutubeUrl(u)).toBe("video");
    expect(isYoutubeCollection(u)).toBe(false);
  });

  it.each([
    "https://www.youtube.com/@SomeHandle",
    "https://www.youtube.com/@Some.Handle_1/videos",
    "https://www.youtube.com/@SomeHandle/shorts",
    "https://www.youtube.com/@SomeHandle/", // trailing slash tolerated
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
    "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/videos",
    "https://www.youtube.com/user/LegacyUserName",
    "https://www.youtube.com/c/CustomName",
  ])("→ channel: %s", (u) => {
    expect(classifyYoutubeUrl(u)).toBe("channel");
    expect(isYoutubeCollection(u)).toBe(true);
  });

  it.each([
    "https://www.youtube.com/playlist?list=PLabc123def456",
    // A bare list= with no v= is a playlist page, not a single video.
    "https://www.youtube.com/watch?list=PLabc123def456",
  ])("→ playlist: %s", (u) => {
    expect(classifyYoutubeUrl(u)).toBe("playlist");
    expect(isYoutubeCollection(u)).toBe(true);
  });

  it.each([
    "https://vimeo.com/12345",
    "https://www.tiktok.com/@x/video/123",
    "https://drive.google.com/file/d/FILEID/view",
    "https://brand.example/landing",
    "not-a-url",
    "",
    // Non-video YouTube pages classify as null (not clippable, but never a hang).
    "https://www.youtube.com/results?search_query=cats",
    "https://www.youtube.com/",
    "https://www.youtube.com/playlist", // /playlist with no list= is not a playlist
    "https://youtu.be/", // bare youtu.be host, no id
  ])("→ null (non-YouTube or unrecognized page): %s", (u) => {
    expect(classifyYoutubeUrl(u)).toBeNull();
    expect(isYoutubeCollection(u)).toBe(false);
  });
});

describe("YOUTUBE_HOST_RE", () => {
  it("matches youtube.com / youtu.be and their subdomains, not lookalikes", () => {
    expect(YOUTUBE_HOST_RE.test("youtube.com")).toBe(true);
    expect(YOUTUBE_HOST_RE.test("www.youtube.com")).toBe(true);
    expect(YOUTUBE_HOST_RE.test("youtu.be")).toBe(true);
    expect(YOUTUBE_HOST_RE.test("notyoutube.com")).toBe(false);
    expect(YOUTUBE_HOST_RE.test("youtube.com.evil.example")).toBe(false);
  });
});
