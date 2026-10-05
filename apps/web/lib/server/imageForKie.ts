// Normalize images before sending them to Kie (nano-banana-pro `image_input`,
// Veo `imageUrls`, jobs `image_url`).
//
// WHY: Kie's remote renderers must be able to FETCH the reference URL AND
// recognize its format. Two things break that in practice:
//   1. Convex storage URLs (https://<deployment>.convex.cloud/api/storage/<uuid>)
//      have NO file extension — Kie can't tell what type they are and rejects
//      them with "image_input file type not supported".
//   2. Local-dev Convex URLs are http://127.0.0.1:3210/... which Kie can't reach.
//   3. Some uploads (JPEG, WebP, GIF) aren't accepted as-is by every Kie model.
//
// FIX: fetch the image, transcode it to PNG with sharp, and re-host it to a
// PUBLIC Supabase bucket under a real `.png` path. The returned URL is always
// public https, ends in `.png`, and serves `image/png` — which every Kie model
// accepts. Already-normalized URLs (public + `.png`) are returned untouched.
//
// NODE-ONLY: this uses `sharp` (a native module). It must NOT be imported from
// any file that Convex bundles (e.g. lib/server/kie-video-pipeline.ts) — only
// from Next.js route handlers running on the Node runtime.

import { putImage, r2ImageConfigured } from "./imageStorage";
import { isDeadMediaUrl } from "../deadMediaHosts";

/** A URL Kie's remote servers can actually fetch — https and not localhost. */
function isPubliclyFetchable(url: string): boolean {
  return /^https:\/\//i.test(url) && !/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url);
}

/** Already safe for Kie: public https AND a real `.png` path. */
function isKieSafe(url: string): boolean {
  return isPubliclyFetchable(url) && /\.png(\?|#|$)/i.test(url);
}

/** A public URL Kie can at least RECOGNIZE as a raster image by its extension.
 *  Kie rejects the WHOLE request with "image_input file type not supported" on an
 *  EXTENSIONLESS url (e.g. a Convex-storage /api/storage/<uuid> link), so when we
 *  can't re-host to `.png` we only pass a source through if it already carries a
 *  recognizable raster extension — otherwise we DROP it (return null) rather than
 *  poison the batch and take down the good refs alongside it. */
function isKieUsableAsIs(url: string): boolean {
  return isPubliclyFetchable(url) && /\.(png|jpe?g|webp)(\?|#|$)/i.test(url);
}

// Process-level cache so the same source image (e.g. an agent avatar reused
// across many renders on a warm instance) is only fetched+transcoded once.
const cache = new Map<string, string>();

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // Browser-ish UA: og-image/hero URLs on marketing sites frequently 403 the
    // default node-fetch UA (hotlink/bot protection) — the same block Kie's own
    // fetcher hits. Fetching like a browser lets us re-host what Kie cannot pull.
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Return a Kie-fetchable PNG URL for `url`, re-hosting + transcoding when needed.
 * Best-effort: on any failure it returns the original URL if that URL is at least
 * publicly fetchable (so behavior never regresses), otherwise null.
 */
export async function normalizeImageForKie(
  url: string | null | undefined,
  idx = 0,
): Promise<string | null> {
  if (!url || typeof url !== "string") return null;
  // A URL on a dead host (restricted Supabase project) would pass the extension
  // checks below, reach Kie, fail to download there and poison the WHOLE request.
  if (isDeadMediaUrl(url)) return null;
  if (isKieSafe(url)) return url;
  const cached = cache.get(url);
  if (cached) return cached;

  // Can't re-host without R2 env — degrade gracefully.
  if (!r2ImageConfigured()) return isKieUsableAsIs(url) ? url : null;

  try {
    const res = await fetchWithTimeout(url, 20_000);
    if (!res.ok) return isKieUsableAsIs(url) ? url : null;
    const mime = res.headers.get("content-type") || "";
    if (!/^image\//i.test(mime)) return isKieUsableAsIs(url) ? url : null;
    const input = Buffer.from(await res.arrayBuffer());
    if (input.length === 0 || input.length > 50_000_000) {
      return isKieUsableAsIs(url) ? url : null;
    }

    // Transcode to PNG. For animated GIFs sharp takes the first frame, which is
    // exactly what Veo/nano-banana need (reference frames must be static).
    const sharp = (await import("sharp")).default;
    const png = await sharp(input).png().toBuffer();

    void idx;
    let publicUrl: string | null = null;
    try {
      publicUrl = (await putImage(png, "image/png", { keyPrefix: "campaign-refs/kie" })).url;
    } catch (e) {
      console.warn("[imageForKie] re-host failed:", e instanceof Error ? e.message : e);
      return isKieUsableAsIs(url) ? url : null;
    }
    cache.set(url, publicUrl);
    console.log(`[imageForKie] normalized → ${publicUrl}`);
    return publicUrl;
  } catch (e) {
    console.warn("[imageForKie] error:", e instanceof Error ? e.message : e);
    return isKieUsableAsIs(url) ? url : null;
  }
}

/** Normalize a list of image URLs, dropping any that can't be made Kie-safe. */
export async function normalizeImagesForKie(
  urls: Array<string | null | undefined>,
): Promise<string[]> {
  const out = await Promise.all(urls.map((u, i) => normalizeImageForKie(u, i)));
  return out.filter((u): u is string => !!u);
}

/**
 * Host a raw base64 image (any format) as a Kie-safe PUBLIC `.png` URL.
 *
 * This is the entry point for user-uploaded reference photos that arrive as
 * base64 data URLs. It transcodes to PNG with sharp and uploads to a PUBLIC
 * Supabase bucket — the ONLY shape nano-banana-pro's `image_input` reliably
 * accepts. Uploading jpg/webp (or an extensionless URL) makes Kie reject the
 * reference with "image_input file type not supported", after which the caller
 * silently drops it and generates a generic face — which is the exact "the
 * output doesn't look like my reference" bug this fixes.
 *
 * Returns null if Supabase creds are missing or the upload fails.
 */
export async function hostBase64ForKie(
  base64: string,
  idx = 0,
): Promise<string | null> {
  if (!base64) return null;
  if (!r2ImageConfigured()) {
    console.warn("[imageForKie] missing R2 env — cannot host reference for Kie");
    return null;
  }
  try {
    const input = Buffer.from(base64, "base64");
    if (input.length === 0 || input.length > 50_000_000) return null;

    const sharp = (await import("sharp")).default;
    const png = await sharp(input).png().toBuffer();

    void idx;
    const { url: publicUrl } = await putImage(png, "image/png", { keyPrefix: "campaign-refs/kie" });
    console.log(`[imageForKie] hosted reference → ${publicUrl}`);
    return publicUrl;
  } catch (e) {
    console.warn("[imageForKie] hostBase64ForKie error:", e instanceof Error ? e.message : e);
    return null;
  }
}
