import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { scrapeTopAds, ADS_LIBRARY_COUNTRIES, type AdLibraryItem } from "@/lib/server/adsLibraryScrape";

// Ads Library feed — trending top-converting UGC ads (TikTok Creative Center
// Top Ads), per-country, Convex-cached. Content rotates every 24h: the cache
// holds a country's feed for a day, then the next request re-scrapes. A failed
// scrape KEEPS serving the last cached feed rather than going blank.
export const runtime = "nodejs";
export const maxDuration = 150;

const FRESH_MS = 24 * 60 * 60 * 1000; // 24h content cycle

export async function GET(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);

  const countryKey = (req.nextUrl.searchParams.get("country") ?? "GLOBAL").toUpperCase();
  if (!(countryKey in ADS_LIBRARY_COUNTRIES)) {
    return NextResponse.json({ ok: false, error: `Unknown country "${countryKey}"` }, { status: 400 });
  }
  const regionCode = ADS_LIBRARY_COUNTRIES[countryKey];
  const cacheKey = `topads:${countryKey}`;

  const cached = await convex.query(api.adsLibraryCache.get, { key: cacheKey }).catch(() => null);
  const cachedItems: AdLibraryItem[] = cached?.payload ? (JSON.parse(cached.payload) as AdLibraryItem[]) : [];
  const fresh = !!cached && Date.now() - cached.fetchedAt < FRESH_MS && cachedItems.length > 0;
  if (fresh) {
    return NextResponse.json({ ok: true, items: cachedItems, fetchedAt: cached.fetchedAt, nextRefreshAt: cached.fetchedAt + FRESH_MS, country: countryKey });
  }

  const scraped = await scrapeTopAds(regionCode);
  if (scraped.length > 0 && secret) {
    const now = Date.now();
    await convex.mutation(api.adsLibraryCache.put, { key: cacheKey, payload: JSON.stringify(scraped), authSecret: secret }).catch(() => {});
    return NextResponse.json({ ok: true, items: scraped, fetchedAt: now, nextRefreshAt: now + FRESH_MS, country: countryKey });
  }
  // Scrape came up empty — last cached feed (if any) beats a blank page, even stale.
  if (cachedItems.length > 0) {
    return NextResponse.json({ ok: true, items: cachedItems, fetchedAt: cached!.fetchedAt, nextRefreshAt: Date.now() + 30 * 60 * 1000, country: countryKey, stale: true });
  }
  return NextResponse.json({ ok: false, error: "Could not load the ads library right now. Try again in a minute." }, { status: 502 });
}
