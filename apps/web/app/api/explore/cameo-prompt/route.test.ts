import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ text: vi.fn(), vision: vi.fn() }));
vi.mock("@/lib/server/characterAuth", () => ({ authorizeCharacterOwner: async () => ({ mint: "m" }) }));
vi.mock("@/lib/server/downloader", () => ({ assertPublicHttpUrl: async () => {} }));
vi.mock("@/lib/server/kie-claude", () => ({ callClaudeText: mocks.text, callGeminiVision: mocks.vision }));

import { POST } from "./route";

const call = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never);
const base = { mintAddress: "m", title: "Duo dance", description: "Two people dance", category: "Dance" };

describe("cameo prompt route", () => {
  it("keeps every cast token referenced, in a short prompt", async () => {
    mocks.text.mockResolvedValue("A rooftop at golden hour, matching streetwear.");
    const res = await call({ ...base, cast: [{ token: "Luna", name: "Luna" }, { token: "Photo1", name: "Photo 1" }] });
    const { prompt } = (await res.json()) as { prompt: string };
    expect(prompt).toContain("@Luna");
    expect(prompt).toContain("@Photo1");
    expect(prompt.length).toBeLessThanOrEqual(380);
  });
  it("does not double-add tokens the model already used", async () => {
    mocks.text.mockResolvedValue("@Luna and @Kai dance in a neon alley.");
    const { prompt } = (await (await call({ ...base, cast: [{ token: "Luna" }, { token: "Kai" }] })).json()) as { prompt: string };
    expect(prompt.match(/@Luna/g)).toHaveLength(1);
  });
  it("rejects an empty cast", async () => {
    expect((await call({ ...base, cast: [] })).status).toBe(400);
  });
});
