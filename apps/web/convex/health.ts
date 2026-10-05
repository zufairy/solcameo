import { query, action } from "./_generated/server";
import { appOrigins, appFetch } from "./lib/appFetch";

/**
 * Tiny public health/deploy check — lets us (and uptime monitors) confirm the
 * Convex backend is reachable and on the latest push. `marker` is bumped when we
 * want to verify an auto-deploy actually shipped to prod.
 */
export const deployPing = query({
  args: {},
  handler: async () => ({
    ok: true as const,
    marker: "autodeploy-2026-06-16",
  }),
});

/**
 * The origins THIS Convex deployment would call the Next app on, in order.
 *
 * The Convex env is edited in a different console from the Next app's, so it
 * silently goes stale when a domain moves — which is exactly how clip runs kept
 * dialing a retired hostname and dying at CERTIFICATE_VERIFY_FAILED, with the
 * only evidence buried in a run log. Surfacing the resolved list makes that
 * visible from the outside (/api/health/config folds it in).
 *
 * Public and safe: origins only, no secrets, no env values beyond the hostnames
 * the app already serves traffic on.
 */
export const callbackOrigins = query({
  args: {},
  handler: async () => ({ origins: appOrigins() }),
});

/**
 * Actually PERFORM the hop the clip pipeline depends on, from Convex's own
 * runtime (Rust/reqwest + BoringSSL — the strict verifier that produced
 * CERTIFICATE_VERIFY_FAILED against the retired domain). `callbackOrigins` shows
 * intent; this proves the TLS handshake and the round trip succeed.
 *
 * Hits the cheap `?probe=1` short-circuit in /api/health/config — no side
 * effects, no auth needed, nothing spent. Run it after any domain or env change:
 *   npx convex run health:callbackProbe '{}'
 */
export const callbackProbe = action({
  args: {},
  handler: async (): Promise<{ ok: boolean; status?: number; origins: string[]; error?: string }> => {
    const origins = appOrigins();
    try {
      const res = await appFetch("/api/health/config?probe=1", { method: "GET" });
      return { ok: res.ok, status: res.status, origins };
    } catch (e) {
      return { ok: false, origins, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
