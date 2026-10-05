import { expect, type Page } from "@playwright/test";

/**
 * Tier B surface helpers — the prod-404-gated MINTED demo clipper at
 * /dev/clipper. It mounts <AgentWorkspace> with a mint-bypassed demo agent and a
 * FAKE Convex client returning deterministic canned data (all mutations no-op).
 * This is the only auth-free way to exercise post-mint flows (Posting, calendar,
 * mint-unlocked tabs) without real Privy/SIWS auth or live secrets.
 *
 * NOTE: /dev/clipper 404s when NODE_ENV === "production" (build-time inlined), so
 * these helpers + the specs that use them only work against a `next dev` server.
 */
export const DEV_CLIPPER_URL = "/dev/clipper";

/** The dev page's bottom-left navigator labels (Screens · dev). */
export type DevScreen =
  | "Home" | "Clipping" | "Marketplace" | "Library" | "Posting"
  | "Tasks" | "Generations" | "Budget" | "Director" | "History";

/** Open /dev/clipper and wait for the workspace + the dev navigator to mount. */
export async function openDevClipper(page: Page) {
  await page.goto(DEV_CLIPPER_URL);
  // The bottom-left dev navigator is the reliable "page is interactive" signal.
  await expect(page.getByText("Screens · dev")).toBeVisible({ timeout: 30_000 });
}

/**
 * Switch tabs. The dev navigator and the workspace tab bar BOTH render a button
 * with the screen label; we click the workspace tab bar entry (top of page) so
 * the assertion targets the real workspace tab, falling back to the navigator.
 */
export async function gotoScreen(page: Page, screen: DevScreen) {
  // Workspace tab bar buttons are exact-text; the dev navigator entries carry a
  // note line so they're NOT exact. Prefer an exact match (the tab bar).
  const tabBarBtn = page.getByRole("button", { name: screen, exact: true });
  if (await tabBarBtn.count()) {
    await tabBarBtn.first().click();
    return;
  }
  // Director/History are not in the clipper tab bar — drive them via the dev
  // navigator (non-exact, label is the leading text of the button).
  await page.getByRole("button", { name: new RegExp(`^${screen}`) }).first().click();
}
