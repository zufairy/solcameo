// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getFreshToken: vi.fn(async () => "user-token") }));
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => auth }));
import { ConnectInfluencerX } from "./ConnectInfluencerX";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(connected: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, connected })));
  vi.stubGlobal("fetch", fetchMock);
  const node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  await act(async () => root.render(<ConnectInfluencerX mint="mint-A" name="Zed" />));
  return fetchMock;
}
describe("Connect Influencer X", () => {
  it("shows the bound account image and name from authenticated status", async () => {
    const fetchMock = await mount({ x: { handle: "zed", displayName: "Zed Creator", image: "https://pbs.twimg.com/zed.jpg" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/social/status?username=mint-A", expect.objectContaining({ headers: { Authorization: "Bearer user-token" } }));
    expect(document.body.textContent).toContain("X binded:");
    expect(document.body.textContent).toContain("Zed Creator");
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://pbs.twimg.com/zed.jpg");
    expect(document.body.textContent).not.toContain("Bind x Account");
  });
  it("explains automated posting before starting agent-scoped OAuth", async () => {
    const fetchMock = await mount({});
    expect(document.body.textContent).toContain("Bind x Account");
    await act(async () => (document.querySelector("button") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("publish posts automatically");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "X is not configured" }), { status: 503 }));
    const authorize = [...document.querySelectorAll("button")].find(button => button.textContent === "Authorize on X")!;
    await act(async () => authorize.click());
    const [url, options] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/social/x/connect");
    expect(JSON.parse(options.body as string)).toMatchObject({ username: "mint-A", allowAutomatedPosting: true });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("X is not configured");
  });
  it("refreshes the binding when returning to the chat", async () => {
    const fetchMock = await mount({});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, connected: { x: { handle: "newaccount" } } })));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(document.body.textContent).toContain("X binded:");
    expect(document.body.textContent).toContain("@newaccount");
  });
  it("supports the twitter alias and reconnecting a bound account", async () => {
    await mount({ twitter: { displayName: "Legacy Account" } });
    await act(async () => (document.querySelector("button") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Change bound X account");
  });

  it("opens X authorization with a return URL for the selected agent", async () => {
    const fetchMock = await mount({});
    const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: "https://x.com/i/oauth2/authorize?state=verified" })));
    await act(async () => (document.querySelector("button") as HTMLButtonElement).click());
    const authorize = [...document.querySelectorAll("button")].find(button => button.textContent === "Authorize on X")!;
    await act(async () => authorize.click());
    expect(navigate).toHaveBeenCalledWith("https://x.com/i/oauth2/authorize?state=verified");
    const [, options] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(new URL(JSON.parse(options.body as string).redirectUrl).searchParams.get("agent")).toBe("mint-A");
  });

});
