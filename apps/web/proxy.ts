import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "velloagents.com";
const NON_CANONICAL_HOSTS = new Set(["vello.gg", "www.vello.gg", "www.velloagents.com"]);

// Next.js 16 renamed the `middleware` convention to `proxy`. Only ONE of
// middleware.ts / proxy.ts may exist — Next.js throws otherwise — so the
// canonical-host redirect (previously a separate middleware.ts) lives here too.
//
// Railway (and any platform that terminates TLS at the edge) forwards requests
// to this container over plain HTTP and tells us the original scheme via the
// `x-forwarded-proto` header. Without this, a user hitting `http://…` is never
// upgraded, so the browser shows "Not secure". Here we force HTTPS and pin it
// with HSTS so future visits go straight to HTTPS.
export function proxy(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host") ?? request.nextUrl.host;

  // vello.gg (and any non-canonical host) currently serves the app directly and
  // only self-canonicalizes via <link rel="canonical">, which Google treats as
  // a *hint*, not a directive — it was indexing both hosts as duplicates and
  // splitting authority. A real 301 to the canonical host fixes that.
  const hostname0 = host.split(":")[0];
  // www.solcameo.com must 301 to the bare domain so Google sees one site (one title, one favicon, one set of signals).
  if (hostname0 === "www.solcameo.com") {
    return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, "https://solcameo.com"), 301);
  }
  if (NON_CANONICAL_HOSTS.has(hostname0)) {
    const canonicalUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${CANONICAL_HOST}`);
    return NextResponse.redirect(canonicalUrl, 301);
  }

  // Never upgrade local development to HTTPS. The dev server only speaks plain
  // HTTP, so redirecting localhost to https:// produces ERR_SSL_PROTOCOL_ERROR
  // ("localhost sent an invalid response"). Bail out entirely for local hosts.
  const hostname = host.split(":")[0];
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost");
  if (isLocalHost) {
    return NextResponse.next();
  }

  // Only act when we're certain we're behind an edge proxy speaking HTTP.
  // Locally (next dev, no x-forwarded-proto) this is a no-op.
  if (forwardedProto === "http") {
    const httpsUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${host}`);
    return NextResponse.redirect(httpsUrl, 308);
  }

  const response = NextResponse.next();

  // Tell browsers to always use HTTPS for this domain for the next 2 years.
  if (forwardedProto === "https") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  // Run on every request except Next's static assets and image optimizer,
  // which never need an HTTPS redirect and shouldn't pay the proxy cost.
  // api/media/upload* is excluded: Next 16 truncates request bodies >10 MB
  // (proxyClientMaxBodySize) on routes the proxy runs on — it broke large uploads.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/media/upload).*)"],
};
