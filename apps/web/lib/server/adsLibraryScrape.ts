// Ads Library scrape — trending, top-converting UGC ads for /recreate/library.
//
// Source: TikTok Creative Center "Top Ads" (ads.tiktok.com/business/creativecenter
// /inspiration/topads) — TikTok's own public showcase of the best-performing ad
// creatives, ranked by CTR/engagement. Its JSON API requires a signed `user-sign`
// header (direct calls return 40101 "no permission"), so instead of reverse-
// engineering the signature we drive the PAGE itself with the same headless
// Chromium used for website screenshots and harvest the API responses the page
// makes for itself (which it signs correctly). Best-effort: any failure returns
// [] and the caller keeps serving the last cached feed.
//
// NODE-ONLY (launches Chromium) — import from Next route handlers only.

export interface AdLibraryItem {
  id: string;
  title: string;
  brandName: string;
  /** Direct CDN mp4 (EXPIRES after hours — why the cache refreshes). */
  videoUrl: string;
  coverUrl: string;
  durationSeconds: number;
  ctr: number;
  likes: number;
  industry: string;
}

const TOP_ADS_PAGE = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en";
const HARVEST_TIMEOUT_MS = 90_000;

/** Country filters the library supports. "" = global (page default ranking). */
export const ADS_LIBRARY_COUNTRIES: Record<string, string> = {
  GLOBAL: "",
  US: "US",
  MY: "MY",
  GB: "GB",
  SG: "SG",
};

type RawMaterial = {
  id?: string | number;
  ad_title?: string;
  brand_name?: string;
  ctr?: number;
  like?: number;
  industry_key?: string;
  video_info?: {
    duration?: number;
    cover?: string;
    video_url?: Record<string, string>;
  };
};

function toItem(m: RawMaterial): AdLibraryItem | null {
  const urls = m.video_info?.video_url ?? {};
  const videoUrl = urls["720p"] ?? urls["1080p"] ?? urls["480p"] ?? Object.values(urls)[0] ?? "";
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) return null;
  return {
    id: String(m.id ?? videoUrl.slice(-24)),
    title: (m.ad_title ?? "Untitled ad").trim(),
    brandName: (m.brand_name ?? "").trim(),
    videoUrl,
    coverUrl: m.video_info?.cover ?? "",
    durationSeconds: Math.round(m.video_info?.duration ?? 0),
    ctr: typeof m.ctr === "number" ? m.ctr : 0,
    likes: typeof m.like === "number" ? m.like : 0,
    industry: (m.industry_key ?? "").replace(/^label_/, "").replace(/_/g, " "),
  };
}

/** Interleave by industry (round-robin) so the feed spans many niches instead
 *  of one dominant vertical, while each niche stays CTR-sorted internally. */
function diversifyByNiche(items: AdLibraryItem[]): AdLibraryItem[] {
  const byNiche = new Map<string, AdLibraryItem[]>();
  for (const it of items) {
    const k = it.industry || "other";
    const arr = byNiche.get(k) ?? [];
    arr.push(it);
    byNiche.set(k, arr);
  }
  const buckets = [...byNiche.values()];
  const out: AdLibraryItem[] = [];
  for (let round = 0; out.length < items.length; round++) {
    let advanced = false;
    for (const b of buckets) {
      if (b[round]) { out.push(b[round]); advanced = true; }
    }
    if (!advanced) break;
  }
  return out;
}

export async function scrapeTopAds(countryCode = ""): Promise<AdLibraryItem[]> {
  let browser: { close: () => Promise<void> } | null = null;
  try {
    const { chromium } = await import("playwright-core");
    const launchEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") launchEnv[k] = v;
    launchEnv.DBUS_SESSION_BUS_ADDRESS = "/dev/null";
    const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--mute-audio"];
    const strategies: Array<Record<string, unknown>> = [
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? [{ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }] : []),
      { channel: "chrome" },
      {},
    ];
    let b: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    for (const s of strategies) {
      try { b = await chromium.launch({ headless: true, args, env: launchEnv, ...s }); break; } catch { /* next */ }
    }
    if (!b) throw new Error("no chromium available");
    browser = b;

    const page = await b.newPage({
      viewport: { width: 1440, height: 900 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    // Harvest every top_ads list response the page fires (it signs its own
    // requests), plus the filters payload (its `industry` list maps the numeric
    // industry ids on each ad to human niche names).
    const materials = new Map<string, RawMaterial>();
    const industryNames = new Map<string, string>();
    let batchCount = 0;
    page.on("response", (res) => {
      const url = res.url();
      if (/top_ads\/v2\/filters/.test(url)) {
        void res.json().then((j: { data?: { industry?: Array<{ id?: string | number; value?: string }> } }) => {
          for (const ind of j?.data?.industry ?? []) {
            if (ind.id != null && ind.value) industryNames.set(String(ind.id), ind.value);
          }
        }).catch(() => {});
        return;
      }
      if (!/top_ads\/v2\/list/.test(url)) return;
      void res.json().then((j: { data?: { materials?: RawMaterial[] } }) => {
        const batch = j?.data?.materials ?? [];
        if (batch.length) batchCount++;
        for (const m of batch) {
          const key = String(m.id ?? Math.random());
          if (!materials.has(key)) materials.set(key, m);
        }
      }).catch(() => {});
    });

    const deadline = Date.now() + HARVEST_TIMEOUT_MS;
    // The Creative Center reads region + period from the URL (shareable filter
    // links). The list endpoint serves 20/page and its pagination control is
    // fragile to drive headlessly — so we UNION the rankings across several
    // periods (last 7 / 30 / 120 days): each period ranks differently, giving
    // 30-60 unique ads across many niches per country.
    const regionParam = countryCode ? `&region=${encodeURIComponent(countryCode)}` : "";
    for (const period of [30, 7, 120]) {
      if (Date.now() > deadline - 15_000 || materials.size >= 45) break;
      const before = batchCount;
      try {
        await page.goto(`${TOP_ADS_PAGE}?period=${period}${regionParam}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch { /* keep going — XHRs may still fire */ }
      // Wait for this period's batch (up to ~35s for the first, less after).
      const batchDeadline = Math.min(deadline - 5_000, Date.now() + (materials.size === 0 ? 40_000 : 15_000));
      while (batchCount === before && Date.now() < batchDeadline) {
        await page.waitForTimeout(1_500);
      }
      await page.waitForTimeout(2_000); // let trailing duplicate/second XHR settle
    }

    const items = [...materials.values()]
      .map(toItem)
      .filter((x): x is AdLibraryItem => !!x)
      .map((it) => ({
        ...it,
        industry: industryNames.get(it.industry) ?? industryNames.get(it.industry.replace(/\D/g, "")) ?? "",
      }))
      .sort((a, b) => b.ctr - a.ctr);
    console.log(`[adsLibraryScrape] harvested ${items.length} top ads (region=${countryCode || "global"})`);
    return diversifyByNiche(items).slice(0, 48);
  } catch (e) {
    console.warn("[adsLibraryScrape] failed:", e instanceof Error ? e.message : e);
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}
