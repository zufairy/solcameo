// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), mutation: vi.fn(), getProfile: vi.fn(), generateConnectUrl: vi.fn(), assertPublicHttpUrl: vi.fn() }));
vi.mock("@/lib/server/contentControlAuth", () => ({ contentControlAdmin: mocks.auth }));
vi.mock("@/lib/server/downloader", () => ({ assertPublicHttpUrl: mocks.assertPublicHttpUrl }));
vi.mock("@/lib/server/contentPublishing", () => ({ MARKETING_PROFILE: "vello_marketing", compatiblePlatforms: (ids: string[], kind: string) => ids.filter(id => kind !== "text" || id === "x") }));
vi.mock("@/lib/server/uploadPost", () => ({ getProfile: mocks.getProfile, generateConnectUrl: mocks.generateConnectUrl, isConfigured: () => true, resolveUsername: (id: string) => id }));
import { GET, POST } from "./route";
const request = (body: unknown) => new NextRequest("https://velloagents.com/api/admin/content-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ convex: { query: mocks.query, mutation: mocks.mutation }, secret: "secret" });
  mocks.query.mockResolvedValue({ agents: [], posts: [], settings: null });
  mocks.getProfile.mockResolvedValue({ connected: { x: { handle: "@vello" }, instagram: {} }, exists: true });
  mocks.mutation.mockResolvedValue("job");
});
describe("admin Content Control API", () => {
  it("denies non-admin callers before connecting or publishing", async () => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await POST(request({ action: "connect" }))).status).toBe(403);
    expect(mocks.generateConnectUrl).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("requires a connected X account before saving the auto-post destination", async () => {
    mocks.getProfile.mockResolvedValue({ connected: { x: null } });
    const response = await POST(request({ action: "settings" }));
    expect(response.status).toBe(400); expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("saves the auto-post destination once X is connected (auto-posting is always on)", async () => {
    expect((await POST(request({ action: "settings" }))).status).toBe(200);
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authSecret: "secret" }));
  });
  it("connects the dedicated marketing profile using the admin page callback", async () => {
    mocks.generateConnectUrl.mockResolvedValue("https://upload-post.com/connect");
    expect((await POST(request({ action: "connect" }))).status).toBe(200);
    expect(mocks.generateConnectUrl).toHaveBeenCalledWith("vello_marketing", expect.objectContaining({ redirectUrl: "https://velloagents.com/admin/content-control" }));
  });
  it("publishes to actual compatible connections and reports skipped socials", async () => {
    const response = await POST(request({ action: "publish", caption: "hello — world", kind: "text", key: "123e4567-e89b-42d3-a456-426614174000" }));
    expect(await response.json()).toMatchObject({ platforms: ["x"], skipped: ["instagram"] });
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ caption: "hello, world", platforms: ["x"] }));
  });
  it("blocks a missing agent before generating a connect link", async () => {
    mocks.query.mockResolvedValue(null);
    expect((await POST(request({ action: "connect", targetMint: "deleted" }))).status).toBe(404);
    expect(mocks.generateConnectUrl).not.toHaveBeenCalled();
  });
  it("returns history and account options when provider status fails", async () => {
    mocks.getProfile.mockRejectedValue(new Error("provider unavailable"));
    const response = await GET(new NextRequest("https://velloagents.com/api/admin/content-control"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ posts: [], profileError: "provider unavailable" });
  });
});
