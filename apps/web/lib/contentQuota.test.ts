import { describe, expect, it } from "vitest";
import { bestMilestone, isProviderCapError, nextSlot, postClass, type PostedEntry } from "./contentQuota";
const H = 3_600_000, now = 1_000 * H;
const at = (cls: PostedEntry["cls"], hoursAgo: number): PostedEntry => ({ cls, at: now - hoursAgo * H });
describe("content quota", () => {
  it("classifies posts", () => {
    expect(postClass({ source: "mint" })).toBe("launch");
    expect(postClass({ source: "milestone", milestoneViews: 10_500 })).toBe("milestone10k");
    expect(postClass({ source: "milestone", milestoneViews: 100_001 })).toBe("milestone100k");
    expect(postClass({ source: "manual" })).toBe("manual");
  });
  it("lets one 10k milestone out per day, then waits until the first one is 24h old", () => {
    expect(nextSlot("milestone10k", [], now)).toEqual({ ok: true });
    const slot = nextSlot("milestone10k", [at("milestone10k", 5)], now);
    expect(slot).toMatchObject({ ok: false, notBefore: now + 19 * H });
  });
  it("allows two 100k milestones a day, six hours apart", () => {
    expect(nextSlot("milestone100k", [at("milestone100k", 2)], now)).toMatchObject({ ok: false, notBefore: now + 4 * H });
    expect(nextSlot("milestone100k", [at("milestone100k", 7)], now)).toEqual({ ok: true });
    expect(nextSlot("milestone100k", [at("milestone100k", 20), at("milestone100k", 7)], now)).toMatchObject({ ok: false, notBefore: now + 4 * H });
  });
  it("allows ten launches a day, 15 minutes apart", () => {
    expect(nextSlot("launch", [{ cls: "launch", at: now - 5 * 60_000 }], now)).toMatchObject({ ok: false, notBefore: now + 10 * 60_000 });
    const ten = Array.from({ length: 10 }, (_, i) => at("launch", 23 - i * 2));
    expect(nextSlot("launch", ten, now)).toMatchObject({ ok: false, notBefore: now + 1 * H });
    expect(nextSlot("launch", ten.slice(1), now)).toEqual({ ok: true });
  });
  it("stops automatic posts at 17 of X's 20 so manual posts always fit", () => {
    const busy = Array.from({ length: 17 }, (_, i) => at("manual", 23 - i));
    expect(nextSlot("launch", busy, now)).toMatchObject({ ok: false });
    expect(nextSlot("manual", busy, now)).toEqual({ ok: true });
  });
  it("picks the most-viewed waiting milestone first", () => {
    expect(bestMilestone([{ milestoneViews: 11_000, createdAt: 1 }, { milestoneViews: 19_000, createdAt: 2 }, { milestoneViews: 19_000, createdAt: 3 }])).toEqual({ milestoneViews: 19_000, createdAt: 2 });
  });
  it("recognises the provider cap error", () => {
    expect(isProviderCapError("You have reached the daily posting cap on x. Used 20/20")).toBe(true);
    expect(isProviderCapError("Invalid media")).toBe(false);
  });
});
