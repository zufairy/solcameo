// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
const agents = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => React.createElement("img", { alt: p.alt }) }));
vi.mock("@/assets/logoblack.png", () => ({ default: { src: "/x.png", width: 1, height: 1 } }));
vi.mock("@/lib/client/useMyAgents", () => ({ useMyAgents: () => ({ agents: agents.value, signedIn: true }) }));
vi.mock("./AgentSetupFlow", () => ({ default: (p: { carry?: string }) => React.createElement("div", { "data-wizard": p.carry ?? "" }, "wizard") }));
import NewAgentEntry from "./NewAgentEntry";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = window.matchMedia ?? ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  replace.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const Q = "Clip this video: https://www.youtube.com/watch?v=abc";
const render = (q: string) => act(async () => root.render(<NewAgentEntry initialType="clipping" clipQuery={q} walkthrough={false} />));

it("offers existing clippers for a queued link and carries the link", async () => {
  agents.value = [{ mintAddress: "M1", name: "ClipBot", avatarUrl: "", niche: "Finance", handle: "", type: "clipping" }, { mintAddress: "M2", name: "Face", avatarUrl: "", niche: "", handle: "", type: "influencer" }];
  await render(Q);
  expect(host.textContent).toContain("Which agent should clip it?");
  expect(host.textContent).toContain("ClipBot");
  expect(host.textContent).not.toContain("Face");
  await act(async () => { ([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("ClipBot")) as HTMLElement).click(); });
  expect(replace).toHaveBeenCalledWith(expect.stringContaining("mint=M1"));
  expect(replace).toHaveBeenCalledWith(expect.stringContaining("q=Clip+this+video"));
});

it("goes straight to setup, carrying the link, when there is no clipping agent", async () => {
  agents.value = [];
  await render(Q);
  const w = host.querySelector("[data-wizard]") as HTMLElement;
  expect(w).toBeTruthy();
  expect(w.getAttribute("data-wizard")).toContain("q=Clip+this+video");
});

it("never shows the chooser without a queued link", async () => {
  agents.value = [{ mintAddress: "M1", name: "ClipBot", avatarUrl: "", niche: "", handle: "", type: "clipping" }];
  await render("");
  expect(host.querySelector("[data-wizard]")).toBeTruthy();
});
