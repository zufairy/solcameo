// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ accessToken: "t" }) }));
import ConnectSocialsPrompt from "./ConnectSocialsPrompt";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const mount = (connected: Record<string, unknown>, tt: boolean, yt: boolean) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: true, configured: true, connected,
    platforms: [{ id: "tiktok", label: "TikTok" }, { id: "youtube", label: "YouTube" }, { id: "instagram", label: "Instagram" }],
  }), { status: 200 })));
  return act(async () => {
    root.render(<ConnectSocialsPrompt open mintAddress="M" agentName="Aria" agentType="clipping" tiktokConnected={tt} youtubeConnected={yt} onClose={() => {}} onOpenSchedule={() => {}} />);
    await new Promise((r) => setTimeout(r, 400));
  });
};

it("focuses on TikTok and YouTube only, with no Add button or dividers", async () => {
  await mount({}, false, false);
  const t = document.body.textContent ?? "";
  expect(t).toContain("TikTok");
  expect(t).toContain("YouTube");
  expect(t).not.toContain("Instagram");
  expect(t).not.toContain("Add account");
  expect(t).not.toMatch(/\bAdd\b/);
  expect(t).not.toContain("Reset all");
  expect(document.body.querySelector(".border-t")).toBeNull();
  expect([...document.body.querySelectorAll("button")].filter((b) => b.textContent === "Connect")).toHaveLength(2);
});

it("shows the done state once both are connected", async () => {
  await mount({ tiktok: { displayName: "aria" }, youtube: { displayName: "ariayt" } }, true, true);
  const t = document.body.textContent ?? "";
  expect(t).toContain("Aria is ready to post");
  expect(t).toContain("@aria");
  expect([...document.body.querySelectorAll("button")].some((b) => b.textContent === "Connect")).toBe(false);
});
