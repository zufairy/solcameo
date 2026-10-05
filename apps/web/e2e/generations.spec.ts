import { test, expect } from "@playwright/test";
import { openDevClipper, gotoScreen } from "./lib/dev-clipper";

/**
 * Tier B (post-mint) — Generations + History contract on /dev/clipper.
 *
 * Product direction removed the inline clip-card grid from both the Generations
 * tab's History section and the standalone History screen — they now show a
 * SUMMARY only (header + count). These tests are the regression guard against
 * the grid silently coming back.
 */

test.describe("generations / history (post-mint, /dev/clipper)", () => {
  test("Generations tab shows the Clips header (summary), not a clip-card grid", async ({ page }) => {
    await openDevClipper(page);
    await gotoScreen(page, "Generations");

    // The clipping Generations pane leads with the "Clips" heading + the URL
    // input — the summary surface.
    await expect(page.getByRole("heading", { name: "Clips", exact: true })).toBeVisible();

    // Contract: no inline per-clip <video> grid in this pane (the removed grid
    // rendered <video> elements; the summary renders none).
    await expect(page.locator("section video")).toHaveCount(0);
  });

  test("History summary renders header + count only, with no clip cards", async ({ page }) => {
    await openDevClipper(page);
    // History is a clipper-hidden alias (folded into Generations) — reach it via
    // the dev navigator. It renders either the empty state or the summary header.
    await gotoScreen(page, "History");

    await expect(
      page.getByText(/No clips yet|clips? generated on this agent/i).first(),
    ).toBeVisible();

    // Summary-only: no clip-card video previews.
    await expect(page.locator("video")).toHaveCount(0);
  });
});
