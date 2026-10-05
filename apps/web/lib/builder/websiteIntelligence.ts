import { assertPublicHttpUrl } from "@/lib/server/downloader";

type ImageCandidate = {
  url: string;
  alt?: string;
};

export type WebsiteIntelligence = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  heroImage?: string;
  logoImage?: string;
  imageCandidates: ImageCandidate[];
  audienceHints: string[];
  productSignals: string[];
  communitySignals: string[];
  viralAngles: string[];
  readableText: string;
};

function firstMatch(input: string, pattern: RegExp): string | undefined {
  const match = input.match(pattern);
  return match?.[1]?.trim();
}

function extractMetaTag(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const value = firstMatch(html, pattern);
    if (value) return value;
  }
  return undefined;
}

function parseSrcsetCandidates(srcset: string): string[] {
  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

function absolutizeUrl(candidate: string, baseUrl: string): string | undefined {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveSignals(text: string): Pick<
  WebsiteIntelligence,
  "audienceHints" | "productSignals" | "communitySignals" | "viralAngles"
> {
  const lower = text.toLowerCase();
  const audienceHints: string[] = [];
  const productSignals: string[] = [];
  const communitySignals: string[] = [];
  const viralAngles: string[] = [];

  if (/\b(founder|startup|brand|company|business|agency)\b/.test(lower)) {
    audienceHints.push("brand operators and founders");
  }
  if (/\b(creator|ugc|influencer|content creator|youtube|tiktok|instagram)\b/.test(lower)) {
    audienceHints.push("creators and growth collaborators");
  }
  if (/\b(course|membership|community|academy|program|coaching|masterclass)\b/.test(lower)) {
    communitySignals.push("education or membership layer already fits the offer");
  }
  if (/\b(template|service|consulting|audit|subscription|product|bundle|tool)\b/.test(lower)) {
    productSignals.push("the site already implies sellable products or service packages");
  }
  if (/\b(viral|share|community|challenge|creator|remix|ugc|testimonial|before and after)\b/.test(lower)) {
    viralAngles.push("build around remixable creator proofs and social proof");
  }
  if (/\b(free trial|book a demo|get started|join|sign up|apply)\b/.test(lower)) {
    viralAngles.push("use the existing CTA as the conversion backbone for the campaign");
  }

  if (audienceHints.length === 0) audienceHints.push("buyers looking for a concrete outcome");
  if (productSignals.length === 0) productSignals.push("shape a flagship offer from the strongest promise on the site");
  if (communitySignals.length === 0) communitySignals.push("use the community as the trust and onboarding layer");
  if (viralAngles.length === 0) viralAngles.push("focus on hook-first UGC with clear before/after outcomes");

  return { audienceHints, productSignals, communitySignals, viralAngles };
}

function extractImages(html: string, baseUrl: string): ImageCandidate[] {
  const imageCandidates: ImageCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: string | undefined, alt?: string) => {
    if (!candidate) return;
    const url = absolutizeUrl(candidate, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    imageCandidates.push({ url, alt });
  };
  const metaImages = [
    extractMetaTag(html, "og:image"),
    extractMetaTag(html, "twitter:image"),
  ].filter(Boolean) as string[];

  for (const metaImage of metaImages) {
    pushCandidate(metaImage);
  }

  const linkIconPattern = /<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon|mask-icon)[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  let linkMatch: RegExpExecArray | null = null;
  while ((linkMatch = linkIconPattern.exec(html)) && imageCandidates.length < 10) {
    pushCandidate(linkMatch[1], "site icon");
  }

  const imgTagPattern = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  const altPattern = /alt=["']([^"']+)["']/i;
  const srcsetPattern = /srcset=["']([^"']+)["']/i;
  let match: RegExpExecArray | null = null;

  while ((match = imgTagPattern.exec(html)) && imageCandidates.length < 12) {
    const fullTag = match[0];
    const alt = firstMatch(fullTag, altPattern);
    pushCandidate(match[1], alt);
    for (const candidate of parseSrcsetCandidates(firstMatch(fullTag, srcsetPattern) || "")) {
      pushCandidate(candidate, alt);
    }
  }

  const sourceTagPattern = /<source[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
  let sourceMatch: RegExpExecArray | null = null;
  while ((sourceMatch = sourceTagPattern.exec(html)) && imageCandidates.length < 16) {
    for (const candidate of parseSrcsetCandidates(sourceMatch[1])) {
      pushCandidate(candidate);
    }
  }

  const structuredImagePattern = /"(?:image|logo|thumbnailUrl)"\s*:\s*"(https?:[^"]+)"/gi;
  let structuredMatch: RegExpExecArray | null = null;
  while ((structuredMatch = structuredImagePattern.exec(html)) && imageCandidates.length < 20) {
    pushCandidate(structuredMatch[1]);
  }

  return imageCandidates;
}

function chooseLogoImage(candidates: ImageCandidate[]): string | undefined {
  return candidates.find((image) => /logo|brand|wordmark|icon/i.test(`${image.alt || ""} ${image.url}`))?.url;
}

function chooseHeroImage(candidates: ImageCandidate[]): string | undefined {
  const preferred = candidates.find(
    (image) =>
      !/logo|brand|wordmark|icon|favicon|avatar/i.test(`${image.alt || ""} ${image.url}`) &&
      /hero|cover|banner|feature|featured|og-image|main|header/i.test(`${image.alt || ""} ${image.url}`),
  );
  if (preferred?.url) return preferred.url;

  return candidates.find(
    (image) => !/logo|brand|wordmark|icon|favicon|avatar/i.test(`${image.alt || ""} ${image.url}`),
  )?.url;
}

/**
 * Internal implementation — may throw. Always call via `fetchWebsiteIntelligence` (safe wrapper).
 */
async function _fetchWebsiteIntelligenceUnsafe(url: string): Promise<WebsiteIntelligence | null> {
  // Use Promise.race with a timeout promise so we never attach a shared AbortSignal to the
  // outer Next.js request, avoiding "signal is aborted without reason" propagation.
  const TIMEOUT_MS = 5000;

  // SSRF guard: validate the URL (and every redirect hop) resolves to a public
  // host before issuing the request. redirect:"manual" stops the runtime from
  // silently following a 30x into a private/metadata address.
  const followFetch = async (): Promise<Response | null> => {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublicHttpUrl(current);
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 JobtepiBuilderBot/2.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return res;
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    return null;
  };

  const fetchPromise = followFetch();

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), TIMEOUT_MS),
  );

  const response = await Promise.race([fetchPromise, timeoutPromise]);

  // Timed out — return null, no error thrown.
  if (!response) return null;

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;

  // Body read also raced with a short timeout to avoid hanging on large pages.
  const textPromise = response.text();
  const textTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const html = await Promise.race([textPromise, textTimeout]);

  if (!html) return null;

  const readableText = htmlToReadableText(html).slice(0, 2600);
  const imageCandidates = extractImages(html, url);
  const title = firstMatch(html, /<title>([^<]+)<\/title>/i) || extractMetaTag(html, "og:title");
  const description =
    extractMetaTag(html, "description") || extractMetaTag(html, "og:description");
  const siteName = extractMetaTag(html, "og:site_name");
  const logoImage = chooseLogoImage(imageCandidates) || imageCandidates[1]?.url || imageCandidates[0]?.url;
  const heroImage = chooseHeroImage(imageCandidates) || imageCandidates[0]?.url || logoImage;
  const signals = deriveSignals(`${title || ""}\n${description || ""}\n${readableText}`);

  return {
    url,
    title,
    description,
    siteName,
    heroImage,
    logoImage,
    imageCandidates,
    readableText,
    ...signals,
  };
}

/**
 * Safe public wrapper — NEVER throws, NEVER propagates an AbortError.
 * Returns null on any failure (timeout, network error, parse error).
 */
export async function fetchWebsiteIntelligence(url: string): Promise<WebsiteIntelligence | null> {
  try {
    return await _fetchWebsiteIntelligenceUnsafe(url);
  } catch {
    return null;
  }
}
