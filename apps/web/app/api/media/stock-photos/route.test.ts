// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

/**
 * The B-Roll drawer's provider chain: Pexels (photos+video) when
 * PEXELS_API_KEY is set, else Openverse (photos only, video = empty +
 * actionable notice — Openverse has no video endpoint at all).
 */
function req(q: string, type?: string): NextRequest {
  const url = new URL("https://x.test/api/media/stock-photos");
  url.searchParams.set("q", q);
  if (type) url.searchParams.set("type", type);
  return new NextRequest(url);
}

describe("GET /api/media/stock-photos", () => {
  const prevPexels = process.env.PEXELS_API_KEY;
  const prevOvId = process.env.OPENVERSE_CLIENT_ID;
  const prevOvSecret = process.env.OPENVERSE_CLIENT_SECRET;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    delete process.env.PEXELS_API_KEY;
    delete process.env.OPENVERSE_CLIENT_ID;
    delete process.env.OPENVERSE_CLIENT_SECRET;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (prevPexels === undefined) delete process.env.PEXELS_API_KEY; else process.env.PEXELS_API_KEY = prevPexels;
    if (prevOvId === undefined) delete process.env.OPENVERSE_CLIENT_ID; else process.env.OPENVERSE_CLIENT_ID = prevOvId;
    if (prevOvSecret === undefined) delete process.env.OPENVERSE_CLIENT_SECRET; else process.env.OPENVERSE_CLIENT_SECRET = prevOvSecret;
  });

  it("requires q", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("video search with NO Pexels key: never calls out to a network provider, returns an empty ok result with an actionable notice (not a hard error)", async () => {
    const res = await GET(req("food", "video"));
    const json = await res.json();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(json).toMatchObject({ ok: true, provider: "none", results: [] });
    expect(json.notice).toMatch(/PEXELS_API_KEY/);
  });

  it("photo search with NO Pexels key falls back to Openverse (anonymous, no token call)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: "1", url: "https://x/a.jpg", thumbnail: "https://x/a-thumb.jpg", title: "A" }] }), { status: 200 }));
    const res = await GET(req("food", "photo"));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("openverse");
    expect(json.results).toHaveLength(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("api.openverse.org");
    expect(calledUrl).not.toContain("auth_tokens"); // no OAuth creds set -> straight to search, no token round-trip
  });

  it("photo search WITH a Pexels key routes to Pexels instead of Openverse", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      photos: [{ id: 1, src: { large: "https://p/large.jpg", medium: "https://p/med.jpg" }, alt: "Food" }],
    }), { status: 200 }));
    const res = await GET(req("food", "photo"));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("pexels");
    expect(json.results).toEqual([{ id: "pexels-photo-1", url: "https://p/large.jpg", thumbnail: "https://p/med.jpg", title: "Food", kind: "photo" }]);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain("api.pexels.com/v1/search");
    expect((init as RequestInit)?.headers).toMatchObject({ Authorization: "test-key" });
  });

  it("video search WITH a Pexels key hits the videos endpoint and picks the sd-quality file", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      videos: [{
        id: 42,
        image: "https://p/thumb.jpg",
        video_files: [
          { link: "https://p/hd.mp4", quality: "hd", width: 1920 },
          { link: "https://p/sd.mp4", quality: "sd", width: 640 },
        ],
      }],
    }), { status: 200 }));
    const res = await GET(req("food", "video"));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("pexels");
    expect(json.results).toEqual([{ id: "pexels-video-42", url: "https://p/sd.mp4", thumbnail: "https://p/thumb.jpg", title: "food", kind: "video" }]);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("api.pexels.com/videos/search");
  });

  it("video search WITH a Pexels key falls back to the narrowest file when no 'sd' quality exists", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      videos: [{
        id: 7,
        image: "https://p/thumb.jpg",
        video_files: [
          { link: "https://p/4k.mp4", quality: "hd", width: 3840 },
          { link: "https://p/720.mp4", quality: "hd", width: 1280 },
        ],
      }],
    }), { status: 200 }));
    const res = await GET(req("food", "video"));
    const json = await res.json();
    expect(json.results[0].url).toBe("https://p/720.mp4"); // narrowest of the two
  });

  it("a Pexels non-2xx response surfaces as a clean 502, not a crash", async () => {
    process.env.PEXELS_API_KEY = "test-key";
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 429 }));
    const res = await GET(req("food", "photo"));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/429/);
  });

  it("photo search with Openverse OAuth creds set fetches a token first, then authenticates the search", async () => {
    process.env.OPENVERSE_CLIENT_ID = "cid";
    process.env.OPENVERSE_CLIENT_SECRET = "csecret";
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok123", expires_in: 43200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    await GET(req("food", "photo"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("auth_tokens/token");
    const [searchUrl, searchInit] = fetchSpy.mock.calls[1];
    expect(String(searchUrl)).toContain("api.openverse.org");
    expect((searchInit as RequestInit)?.headers).toMatchObject({ Authorization: "Bearer tok123" });
  });
});
