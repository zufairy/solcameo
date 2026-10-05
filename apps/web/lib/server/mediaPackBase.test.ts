import { describe, it, expect, afterEach, vi } from "vitest";
import { mediaPackBase, mediaPackConfigured } from "./mediaPackBase";

afterEach(() => vi.unstubAllEnvs());

/**
 * The readiness line an operator sees ("✓ Trending Audio ready") is printed by the
 * CONVEX action, while the track URL is resolved in the NEXT process. Both go
 * through this helper so they cannot disagree — and neither may resolve to the
 * dead Supabase project, which answers 402 to every object.
 */
describe("mediaPackBase", () => {
  it("uses the explicit env var when set (trailing slash trimmed)", () => {
    vi.stubEnv("TRENDING_AUDIO_BASE_URL", "https://cdn.example/audio/");
    expect(mediaPackBase("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe("https://cdn.example/audio");
  });

  it("no longer derives a bucket from the Supabase project vars", () => {
    vi.stubEnv("TRENDING_AUDIO_BASE_URL", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    expect(mediaPackBase("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe("");
    expect(mediaPackConfigured("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe(false);
  });

  it("derives <R2_PUBLIC_BASE_URL>/<bucket> when the pack var is unset (packs live on R2 now)", () => {
    vi.stubEnv("TRENDING_AUDIO_BASE_URL", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-abc.r2.dev/");
    expect(mediaPackBase("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe("https://pub-abc.r2.dev/trending-audio");
    expect(mediaPackConfigured("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe(true);
  });

  it("derives R2 for the sfx pack, but NOT for packs not yet uploaded (gameplay)", () => {
    vi.stubEnv("REACTION_SFX_BASE_URL", "");
    vi.stubEnv("GAMEPLAY_PACK_BASE_URL", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-abc.r2.dev/");
    expect(mediaPackBase("REACTION_SFX_BASE_URL", "sfx")).toBe("https://pub-abc.r2.dev/sfx");
    expect(mediaPackConfigured("REACTION_SFX_BASE_URL", "sfx")).toBe(true);
    expect(mediaPackBase("GAMEPLAY_PACK_BASE_URL", "gameplay")).toBe("");
  });

  it("ignores a var pointing at the dead Supabase host and falls back to R2", () => {
    vi.stubEnv("TRENDING_AUDIO_BASE_URL", "https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/trending-audio");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-abc.r2.dev");
    expect(mediaPackBase("TRENDING_AUDIO_BASE_URL", "trending-audio")).toBe("https://pub-abc.r2.dev/trending-audio");
  });

  it("treats a dead-host var as unconfigured when there's no R2 to fall back to", () => {
    vi.stubEnv("REACTION_SFX_BASE_URL", "https://slmlubxaclmoqxivcurz.supabase.co/storage/v1/object/public/sfx");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    expect(mediaPackBase("REACTION_SFX_BASE_URL", "sfx")).toBe("");
    expect(mediaPackConfigured("REACTION_SFX_BASE_URL", "sfx")).toBe(false);
  });

  it("is empty when nothing is configured", () => {
    vi.stubEnv("GAMEPLAY_PACK_BASE_URL", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    expect(mediaPackBase("GAMEPLAY_PACK_BASE_URL", "gameplay")).toBe("");
  });
});
