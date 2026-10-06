// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

/** A fake feed of 20 pages x 48 clips. A clip is "short" (4.5s) when its index is divisible by 40, else 12s. */
function fakeFeed(cursor: number) {
  const items = Array.from({ length: 48 }, (_, i) => {
    const n = (cursor - 1) * 48 + i;
    return {
      id: `clip-${n}`,
      title: n % 7 === 0 ? "Dance battle" : "Studio shot",
      description: "",
      original_video: { url: `https://example.com/${n}.mp4`, duration: n % 40 === 0 ? 4.5 : 12, width: 720, height: 1280, media_type: "video_input" },
    };
  });
  return { total: 20 * 48, cursor: cursor + 1, items };
}

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/explore", () => {
  it("returns one plain page when nothing is filtered", async () => {
    const seen: number[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const cursor = Number(new URL(url).searchParams.get("cursor"));
      seen.push(cursor);
      return new Response(JSON.stringify(fakeFeed(cursor)));
    });
    const res = await GET(new NextRequest("http://x/api/explore?cursor=3"));
    const data = await res.json();
    expect(seen).toEqual([3]);
    expect(data.items).toHaveLength(48);
  });

  it("keeps scanning pages for a sparse filter and hands back the cursor to continue from", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const cursor = Number(new URL(url).searchParams.get("cursor"));
      return new Response(JSON.stringify(fakeFeed(cursor)));
    });
    const res = await GET(new NextRequest("http://x/api/explore?cursor=1&max=5"));
    const data = await res.json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((i: { duration: number }) => i.duration < 5)).toBe(true);
    expect(data.scanned).toBeGreaterThan(1);
    expect(data.next).toBeGreaterThan(1);
    // Continuing from `next` finds different clips, so scrolling never repeats.
    const more = await (await GET(new NextRequest(`http://x/api/explore?cursor=${data.next}&max=5`))).json();
    const ids = new Set(data.items.map((i: { id: string }) => i.id));
    expect(more.items.every((i: { id: string }) => !ids.has(i.id))).toBe(true);
  });

  it("filters by search term and category, and rejects bad input", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(fakeFeed(Number(new URL(url).searchParams.get("cursor"))))));
    const data = await (await GET(new NextRequest("http://x/api/explore?cursor=1&q=dance"))).json();
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((i: { title: string }) => /dance/i.test(i.title))).toBe(true);
    expect((await GET(new NextRequest("http://x/api/explore?cursor=0"))).status).toBe(400);
    expect((await GET(new NextRequest("http://x/api/explore?category=Nope"))).status).toBe(400);
  });

  it("reports the end of the library as next: null", async () => {
    vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(fakeFeed(Number(new URL(url).searchParams.get("cursor"))))));
    const data = await (await GET(new NextRequest("http://x/api/explore?cursor=19&q=zzz-nothing"))).json();
    expect(data.items).toHaveLength(0);
    expect(data.next).toBeNull();
  });
});
