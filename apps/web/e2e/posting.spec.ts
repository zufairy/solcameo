import { test, expect } from "@playwright/test";
import { openDevClipper, gotoScreen } from "./lib/dev-clipper";

/**
 * Tier B (post-mint) — Posting tab on /dev/clipper.
 * Covers: the Auto-post switch, the Connections "Show" disclosure pill, the
 * calendar today-highlight + first-preview-not-before-today regression guard,
 * and the mint-unlocked tab contract.
 *
 * All Convex writes are no-ops on /dev/clipper, so the toggle updates LOCAL UI
 * state only — perfect for deterministic assertions, zero side effects.
 */

test.describe("posting (post-mint, /dev/clipper)", () => {
  test("Auto-post switch flips aria-checked + On/Off label", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");

    const toggle = page.getByRole("switch", { name: "Auto-post" });
    await expect(toggle).toBeVisible();

    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    const after = await toggle.getAttribute("aria-checked");
    expect(after).not.toBe(before);

    // The "On"/"Off" pill mirrors the new state.
    const expectedLabel = after === "true" ? "On" : "Off";
    await expect(
      page.getByText(expectedLabel, { exact: true }).first(),
    ).toBeVisible();
  });

  test("Connections disclosure shows the green Show pill and expands to Hide", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");

    // The disclosure summary row carries "Connections" + a "Show" pill (collapsed)
    // that swaps to "Hide" once <details> is open.
    await expect(page.getByText("Connections", { exact: true })).toBeVisible();
    const showPill = page.getByText("Show", { exact: true });
    await expect(showPill).toBeVisible();

    await showPill.click();
    await expect(page.getByText("Hide", { exact: true })).toBeVisible();
  });

  test("mint-unlocked tabs render content, not the lock panel", async ({ page }) => {
    await openDevClipper(page);
    // No "Mint your agent to unlock" panel should ever appear on a minted agent.
    for (const screen of ["Posting", "Library", "Marketplace"] as const) {
      await gotoScreen(page, screen);
      await expect(page.getByText(/Mint your agent to unlock/i)).toHaveCount(0);
    }
  });

  // ── Calendar: today-highlight + first-preview-not-before-today ─────────────
  // The "first slot lands on a PRIOR day" bug. With Auto-post ON the Calendar
  // tab mounts. We assert the today cell carries the lime day-badge, and that no
  // dashed preview/scheduled chip sits in a day cell ordered BEFORE the today
  // cell. Cells render in document order (earliest → latest), so an index
  // comparison is a sound "not before today" check.
  test("calendar highlights today and no preview chip lands before today", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Posting");

    // Ensure Auto-post is ON so the Calendar tab exists.
    const toggle = page.getByRole("switch", { name: "Auto-post" });
    if ((await toggle.getAttribute("aria-checked")) !== "true") {
      await toggle.click();
    }

    // Open the Calendar tab in the right-hand pane.
    await page.getByRole("button", { name: /^Calendar/ }).first().click();

    // The month grid is the 7-col day container; cells are its direct children.
    // Locate every day cell (each holds a rounded size-6 day badge).
    const dayBadges = page.locator(".grid-cols-7 .rounded-full.tabular-nums");
    await expect(dayBadges.first()).toBeVisible({ timeout: 15_000 });

    // Today's badge is the lime-filled one.
    const todayBadge = page.locator(".grid-cols-7 .rounded-full.bg-lime-500");
    await expect(todayBadge).toHaveCount(1);

    // Index of the today cell among all cells. Cells are siblings under the
    // grid; map each badge to its owning cell, find today's position.
    const todayCellIndex = await page.evaluate(() => {
      const grid = document.querySelector(".grid-cols-7:last-of-type")
        ?? document.querySelector(".grid-cols-7");
      if (!grid) return -1;
      const cells = Array.from(grid.children);
      return cells.findIndex((c) => c.querySelector(".bg-lime-500.rounded-full, .rounded-full.bg-lime-500"));
    });
    expect(todayCellIndex).toBeGreaterThanOrEqual(0);

    // The earliest dashed PREVIEW chip (border-dashed border-lime-500) must sit
    // in a cell at index >= todayCellIndex. If there are no preview chips in
    // this window, the assertion is vacuously satisfied.
    const firstPreviewCellIndex = await page.evaluate(() => {
      const grid = document.querySelector(".grid-cols-7:last-of-type")
        ?? document.querySelector(".grid-cols-7");
      if (!grid) return Number.POSITIVE_INFINITY;
      const cells = Array.from(grid.children);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].querySelector("[class*='border-dashed'][class*='border-lime']")) return i;
      }
      return Number.POSITIVE_INFINITY;
    });
    expect(firstPreviewCellIndex).toBeGreaterThanOrEqual(todayCellIndex);
  });
});
