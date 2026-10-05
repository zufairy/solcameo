// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const token = async () => "admin-token";
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ getFreshToken: token }) }));
vi.mock("@/components/admin/content-templates", () => ({ ContentTemplates: () => null }));
import Page from "./page";
let root: Root;
let container: HTMLDivElement;
const base = { agents: [{ mintAddress: "agent1", name: "mila", handle: "@mila", avatarUrl: "https://example.com/a.jpg" }], posts: [], settings: null, configured: true, connected: { x: { handle: "@vello" }, instagram: { handle: "@vello" } } };
let state = base;
let calls: unknown[];
beforeEach(() => {
  calls = []; state = base;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") {
      calls.push(JSON.parse(String(opts.body)));
      return new Response(JSON.stringify({ ok: true, platforms: ["x"], skipped: ["instagram"] }));
    }
    return new Response(JSON.stringify(state));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => { root.render(<Page />); await new Promise(resolve => setTimeout(resolve, 25)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}
function button(text: string) { return [...container.querySelectorAll("button")].find(b => b.textContent?.includes(text))!; }
describe("Content Control page", () => {
  it("shows connected accounts, is always on, and saves the X auto-post destination", async () => {
    await render();
    expect(container.textContent).toContain("x @vello");
    expect(container.textContent).toContain("Always on");
    expect(button("Use this account for auto-posts").disabled).toBe(false);
    await act(async () => button("Use this account for auto-posts").click());
    expect(calls).toContainEqual({ action: "settings", autoAnnounce: true, autoMilestones: true });
  });
  it("prevents saving the destination without an X connection", async () => {
    state = { ...base, connected: { x: null, instagram: { handle: "@vello" } } } as unknown as typeof base;
    await render();
    expect(button("Use this account for auto-posts").disabled).toBe(true);
    expect(button("Publish to 0 socials").disabled).toBe(true);
  });
  it("lets admins choose a minted agent and refreshes its connected accounts", async () => {
    await render();
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "agent1"; select.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 25)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(select.options.length).toBe(2);
    expect(container.textContent).toContain("Selected destination: mila");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("targetMint=agent1"))).toBe(true);
  });
});
