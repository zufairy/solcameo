/**
 * Feature flags. Read from build/runtime env with safe defaults when unset.
 */

/**
 * Whether the Invest feature (buying shares in AI agents) is turned ON.
 *
 * Default OFF. The invest numbers are demo-grade and buying shares moves REAL
 * USDC, so the whole buy path is gated behind this single flag:
 *   - the /market "Invest" column button (shows "Coming soon" when off)
 *   - the agent-detail invest widget (shows a "Coming soon" card when off)
 *   - the /api/market/buy-shares + /api/market/test-invest routes (403 when off)
 *   - the Convex `shares.buyShares` mutation (throws when off — defense in depth)
 *
 * REDEEM is intentionally NOT gated — existing holders can always exit.
 *
 * To RE-ENABLE, set `NEXT_PUBLIC_INVEST_ENABLED="true"` in BOTH places:
 *   - Next (Railway): set the var and REBUILD — NEXT_PUBLIC_* is inlined at build.
 *   - Convex: `npx convex env set NEXT_PUBLIC_INVEST_ENABLED true` (gates the mutation).
 *
 * `process.env.NEXT_PUBLIC_INVEST_ENABLED` is build-inlined in client bundles and
 * read at runtime on the server / in Convex — so the one env name works everywhere.
 */
export function investEnabled(): boolean {
  return process.env.NEXT_PUBLIC_INVEST_ENABLED === "true";
}

/**
 * Whether the legacy (pre-Solstar) UI is exposed: the old landing page and
 * old top-nav items. Default OFF; only the exact string "true" enables it.
 * NEXT_PUBLIC_* is inlined at build time.
 */
export function legacyUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LEGACY_UI === "true";
}
