// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true, loading: false, pending: false, mint: "", error: undefined as string | undefined,
  quota: { agents: [{ mintAddress: "mine", name: "My clipper" }], agentCount: 1, agentLimit: 1, canCreate: false },
}));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ ...state, login: vi.fn() }) }));
vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/hooks/use-agent-quota", () => ({ useAgentQuota: () => ({ ...state, refresh: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.mint ? { mint: state.mint } : {}) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) }));
import { AgentCreationGate } from "./agent-creation-gate";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(state, { authenticated: true, loading: false, pending: false, mint: "", error: undefined });
  state.quota = { agents: [{ mintAddress: "mine", name: "My clipper" }], agentCount: 1, agentLimit: 1, canCreate: false };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<AgentCreationGate allowResume><div data-builder>builder</div></AgentCreationGate>));
}
it("blocks new creation at one free agent and links to owned agents", async () => {
  await render();
  expect(host.querySelector("[data-builder]")).toBeNull();
  expect(host.textContent).toContain("Agent limit reached");
  expect(host.querySelector('a[href="/builder?mint=mine"]')).not.toBeNull();
});
it("also blocks legacy free users with more than one agent", async () => {
  state.quota.agentCount = 4; await render();
  expect(host.querySelector("[data-builder]")).toBeNull();
  expect(host.textContent).toContain("4 of 1");
});
it("opens an owned existing agent at the limit", async () => {
  state.mint = "mine"; await render(); expect(host.querySelector("[data-builder]")).not.toBeNull();
});
it("does not open somebody else's or a deleted agent", async () => {
  state.mint = "not-mine"; await render();
  expect(host.querySelector("[data-builder]")).toBeNull(); expect(host.textContent).toContain("Agent unavailable");
});
it("does not mount builder tools while quota loads or when its request fails", async () => {
  state.pending = true; await render(); expect(host.querySelector("[data-builder]")).toBeNull();
  state.pending = false; state.error = "Network error"; await render();
  expect(host.querySelector("[data-builder]")).toBeNull(); expect(host.textContent).toContain("Retry");
});
it("opens new creation after a slot is freed", async () => {
  state.quota.agentCount = 0; state.quota.canCreate = true; await render(); expect(host.querySelector("[data-builder]")).not.toBeNull();
});
