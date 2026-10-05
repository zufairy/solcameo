import { beforeEach, describe, expect, it, vi } from "vitest";

const json = vi.hoisted(() => vi.fn());
const intel = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/requireAuth", () => ({ requireInternalOrUserAuth: async () => ({ internal: false }) }));
vi.mock("@/lib/server/kie-claude", () => ({ callClaudeJSON: json }));
vi.mock("@/lib/builder/websiteIntelligence", () => ({ fetchWebsiteIntelligence: intel }));
import { POST } from "./route";

const call = (body: unknown) => POST(new Request("http://x/api/campaigns/suggest", { method: "POST", body: JSON.stringify(body) }) as never);

describe("POST /api/campaigns/suggest", () => {
  beforeEach(() => { json.mockReset(); intel.mockReset(); });

  it("rejects an empty request", async () => {
    expect((await call({})).status).toBe(400);
  });

  it("rejects non-http links before fetching", async () => {
    const res = await call({ url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(intel).not.toHaveBeenCalled();
  });

  it("reports an unreadable website", async () => {
    intel.mockResolvedValue(null);
    expect((await call({ url: "https://nope.example" })).status).toBe(422);
  });

  it("sanitises and clamps the model output", async () => {
    intel.mockResolvedValue({ title: "Wise", siteName: "Wise", description: "Send money", readableText: "text" });
    json.mockResolvedValue({
      brandName: "Wise", title: "Send money abroad", brief: "  A brief   with   spaces ",
      requirements: ["One", "", "Two", 5, "x".repeat(400), "Four", "Five", "Six", "Seven"],
      niche: "FINANCE", language: "xx",
    });
    const res = await call({ url: "https://wise.com", campaignType: "marketing", boardCategory: "ugc" });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.brief).toBe("A brief with spaces");
    expect(data.requirements).toHaveLength(6);
    expect(data.requirements.every((r: string) => r.length <= 160)).toBe(true);
    expect(data.niche).toBe("finance");
    expect(data.language).toBeUndefined();
  });

  it("returns a friendly error when the model fails", async () => {
    json.mockRejectedValue(new Error("boom"));
    const res = await call({ brandName: "Wise", title: "Launch" });
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });
});
