import { describe, expect, it, vi } from "vitest";
import { computeMenuPosition } from "./CreateMenu";

const rect = (r: Partial<DOMRect>): DOMRect => ({
  top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r,
});

describe("computeMenuPosition (control page '+' dropdown)", () => {
  it("opens to the right of the button when there's room (the wide-sidebar case)", () => {
    vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 900 });
    const pos = computeMenuPosition(rect({ top: 100, right: 300, bottom: 140 }));
    expect(pos).toEqual({ top: 100, left: 308 });
    vi.unstubAllGlobals();
  });

  it("falls back to opening below the button when the right side has no room (the collapsed rail case)", () => {
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 900 });
    // Button near the right edge — right + gap + menu width would overflow.
    const pos = computeMenuPosition(rect({ top: 50, right: 380, bottom: 90 }));
    expect(pos.top).toBe(98); // below the button, not to its right
    expect(pos.left).toBeLessThanOrEqual(400 - 300 - 8);
  });

  it("never places the menu off the left edge of the viewport", () => {
    vi.stubGlobal("window", { innerWidth: 320, innerHeight: 800 });
    const pos = computeMenuPosition(rect({ top: 10, right: 310, bottom: 50 }));
    expect(pos.left).toBeGreaterThanOrEqual(8);
    vi.unstubAllGlobals();
  });

  it("never places the menu below the bottom edge of the viewport", () => {
    vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 300 });
    const pos = computeMenuPosition(rect({ top: 250, right: 900, bottom: 290 }));
    expect(pos.top).toBeLessThanOrEqual(300 - 8);
    vi.unstubAllGlobals();
  });
});
