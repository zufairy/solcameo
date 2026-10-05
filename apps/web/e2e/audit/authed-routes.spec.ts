import { test, expect, axeSeriousCritical, settle } from "./fixtures";
import { armSession } from "./auth";

/**
 * Phase 4 — AUTHENTICATED-route sweep via the dev E2E_AUTH_BYPASS seam. Arms a
 * logged-in session (a fresh test wallet that owns nothing → exercises the
 * authenticated shell + EMPTY states, not another user's data). Each route must:
 * render authenticated (not bounce to a login gate), no console/page errors, no
 * serious/critical a11y, screenshot to AUDIT/evidence/. Owner-data flows (funding,
 * editing a real agent) need seeded test data — tracked separately.
 */

const AUTHED_ROUTES = ["/builder", "/wallet", "/studio", "/stage/create"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const slug = (r: string) => r.replace(/\//g, "_").replace(/^_/, "") || "root";

test.beforeEach(async ({ context }) => {
  await armSession(context);
});

for (const route of AUTHED_ROUTES) {
  test(`authed ${route}`, async ({ page, errors }) => {
    const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(resp?.status(), `HTTP status for ${route}`).toBeLessThan(400);
    await settle(page);

    // The bypass should keep us on the route (not bounce to a login/connect gate).
    expect.soft(page.url(), `authed ${route} stayed on the route`).toContain(route.split("?")[0]);

    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect.soft(overflow, `horizontal overflow on ${route} @ ${v.name}`).toBe(false);
      await page.screenshot({ path: `AUDIT/evidence/authed-${slug(route)}-${v.name}.png`, fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    const violations = await axeSeriousCritical(page);
    await test.info().attach(`axe-authed-${slug(route)}`, { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
    expect.soft(violations, `serious/critical a11y on ${route}`).toEqual([]);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    for (const bad of ["undefined", "NaN", "Invalid Date", "[object Object]"]) {
      expect.soft(bodyText.includes(bad), `authed ${route} renders literal "${bad}"`).toBe(false);
    }

    expect.soft(errors, `runtime errors on ${route}:\n${errors.join("\n")}`).toEqual([]);
  });
}
