import { test, expect, axeSeriousCritical, settle } from "./fixtures";

/**
 * Phase 4/6 — public-route runtime sweep (no auth). Each public route must:
 *  - respond < 400,
 *  - render with ZERO console/page/network errors (the fixture collects them),
 *  - have NO serious/critical axe violations,
 *  - produce a screenshot at desktop/tablet/mobile → AUDIT/evidence/.
 * Uses expect.soft so every issue on a route is reported together (data-gathering),
 * not aborted at the first failure. Reads REAL prod-Convex data (read-only).
 */

const PUBLIC_ROUTES = [
  "/", "/market", "/agents", "/arena", "/generations", "/stage",
  "/pricing", "/hiring", "/docs", "/docs/start", "/docs/build", "/docs/scale", "/docs/sell",
  "/landing2",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const slug = (r: string) => r.replace(/\//g, "_").replace(/^_/, "") || "root";

for (const route of PUBLIC_ROUTES) {
  test(`public ${route}`, async ({ page, errors }) => {
    const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
    // A public route returning >=400 (esp. 500) is a hard failure.
    expect(resp?.status(), `HTTP status for ${route}`).toBeLessThan(400);
    await settle(page);

    // No horizontal scroll at any viewport + capture evidence.
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect.soft(overflow, `horizontal overflow on ${route} @ ${v.name}`).toBe(false);
      await page.screenshot({ path: `AUDIT/evidence/${slug(route)}-${v.name}.png`, fullPage: true });
    }

    // a11y at desktop.
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    const violations = await axeSeriousCritical(page);
    await test.info().attach(`axe-${slug(route)}`, { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
    expect.soft(violations, `serious/critical a11y on ${route}`).toEqual([]);

    // No literal broken values rendered.
    const bodyText = await page.locator("body").innerText().catch(() => "");
    for (const bad of ["undefined", "NaN", "Invalid Date", "[object Object]"]) {
      expect.soft(bodyText.includes(bad), `route ${route} renders literal "${bad}"`).toBe(false);
    }

    // Zero console/page/network errors (collected across the whole test).
    expect.soft(errors, `runtime errors on ${route}:\n${errors.join("\n")}`).toEqual([]);
  });
}
