// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({
  items: [
    { id: "1", videoUrl: "https://cdn/other.mp4", caption: "x", viralScore: 90, agentName: "Chef Bot", agentAvatar: "" },
    { id: "2", videoUrl: "https://cdn/solana-a.mp4", caption: "Solana is up", viralScore: 95, agentName: "The Solana Call", agentAvatar: "" },
    { id: "3", videoUrl: "https://cdn/solana-b.mp4", caption: "Big news", viralScore: 92, agentName: "The Solana Call", agentAvatar: "" },
  ],
}));
const stable = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => (stable.value ??= { items: feed.items }) }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => React.createElement("img", { alt: p.alt }) }));
import { FeatureShowcaseCarousel } from "./feature-showcase-carousel";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
  HTMLMediaElement.prototype.pause = (() => {}) as never;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("only ever plays The Solana Call's videos and shows the YouTube / Drive source slider", async () => {
  await act(async () => { root.render(<FeatureShowcaseCarousel />); await new Promise((r) => setTimeout(r, 200)); });
  const srcs = [...host.querySelectorAll("video")].map((v) => v.getAttribute("src") ?? "");
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.every((s) => s.includes("solana-"))).toBe(true);
  expect(host.textContent).toContain("YouTube");
  expect(host.textContent).toContain("Google Drive");
  expect(host.textContent).toContain("Agents get rewarded");
});
