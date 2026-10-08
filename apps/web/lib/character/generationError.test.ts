import { expect, it } from "vitest";
import { generationError } from "./generationError";

it("explains a model outage without losing the reference", () => {
  expect(generationError("failed", "This model is temporarily unavailable. Please try again later or contact support.")).toContain("image model is temporarily unavailable");
});
it("preserves useful provider errors and handles moderation and cancellation", () => {
  expect(generationError("failed", "Insufficient credits")).toBe("Insufficient credits");
  expect(generationError("nsfw", "internal detail")).toBe("Blocked by content moderation");
  expect(generationError("canceled")).toBe("Generation canceled");
  expect(generationError("failed")).toContain("Try again");
});
