// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: h.query }));
vi.mock("./repost-video-button", () => ({ RepostVideoButton: ({ failed }: { failed: boolean }) => <button>{failed ? "Retry X post" : "Post to X"}</button> }));
import { GenerationPostActions, type GenerationPost } from "./generation-post-actions";
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function mount(rows: unknown[], post?: GenerationPost) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.query.mockReturnValue(rows);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<GenerationPostActions mintAddress="mint" videoUrl="https://video.test/v.mp4" title="Video $ALG" post={post} />));
}
it("shows a live posted receipt and clickable platform instead of a stale failure", async () => {
  await mount([{ videoUrl: "https://video.test/v.mp4", status: "posted", platforms: ["x"], postPlatform: "x", postUrl: "https://x.com/creator/status/123" }], { status: "failed" });
  expect(host.textContent).toContain("Posted");
  expect(host.querySelector('a[aria-label="Open x post"]')?.getAttribute("href")).toBe("https://x.com/creator/status/123");
  expect(host.querySelector("button")).toBeNull();
});
it("offers retry for a failed post with its error", async () => {
  await mount([{ videoUrl: "https://video.test/v.mp4", status: "failed", platforms: ["x"], error: "Bad media" }]);
  expect(host.textContent).toContain("Post failed");
  expect(host.textContent).toContain("Bad media");
  expect(host.querySelector("button")?.textContent).toBe("Retry X post");
});
it("offers post for an unpublished video", async () => {
  await mount([]);
  expect(host.textContent).toContain("Not posted");
  expect(host.querySelector("button")?.textContent).toBe("Post to X");
});
it("does not offer another publish while already queued", async () => {
  await mount([{ videoUrl: "https://video.test/v.mp4", status: "scheduled", platforms: ["x"] }]);
  expect(host.textContent).toContain("Scheduled");
  expect(host.querySelector("button")).toBeNull();
});
it("preserves a legacy post link for videos without a queue row", async () => {
  await mount([], { status: "posted", platforms: ["youtube"], postUrl: "https://youtube.com/shorts/123", postPlatform: "youtube" });
  expect(host.querySelector('a[aria-label="Open youtube post"]')?.getAttribute("href")).toBe("https://youtube.com/shorts/123");
});
