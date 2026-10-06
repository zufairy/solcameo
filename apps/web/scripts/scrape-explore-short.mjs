/**
 * Index the SHORT references in Higgsfield's public community feed: clips of 4 to 6 seconds, the quickest and
 * cheapest to replicate with Genjutsu (4s is its minimum). Reads public feed metadata only, keeps the feed's own
 * trending order so the most popular come first, and verifies each original is playable. Never downloads video.
 * EXPLORE_SHORT_PAGES controls depth (default 320 pages of 48 covers the whole feed).
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeFeed, FEED } from "../lib/explore/feed.ts";

const pages = Math.min(400, Math.max(1, Number(process.env.EXPLORE_SHORT_PAGES) || 320));
const MAX_SECONDS = 6;
const found = new Map();
let total = 0;
let scanned = 0;

async function page(cursor) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${FEED}?lang=en&source=community&size=48&cursor=${cursor}&sort=trending`, { signal: AbortSignal.timeout(20000) });
      if (response.ok) return normalizeFeed(await response.json());
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return null;
}

let nextCursor = 1;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (nextCursor <= pages) {
    const cursor = nextCursor++;
    const result = await page(cursor);
    if (!result) continue;
    scanned++;
    total = Math.max(total, result.total);
    result.items.forEach((item, i) => {
      if (item.duration <= MAX_SECONDS) found.set(item.id, { ...item, rank: cursor * 48 + i });
    });
  }
}));

const candidates = [...found.values()].sort((a, b) => a.rank - b.rank);
const playable = new Set();
let index = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (index < candidates.length) {
    const item = candidates[index++];
    try {
      const response = await fetch(item.videoUrl, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
      if (response.ok && /^video\//i.test(response.headers.get("content-type") ?? "")) playable.add(item.id);
      await response.body?.cancel();
    } catch { /* unavailable sources are omitted */ }
  }
}));

const items = candidates.filter((item) => playable.has(item.id)).map(({ rank, ...item }) => ({ ...item, rank }));
if (!items.length) throw new Error("No playable short references; existing index preserved.");
await writeFile(fileURLToPath(new URL("../lib/explore/short-references.json", import.meta.url)), JSON.stringify({ items, scannedPages: scanned, total, refreshedAt: new Date().toISOString() }));
console.log(`Indexed ${items.length} short references (4-${MAX_SECONDS}s) from ${scanned} pages of ${total} source records.`);
