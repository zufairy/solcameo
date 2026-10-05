// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveSourceUrl powers the clipper's Paste-URL pill: it reuses the SAME
 * classifier the Campaign pill uses so a pasted Google Drive FOLDER — or a YouTube
 * CHANNEL/PLAYLIST — expands into its member videos (and the user picks one), while
 * a single video/file link stays one source — with NO regression to today's single
 * YouTube video / TikTok / .mp4 pasting.
 *
 * Only listDriveFolderVideos + listChannelVideos are mocked (no Drive key / yt-dlp /
 * network here); the REAL classifyUrl, classifyYoutubeUrl, driveFolderId,
 * driveFileUrl, isDriveUrl and sourceKey run, so the collection-vs-file-vs-video
 * classification is the genuine code path, not a stub.
 */
const h = vi.hoisted(() => ({ listMock: vi.fn(), channelMock: vi.fn() }));

vi.mock("@/lib/server/driveDownload", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/server/driveDownload")>();
  return { ...actual, listDriveFolderVideos: h.listMock };
});

// yt-dlp channel enumeration is mocked (no yt-dlp / network here); classifyUrl's
// channel→top-N expansion is the real code path, only the spawn is stubbed.
vi.mock("@/lib/server/youtubeChannel", () => ({ listChannelVideos: h.channelMock }));

import { resolveSourceUrl, classifyYoutubeUrl, isYoutubeCollection } from "./campaignSources";

beforeEach(() => {
  vi.clearAllMocks();
});

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
    "https://brand.example/landing",
    "not-a-url",
    "",
    // Non-video YouTube pages classify as null (not clippable, but never a hang).
    "https://www.youtube.com/results?search_query=cats",
    "https://www.youtube.com/",
  ])("→ null (non-YouTube or unrecognized page): %s", (u) => {
    expect(classifyYoutubeUrl(u)).toBeNull();
    expect(isYoutubeCollection(u)).toBe(false);
  });
});

describe("resolveSourceUrl — Paste-URL source expansion", () => {
  it("expands a Drive FOLDER into every member video (isFolder true)", async () => {
    h.listMock.mockResolvedValue([
      { fileId: "f1", name: "clip-a.mp4" },
      { fileId: "f2", name: "clip-b.mp4" },
    ]);
    const r = await resolveSourceUrl("https://drive.google.com/drive/folders/FOLDERID123456");
    expect(r.isFolder).toBe(true);
    expect(r.videos).toEqual([
      { url: "https://drive.google.com/file/d/f1/view", name: "clip-a.mp4" },
      { url: "https://drive.google.com/file/d/f2/view", name: "clip-b.mp4" },
    ]);
    expect(h.listMock).toHaveBeenCalledWith("FOLDERID123456");
  });

  it("a single Drive FILE → one video, isFolder false (no folder listing)", async () => {
    const r = await resolveSourceUrl("https://drive.google.com/file/d/FILEID123456/view");
    expect(r.isFolder).toBe(false);
    expect(r.videos).toEqual([
      { url: "https://drive.google.com/file/d/FILEID123456/view", name: "Drive file" },
    ]);
    expect(h.listMock).not.toHaveBeenCalled();
  });

  it("a YouTube link → one video, isFolder false (unchanged single-source path)", async () => {
    const r = await resolveSourceUrl("https://youtube.com/watch?v=abc123");
    expect(r.isFolder).toBe(false);
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0].url).toBe("https://youtube.com/watch?v=abc123");
    expect(h.listMock).not.toHaveBeenCalled();
  });

  it("a YouTube CHANNEL → expands to its top-N videos, isFolder true (like a Drive folder)", async () => {
    h.channelMock.mockResolvedValue([
      { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", name: "Top clip" },
      { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", name: "Second clip" },
    ]);
    const r = await resolveSourceUrl("https://www.youtube.com/@SomeHandle");
    expect(r.isFolder).toBe(true); // shows the sub-picker, mirroring a folder
    expect(r.videos).toEqual([
      { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", name: "Top clip" },
      { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", name: "Second clip" },
    ]);
    expect(h.channelMock).toHaveBeenCalledWith("https://www.youtube.com/@SomeHandle", { limit: 5 });
    expect(h.listMock).not.toHaveBeenCalled(); // never touched the Drive lister
  });

  it("a YouTube PLAYLIST → expands via the channel lister, isFolder true", async () => {
    h.channelMock.mockResolvedValue([{ url: "https://www.youtube.com/watch?v=ccccccccccc", name: "Playlist item" }]);
    const r = await resolveSourceUrl("https://www.youtube.com/playlist?list=PLabc123");
    expect(r.isFolder).toBe(true);
    expect(r.videos).toHaveLength(1);
    expect(h.channelMock).toHaveBeenCalled();
  });

  it("a channel we can't enumerate (yt-dlp fails) → isFolder true, videos [] (graceful, no throw)", async () => {
    h.channelMock.mockRejectedValue(new Error("yt-dlp channel enumeration timed out"));
    const r = await resolveSourceUrl("https://www.youtube.com/@SomeHandle");
    expect(r).toEqual({ videos: [], isFolder: true });
  });

  it("a single YouTube VIDEO → one source, isFolder false (never walks the channel)", async () => {
    const r = await resolveSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.isFolder).toBe(false);
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0].url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(h.channelMock).not.toHaveBeenCalled();
  });

  it("a bare website → no videos, isFolder false (skipped, not an error)", async () => {
    const r = await resolveSourceUrl("https://brand.example/landing");
    expect(r).toEqual({ videos: [], isFolder: false });
  });

  it("a blank / whitespace URL → empty, isFolder false (never throws)", async () => {
    expect(await resolveSourceUrl("   ")).toEqual({ videos: [], isFolder: false });
    expect(h.listMock).not.toHaveBeenCalled();
  });

  it("a FOLDER we can't list (unshared / no Drive key) → isFolder true, videos [] (empty-folder hint)", async () => {
    h.listMock.mockResolvedValue([]);
    const r = await resolveSourceUrl("https://drive.google.com/drive/folders/EMPTYFOLDERID");
    expect(r).toEqual({ videos: [], isFolder: true });
  });

  it("stays graceful (videos [], isFolder true) when the folder listing throws", async () => {
    h.listMock.mockRejectedValue(new Error("drive down"));
    const r = await resolveSourceUrl("https://drive.google.com/drive/folders/FOLDERID123456");
    expect(r).toEqual({ videos: [], isFolder: true });
  });
});
