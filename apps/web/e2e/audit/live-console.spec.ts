import { test } from "@playwright/test";

/**
 * Read-only classification pass against the LIVE prod site (velloagents.com) — does the
 * Privy-cluster console noise (CSP framing / 403 / pageerror) seen locally also
 * appear in production? Prod is a minified build, so React dev warnings (key,
 * setState) will NOT appear here (they're real bugs, just dev-only logs). No auth,
 * no mutations — pure page load + console capture.
 */
const LIVE = "https://velloagents.com";

for (const path of ["/", "/market", "/agents"]) {
  test(`LIVE ${path}`, async ({ page }) => {
    const errs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(`[console] ${m.text()}`); });
    page.on("pageerror", (e) => errs.push(`[pageerror] ${e.message}`));
    await page.goto(LIVE + path, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => errs.push(`[goto] ${e.message}`));
    await page.waitForTimeout(4000);

    console.log(`\n===== LIVE ${path}: ${errs.length} console/page errors =====\n${errs.join("\n") || "(none)"}\n`);
  });
}
