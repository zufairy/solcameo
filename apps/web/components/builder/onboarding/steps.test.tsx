// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyDraft, draftFromBible, draftToBible } from "@/lib/builder/onboardingDraft";
import { normalizeShowBible } from "@/lib/builder/showBible";
const data = vi.hoisted(() => ({
  agent: { avatarUrl: "https://images.test/portrait.webp", avatarStills: [] as string[] },
  draft: { avatarUrls: ["https://images.test/generated.webp"], referencePhotoUrls: [] as string[] },
}));
vi.mock("convex/react", () => ({ useQuery: (query: string) => query === "agent" ? data.agent : data.draft }));
vi.mock("@/convex/_generated/api", () => ({ api: { influencers: { getByMint: "agent" }, nftAgents: { getDraftByMint: "draft" } } }));
vi.mock("./MotionReferencePicker", () => ({ MotionReferencePicker: () => null }));
import { StepModel } from "./steps";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("shows draft generations and selects the generated influencer portrait by default", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(<StepModel draft={emptyDraft()} onChange={onChange} mintAddress="mint" />));
  expect(Array.from(host.querySelectorAll("img")).map(img => img.src)).toContain("https://images.test/generated.webp");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ identityImageUrl: data.agent.avatarUrl, identityImageKind: "ai-sheet" }));
});
it("restores a saved selected AI image even when it is absent from the avatar gallery", async () => {
  const url = "https://images.test/saved.webp";
  const bible = normalizeShowBible(draftToBible({ ...emptyDraft(), premise: "My show", formats: ["founder-talk"], identityImageUrl: url, identityImageKind: "ai-sheet" }));
  const onChange = vi.fn();
  await act(async () => root.render(<StepModel draft={draftFromBible(bible)} onChange={onChange} mintAddress="mint" />));
  const image = Array.from(host.querySelectorAll("img")).find(img => img.src === url);
  expect(image).toBeDefined();
  expect(image?.closest("button")?.getAttribute("aria-pressed")).toBe("true");
  expect(onChange).not.toHaveBeenCalled();
});
