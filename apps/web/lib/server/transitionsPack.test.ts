import { describe, it, expect, afterEach } from "vitest";
import {
  TRANSITIONS,
  transitionById,
  isTransitionId,
  resolveXfadeName,
  clampTransitionDuration,
  isWipTransition,
  isTransitionAssetsReady,
  DEFAULT_TRANSITION_ID,
  TRANSITION_DURATION_MIN,
  TRANSITION_DURATION_MAX,
} from "./transitionsPack";

const ENV = "TRANSITION_PACK_BASE_URL";

describe("transitionsPack", () => {
  afterEach(() => { delete process.env[ENV]; });

  it("every transition has a unique id and a real ffmpeg xfade name", () => {
    expect(TRANSITIONS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const t of TRANSITIONS) {
      expect(isTransitionId(t.id)).toBe(true);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      // Even premium/WIP styles carry a geometric xfade fallback, so a seam NEVER
      // hard-cuts just because the assets aren't hosted yet.
      expect(typeof t.xfade).toBe("string");
      expect(t.xfade.length).toBeGreaterThan(0);
    }
  });

  it("resolveXfadeName maps a known id → its xfade, and unknown/missing → the default fade", () => {
    expect(resolveXfadeName("wipe_left")).toBe("wipeleft");
    expect(resolveXfadeName("circle_open")).toBe("circleopen");
    expect(resolveXfadeName("does-not-exist")).toBe(transitionById(DEFAULT_TRANSITION_ID)!.xfade);
    expect(resolveXfadeName(undefined)).toBe(transitionById(DEFAULT_TRANSITION_ID)!.xfade);
  });

  it("a premium/WIP transition still resolves to a concrete geometric xfade (never empty)", () => {
    const glitch = transitionById("glitch");
    expect(glitch?.wip).toBe(true);
    expect(resolveXfadeName("glitch").length).toBeGreaterThan(0); // falls back, never hard-cuts
  });

  it("isWipTransition gates premium styles until the asset pack is hosted", () => {
    delete process.env[ENV];
    expect(isTransitionAssetsReady()).toBe(false);
    expect(isWipTransition("glitch")).toBe(true);   // premium, no assets → blocked
    expect(isWipTransition("fade")).toBe(false);     // geometric → always available
    process.env[ENV] = "https://cdn.test/transitions";
    expect(isTransitionAssetsReady()).toBe(true);
    expect(isWipTransition("glitch")).toBe(false);   // assets hosted → unblocked
  });

  it("clampTransitionDuration keeps the seam inside the allowed window", () => {
    expect(clampTransitionDuration(0.5)).toBe(0.5);
    expect(clampTransitionDuration(99)).toBe(TRANSITION_DURATION_MAX);
    expect(clampTransitionDuration(0)).toBe(TRANSITION_DURATION_MIN);
    expect(clampTransitionDuration("nonsense")).toBeGreaterThanOrEqual(TRANSITION_DURATION_MIN);
  });
});
