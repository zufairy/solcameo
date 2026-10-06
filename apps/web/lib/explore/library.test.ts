// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ stored: null as string | null, put: vi.fn(), calls: [] as number[] }));
vi.mock("@/lib/server/imageStorage", () => ({
  r2ImageConfigured: () => true,
  getObjectText: async () => h.stored,
  putImage: async (buf: Buffer, _type: string, opts: { key: string }) => { h.put(opts.key); h.stored = buf.toString(); },
}));
import { PAGE, getLibrary, queryLibrary, rebuildLibrary, resetLibraryForTests, findInLibrary } from "./library";

/** A fake upstream of 6 pages x 48 clips. Index divisible by 7 = "Dance battle", divisible by 40 = 4.5s, else 12s. */
const PAGES = 6;
const feed = (cursor: number, dropFrom = Infinity) => ({
  total: PAGES * PAGE,
  cursor: cursor + 1,
  items: cursor >= dropFrom ? [] : Array.from({ length: PAGE }, (_, i) => {
    const n = (cursor - 1) * PAGE + i;
    return { id: `clip-${n}`, title: n % 7 === 0 ? "Dance battle" : "Studio shot", description: "x".repeat(400), original_video: { url: `https://cdn.example/${n}.mp4`, duration: n % 40 === 0 ? 4.5 : 12, width: 720, height: 1280, media_type: "video_input" } };
  }),
});
const stubFeed = (dropFrom = Infinity) => vi.stubGlobal("fetch", async (url: string) => {
  const cursor = Number(new URL(url).searchParams.get("cursor"));
  h.calls.push(cursor);
  return new Response(JSON.stringify(feed(cursor, dropFrom)));
});

beforeEach(() => { resetLibraryForTests(); h.stored = null; h.calls = []; h.put.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("rebuildLibrary", () => {
  it("scrapes every feed page once, keeps trending order, trims descriptions and writes one R2 snapshot", async () => {
    stubFeed();
    const snapshot = (await rebuildLibrary())!;
    expect(snapshot.items).toHaveLength(PAGES * PAGE);
    expect([...new Set(h.calls)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snapshot.items[0].id).toBe("clip-0");
    expect(snapshot.items.at(-1)!.id).toBe(`clip-${PAGES * PAGE - 1}`);
    expect(snapshot.items.every((i) => i.description.length <= 260)).toBe(true);
    expect(snapshot.items[50].page).toBe(2);
    expect(h.put).toHaveBeenCalledWith("explore/library/v1.json");
  });
  it("runs once for concurrent callers", async () => {
    stubFeed();
    await Promise.all([rebuildLibrary(), rebuildLibrary(), rebuildLibrary()]);
    expect(h.calls.filter((c) => c === 1)).toHaveLength(1);
  });
  it("never replaces a good snapshot with a scrape that lost most of its pages", async () => {
    stubFeed(3); // pages 3+ come back empty
    expect(await rebuildLibrary()).toBeNull();
    expect(h.put).not.toHaveBeenCalled();
  });
});

describe("getLibrary", () => {
  it("serves the bundled index immediately while the first snapshot builds, then the snapshot", async () => {
    stubFeed();
    const first = await getLibrary();
    expect(first.seed).toBe(true);
    await rebuildLibrary();
    const second = await getLibrary();
    expect(second.seed).toBe(false);
    expect(second.items).toHaveLength(PAGES * PAGE);
  });
  it("loads the stored snapshot after a restart without scraping", async () => {
    stubFeed();
    await rebuildLibrary();
    resetLibraryForTests();
    h.calls = [];
    const lib = await getLibrary();
    expect(lib.seed).toBe(false);
    expect(lib.items).toHaveLength(PAGES * PAGE);
    expect(h.calls).toEqual([]);
  });
  it("finds a reference by id from the index", async () => {
    stubFeed();
    await rebuildLibrary();
    expect((await findInLibrary("clip-100"))?.videoUrl).toBe("https://cdn.example/100.mp4");
    expect(await findInLibrary("nope")).toBeNull();
  });
});

describe("queryLibrary", () => {
  it("filters by text, category and length across the whole library, and pages without repeats", async () => {
    stubFeed();
    await rebuildLibrary();
    const lib = await getLibrary();
    const dance = queryLibrary(lib, { q: "dance" });
    expect(dance.total).toBe(Math.ceil((PAGES * PAGE) / 7));
    expect(dance.items.every((i) => i.title === "Dance battle")).toBe(true);
    const short = queryLibrary(lib, { max: 5 });
    expect(short.items.every((i) => i.duration < 5)).toBe(true);
    expect(short.total).toBe(Math.ceil((PAGES * PAGE) / 40));
    // paging: 48 per request, `next` is the 1-based position to continue from, last page ends with null
    const p1 = queryLibrary(lib, { cursor: 1 });
    expect(p1.items).toHaveLength(PAGE);
    expect(p1.next).toBe(PAGE + 1);
    const p2 = queryLibrary(lib, { cursor: p1.next! });
    expect(p2.items[0].id).toBe(`clip-${PAGE}`);
    const last = queryLibrary(lib, { cursor: (PAGES - 1) * PAGE + 1 });
    expect(last.items).toHaveLength(PAGE);
    expect(last.next).toBeNull();
    expect(queryLibrary(lib, { q: "no such thing" })).toMatchObject({ items: [], next: null, total: 0 });
  });
});
