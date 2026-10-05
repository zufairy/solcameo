import { describe, it, expect } from "vitest";
import { shouldWarnBeforeRun } from "./connectGate";

describe("shouldWarnBeforeRun (pre-run connect-a-social gate)", () => {
  it("warns when zero accounts are connected and not dismissed", () => {
    expect(
      shouldWarnBeforeRun({ connectedCount: 0, dismissedThisSession: false }),
    ).toBe(true);
  });

  it("does not warn when at least one account is connected", () => {
    expect(
      shouldWarnBeforeRun({ connectedCount: 1, dismissedThisSession: false }),
    ).toBe(false);
    expect(
      shouldWarnBeforeRun({ connectedCount: 3, dismissedThisSession: false }),
    ).toBe(false);
  });

  it("does not warn once the user chose Run anyway this session", () => {
    expect(
      shouldWarnBeforeRun({ connectedCount: 0, dismissedThisSession: true }),
    ).toBe(false);
  });

  it("never false-blocks on an unknown/flaky status read (null)", () => {
    expect(
      shouldWarnBeforeRun({ connectedCount: null, dismissedThisSession: false }),
    ).toBe(false);
    expect(
      shouldWarnBeforeRun({ connectedCount: null, dismissedThisSession: true }),
    ).toBe(false);
  });
});
