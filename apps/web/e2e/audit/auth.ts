import type { BrowserContext } from "@playwright/test";

/**
 * Arms an authenticated session for the dev-gated E2E_AUTH_BYPASS seam (see
 * .superpowers/sdd/e2e-auth-seam-report.md). Writes localStorage["vello.e2e.session"]
 * BEFORE app scripts run; the client seam then reports authenticated + the fetch
 * interceptor attaches X-E2E-* headers so server /api routes set provenWallet.
 *
 * Requires the running dev server to have NEXT_PUBLIC_E2E_AUTH_BYPASS=1 + E2E_AUTH_BYPASS=1
 * + E2E_AUTH_BYPASS_SECRET (they're in .env.local), and Playwright's process to see the
 * same secret (playwright.config.ts loads .env.local via dotenv).
 */
export const E2E_SECRET = process.env.E2E_AUTH_BYPASS_SECRET || "";

/** A syntactically valid base58 pubkey that owns nothing in Vello (System Program addr). */
export const TEST_WALLET = "11111111111111111111111111111111";

export async function armSession(
  context: BrowserContext,
  opts: { wallet?: string; did?: string; isAdmin?: boolean } = {},
) {
  const session = {
    wallet: opts.wallet ?? TEST_WALLET,
    did: opts.did ?? "did:privy:e2e-user-1",
    isAdmin: opts.isAdmin ?? false,
    secret: E2E_SECRET,
  };
  await context.addInitScript((s) => {
    // addInitScript runs in EVERY new document created in this context — including
    // cross-origin iframes (e.g. Privy's auth.privy.io login frame), where reading/
    // writing `window.localStorage` throws ("Failed to read the 'localStorage'
    // property from 'Window': Access is denied for this document"). Only the
    // TOP frame's storage matters (that's what the app under test reads), so scope
    // the write to it and swallow anything unexpected defensively.
    if (window.top === window) {
      try {
        window.localStorage.setItem("vello.e2e.session", JSON.stringify(s));
      } catch {
        /* storage access blocked — nothing to do */
      }
    }
  }, session);
}
