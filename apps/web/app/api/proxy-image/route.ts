import { NextRequest, NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@/lib/server/downloader";

export const runtime = "nodejs";

// Proxy external image URLs server-side to avoid browser CORS issues.
// Only allow fetching from Kie.ai domains.
const ALLOWED_HOSTS = [
  "kie.ai",
  "aiquickdraw.com",   // Kie.ai CDN where nano-banana-pro results are hosted
  "tempfile.aiquickdraw.com",
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing url param", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  const host = parsed.hostname;
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return new NextResponse("URL not allowed", { status: 403 });
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    // SSRF guard: the one-time host allowlist above only guards the FIRST hop.
    // Follow redirects MANUALLY and re-validate EVERY hop against the private/
    // loopback/link-local/metadata block-list, so a trusted CDN's open redirect
    // can't bounce the server onto an internal address (e.g. the cloud metadata
    // endpoint). The allowlist is NOT re-checked per hop on purpose — Kie can
    // deliver images via a cross-domain redirect to a presigned storage URL, and
    // assertPublicHttpUrl alone is what actually stops the SSRF.
    let current = url;
    let res: Response;
    try {
      for (let hop = 0; ; hop++) {
        if (hop > 5) {
          clearTimeout(timeout);
          return new NextResponse("Too many redirects", { status: 502 });
        }
        await assertPublicHttpUrl(current);
        res = await fetch(current, { redirect: "manual", signal: ctrl.signal });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          current = new URL(loc, current).toString();
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return new NextResponse(`Upstream ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    // user-controlled upstream — a DNS/network/abort/blocked-host error must not
    // surface as an unhandled 500.
    console.error("[proxy-image] upstream fetch failed:", err);
    return new NextResponse("Upstream fetch failed", { status: 502 });
  }
}
