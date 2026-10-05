import { test as base, expect, type Page } from "@playwright/test";

/**
 * Zero-tolerance console/page-error fixture (Phase 6). Every audit spec uses this
 * `test`; a route that logs a console error or throws a page error FAILS.
 * The ALLOW list is the ONLY escape hatch — every entry needs a justification
 * comment. Start empty; add a pattern only after confirming it is genuinely benign.
 */
const ALLOW: RegExp[] = [
  // Chromium reports the page's own initial-navigation request as "failed" with
  // ERR_ABORTED when it's superseded (client-side nav takeover / prefetch cancel) —
  // not a real network failure. Observed on every route on first load; benign.
  /net::ERR_ABORTED/,
  // Dev-only Privy iframe/CSP noise — VERIFIED not present in prod (live velloagents.com is
  // console-clean on /, /market, /agents; see AUDIT/bugs.md BUG-013/014/015,
  // "RECLASSIFIED → DEV-ONLY, NOT REAL... WON'T FIX"). `next dev` serves unminified
  // assets and Privy's cross-origin auth iframe trips the local dev CSP differently
  // than prod's: BUG-014 is the frame-ancestors block itself, BUG-015 is the
  // resulting 403 on that framed resource, and BUG-013 is the browser trying (and
  // failing) to parse the 403 response body as a script.
  /Framing 'https:\/\/auth\.privy\.io\/' violates the following Content Security Policy/,
  /Failed to load resource: the server responded with a status of 403/,
  /Invalid or unexpected token/,
  // Base UI dev-only warning (library-internal `nativeButton` heuristic logging) —
  // stripped from a prod build's console output; not app code.
  /Base UI: A component that acts as a button/,
];

type Fixtures = { errors: string[] };

export const test = base.extend<Fixtures>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !ALLOW.some((r) => r.test(m.text()))) errors.push(`[console.error] ${m.text()}`);
    });
    page.on("pageerror", (e) => {
      if (!ALLOW.some((r) => r.test(e.message))) errors.push(`[pageerror] ${e.message}`);
    });
    // Failed network requests during a load are also bugs (Phase 4). Check the
    // ALLOW list against BOTH the error code and the URL — e.g. `net::ERR_ABORTED`
    // lives in the error code, not the URL, so a URL-only test would never match it.
    page.on("requestfailed", (r) => {
      const u = r.url();
      const errorText = r.failure()?.errorText ?? "";
      if (u.startsWith("http://localhost:3000") && !ALLOW.some((rx) => rx.test(errorText) || rx.test(u))) {
        errors.push(`[requestfailed] ${errorText} ${u}`);
      }
    });
    await use(errors);
  },
});

export { expect };

/** Assert the collected console/page/network errors are empty (call at end of a test). */
export function assertClean(errors: string[]) {
  expect(errors, `Runtime errors on this route:\n${errors.join("\n")}`).toEqual([]);
}

/** Inject axe-core (present in node_modules) and return serious+critical violations. */
export async function axeSeriousCritical(page: Page) {
  await page.addScriptTag({ path: require.resolve("axe-core") });
  const res: { violations: Array<{ id: string; impact: string; help: string; nodes: unknown[] }> } =
    await page.evaluate(async () => {
      // @ts-expect-error axe injected on window
      return await window.axe.run(document, { resultTypes: ["violations"] });
    });
  return (res.violations || [])
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
}

/** Wait for the page to be visually settled before a screenshot/scan. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready).catch(() => {});
}
