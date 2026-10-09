// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("./downloader", () => ({ safeFetchToBuffer: vi.fn(async () => ({ buffer: new Uint8Array([1]) })) }));
vi.mock("sharp", () => ({ default: () => { const chain = { rotate: () => chain, resize: () => chain, flatten: () => chain, jpeg: () => chain, toBuffer: async () => new Uint8Array([1, 2, 3]) }; return chain; } }));
const x = vi.hoisted(() => ({ configured: vi.fn(), read: vi.fn(), post: vi.fn() }));
vi.mock("./xApi", () => ({ xConfigured: x.configured, readX: x.read, postX: x.post }));
import { contentResult, publishContent, retryContent, publishRouted } from "./contentPublishing";
import { compatiblePlatforms } from "../contentPlatforms";
import { agentLaunchCaption } from "../marketingCaption";
afterEach(() => vi.unstubAllGlobals());
describe("marketing publishing", () => {
  it("creates bounded human launch captions without em dashes or markdown", () => {
    const caption = agentLaunchCaption({ name: "mila", handle: "@mila", description: "turns podcasts — into **clips**", niche: "content" });
    expect(caption).toContain("mila"); expect(caption).toContain("podcasts"); expect(caption).not.toMatch(/[—–*]/); expect(caption.length).toBeLessThanOrEqual(275);
    expect(agentLaunchCaption({ name: "n".repeat(100), handle: "h".repeat(100), description: "d".repeat(300), niche: "" }).length).toBeLessThanOrEqual(275);
  });
  it("excludes incompatible socials and duplicate targets", () => {
    expect(compatiblePlatforms(["x", "instagram", "youtube", "x"], "text")).toEqual(["x"]);
    expect(compatiblePlatforms(["x", "instagram", "youtube"], "photo")).toEqual(["x", "instagram"]);
    expect(compatiblePlatforms(["x", "instagram", "youtube"], "video")).toEqual(["x", "instagram", "youtube"]);
  });
  it("does not mistake acceptance for a published post", () => {
    expect(contentResult({ success: true, request_id: "r" }, ["x"]).status).toBe("submitted");
    expect(contentResult({ success: true }, ["x"]).status).toBe("failed");
    expect(contentResult({ status: "processing", request_id: "r", results: [{ platform: "instagram", success: true }] }, ["x", "instagram"]).status).toBe("submitted");
  });
  it("handles array results, X aliases and HTTP-200 failures", () => {
    expect(contentResult({ status: "completed", results: [{ platform: "x", success: false, error: "expired OAuth" }] }, ["x"]).status).toBe("failed");
    expect(contentResult({ results: { twitter: { platform_post_id: "123" } } }, ["x"]).status).toBe("posted");
    expect(contentResult({ status: "completed", results: { x: { skipped: true } } }, ["x"]).status).toBe("failed");
    expect(contentResult({ status: "completed", results: { x: { fallback_to_inbox: true } } }, ["x"]).status).toBe("failed");
  });
  it("sends X caption, real JPEG media and provider idempotency", async () => {
    process.env.UPLOAD_POST_API_KEY = "test";
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ success: true, request_id: "r" })));
    vi.stubGlobal("fetch", fetcher);
    await publishContent({ _id: "job", kind: "photo", mediaUrl: "https://example.com/avatar.svg", caption: "meet mila — your clipping agent", platforms: ["x"] }, "vello_marketing");
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("upload_photos");
    const form = options.body as FormData;
    expect(form.getAll("platform[]")).toEqual(["x"]);
    expect(form.get("x_title")).toBe("meet mila, your clipping agent");
    expect((form.get("photos[]") as File).type).toBe("image/jpeg");
    expect(form.get("async_upload")).toBe("true");
    expect((options.headers as Record<string, string>)["Idempotency-Key"]).toBe("vello-content-job");
  });
  it("polls a known request ID after a lost response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const result = await publishContent({ _id: "job", kind: "text", caption: "hello", platforms: ["x"] }, "vello_marketing");
    expect(result).toMatchObject({ status: "submitted", requestId: "vello-content-job" });
  });
  it("retries through the provider without reuploading successful targets", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetcher);
    expect(await retryContent("r")).toMatchObject({ status: "submitted", requestId: "r" });
    expect(fetcher.mock.calls[0][0]).toContain("posts/retry");
  });
});


describe("Content Control direct X routing", () => {
  it("publishes X-only content with no Upload-Post key or API request", async () => {
    vi.stubEnv("UPLOAD_POST_API_KEY", "");
    x.configured.mockReturnValue(true); x.read.mockResolvedValue({ id: "account" });
    x.post.mockResolvedValue({ ok: true, data: { results: { x: { url: "https://x.com/account/status/42" } } }, postIds: { x: "42" } });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await publishRouted({ _id: "event", caption: "New $ALG video", kind: "text", platforms: ["x"] }, "vello_marketing")).status).toBe("posted");
    expect(x.post).toHaveBeenCalledWith("vello_marketing", "New $ALG video", [], false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("does not fall back to Upload-Post when the direct connection is missing", async () => {
    x.configured.mockReturnValue(true); x.read.mockResolvedValue(null);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const result = await publishRouted({ _id: "event", caption: "New coin", kind: "text", platforms: ["x"] }, "vello_marketing");
    expect(result.status).toBe("failed"); expect(result.error).toContain("Reconnect X");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
