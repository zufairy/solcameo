// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./stripeClient", () => ({
  getStripe: () => ({ subscriptions: { search } }),
  SUBSCRIPTION_TIERS: { starter: { stripePriceId: "starter-price" }, creator: { stripePriceId: "creator-price" }, growth: { stripePriceId: "growth-price" } },
}));
import { _resetSubscriptionStatusCache, subscriptionAgentLimit } from "./subscriptionStatus";
beforeEach(() => { _resetSubscriptionStatusCache(); search.mockReset(); });
it.each([["starter", 1], ["creator", 3], ["growth", 5]])("resolves %s's advertised slots", async (tier, limit) => {
  search.mockResolvedValue({ data: [{ metadata: { tier }, items: { data: [] } }] });
  expect(await subscriptionAgentLimit("wallet")).toBe(limit);
});
it("falls back to the Stripe price for subscriptions without tier metadata", async () => {
  search.mockResolvedValue({ data: [{ metadata: {}, items: { data: [{ price: { id: "creator-price" } }] } }] });
  expect(await subscriptionAgentLimit("wallet")).toBe(3);
});
it("treats an account with no subscription as free", async () => {
  search.mockResolvedValue({ data: [] }); expect(await subscriptionAgentLimit("wallet")).toBe(0);
});
it("fails closed on Stripe errors without caching the failure", async () => {
  search.mockRejectedValueOnce(new Error("timeout"));
  expect(await subscriptionAgentLimit("wallet")).toBe(0);
  search.mockResolvedValue({ data: [{ metadata: { tier: "growth" }, items: { data: [] } }] });
  expect(await subscriptionAgentLimit("wallet")).toBe(5);
});
