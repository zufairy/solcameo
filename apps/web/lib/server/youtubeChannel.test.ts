// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * The yt-dlp spawn (runFlatPlaylist / listChannelVideos) can't be unit-tested here
 * (no yt-dlp binary / network), so these tests cover the PURE parse+rank logic that
 * turns a `--flat-playlist -J` `entries[]` fixture into the top-N clippable
 * `watch?v=<id>` videos — the part that actually decides "top performing".
 */
import { rankTopVideos, entryVideoId, channelVideosUrl, type FlatPlaylistEntry } from "./youtubeChannel";

describe("entryVideoId — pull a video id from a flat-playlist entry", () => {
  it("uses the 11-char id when present", () => {
    expect(entryVideoId({ id: "dQw4w9WgXcQ" })).toBe("dQw4w9WgXcQ");
  });
  it("parses a watch url", () => {
    expect(entryVideoId({ url: "https://www.youtube.com/watch?v=abc123DEF45" })).toBe("abc123DEF45");
  });
  it("parses a shorts / youtu.be url", () => {
    expect(entryVideoId({ url: "https://www.youtube.com/shorts/abc123DEF45" })).toBe("abc123DEF45");
    expect(entryVideoId({ webpage_url: "https://youtu.be/abc123DEF45" })).toBe("abc123DEF45");
  });
  it("accepts a bare id in the url field", () => {
    expect(entryVideoId({ url: "abc123DEF45" })).toBe("abc123DEF45");
  });
  it("returns null when no id can be found", () => {
    expect(entryVideoId({ title: "no id here" })).toBeNull();
    expect(entryVideoId({ id: "too-short" })).toBeNull();
  });
});

describe("rankTopVideos — rank flat entries by view_count → top-N watch URLs", () => {
  const entries: FlatPlaylistEntry[] = [
    { id: "aaaaaaaaaaa", title: "Low", view_count: 100 },
    { id: "bbbbbbbbbbb", title: "Huge", view_count: 1_000_000 },
    { id: "ccccccccccc", title: "Mid", view_count: 5_000 },
    { id: "ddddddddddd", title: "High", view_count: 50_000 },
  ];

  it("sorts by view_count desc and takes the top-N as watch URLs", () => {
    expect(rankTopVideos(entries, 2)).toEqual([
      { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", name: "Huge" },
      { url: "https://www.youtube.com/watch?v=ddddddddddd", name: "High" },
    ]);
  });

  it("returns all ranked when N exceeds the entry count", () => {
    const out = rankTopVideos(entries, 10);
    expect(out.map((v) => v.name)).toEqual(["Huge", "High", "Mid", "Low"]);
  });

  it("dedupes by video id (a repeated id counts once)", () => {
    const dupes: FlatPlaylistEntry[] = [
      { id: "aaaaaaaaaaa", title: "First", view_count: 10 },
      { id: "aaaaaaaaaaa", title: "Dup", view_count: 999 },
      { id: "bbbbbbbbbbb", title: "Other", view_count: 20 },
    ];
    const out = rankTopVideos(dupes, 5);
    expect(out).toHaveLength(2);
    expect(out.map((v) => v.url)).toEqual([
      "https://www.youtube.com/watch?v=bbbbbbbbbbb", // views 20 ranks first
      "https://www.youtube.com/watch?v=aaaaaaaaaaa", // deduped to first-seen (views 10, not the dup's 999)
    ]);
  });

  it("FALLBACK: when NO entry has a view_count, preserves source order (recency/author)", () => {
    const noViews: FlatPlaylistEntry[] = [
      { id: "aaaaaaaaaaa", title: "Newest" },
      { id: "bbbbbbbbbbb", title: "Older" },
      { id: "ccccccccccc", title: "Oldest" },
    ];
    expect(rankTopVideos(noViews, 2)).toEqual([
      { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", name: "Newest" },
      { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", name: "Older" },
    ]);
  });

  it("entries WITH views outrank entries missing views (partial view data)", () => {
    const mixed: FlatPlaylistEntry[] = [
      { id: "aaaaaaaaaaa", title: "NoViews" },
      { id: "bbbbbbbbbbb", title: "HasViews", view_count: 42 },
    ];
    expect(rankTopVideos(mixed, 1)).toEqual([
      { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", name: "HasViews" },
    ]);
  });

  it("skips entries with no resolvable id and falls back to the id for a blank title", () => {
    const messy: FlatPlaylistEntry[] = [
      { title: "junk, no id" },
      { url: "https://www.youtube.com/watch?v=abc123DEF45", title: "" },
    ];
    expect(rankTopVideos(messy, 5)).toEqual([
      { url: "https://www.youtube.com/watch?v=abc123DEF45", name: "abc123DEF45" },
    ]);
  });

  it("caps the name at 120 chars", () => {
    const long = "x".repeat(300);
    const out = rankTopVideos([{ id: "aaaaaaaaaaa", title: long, view_count: 1 }], 1);
    expect(out[0].name).toHaveLength(120);
  });

  it("N=0 returns nothing", () => {
    expect(rankTopVideos(entries, 0)).toEqual([]);
  });
});

describe("channelVideosUrl — target the channel's Videos tab for real uploads", () => {
  it.each([
    ["https://www.youtube.com/@Handle", "https://www.youtube.com/@Handle/videos"],
    ["https://www.youtube.com/@Handle/featured", "https://www.youtube.com/@Handle/videos"],
    ["https://www.youtube.com/channel/UCabc123", "https://www.youtube.com/channel/UCabc123/videos"],
    ["https://www.youtube.com/user/Legacy", "https://www.youtube.com/user/Legacy/videos"],
    ["https://www.youtube.com/c/Custom", "https://www.youtube.com/c/Custom/videos"],
  ])("%s → %s", (input, expected) => {
    expect(channelVideosUrl(input)).toBe(expected);
  });

  it("leaves a playlist URL unchanged (not a channel)", () => {
    const pl = "https://www.youtube.com/playlist?list=PLabc123";
    expect(channelVideosUrl(pl)).toBe(pl);
  });
});
