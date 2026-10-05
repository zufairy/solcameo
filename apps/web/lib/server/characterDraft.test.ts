// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueCharacterJobTicket, verifyCharacterJobTicket } from "./characterDraft";
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("draft generation job ownership", () => {
  it("accepts its owner and job, rejects other drafts and jobs and modified tickets", () => {
    vi.stubEnv("PRIVY_APP_SECRET", "test-key");
    const ticket = issueCharacterJobTicket("draft-owner", "job-123");
    expect(verifyCharacterJobTicket(ticket, "draft-owner", "job-123")).toBe(true);
    expect(verifyCharacterJobTicket(ticket, "draft-attacker", "job-123")).toBe(false);
    expect(verifyCharacterJobTicket(ticket, "draft-owner", "job-other")).toBe(false);
    expect(verifyCharacterJobTicket(ticket + "x", "draft-owner", "job-123")).toBe(false);
  });
  it("expires and fails closed when signing credentials are absent", () => {
    vi.stubEnv("PRIVY_APP_SECRET", "test-key");
    vi.useFakeTimers();
    const ticket = issueCharacterJobTicket("owner", "job");
    vi.advanceTimersByTime(30 * 60_000);
    expect(verifyCharacterJobTicket(ticket, "owner", "job")).toBe(false);
    vi.stubEnv("PRIVY_APP_SECRET", "");
    expect(verifyCharacterJobTicket(ticket, "owner", "job")).toBe(false);
    expect(() => issueCharacterJobTicket("owner", "job")).toThrow();
  });
});
