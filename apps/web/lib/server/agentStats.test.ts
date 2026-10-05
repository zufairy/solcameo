import { describe, it, expect } from "vitest";
import { buildAgentStatsLines } from "./agentStats";

const NOW = Date.UTC(2026, 8, 23);
const DAY = 86_400_000;

describe("buildAgentStatsLines", () => {
  it("reports real totals, virality and top performers", () => {
    const lines = buildAgentStatsLines([
      { title: "Quran while cooking", createdAt: NOW - DAY, state: "posted", viewCount: 12000, viralScore: 88, platform: "tiktok" },
      { title: "Kopi review", createdAt: NOW - 2 * DAY, state: "posted", viewCount: 800, viralScore: 61, platform: "youtube" },
      { title: "Old one", createdAt: NOW - 30 * DAY, state: "posted", viewCount: null, viralScore: 40, platform: "tiktok" },
      { title: "Queued", createdAt: NOW, state: "scheduled", viewCount: null },
    ], { now: NOW, creditsBalance: 250, lifetimeEarningsUsdc: 3.5, connectedPlatforms: ["tiktok"] }).join("\n");
    expect(lines).toContain("4 total · 3 posted · 1 scheduled");
    expect(lines).toContain("TOTAL VIEWS across all posted videos: 12,800 (view counts synced for 2 of 3");
    expect(lines).toContain("average 63/100 across 3 scored clips");
    expect(lines).toMatch(/Highest virality scores: "Quran while cooking" 88\/100, 12,000 views/);
    expect(lines).toContain("tiktok 12,000 (2 posts)");
    expect(lines).toContain("Last 7 days: 2 posted, 12,800 views");
    expect(lines).toContain("250 credits");
  });
  it("says plainly when there is no data yet", () => {
    const lines = buildAgentStatsLines([], { now: NOW }).join("\n");
    expect(lines).toContain("TOTAL VIEWS across all posted videos: 0");
    expect(lines).toContain("VIRALITY SCORE: none yet");
  });
});
