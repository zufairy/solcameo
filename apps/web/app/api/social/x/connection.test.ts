// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const h = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), query: vi.fn(), token: vi.fn(), save: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: h.auth, requireOwnerWithSiws: h.owner }));
vi.mock("@/lib/server/xApi", async (original) => ({
  ...await original<typeof import("@/lib/server/xApi")>(),
  xConfigured: h.configured,
  xDb: () => ({ query: h.query }),
  xToken: h.token,
  saveX: h.save,
}));
vi.mock("@/lib/server/uploadPost", () => ({ resolveUsername: (mint: string) => `agent_${mint}` }));
import { POST } from "./connect/route";
import { GET } from "./callback/route";
import { unseal } from "@/lib/server/xApi";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("X_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("X_CLIENT_ID", "client");
  vi.stubEnv("X_REDIRECT_URI", "https://solcameo.com/api/social/x/callback");
  h.configured.mockReturnValue(true);
  h.auth.mockResolvedValue({ internal: false, wallet: "owner" });
  h.owner.mockReturnValue(null);
  h.query.mockResolvedValue({ creatorWallet: "owner" });
  h.token.mockResolvedValue({ access_token: "access", refresh_token: "refresh", expires_in: 7200, scope: "tweet.write offline.access" });
  h.save.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "42", username: "creator", name: "Creator Name", profile_image_url: "https://pbs.twimg.com/avatar.jpg" } }))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function start(extra: Record<string, unknown> = {}) {
  return POST(new NextRequest("https://solcameo.com/api/social/x/connect", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "mint-A", allowAutomatedPosting: true, redirectUrl: "https://solcameo.com/control?agent=mint-A", ...extra }),
  }));
}
async function callback(started: Response, params: Record<string, string> = {}) {
  const cookie = started.headers.get("set-cookie")!.split(";")[0];
  const session = unseal<{ state: string }>(cookie.slice("x_oauth=".length));
  const url = new URL("https://solcameo.com/api/social/x/callback");
  url.search = new URLSearchParams({ code: "code", state: session.state, ...params }).toString();
  return GET(new NextRequest(url, { headers: { cookie } }));
}
describe("agent X binding", () => {
  it("starts PKCE authorization and saves account identity before returning to the same chat", async () => {
    const res = await start();
    const auth = new URL((await res.json()).url);
    expect(auth.hostname).toBe("x.com");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("scope")).toContain("tweet.write");
    expect(auth.searchParams.get("scope")).toContain("offline.access");
    expect(h.owner).toHaveBeenCalled();
    const returned = await callback(res);
    expect(returned.headers.get("location")).toBe("https://solcameo.com/control?agent=mint-A&x_connect=ok");
    expect(h.save).toHaveBeenCalledWith("agent_mint-A", expect.objectContaining({ id: "42", handle: "creator", displayName: "Creator Name", image: "https://pbs.twimg.com/avatar.jpg", automatedPostingConsentAt: expect.any(Number) }));
    expect(returned.headers.get("set-cookie")).toContain("x_oauth=");
  });
  it("requires explicit automated posting consent", async () => {
    expect((await start({ allowAutomatedPosting: false })).status).toBe(400);
    expect(h.query).not.toHaveBeenCalled();
  });
  it("denies a different owner before issuing an OAuth session", async () => {
    h.owner.mockReturnValue(NextResponse.json({ error: "Not owner" }, { status: 403 }));
    const res = await start();
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("does not save accounts on cancellation or state mismatch", async () => {
    for (const params of [{ error: "access_denied" }, { state: "invalid" }] as Record<string, string>[]) {
      const returned = await callback(await start(), params);
      expect(returned.headers.get("location")).toContain("x_connect=error");
    }
    expect(h.save).not.toHaveBeenCalled();
    expect(h.token).not.toHaveBeenCalled();
  });
  it("rejects ownership changes during authorization", async () => {
    const started = await start();
    h.query.mockResolvedValue({ creatorWallet: "other-owner" });
    expect((await callback(started)).headers.get("location")).toContain("x_connect=error");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("requires posting permission and a refresh token", async () => {
    h.token.mockResolvedValue({ access_token: "access", scope: "tweet.read" });
    expect((await callback(await start())).headers.get("location")).toContain("x_connect=error");
    expect(h.save).not.toHaveBeenCalled();
  });
});
