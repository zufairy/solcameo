import { describe, it, expect, afterEach } from "vitest";
import { legacyUiEnabled } from "./flags";

afterEach(() => { delete process.env.NEXT_PUBLIC_LEGACY_UI; });
describe("legacyUiEnabled", () => {
  it("is off by default and on only for the exact string true", () => {
    expect(legacyUiEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_LEGACY_UI = "1";
    expect(legacyUiEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_LEGACY_UI = "true";
    expect(legacyUiEnabled()).toBe(true);
  });
});
