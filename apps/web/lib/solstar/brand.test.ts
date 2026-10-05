import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";

describe("BRAND", () => {
  it("exposes the Solcameo name and tagline", () => {
    expect(BRAND.name).toBe("Solcameo");
    expect(BRAND.tagline).toBe("Launch a meme that keeps making videos");
  });
  it("does not use the old Solstar name", () => {
    expect(BRAND.name).not.toContain("Solstar");
  });
});
