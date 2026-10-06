import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES, FEED, normalizeFeed, type ReferenceVideo } from "@/lib/explore/feed";

const PAGE = 48;
const GROUP = 4; // pages fetched in parallel
const MAX_PAGES_PER_REQUEST = 12; // scan budget for one request
const TARGET = 24; // stop scanning once this many matches are found

async function page(cursor: number) {
  const res = await fetch(`${FEED}?lang=en&source=community&size=${PAGE}&cursor=${cursor}&sort=trending`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("Upstream unavailable");
  const feed = normalizeFeed(await res.json());
  return { ...feed, items: feed.items.map((i) => ({ ...i, page: cursor })) };
}

/**
 * The reference library, filtered on the server. Without filters it is one page of the feed. With a search term,
 * category or length it keeps scanning pages (several at once) until it has a screenful of matches, then returns
 * them with the cursor to continue from, so the client can scroll through the WHOLE library, not just what it
 * has already loaded.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cursor = Number(sp.get("cursor") ?? 1);
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > 10000) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const category = sp.get("category") ?? "All";
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const min = Number(sp.get("min") ?? 0), max = Number(sp.get("max") ?? 0);
  if (![min, max].every((n) => Number.isFinite(n) && n >= 0 && n <= 120)) return NextResponse.json({ error: "Invalid length" }, { status: 400 });
  const filtered = !!q || category !== "All" || min > 0 || max > 0;
  const matches = (i: ReferenceVideo) =>
    (category === "All" || i.category === category) &&
    (!min || i.duration >= min) &&
    (!max || i.duration < max) &&
    (!q || `${i.title} ${i.description}`.toLowerCase().includes(q));

  try {
    if (!filtered) {
      const result = await page(cursor);
      return NextResponse.json({ ...result, scanned: 1 }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } });
    }
    const out: ReferenceVideo[] = [];
    let at = cursor;
    let total = 0;
    let lastPage = Infinity;
    let scanned = 0;
    while (out.length < TARGET && scanned < MAX_PAGES_PER_REQUEST && at <= lastPage) {
      const group = Array.from({ length: Math.max(0, Math.min(GROUP, lastPage - at + 1)) }, (_, i) => at + i);
      if (!group.length) break;
      const results = await Promise.allSettled(group.map(page));
      let failed = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          total = Math.max(total, r.value.total);
          for (const item of r.value.items) if (matches(item)) out.push(item);
        } else failed++;
      }
      if (failed === group.length) throw new Error("Upstream unavailable");
      if (total) lastPage = Math.ceil(total / PAGE);
      at += group.length;
      scanned += group.length;
    }
    return NextResponse.json({ items: out, next: at <= lastPage ? at : null, total, scanned }, { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "The reference library is temporarily unavailable. Please retry." }, { status: 502 });
  }
}
