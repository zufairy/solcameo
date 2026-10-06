// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/react", () => ({ useQuery: mocks.query }));
vi.mock("@/lib/client/useSolUsd", () => ({ useSolUsd: () => 100 }));
vi.mock("./feedShared", () => ({ PanelErrorBoundary: ({children}: {children: React.ReactNode}) => children }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
import { LaunchpadFeed } from "./LaunchpadFeed";
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LaunchpadFeed />));
}
it("does not show paper characters as confirmed launches, and has no Previews tab", async () => {
  mocks.query.mockImplementation((_ref, args) => args?.network === "devnet" ? [] : args?.network === "paper" ? [{characterId:"preview1",name:"Preview Person",ticker:"PRE",network:"paper",category:"Comedy",imageUrl:"https://example.com/image.jpg",marketCapLamports:"1000000000",videosPosted:0,followers:0}] : null);
  await mount();
  expect(host.textContent).toContain("Be part of the first launches");
  expect(host.textContent).not.toContain("$PRE");
  const tabs = Array.from(host.querySelectorAll('[role="tab"]')).map(b => b.textContent);
  expect(tabs).toEqual(["New launches", "Trending", "Episodes"]);
});
it("shows the newest videos in the Trending tab with the engine that made each one", async () => {
  mocks.query.mockImplementation((_ref, args) => args?.network ? [] : args?.kind === "ugc" ? { items: [{ id: "v1", videoUrl: "https://example.com/v1.mp4", posterUrl: null, caption: "Cat takes over", agentName: "Mochi", engine: "grok-imagine/image-to-video", createdAt: Date.now() - 60000, viewCount: 1200 }], total: 1, hasMore: false } : args && Object.keys(args).length === 0 ? [{ id: "e1", characterId: "c1", name: "Nova", ticker: "NOVA", title: "Neon run", videoUrl: "https://example.com/e1.mp4", posterUrl: "", createdAt: Date.now() - 600000, sample: false, engine: "Veo 3" }] : null);
  await mount();
  await act(async () => { (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Trending")!).click(); });
  expect(host.textContent).toContain("Grok Imagine");
  expect(host.textContent).toContain("Cat takes over");
  expect(host.textContent).toContain("Veo 3");
  expect(host.textContent).toContain("$NOVA");
});
it("only shows characters with published episodes in the episode tab", async () => {
  mocks.query.mockImplementation((_ref, args) => args?.network ? [] : null);
  await mount();
  await act(async () => { (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Episodes")!).click(); });
  expect(host.textContent).toContain("The first episode starts here");
  expect(host.querySelector('a[href="/create"]')).not.toBeNull();
});
