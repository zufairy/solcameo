import { test, expect, type Page, type Locator } from "@playwright/test";
import { openDevClipper, gotoScreen } from "./lib/dev-clipper";

/**
 * Visual-snapshot baselines (project: "snapshot"). Element-scoped screenshots
 * (not full-page) to minimise flake; dynamic regions (timestamps, balances,
 * avatars, <video> thumbnails) are masked. Animations/caret are disabled and a
 * 0.01 maxDiffPixelRatio is applied globally in playwright.config.ts.
 *
 * Baselines are generated ONCE by a human and committed — see e2e/README.md:
 *   npm run e2e -- --project=snapshot --update-snapshots
 * Review the generated PNGs before committing; they are the human-approved
 * pixel contract. CI must run the SAME OS baseline set (or its own Linux set).
 *
 * Tier A (pre-mint) snapshots use /builder?type=clipping; Tier B (post-mint)
 * snapshots use /dev/clipper (404 in prod by design).
 */

const CLIPPING_URL = "/builder?type=clipping";

/** Common masks for dynamic content that must never gate a pixel baseline. */
function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator("video"),
    page.locator("img"),
    // Timezone/offset + tabular time/balance chips drift with the clock/env.
    page.locator(".tabular-nums"),
  ];
}

async function openClippingTabA(page: Page) {
  await page.goto(CLIPPING_URL);
  await page.getByRole("button", { name: "Clipping", exact: true }).first().click();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });
}

test.describe("visual snapshots", () => {
  // ── V6 / V5: wired graph + Compose node handles (Tier A) ─────────────────
  test("V6 wired graph after Podcast Clipper template", async ({ page }) => {
    await openClippingTabA(page);
    await page.locator("button", { hasText: "Podcast Clipper" }).first().click();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    const viewport = page.locator(".react-flow__viewport");
    await expect(viewport).toHaveScreenshot("v6-wired-graph.png", {
      mask: dynamicMasks(page),
    });
  });

  test("V5 Compose node with top/bottom skill handles", async ({ page }) => {
    await openClippingTabA(page);
    await page.locator("button", { hasText: "Hormozi Bold" }).first().click();
    const compose = page.locator(".react-flow__node", { hasText: "Compose" }).first();
    await expect(compose).toBeVisible();
    await expect(compose).toHaveScreenshot("v5-compose-node.png");
  });

  // ── V12 / V11: run bar idle + confirm dialog (Tier A) ────────────────────
  test("V12 run bar idle state", async ({ page }) => {
    await openClippingTabA(page);
    await page.locator("button", { hasText: "Podcast Clipper" }).first().click();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    // The run bar pill is the dark rounded toolbar holding the status + Run button.
    const runBar = page.getByRole("button", { name: /Run pipeline/i }).locator("xpath=ancestor::div[1]");
    await expect(runBar).toHaveScreenshot("v12-run-bar-idle.png", {
      mask: [page.locator(".tabular-nums")],
    });
  });

  test("V11 run-confirm dialog", async ({ page }) => {
    await openClippingTabA(page);
    await page.locator("button", { hasText: "Podcast Clipper" }).first().click();
    await page.getByRole("button", { name: "Paste URL" }).click();
    await page.getByPlaceholder("https://youtube.com/… or .mp4")
      .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: /Run pipeline/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Run the pipeline?" })).toBeVisible();
    await expect(dialog).toHaveScreenshot("v11-run-confirm-dialog.png", {
      mask: [page.locator(".tabular-nums")],
    });
  });

  // ── V9: pre-mint workspace (Earnings hidden + tabs locked) (Tier A) ──────
  test("V9 pre-mint workspace lock panel (Earnings hidden)", async ({ page }) => {
    await page.goto(CLIPPING_URL);
    // Click a non-home clipper tab → the mint-lock panel renders.
    await page.getByRole("button", { name: "Posting", exact: true }).first().click();
    const lock = page.getByText(/Mint your agent to unlock/i);
    await expect(lock).toBeVisible();
    // No Earnings heading exists pre-mint anywhere.
    await expect(page.getByText("Earnings", { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).toHaveScreenshot("v9-premint-lock.png", {
      mask: dynamicMasks(page),
    });
  });

  // ── Tier B (post-mint, /dev/clipper) ─────────────────────────────────────
  test("V1 posting status strip (auto-post toggle + counts)", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");
    const strip = page.getByRole("switch", { name: "Auto-post" })
      .locator("xpath=ancestor::div[contains(@class,'border-2')][1]");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveScreenshot("v1-posting-status-strip.png", {
      // Timezone + offset + counts are env/clock-relative.
      mask: [page.locator(".tabular-nums")],
    });
  });

  test("V2 Connections Show pill", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");
    const summary = page.getByText("Connections", { exact: true })
      .locator("xpath=ancestor::summary[1]");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveScreenshot("v2-connections-show-pill.png");
  });

  test("V3 schedule calendar month grid", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");
    const toggle = page.getByRole("switch", { name: "Auto-post" });
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await page.getByRole("button", { name: /^Calendar/ }).first().click();
    const grid = page.locator(".grid-cols-7").last();
    await expect(grid).toBeVisible({ timeout: 15_000 });
    await expect(grid).toHaveScreenshot("v3-calendar-month-grid.png", {
      // Day numbers + entry times are date-relative; mask the dynamic chips.
      mask: [page.locator("video"), page.locator("img")],
    });
  });

  test("V7 Generations summary pane", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Generations");
    const heading = page.getByRole("heading", { name: "Clips", exact: true });
    await expect(heading).toBeVisible();
    const pane = heading.locator("xpath=ancestor::section[1]");
    await expect(pane).toHaveScreenshot("v7-generations-summary.png", {
      mask: dynamicMasks(page),
    });
  });

  test("V10 post-mint workspace (tabs unlocked)", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Home");
    // The tab bar (top) — unlocked, all clipper tabs present. Mask dynamic body.
    const tabBar = page.getByRole("button", { name: "Posting", exact: true })
      .locator("xpath=ancestor::div[1]");
    await expect(tabBar).toBeVisible();
    await expect(tabBar).toHaveScreenshot("v10-postmint-tabbar.png");
  });
});
