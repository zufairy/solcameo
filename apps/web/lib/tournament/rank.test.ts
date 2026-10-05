import { describe, it, expect } from "vitest";
import { rankAgents, summarize, type AgentStats, type RosterAgent } from "./rank";

const roster: RosterAgent[] = [
  { mintAddress: "A", name: "Alpha", handle: "alpha", avatarUrl: "", platforms: ["tiktok"], followers: 2500, followerDelta: 120 },
  { mintAddress: "B", name: "Beta", handle: "beta", avatarUrl: "", platforms: [], followers: 0, followerDelta: 0 },
  { mintAddress: "C", name: "Gamma", handle: "gamma", avatarUrl: "", platforms: ["instagram", "x"], followers: 9000, followerDelta: -30 },
];
const stats: Record<string, AgentStats> = {
  A: { views: 12000, posted: 10, generated: 30, jobs: 3, ledgerCostUsdc: 12, lastPostedAt: 100 },
  B: { views: 0, posted: 0, generated: 0, jobs: 0, ledgerCostUsdc: 0, lastPostedAt: null },
  C: { views: 4000, posted: 8, generated: 20, jobs: 2, ledgerCostUsdc: 0, lastPostedAt: 50 },
};

describe("rankAgents", () => {
  it("ranks by views desc, breaks ties by posted, assigns 1-based rank", () => {
    const rows = rankAgents(roster, stats, "views");
    expect(rows.map((r) => r.mintAddress)).toEqual(["A", "C", "B"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it("estimates cost from generations when the ledger is empty, and flags it", () => {
    const rows = rankAgents(roster, stats, "views");
    const c = rows.find((r) => r.mintAddress === "C")!;
    expect(c.costUsdc).toBeCloseTo(20 * 0.4 + 8 * 0.05, 5);
    expect(c.costEstimated).toBe(true);
    const a = rows.find((r) => r.mintAddress === "A")!;
    expect(a.costUsdc).toBe(12);
    expect(a.costEstimated).toBe(false);
  });
  it("views per dollar is null when nothing was spent, else views/cost", () => {
    const rows = rankAgents(roster, stats, "views");
    expect(rows.find((r) => r.mintAddress === "B")!.viewsPerUsd).toBeNull();
    expect(rows.find((r) => r.mintAddress === "A")!.viewsPerUsd).toBe(1000);
  });
  it("supports other sort keys (efficiency puts the cheapest views first)", () => {
    const rows = rankAgents(roster, stats, "viewsPerUsd");
    expect(rows[0].mintAddress).toBe("A"); // 1000/$ beats 4000/8.4≈476/$
    expect(rows[rows.length - 1].mintAddress).toBe("B"); // null sorts last
  });
  it("sorts by account followers", () => {
    const rows = rankAgents(roster, stats, "followers");
    expect(rows.map((r) => r.mintAddress)).toEqual(["C", "A", "B"]);
  });
  it("agents with missing stats (query still loading) are treated as zero, not dropped", () => {
    const rows = rankAgents(roster, { A: stats.A }, "views");
    expect(rows).toHaveLength(3);
    expect(rows[2].views).toBe(0);
  });
});

describe("summarize", () => {
  it("totals the board", () => {
    const rows = rankAgents(roster, stats, "views");
    expect(summarize(rows)).toEqual({ agents: 3, active: 2, views: 16000, posted: 18, generated: 50, costUsdc: 12 + 20 * 0.4 + 8 * 0.05 });
  });
});
