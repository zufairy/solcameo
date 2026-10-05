/**
 * Convex → Next app fetch with ORIGIN FAILOVER.
 *
 * THE BUG THIS KILLS: Convex actions call back into the Next app
 * (`/api/video/download`, `/api/video/download-start`, `/api/agents/run-task`, …)
 * using `NEXT_PUBLIC_APP_URL` — the custom domain. When Railway's cert for the
 * custom domain is missing/stale, the edge answers with its `*.up.railway.app`
 * wildcard cert instead. Convex's fetch is Rust (reqwest + BoringSSL) and verifies
 * strictly, so every hop dies at CONNECT time with:
 *
 *   error sending request for url (https://vello.gg/api/video/download):
 *   client error (Connect): error:1000007D:SSL routines:OPENSSL_internal:
 *   CERTIFICATE_VERIFY_FAILED
 *
 * The builder showed that as "Clipping failed: error sending request…". A browser
 * kept working (already-established/session-resumed TLS), which made it look like
 * an app bug rather than a cert bug.
 *
 * THE FIX: never depend on ONE hostname. Try each known origin in order and fall
 * through on connect/TLS-phase failures. The `*.up.railway.app` origin (passed in
 * as `appUrl` by the Next route via `selfOrigin()`, or set as `INTERNAL_APP_URL`)
 * is covered by Railway's wildcard cert and therefore survives a custom-domain
 * cert outage.
 *
 * RETRY SAFETY: only CONNECT/TLS/DNS-phase errors trigger failover. Those mean the
 * request never reached the server, so re-sending a POST cannot double-execute.
 * Anything that failed after bytes were on the wire (timeouts, aborts, HTTP
 * errors) is returned/thrown as-is.
 */

const env = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

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

/**
 * Ordered, deduped origins Convex can use to reach the Next app.
 * `preferred` is whatever the Next route handed us at enqueue time (`appUrl`) —
 * it is the app reporting its OWN reachable origin, so it beats the env guess.
 */
/**
 * Canonical production origin, compiled in.
 *
 * The env var is NOT trustworthy on its own: the Convex deployment env is edited
 * by hand, in a different console from the Next app's, so it goes stale exactly
 * when a domain changes — which is how a retired hostname kept being dialed long
 * after the app had moved. Appending the canonical origin as a LAST-RESORT
 * candidate means a stale (or plain wrong) env var degrades into one failed
 * handshake instead of a dead pipeline. It is never preferred over an explicit
 * setting, so a self-hosted or preview deployment is unaffected.
 */
const CANONICAL_PROD_ORIGIN = "https://velloagents.com";

export function appOrigins(preferred?: string): string[] {
  const e = env();
  const railwayFirst = (a: string, b: string) => {
    const rank = (o: string) => (/\.up\.railway\.app$/i.test(new URL(o).hostname) ? 0 : 1);
    return rank(a) - rank(b);
  };
  const explicit = [normalizeOrigin(e.INTERNAL_APP_URL), normalizeOrigin(preferred)].filter(Boolean);
  const rest = [normalizeOrigin(e.NEXT_PUBLIC_APP_URL), normalizeOrigin(e.NEXT_PUBLIC_SITE_URL)]
    .filter(Boolean)
    // Within the fallbacks, a railway.app host outranks a custom domain: its cert
    // is the wildcard Railway always serves.
    .sort(railwayFirst);
  return [...new Set([...explicit, ...rest, CANONICAL_PROD_ORIGIN])];
}

/**
 * True for failures that happened BEFORE the request reached the server:
 * TLS handshake / cert verification, DNS, refused or reset connection, proxy
 * tunnel setup. These are the only failures we retry on another origin.
 */
export function isConnectPhaseError(e: unknown): boolean {
  // Flatten the cause chain: Node's fetch reports a bare "fetch failed" and puts
  // the real reason (cert mismatch, ECONNREFUSED, …) on `cause`. Convex's Rust
  // fetch puts everything in one message. Handle both.
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur instanceof Error && depth < 5; depth++) {
    parts.push(`${cur.name}: ${cur.message}`);
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  const msg = parts.length ? parts.join(" | ") : String(e);
  if (/AbortError|aborted|timed? ?out/i.test(msg)) return false; // post-connect → do NOT retry
  return /CERTIFICATE_VERIFY_FAILED|certificate|altnames|SSL routines|ERR_TLS|tls handshake|client error \(Connect\)|tunnel error|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|dns error|failed to lookup|connection (refused|reset|closed) before/i
    .test(msg);
}

/** Human-readable, ACTIONABLE message for a total origin failure. */
export function originFailureMessage(origins: string[], lastError: unknown): string {
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  const tls = isConnectPhaseError(lastError) && /CERTIFICATE|SSL|certificate/i.test(detail);
  return tls
    ? `cannot reach the app over TLS from Convex (tried ${origins.join(", ")}). The domain's certificate is invalid — re-issue the Railway custom-domain cert, or set INTERNAL_APP_URL in the Convex env to the *.up.railway.app origin. Underlying error: ${detail}`
    : `cannot reach the app from Convex (tried ${origins.join(", ")}): ${detail}`;
}

// Remembers the origin that last connected, so a run does not re-pay the failed
// handshake on every hop. Module scope = per action instance; harmless if reset.
let stickyOrigin: string | null = null;

/** Test hook — clears the last-known-good origin. */
export function resetOriginCache(): void {
  stickyOrigin = null;
}

export type AppFetchOptions = { preferredOrigin?: string };

/**
 * `fetch` against the Next app with origin failover.
 * @param path absolute path beginning with "/" (e.g. "/api/video/download").
 * Throws the last error (wrapped by {@link originFailureMessage}) when every
 * origin fails at connect time.
 */
export async function appFetch(path: string, init: RequestInit, opts: AppFetchOptions = {}): Promise<Response> {
  const all = appOrigins(opts.preferredOrigin);
  if (all.length === 0) {
    throw new Error("no app origin configured — set NEXT_PUBLIC_APP_URL (or INTERNAL_APP_URL) in the Convex deployment env");
  }
  // Try the last-known-good origin first, then the rest in priority order.
  const ordered = stickyOrigin && all.includes(stickyOrigin)
    ? [stickyOrigin, ...all.filter((o) => o !== stickyOrigin)]
    : all;

  let lastError: unknown = new Error("no attempt made");
  for (let i = 0; i < ordered.length; i++) {
    const origin = ordered[i];
    try {
      const res = await fetch(`${origin}${path}`, init);
      stickyOrigin = origin;
      return res;
    } catch (e) {
      lastError = e;
      if (!isConnectPhaseError(e)) throw e; // timeout/abort → caller's existing handling
      if (stickyOrigin === origin) stickyOrigin = null;
      // Only narrate when there is actually a fallback left; the final failure is
      // reported by the caller (and by originFailureMessage below), so a warn here
      // for the last origin would just double-log.
      if (i < ordered.length - 1) {
        console.warn(`[appFetch] ${origin}${path} failed at connect: ${e instanceof Error ? e.message : e} — trying next origin`);
      }
    }
  }
  throw new Error(originFailureMessage(ordered, lastError));
}
