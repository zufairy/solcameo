import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchXPostViews, tweetIdFromUrl } from "./xApi";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("X API view counts", () => {
  it("extracts the tweet id from x.com and twitter.com links", () => {
    expect(tweetIdFromUrl("https://x.com/solcameo/status/1844000000000000001?s=20")).toBe("1844000000000000001");
    expect(tweetIdFromUrl("https://twitter.com/a/status/42")).toBe("42");
    expect(tweetIdFromUrl("https://example.com/a/status/42")).toBeUndefined();
  });
  it("reads impression_count from public_metrics with the app bearer token", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "bearer");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "42", public_metrics: { impression_count: 1234, like_count: 5 } } })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchXPostViews("42");
    expect(r).toMatchObject({ ok: true, views: 1234 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.x.com/2/tweets/42");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer bearer");
  });
  it("fails closed without a token or on an API error", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    expect(await fetchXPostViews("42")).toEqual({ ok: false, reason: "x_bearer_not_configured" });
    vi.stubEnv("X_BEARER_TOKEN", "bearer");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    expect(await fetchXPostViews("42")).toEqual({ ok: false, reason: "x_api_429" });
  });
});
