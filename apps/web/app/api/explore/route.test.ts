// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const items = vi.hoisted(() => Array.from({ length: 130 }, (_, i) => ({
  id: `clip-${i}`, title: i % 7 === 0 ? "Dance battle" : "Studio shot", description: "", videoUrl: `https://x/${i}.mp4`, previewUrl: `https://x/${i}.mp4`,
  duration: i % 40 === 0 ? 4.5 : 12, category: i % 7 === 0 ? "Dance" : "Other",
})));
vi.mock("@/lib/explore/library", async () => {
  const real = await vi.importActual<typeof import("@/lib/explore/library")>("@/lib/explore/library");
  const lib = { builtAt: Date.now(), total: items.length, items, hay: items.map((i) => `${i.title} ${i.description}`.toLowerCase()), seed: false };
  return { ...real, getLibrary: async () => lib };
});
import { GET } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://x/api/explore?${qs}`));

describe("GET /api/explore", () => {
  it("returns a page of the indexed library without any upstream request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const data = await (await get("cursor=1")).json();
    expect(data.items).toHaveLength(48);
    expect(data.next).toBe(49);
    expect(data.total).toBe(130);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("filters by search, category and length over the whole library and continues without repeats", async () => {
    const dance = await (await get("cursor=1&q=dance")).json();
    expect(dance.items.every((i: { title: string }) => i.title === "Dance battle")).toBe(true);
    expect(dance.total).toBe(19);
    const byCategory = await (await get("cursor=1&category=Dance")).json();
    expect(byCategory.total).toBe(19);
    const short = await (await get("cursor=1&max=5")).json();
    expect(short.items.every((i: { duration: number }) => i.duration < 5)).toBe(true);
    const p1 = await (await get("cursor=1")).json();
    const p2 = await (await get(`cursor=${p1.next}`)).json();
    const seen = new Set(p1.items.map((i: { id: string }) => i.id));
    expect(p2.items.every((i: { id: string }) => !seen.has(i.id))).toBe(true);
  });
  it("rejects bad input", async () => {
    expect((await get("cursor=0")).status).toBe(400);
    expect((await get("cursor=1&category=Nope")).status).toBe(400);
    expect((await get("cursor=1&min=-1")).status).toBe(400);
  });
});
