// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV = "GAMEPLAY_PACK_BASE_URL";

describe("gameplayPack", () => {
  const prev = process.env[ENV];
  beforeEach(() => { delete process.env[ENV]; });
  afterEach(() => { if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev; });

  it("the bundled ids are stable (inspector contract)", async () => {
    const { GAMEPLAY_PACK_IDS } = await import("./gameplayPack");
    expect(GAMEPLAY_PACK_IDS).toEqual(["subway-surfers", "minecraft", "minecraft-2", "gta-ramps", "gta-ramps-2", "surfing"]);
  });

  it("randomGameplayId is deterministic, in-range, and rotates across the pool", async () => {
    const { randomGameplayId, GAMEPLAY_PACK_IDS } = await import("./gameplayPack");
    expect(GAMEPLAY_PACK_IDS).toContain(randomGameplayId(0));
    expect(randomGameplayId(7)).toBe(randomGameplayId(7)); // deterministic per seed
    const picks = new Set([0, 1, 2, 3].map((s) => randomGameplayId(s)));
    expect(picks.size).toBeGreaterThan(1); // different seeds → different bgs
    expect(randomGameplayId(NaN)).toBe(GAMEPLAY_PACK_IDS[0]); // NaN-safe
  });

  it("gameplayUrl resolves against the env base, tolerating a trailing slash", async () => {
    process.env[ENV] = "https://cdn.example.com/gameplay/";
    // re-import to pick up the env (module reads it lazily inside the helper)
    const { gameplayUrl } = await import("./gameplayPack");
    expect(gameplayUrl("subway-surfers")).toBe("https://cdn.example.com/gameplay/SubwaySurfer.mp4");
    expect(gameplayUrl("gta-ramps")).toBe("https://cdn.example.com/gameplay/GTA5Ramps.mp4");
  });

  it("returns '' for an unknown id even when the base is set", async () => {
    process.env[ENV] = "https://cdn.example.com";
    const { gameplayUrl } = await import("./gameplayPack");
    expect(gameplayUrl("not-a-pack")).toBe("");
  });

  it("returns '' for every id when the base env is unset (graceful degrade)", async () => {
    const { gameplayUrl, GAMEPLAY_PACK_IDS } = await import("./gameplayPack");
    for (const id of GAMEPLAY_PACK_IDS) expect(gameplayUrl(id)).toBe("");
  });
});
