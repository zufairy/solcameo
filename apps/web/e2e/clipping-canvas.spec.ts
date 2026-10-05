import { test, expect, type Page } from "@playwright/test";

/**
 * Functional E2E for the clipping Flow canvas. NO pipeline runs (zero API
 * spend) — covers the UI/UX contract: tabs, canvas, palette, drag-to-create,
 * inspector, marketplace, history, and the no-URL run guard.
 *
 * The canvas starts EMPTY (no seeded demo graph) — tests that need nodes drag
 * them in from the palette exactly like an operator would.
 */

const CLIPPING_URL = "/builder?type=clipping";

async function openClippingTab(page: Page) {
  await page.goto(CLIPPING_URL);
  // The workspace defaults to Home; move to the Clipping tab.
  await page.getByRole("button", { name: "Clipping", exact: true }).first().click();
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 15_000 });
}

/** HTML5 drag from a palette entry onto the canvas pane (the palette sets
 *  dataTransfer in dragstart; the pane's onDrop reads it). */
async function dragFromPalette(page: Page, entryText: string, x = 400, y = 300) {
  await page.getByRole("button", { name: "Add nodes" }).click();
  await expect(page.getByText("Drag onto the canvas")).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const entry = page.locator("[draggable]", { hasText: entryText }).first();
  await entry.dispatchEvent("dragstart", { dataTransfer });
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await pane.dispatchEvent("drop", { dataTransfer, clientX: box.x + x, clientY: box.y + y });
}

test.describe("clipping canvas", () => {
  test("canvas starts empty with the template picker cards", async ({ page }) => {
    await openClippingTab(page);
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await expect(page.getByText("Start with a template")).toBeVisible();
    // All three starter templates offered.
    await expect(page.getByText("Podcast Clipper")).toBeVisible();
    await expect(page.getByText("Hormozi Bold")).toBeVisible();
    await expect(page.getByText("Campaign Hunter")).toBeVisible();
    // Run bar present with the Run button.
    await expect(page.getByRole("button", { name: /Run pipeline/i })).toBeVisible();
  });

  test("applying a template populates a wired graph and opens the Source inspector", async ({ page }) => {
    await openClippingTab(page);
    await page.locator("button", { hasText: "Podcast Clipper" }).first().click();
    // 5 nodes: Source → Face Track → Dynamic Captions → Filler Cut → Publish.
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    // Source node auto-selected → inspector prompts for the URL.
    await expect(page.getByText("Source video", { exact: true })).toBeVisible();
    // URL/Upload toggle present.
    await expect(page.getByRole("button", { name: "Paste URL" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload file" })).toBeVisible();
    // Template cards are gone once the canvas has nodes.
    await expect(page.getByText("Start with a template")).toBeHidden();
  });

  test("node palette opens via the + FAB, scrolls, and closes on outside click", async ({ page }) => {
    await openClippingTab(page);
    await page.getByRole("button", { name: "Add nodes" }).click();
    await expect(page.getByText("Drag onto the canvas")).toBeVisible();
    await expect(page.getByText("SOURCES", { exact: false }).first()).toBeVisible();
    // "Your skills" section exists (marketplace skills area).
    await expect(page.getByText("Your skills", { exact: true })).toBeVisible();
    // Click the canvas pane → palette collapses.
    // Raw mouse click on canvas coordinates — the outside-click handler listens
    // on window pointerdown, and page.mouse bypasses Playwright's interception
    // checks (the centered template-card overlay made element clicks flaky
    // across viewport sizes).
    const pane = await page.locator(".react-flow__pane").boundingBox();
    await page.mouse.click(pane!.x + 40, pane!.y + 40);
    await expect(page.getByText("Drag onto the canvas")).toBeHidden();
  });

  test("dragging Source from the palette creates a node; inspector shows clip controls", async ({ page }) => {
    await openClippingTab(page);
    await dragFromPalette(page, "Video URL to clip");
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await page.locator(".react-flow__node", { hasText: "Source" }).first().click();
    await expect(page.getByText("Source video", { exact: true })).toBeVisible();
    // URL/Upload toggle present.
    await expect(page.getByRole("button", { name: "Paste URL" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload file" })).toBeVisible();
    await expect(page.getByText(/Min clip length/)).toBeVisible();
    await expect(page.getByText(/Max clip length/)).toBeVisible();
    await expect(page.getByText("Clip feel", { exact: true })).toBeVisible();
    // Genre chip row (OpusClip parity) with the AI-detect default.
    await expect(page.getByRole("button", { name: /Let AI detect/i })).toBeVisible();
  });

  test("running on an empty canvas shows the guard hint instead of crashing", async ({ page }) => {
    await openClippingTab(page);
    await page.getByRole("button", { name: /Run pipeline/i }).click();
    await expect(page.getByText(/Add a video URL to the Source node first/i)).toBeVisible();
  });

  test("marketplace lists the clip skills with search + category filters", async ({ page }) => {
    await openClippingTab(page);
    await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
    await expect(page.getByText("Dynamic Captions").first()).toBeVisible();
    await expect(page.getByText("Face Track").first()).toBeVisible();
    await expect(page.getByText("Prompt to Clip").first()).toBeVisible();
    await expect(page.getByText("Campaign Scout").first()).toBeVisible();
    await expect(page.getByText("Filler Cut").first()).toBeVisible();

    // Search narrows the list.
    await page.getByPlaceholder("Search skills…").fill("face");
    await expect(page.getByText("Face Track").first()).toBeVisible();
    await expect(page.getByText("Filler Cut")).toHaveCount(0);
    await page.getByPlaceholder("Search skills…").fill("");

    // Category chip filters to one group.
    await page.getByRole("button", { name: "Framing", exact: true }).click();
    await expect(page.getByText("Face Track").first()).toBeVisible();
    await expect(page.getByText("Campaign Scout")).toHaveCount(0);
  });

  test("history tab renders (empty state or clip cards with status badges)", async ({ page }) => {
    await openClippingTab(page);
    await page.getByRole("button", { name: "History", exact: true }).first().click();
    // Either the empty state or the populated header is acceptable.
    await expect(page.getByText(/No clips yet|clips? generated on this agent/i).first()).toBeVisible();
  });

  test("canvas state survives a tab roundtrip (Clipping → Home → Clipping)", async ({ page }) => {
    await openClippingTab(page);
    await dragFromPalette(page, "Video URL to clip");
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await page.getByRole("button", { name: "Home", exact: true }).first().click();
    await page.getByRole("button", { name: "Clipping", exact: true }).first().click();
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
  });
});
