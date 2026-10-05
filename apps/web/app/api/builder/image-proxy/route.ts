import { NextRequest, NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@/lib/server/downloader";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy remote images so the builder canvas can render hero/logo images
 * from third-party sites that block hotlinking or have CORS issues.
 *
 * Usage: <img src="/api/builder/image-proxy?url=https%3A%2F%2Fexample.com%2Fimg.png" />
 *
 * Safety:
 * - Only http(s) URLs are allowed.
 * - 8s timeout to prevent slow upstreams from hanging the page.
 * - Only image/* content types are streamed back.
 * - Errors return a tiny transparent 1x1 PNG so <img> tags don't show a broken icon.
 */
export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const url = req.nextUrl.searchParams.get("url");

  if (!url || !/^https?:\/\//i.test(url)) {
    return brokenImageFallback();
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    // SSRF guard: validate the host (+ every redirect hop) against the
    // private/loopback/link-local/metadata block-list, following redirects
    // MANUALLY so an attacker can't bounce us onto an internal address.
    let current = url;
    let upstream: Response;
    try {
      for (let hop = 0; ; hop++) {
        if (hop > 5) { clearTimeout(timeout); return brokenImageFallback(); }
        await assertPublicHttpUrl(current);
        upstream = await fetch(current, {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 JobtepiBuilderBot/2.0",
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8",
          },
          redirect: "manual",
        });
        if (upstream.status >= 300 && upstream.status < 400) {
          const loc = upstream.headers.get("location");
          if (!loc) break;
          current = new URL(loc, current).toString();
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) return brokenImageFallback();

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return brokenImageFallback();

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength === 0) return brokenImageFallback();

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return brokenImageFallback();
  }
}

// 1x1 transparent PNG — keeps the layout stable instead of showing a broken icon.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  "base64",
);

function brokenImageFallback() {
  return new NextResponse(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60",
    },
  });
}
