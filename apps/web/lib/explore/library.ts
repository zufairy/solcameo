import references from "@/lib/explore/references.json";
import short from "@/lib/explore/short-references.json";
import { FEED, normalizeFeed, type ReferenceVideo } from "@/lib/explore/feed";
import { getObjectText, putImage, r2ImageConfigured } from "@/lib/server/imageStorage";

/**
 * The Explore reference library, indexed ahead of time.
 *
 * Filtering used to walk the upstream feed live (up to a dozen requests per search). Instead the WHOLE feed is
 * scraped in the background, trimmed to what the page needs, written to R2 as one snapshot and held in memory. Every
 * search, category and length filter is then a local scan of a few thousand rows, so it answers in milliseconds and
 * the client can page through the entire library. A snapshot is reused across restarts and refreshed by a cron.
 */
export const PAGE = 48;
const SNAPSHOT_KEY = "explore/library/v1.json";
const MEMORY_FRESH_MS = 20 * 60_000; // re-check R2 for a newer snapshot this often
const REBUILD_AFTER_MS = 6 * 3_600_000; // a snapshot older than this triggers a background rebuild
const MAX_PAGES = 400;
const CONCURRENCY = 6;

interface Snapshot { builtAt: number; total: number; items: ReferenceVideo[] }
export interface Library extends Snapshot { hay: string[]; seed: boolean }

let memory: Library | null = null;
let checkedAt = 0;
let loading: Promise<Library> | null = null;
let rebuilding: Promise<Snapshot | null> | null = null;

const hayOf = (i: ReferenceVideo) => `${i.title} ${i.description} ${i.sourceName ?? ""}`.toLowerCase();
const index = (s: Snapshot, seed = false): Library => ({ ...s, seed, hay: s.items.map(hayOf) });

/** What ships in the bundle: shown instantly, and the fallback while the first snapshot is still being built. */
function seedSnapshot(): Snapshot {
  const seen = new Set<string>();
  const items: ReferenceVideo[] = [];
  for (const list of [references.items, short.items] as ReferenceVideo[][]) {
    for (const item of list) if (item.id && !seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }
  return { builtAt: 0, total: references.total, items };
}

async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const text = await Promise.race([getObjectText(SNAPSHOT_KEY), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    if (!text) return null;
    const data = JSON.parse(text) as Snapshot;
    return Array.isArray(data.items) && data.items.length > 0 ? data : null;
  } catch { return null; }
}

async function fetchPage(cursor: number): Promise<{ items: ReferenceVideo[]; total: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${FEED}?lang=en&source=community&size=${PAGE}&cursor=${cursor}&sort=trending`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const feed = normalizeFeed(await res.json());
      return { items: feed.items, total: feed.total };
    } catch { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); }
  }
  return null;
}

/**
 * Scrape the whole upstream feed (a few hundred small pages, six at a time), keep it in trending order, drop the
 * duplicates, and publish it to R2 and memory. Safe to call any time: concurrent calls share one run.
 */
export function rebuildLibrary(): Promise<Snapshot | null> {
  rebuilding ??= (async () => {
    const first = await fetchPage(1);
    if (!first) return null;
    const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(first.total / PAGE)));
    const byPage = new Map<number, ReferenceVideo[]>([[1, first.items]]);
    let next = 2;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const cursor = next++;
        if (cursor > pages) return;
        const page = await fetchPage(cursor);
        if (page) byPage.set(cursor, page.items);
      }
    }));
    const seen = new Set<string>();
    const items: ReferenceVideo[] = [];
    for (const cursor of [...byPage.keys()].sort((a, b) => a - b)) {
      for (const item of byPage.get(cursor)!) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push({ ...item, description: item.description.slice(0, 260), page: cursor });
      }
    }
    // A scrape that lost most of its pages must never replace a good snapshot.
    if (byPage.size < pages * 0.8 || items.length < 100) return null;
    const snapshot: Snapshot = { builtAt: Date.now(), total: first.total, items };
    if (r2ImageConfigured()) {
      try { await putImage(Buffer.from(JSON.stringify(snapshot)), "application/json", { key: SNAPSHOT_KEY }); } catch { /* memory still serves it */ }
    }
    memory = index(snapshot);
    checkedAt = Date.now();
    return snapshot;
  })().finally(() => { rebuilding = null; });
  return rebuilding;
}

/** Library for the current request: memory, else the R2 snapshot, else the bundle (while a rebuild runs behind it). */
export async function getLibrary(): Promise<Library> {
  const now = Date.now();
  if (memory && now - checkedAt < MEMORY_FRESH_MS) return memory;
  loading ??= (async () => {
    const snapshot = await readSnapshot();
    if (snapshot && (!memory || snapshot.builtAt >= memory.builtAt)) memory = index(snapshot);
    memory ??= index(seedSnapshot(), true);
    checkedAt = Date.now();
    if (memory.seed || Date.now() - memory.builtAt > REBUILD_AFTER_MS) void rebuildLibrary().catch(() => undefined);
    return memory;
  })().finally(() => { loading = null; });
  return memory ?? loading;
}

export interface LibraryQuery { q?: string; category?: string; min?: number; max?: number; cursor?: number; limit?: number }

/** One page of matches. `cursor` is 1-based: the position in the filtered list to start from. */
export function queryLibrary(lib: Library, { q = "", category = "All", min = 0, max = 0, cursor = 1, limit = PAGE }: LibraryQuery) {
  const needle = q.trim().toLowerCase();
  const matches: ReferenceVideo[] = [];
  for (let i = 0; i < lib.items.length; i++) {
    const item = lib.items[i];
    if (category !== "All" && item.category !== category) continue;
    if (min && item.duration < min) continue;
    if (max && item.duration >= max) continue;
    if (needle && !lib.hay[i].includes(needle)) continue;
    matches.push(item);
  }
  const offset = Math.max(0, cursor - 1);
  const items = matches.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, next: end < matches.length ? end + 1 : null, total: matches.length, libraryTotal: lib.items.length, building: lib.seed, builtAt: lib.builtAt };
}

/** Find a reference by id, for pricing and generation. */
export async function findInLibrary(id: string): Promise<ReferenceVideo | null> {
  const lib = await getLibrary();
  return lib.items.find((i) => i.id === id) ?? null;
}

/** Test seam. */
export function resetLibraryForTests() { memory = null; checkedAt = 0; loading = null; rebuilding = null; }
