import references from "@/lib/explore/references.json";
import short from "@/lib/explore/short-references.json";
import { FEED, normalizeFeed } from "@/lib/explore/feed";
import { findInLibrary } from "@/lib/explore/library";

export interface ServerReference { id: string; title: string; videoUrl: string; thumbUrl?: string; duration: number; category: string }
let byId: Map<string, ServerReference> | null = null;
const PAGE = 48;

function table() {
  if (!byId) {
    byId = new Map();
    for (const list of [references.items, short.items] as ServerReference[][]) for (const r of list) if (r.id && r.videoUrl && !byId.has(r.id)) byId.set(r.id, r);
  }
  return byId;
}

/** Trusted reference data from the bundled indexes. Price and the source video come from here, never from the client. */
export function getReference(id: string): ServerReference | null {
  return table().get(id) ?? null;
}

async function feedPage(cursor: number): Promise<ServerReference[]> {
  try {
    const res = await fetch(`${FEED}?lang=en&source=community&size=${PAGE}&cursor=${cursor}&sort=trending`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(12000) });
    return res.ok ? normalizeFeed(await res.json()).items : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a reference the user picked in Explore. The bundled indexes cover most of the library; anything the page
 * loaded live from the feed (and so isn't bundled) is found in the feed itself, around the page the client says it
 * came from. The video URL and duration (so the price) always come from our side, never from the client.
 */
export async function resolveReference(id: string, pageHint?: unknown): Promise<ServerReference | null> {
  const known = getReference(id);
  if (known) return known;
  // The indexed library covers the whole feed, so a reference the page loaded is found by id without touching the feed.
  const indexed = await findInLibrary(id).catch(() => null);
  if (indexed) { table().set(indexed.id, indexed); return indexed; }
  const hint = Number(pageHint);
  if (!Number.isInteger(hint) || hint < 1 || hint > 10000) return null;
  for (const group of [[hint], [hint - 1, hint + 1], [hint - 2, hint + 2, hint + 3]]) {
    const pages = await Promise.all(group.filter((p) => p >= 1).map(feedPage));
    for (const items of pages) {
      const hit = items.find((i) => i.id === id);
      if (hit) { table().set(hit.id, hit); return hit; }
    }
  }
  return null;
}
