/**
 * The origin Convex (and any other server-to-server caller) should use to reach
 * THIS Next app.
 *
 * WHY THIS EXISTS — the custom domain's TLS cert is a single point of failure.
 * When Railway's cert for the custom domain is missing/stale, the edge falls back to its
 * own `*.up.railway.app` wildcard cert. Browsers that already negotiated a session
 * keep working, but any strict client re-verifying the chain (Convex's fetch is
 * Rust/reqwest+BoringSSL) dies with:
 *
 *   error sending request for url (https://vello.gg/api/video/download):
 *   client error (Connect): error:1000007D:SSL routines:OPENSSL_internal:
 *   CERTIFICATE_VERIFY_FAILED
 *
 * …which surfaced in the builder as "Clipping failed: error sending request".
 *
 * The `*.up.railway.app` hostname is covered by the wildcard cert Railway serves,
 * so it is ALWAYS valid regardless of the custom-domain cert state. Prefer it for
 * machine-to-machine hops; the public domain stays the user-facing URL.
 */

/** Normalize to `https://host` with no trailing slash. Returns "" when unusable. */
function normalizeOrigin(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "";
  }
}

/** Railway injects these at runtime; only the railway.app one has a guaranteed-valid cert. */
function railwayOrigin(): string {
  for (const raw of [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.RAILWAY_STATIC_URL]) {
    const origin = normalizeOrigin(raw);
    // RAILWAY_PUBLIC_DOMAIN can be the CUSTOM domain when one is attached — that is
    // the exact host with the broken cert, so only accept the railway.app form.
    if (origin && /\.up\.railway\.app$/i.test(new URL(origin).hostname)) return origin;
  }
  return "";
}

/**
 * Canonical production origin, compiled in as a LAST-RESORT candidate so a stale
 * env var (the classic failure: a domain moves, one console gets updated and the
 * other does not) degrades into one failed handshake instead of an unreachable
 * app. Never preferred over an explicit setting.
 */
const CANONICAL_PROD_ORIGIN = "https://velloagents.com";

/**
 * Ordered, deduped list of origins that reach this app, most-reliable first.
 * Callers should try each in order and fall through on CONNECT/TLS failures.
 */
export function selfOrigins(): string[] {
  const candidates = [
    // Explicit override wins (set this in Railway + Convex if the auto-detected
    // origin is ever wrong).
    normalizeOrigin(process.env.INTERNAL_APP_URL),
    railwayOrigin(),
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    CANONICAL_PROD_ORIGIN,
  ].filter(Boolean);
  return [...new Set(candidates)];
}

/** Single best origin for this app. */
export function selfOrigin(): string {
  return selfOrigins()[0] ?? "";
}
