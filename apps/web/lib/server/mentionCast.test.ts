import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = m.query; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { influencers: { listSearchable: "list", getByMint: "get" } } }));
vi.mock("./identityStill", () => ({ identityStills: async (urls: string[]) => urls }));
import { resolveMentions } from "./mentionCast";

const agent = (mint: string, name: string, stills: string[] = [], avatarUrl = `https://img.test/${mint}.gif`) => ({ mintAddress: mint, name, avatarStills: stills, avatarUrl });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.test";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: !String(url).includes("dead"), status: 200, headers: { get: () => "image/png" }, body: { cancel: async () => undefined } })));
});

it("finds tagged influencers from the prompt itself, even with no hint, and prefers the minted still", async () => {
  m.query.mockImplementation(async (ref: string, args?: { mintAddress?: string }) => ref === "list" ? [{ mintAddress: "M1", name: "Luna Fox" }] : args?.mintAddress === "M1" ? agent("M1", "Luna Fox", ["https://img.test/luna-still.png"]) : null);
  const out = await resolveMentions({ prompt: "dance with @LunaFox on a beach", hints: [] });
  expect(out).toEqual([{ token: "LunaFox", name: "Luna Fox", imageUrl: "https://img.test/luna-still.png", mintAddress: "M1" }]);
});
it("skips the lead influencer and tags that are not in the prompt", async () => {
  m.query.mockImplementation(async (ref: string, args?: { mintAddress?: string }) => ref === "list" ? [] : agent(args?.mintAddress ?? "", "X", ["https://img.test/x.png"]));
  const out = await resolveMentions({ prompt: "a video of @Kai", hints: [{ token: "Kai", mintAddress: "SELF" }, { token: "Zed", mintAddress: "M9" }], excludeMint: "SELF" });
  expect(out).toEqual([]);
});
it("falls back to the next picture when the first cannot be fetched", async () => {
  m.query.mockImplementation(async (ref: string) => ref === "list" ? [] : agent("MINT2", "Kai", ["https://img.test/dead.png"], "https://img.test/kai.png"));
  const out = await resolveMentions({ prompt: "meet @Kai", hints: [{ token: "Kai", mintAddress: "MINT2" }] });
  expect(out[0]?.imageUrl).toBe("https://img.test/kai.png");
});

import { mergeCast } from "./mentionCast";
it("mergeCast replaces a weak picture, adds a missed tag, and keeps names aligned with images", async () => {
  m.query.mockImplementation(async (ref: string, args?: { mintAddress?: string }) => ref === "list"
    ? [{ mintAddress: "MINTA", name: "Kai" }, { mintAddress: "MINTB", name: "Luna" }]
    : args?.mintAddress === "MINTA" ? agent("MINTA", "Kai", ["https://img.test/kai.png"]) : agent("MINTB", "Luna", ["https://img.test/luna.png"]));
  const out = await mergeCast({ prompt: "@Lead meets @Kai and @Luna", castTokens: ["Lead", "Kai"], imageUrls: ["https://img.test/lead.png", "https://img.test/kai.gif"], hints: [{ token: "Kai", mintAddress: "MINTA" }, { token: "Luna", mintAddress: "MINTB" }], excludeMint: "LEADMINT" });
  expect(out.imageUrls).toEqual(["https://img.test/lead.png", "https://img.test/kai.png", "https://img.test/luna.png"]);
  expect(out.castTokens).toEqual(["Lead", "Kai", "Luna"]);
});
