import { hostBase64ForKie } from "@/lib/server/imageForKie";

// App-store screenshot crawl: given an Apple App Store / Google Play link,
// return the app's REAL store screenshots as Kie-safe hosted URLs — the
// strongest possible visual reference for "make a video/carousel about this
// app". Falls back to [] on any failure (callers then use the generic headless
// page screenshot instead).
//
// Apple: the public iTunes Lookup API returns `screenshotUrls` directly — no
// scraping. Google Play: the store page inlines screenshot URLs on
// play-lh.googleusercontent.com; regex them out of the HTML.
//
// Every screenshot is re-hosted via hostBase64ForKie: play-lh URLs are
// extensionless (one such ref poisons a WHOLE KIE request — see the
// ref-image-poisoning incident) and mzstatic sizes vary, so a transcoded
// public .png is the only shape guaranteed safe.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_SCREENSHOTS = 3;

export function isAppStoreUrl(url: string): boolean {
  return /apps\.apple\.com|itunes\.apple\.com|play\.google\.com/i.test(url);
}

async function appleScreenshots(url: string): Promise<string[]> {
  const idMatch = /\/id(\d{5,})/.exec(url);
  if (!idMatch) return [];
  const country = /apps\.apple\.com\/([a-z]{2})\//i.exec(url)?.[1] ?? "us";
  const res = await fetch(`https://itunes.apple.com/lookup?id=${idMatch[1]}&country=${country}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { results?: Array<{ screenshotUrls?: string[]; ipadScreenshotUrls?: string[] }> };
  const app = data.results?.[0];
  return [...(app?.screenshotUrls ?? []), ...(app?.ipadScreenshotUrls ?? [])].filter((u) => /^https?:\/\//i.test(u));
}

async function playScreenshots(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return [];
  const html = await res.text();
  // Screenshot CDN URLs — dedupe, skip tiny icon renditions (=w64 etc.).
  const found = html.match(/https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-=/]+/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const base = raw.split("=")[0];
    if (seen.has(base)) continue;
    seen.add(base);
    // Request a video-friendly size explicitly.
    out.push(`${base}=w1080`);
  }
  // The first few matches are usually the app icon + developer avatar — the
  // screenshot carousel images dominate after that. Heuristic: drop the first 2.
  return out.slice(2);
}

async function rehost(urls: string[]): Promise<string[]> {
  const hosted = await Promise.all(
    urls.slice(0, MAX_SCREENSHOTS).map(async (u, i) => {
      try {
        const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 5_000) return null; // icon/placeholder junk
        return await hostBase64ForKie(buf.toString("base64"), i);
      } catch {
        return null;
      }
    }),
  );
  return hosted.filter((u): u is string => !!u);
}

/** Real store screenshots for an App Store / Play Store link, Kie-safe hosted. */
export async function fetchAppStoreScreenshots(url: string): Promise<string[]> {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  try {
    const raw = /play\.google\.com/i.test(url) ? await playScreenshots(url) : await appleScreenshots(url);
    if (raw.length === 0) return [];
    const hosted = await rehost(raw);
    console.log(`[appStoreScreenshots] ${hosted.length} screenshot(s) for ${url}`);
    return hosted;
  } catch (e) {
    console.warn("[appStoreScreenshots] failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
