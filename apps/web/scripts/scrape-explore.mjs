/** Crawl public source records, keeping original inputs only. EXPLORE_PAGES controls depth (default 12). */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeFeed, FEED } from "../lib/explore/feed.ts";
const pages = Math.min(1000, Math.max(1, Number(process.env.EXPLORE_PAGES) || 12));
const items = new Map();
let cursor = 1, total = 0;
for (let page = 0; page < pages && cursor; page++) {
  const response = await fetch(`${FEED}?lang=en&source=community&size=48&cursor=${cursor}&sort=trending`);
  if (!response.ok) throw new Error(`Feed failed: ${response.status}`);
  const result = normalizeFeed(await response.json());
  for (const item of result.items) items.set(item.id, item);
  total = result.total;
  cursor = result.next && result.next > cursor ? result.next : null;
}
// Validate original media, never substitute an edited demo when an input is unavailable.
const candidates = [...items.values()];
const verified = new Set();
let index = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (index < candidates.length) {
    const item = candidates[index++];
    try {
      const response = await fetch(item.videoUrl, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && /^video\//i.test(type)) verified.add(item.id);
      await response.body?.cancel();
    } catch { /* unavailable sources are omitted; never fall back to a demo */ }
  }
}));
const originals = candidates.filter(item => verified.has(item.id));
if (!originals.length) throw new Error("No playable original references; existing index preserved.");
await writeFile(fileURLToPath(new URL("../lib/explore/references.json", import.meta.url)), JSON.stringify({ items: originals, next: cursor, total, refreshedAt: new Date().toISOString() }));
console.log(`Indexed ${originals.length} verified originals; omitted ${candidates.length - originals.length} unavailable inputs (${total} source records).`);
