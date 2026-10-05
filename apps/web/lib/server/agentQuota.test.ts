// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { ConvexHttpClient } from "convex/browser";
const { plan } = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock("./subscriptionStatus", () => ({ subscriptionAgentLimit: plan }));
import { getAgentQuotaIdentity } from "./agentQuota";
beforeEach(() => { plan.mockReset(); plan.mockResolvedValue(0); });
const identity = { wallets: ["old", "current"], agents: [{ mintAddress: "mine", name: "Agent" }], agentLimitOverride: 15 };
const query = vi.fn(async () => identity);
const convex = { query } as unknown as ConvexHttpClient;
it("limits a free account to one even if it has a legacy higher override", async () => {
  expect(await getAgentQuotaIdentity(convex, { id: "user", walletAddress: "current" })).toMatchObject({ agentLimit: 1, creatorDid: "user", creatorWallets: ["old", "current"] });
});
it("finds the paid subscription on an older linked wallet", async () => {
  plan.mockImplementation(async wallet => wallet === "old" ? 3 : 0);
  const result = await getAgentQuotaIdentity(convex, { id: "user", walletAddress: "current" });
  expect(result.agentLimit).toBe(15); // Paid accounts may use an explicit admin override.
  expect(plan).toHaveBeenCalledWith("old");
});
