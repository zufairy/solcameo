import type { NextRequest } from "next/server";

/**
 * Loopback base for firing same-server self-calls (most reliable on a single-server
 * host like Railway — hits this node process directly, no DNS/TLS/edge round-trip).
 * Override with INTERNAL_SELF_BASE_URL on hosts where loopback can't reach the app
 * (e.g. Vercel serverless, where you'd set it to the public URL).
 */
export function selfLoopbackBase(): string {
  return (process.env.INTERNAL_SELF_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`).replace(/\/+$/, "");
}

/**
 * Candidate base URLs for calling THIS server's own /api routes from a route
 * handler, best→worst. Loopback first because a container often CANNOT fetch its
 * own public URL (DNS/TLS/edge-proxy round-trip) — the classic "TypeError: fetch
 * failed" on a self-call. Loopback (127.0.0.1:$PORT) hits the same node process
 * directly on a single-server host (Railway / self-hosted).
 */
function selfBaseCandidates(req?: NextRequest): string[] {
  const out: string[] = [];
  const port = process.env.PORT || "3000";
  out.push(`http://127.0.0.1:${port}`);
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) out.push(env.replace(/\/+$/, ""));
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) out.push(`${proto}://${host}`);
    try { out.push(new URL(req.url).origin); } catch { /* ignore */ }
  }
  return Array.from(new Set(out.filter(Boolean)));
}

/**
 * POST/GET one of THIS server's own /api routes, trying loopback first then the
 * public origin. `fetch` only throws on connection-level failures (not on HTTP
 * 4xx/5xx), so we fall through to the next base ONLY on a real connection error
 * and otherwise return the first real Response. Fixes "fetch failed" self-calls.
 *
 * @param path  path beginning with "/api/..."
 */
export async function fetchSelf(path: string, init: RequestInit, req?: NextRequest): Promise<Response> {
  const bases = selfBaseCandidates(req);
  let lastErr: unknown;
  for (const base of bases) {
    try {
      return await fetch(`${base}${path}`, init);
    } catch (e) {
      lastErr = e; // connection failure (DNS/TLS/refused) → try the next base
      console.warn(`[fetchSelf] ${base}${path} failed (${e instanceof Error ? e.message : e}); trying next base`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetchSelf: all bases failed for ${path}`);
}
