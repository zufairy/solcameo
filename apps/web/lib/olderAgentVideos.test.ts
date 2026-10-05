import { describe, expect, it } from "vitest";
import { olderAgentVideos } from "./olderAgentVideos";

describe("olderAgentVideos", () => {
  it("shows only videos strictly older than 72 hours", () => {
    const now = Date.UTC(2026, 8, 24);
    const day = 24 * 60 * 60 * 1000;
    const videos = [
      { id: "old", createdAt: now - 4 * day },
      { id: "edge", createdAt: now - 3 * day },
      { id: "new", createdAt: now - day },
      { id: "future", createdAt: now + day },
      { id: "invalid", createdAt: Number.NaN },
    ];
    expect(olderAgentVideos(videos, now).map((video) => video.id)).toEqual(["old"]);
  });
});
