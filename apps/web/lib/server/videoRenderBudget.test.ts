import { describe, it, expect } from "vitest";
import { CLIP_RENDER_BUDGET_MS, clipPollBudgetMs } from "./videoRenderBudget";

describe("clip render budget", () => {
  const now = 1_000_000;

  it("polls far longer than the old hard 180s cap when a full route budget remains", () => {
    // The timeout bug: clip polling was capped at 180s under a 300s route, so a
    // still-processing veo task was abandoned early. The poll must now use nearly
    // the whole invocation budget.
    expect(clipPollBudgetMs(now + CLIP_RENDER_BUDGET_MS, now)).toBeGreaterThan(180_000);
  });

  it("keeps the whole clip budget safely under the 300s route maxDuration", () => {
    expect(CLIP_RENDER_BUDGET_MS).toBeGreaterThan(180_000);
    expect(CLIP_RENDER_BUDGET_MS).toBeLessThan(300_000);
  });

  it("returns the remaining budget minus a small safety margin", () => {
    expect(clipPollBudgetMs(now + 200_000, now)).toBe(195_000);
  });

  it("floors to a usable minimum when little budget remains", () => {
    expect(clipPollBudgetMs(now + 10_000, now)).toBe(45_000);
  });
});
