import { describe, it, expect } from "vitest";
import { buildPersonaKernelDeterministic, type PersonaKernelInput } from "./personaKernel";

const luxe: PersonaKernelInput = {
  agentName: "Nova",
  agentNiche: "luxury skincare",
  voiceArchetype: "expert",
  characterBible: "A poised 30-something dermatologist with sleek dark hair, minimalist gold jewelry, always in tailored ivory.",
  aesthetic: "clean clinical luxury",
  traits: ["precise", "warm-authoritative"],
  catchphrase: "Skin is a science.",
  personality: { warmth: 60, humor: 20, authority: 90, boldness: 40 },
  brandColor: "#C8A96A",
  settings: ["marble bathroom", "sunlit clinic"],
  memories: [{ kind: "lesson", summary: "Audience loves close-up texture shots.", importance: 90 }],
};

const gamer: PersonaKernelInput = {
  agentName: "Blitz",
  agentNiche: "esports",
  voiceArchetype: "entertainer",
  characterBible: "A hyper 20-year-old streamer, neon hoodie, messy hair, RGB-lit gaming den.",
  aesthetic: "neon cyberpunk chaos",
  traits: ["loud", "fast"],
  catchphrase: "Let's GO!",
  personality: { warmth: 40, humor: 95, authority: 30, boldness: 95 },
  brandColor: "#22D3EE",
  settings: ["RGB battlestation"],
  memories: [{ kind: "lesson", summary: "Jump cuts every 2s keep retention.", importance: 85 }],
};

describe("buildPersonaKernelDeterministic", () => {
  it("includes wardrobe/aesthetic identity from the character bible", () => {
    const k = buildPersonaKernelDeterministic(luxe);
    expect(k.toLowerCase()).toContain("ivory");
    expect(k.toLowerCase()).toContain("clean clinical luxury");
  });

  it("derives energy from personality dials", () => {
    // High authority + low boldness reads 'commanding/measured'; high boldness+humor reads 'high-energy'.
    expect(buildPersonaKernelDeterministic(luxe).toLowerCase()).toMatch(/commanding|measured|authoritative/);
    expect(buildPersonaKernelDeterministic(gamer).toLowerCase()).toMatch(/high-energy|frenetic|explosive/);
  });

  it("produces DIVERGENT kernels for two different personas (the core fix)", () => {
    const a = buildPersonaKernelDeterministic(luxe);
    const b = buildPersonaKernelDeterministic(gamer);
    expect(a).not.toEqual(b);
    // Palettes differ
    expect(a).toContain("#C8A96A");
    expect(b).toContain("#22D3EE");
  });

  it("returns a non-empty kernel even for a sparse persona", () => {
    const k = buildPersonaKernelDeterministic({ agentName: "Solo" });
    expect(k.trim().length).toBeGreaterThan(0);
    expect(k).toContain("Solo");
  });

  it("caps length so it never dominates the clip prompt", () => {
    expect(buildPersonaKernelDeterministic(luxe).length).toBeLessThanOrEqual(1200);
  });
});
