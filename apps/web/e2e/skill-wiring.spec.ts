import { test, expect, type Page } from "@playwright/test";
import { openDevClipper, gotoScreen } from "./lib/dev-clipper";

/**
 * One-skill-per-category wiring rules. These need INSTALLED marketplace skills,
 * which only exist on the minted /dev/clipper surface (the pre-mint /builder
 * canvas has an empty "Your skills" palette). The demo agent ships Brain Rot +
 * Meme Audio — both "Backgrounds & Audio" — which is exactly the conflict pair.
 *
 * NO pipeline runs here (zero API spend) — pure canvas/store behaviour.
 */

/** Open the dev clipper, go to the Clipping tab, wait for the flow canvas. */
async function openClipping(page: Page) {
  await openDevClipper(page);
  await gotoScreen(page, "Clipping");
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });
}

/** Drag an installed "Your skills" palette entry onto the canvas pane. The
 *  palette sets dataTransfer "application/vello-skill"; the pane's onDrop reads
 *  it and auto-wires the skill downstream of the Compose hub. */
async function dragSkill(page: Page, skillName: string, x = 420, y = 320) {
  await page.getByRole("button", { name: "Add nodes" }).click();
  await expect(page.getByText("Drag onto the canvas")).toBeVisible();
  await expect(page.getByText("Your skills", { exact: true })).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const entry = page.locator("[draggable]", { hasText: skillName }).first();
  await entry.dispatchEvent("dragstart", { dataTransfer });
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await pane.dispatchEvent("drop", { dataTransfer, clientX: box.x + x, clientY: box.y + y });
  // Re-open the palette for the next drag (drop may collapse it).
}

test.describe("skill wiring — one per category (post-mint, /dev/clipper)", () => {
  test("dragging a second same-category skill SWAPS the first with a notice", async ({ page }) => {
    await openClipping(page);

    // First Backgrounds & Audio skill.
    await dragSkill(page, "Brain Rot");
    await expect(page.locator(".react-flow__node", { hasText: "Brain Rot" })).toHaveCount(1);

    // Second Backgrounds & Audio skill → triggers the one-per-category SWAP.
    await dragSkill(page, "Meme Audio", 520, 380);

    // Swap notice banner (transient) — assert the wording.
    await expect(
      page.getByText(/Swapped .* → .* \(one .* skill at a time\)/),
    ).toBeVisible();

    // Net effect: the conflicting Brain Rot node is gone, Meme Audio remains.
    await expect(page.locator(".react-flow__node", { hasText: "Meme Audio" })).toHaveCount(1);
    await expect(page.locator(".react-flow__node", { hasText: "Brain Rot" })).toHaveCount(0);
  });
});
