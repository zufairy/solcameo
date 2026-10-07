import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/lib/explore/feed";
import { PAGE, getLibrary, queryLibrary, type LibraryPrice, type LibrarySort } from "@/lib/explore/library";

const PRICES: LibraryPrice[] = ["any", "u5", "5-10", "10-20", "o20"];
const SORTS: LibrarySort[] = ["trending", "shortest", "cheapest"];

/**
 * The reference library, filtered on our side. The whole upstream feed is indexed ahead of time (see
 * lib/explore/library.ts), so a search, category or length filter is a local scan that answers in milliseconds and
 * pages through every match. `cursor` is the 1-based position in the filtered list; `next` is where to continue.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cursor = Number(sp.get("cursor") ?? 1);
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > 100000) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim().toLowerCase().slice(0, 64);
  const category = sp.get("category") ?? "All";
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  const min = Number(sp.get("min") ?? 0), max = Number(sp.get("max") ?? 0);
  if (![min, max].every((n) => Number.isFinite(n) && n >= 0 && n <= 120)) return NextResponse.json({ error: "Invalid length" }, { status: 400 });
  const price = (sp.get("price") ?? "any") as LibraryPrice, sort = (sp.get("sort") ?? "trending") as LibrarySort;
  if (!PRICES.includes(price) || !SORTS.includes(sort)) return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  try {
    const result = queryLibrary(await getLibrary(), { q, category, min, max, price, sort, cursor, limit: PAGE });
    // A library that is still being built answers from the bundled index, so keep that short lived at the edge.
    const maxAge = result.building ? 15 : 120;
    return NextResponse.json({ ...result, scanned: 0 }, { headers: { "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=600` } });
  } catch {
    return NextResponse.json({ error: "The reference library is temporarily unavailable. Please retry." }, { status: 502 });
  }
}
