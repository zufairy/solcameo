// @vitest-environment node
import { describe, it, expect } from "vitest";
import { withTimeout } from "./withTimeout";

// Bounds a promise that might hang (e.g. a stalled whole-source download whose
// own retry/abort never fires) so the caller fails fast instead of waiting out a
// far-downstream deadline.
describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "too slow")).resolves.toBe("ok");
  });

  it("rejects with the message when the timeout fires first (the hung case)", async () => {
    const never = new Promise<string>(() => {}); // never settles
    await expect(withTimeout(never, 20, "pull stalled")).rejects.toThrow("pull stalled");
  });

  it("propagates the promise's own rejection if it loses the race", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "too slow")).rejects.toThrow("boom");
  });
});
