import { describe, it, expect } from "vitest";
import {
  priceFor, SERVICE_PRICES, CLIP_SKILL_PRICE_USDC, clipSkillRunCost, clipSkillPriceLabel,
  MAX_SKILL_PRICE_USDC, isValidSkillPrice, staticUnitPrice, effectiveUnitPrice,
  priceForWithOverride, clipSkillRunCostWithOverrides, priceLabelFromUsdc,
  PRICEABLE_SERVICE_IDS, effectivePostCostUsdc, CLIP_SOURCE_MINUTE_ID,
} from "./servicePrices";

describe("clip-skill pricing", () => {
  it("priced skills span the agreed $0.10–$0.43 range ($0 = free until implemented)", () => {
    // clip.speed is intentionally $0 — its ffmpeg op is stripped (would desync
    // audio/captions) so it renders nothing and must not be billed. Range check
    // covers the skills that actually do work; $0 is a valid free price.
    // The source-minute fee is metered separately from per-run skills.
    const priced = Object.entries(CLIP_SKILL_PRICE_USDC)
      .filter(([id, price]) => id !== CLIP_SOURCE_MINUTE_ID && price > 0)
      .map(([, price]) => price);
    expect(CLIP_SKILL_PRICE_USDC[CLIP_SOURCE_MINUTE_ID]).toBe(0.02);
    expect(Math.min(...priced)).toBe(0.10);
    expect(Math.max(...priced)).toBe(0.43);
    expect(CLIP_SKILL_PRICE_USDC["clip.speed"]).toBe(0);
  });
  it("clipSkillRunCost sums + dedupes wired skills", () => {
    expect(clipSkillRunCost(["clip.captions", "clip.hook", "clip.zoom"])).toBe(1.00);
    expect(clipSkillRunCost(["clip.captions", "clip.captions"])).toBe(0.40); // dedup
    expect(clipSkillRunCost([])).toBe(0);
    expect(clipSkillRunCost(["clip.unknownfree", "clip.captions"])).toBe(0.40); // unknown = $0
  });
  it("priceFor resolves a clip-skill id (so recordUsage can charge it)", () => {
    expect(priceFor("clip.facetrack", 1)).toBe(0.43);
    expect(priceFor("clip.campaignscout", 1)).toBe(0.10);
  });
  it("clipSkillPriceLabel formats per-run / Free", () => {
    expect(clipSkillPriceLabel("clip.captions")).toBe("$0.40 / run");
    expect(clipSkillPriceLabel("clip.unknown")).toBe("Free");
  });
  it("prices clip.trendingaudio at $0.15 (curated licensed-asset value)", () => {
    expect(CLIP_SKILL_PRICE_USDC["clip.trendingaudio"]).toBe(0.15);
    expect(priceFor("clip.trendingaudio", 1)).toBe(0.15);
    expect(clipSkillPriceLabel("clip.trendingaudio")).toBe("$0.15 / run");
  });
});

describe("SERVICE_PRICES", () => {
  it("has expected unit prices for all five services", () => {
    expect(SERVICE_PRICES.render).toBe(0.40);
    expect(SERVICE_PRICES.image_gen).toBe(0.05);
    expect(SERVICE_PRICES.llm_message).toBe(0.003);
    expect(SERVICE_PRICES.social_post).toBe(0.05);
    expect(SERVICE_PRICES.transcription).toBe(0.10);
  });
});

describe("priceFor", () => {
  it("returns the correct cost for render × 1", () => {
    expect(priceFor("render", 1)).toBe(0.4);
  });

  it("returns the correct cost for llm_message × 10", () => {
    expect(priceFor("llm_message", 10)).toBe(0.03);
  });

  it("returns correct cost for image_gen × 2", () => {
    expect(priceFor("image_gen", 2)).toBe(0.1);
  });

  it("returns correct cost for social_post × 1", () => {
    expect(priceFor("social_post", 1)).toBe(0.05);
  });

  it("returns correct cost for transcription × 3", () => {
    expect(priceFor("transcription", 3)).toBe(0.3);
  });

  it("throws on an unknown service", () => {
    expect(() => priceFor("unknown_service", 1)).toThrow("unknown service: unknown_service");
  });

  it("throws when qty is 0", () => {
    expect(() => priceFor("render", 0)).toThrow("qty must be a positive number");
  });

  it("throws when qty is negative", () => {
    expect(() => priceFor("render", -1)).toThrow("qty must be a positive number");
  });

  it("throws when qty is Infinity", () => {
    expect(() => priceFor("render", Infinity)).toThrow("qty must be a positive number");
  });

  it("throws when qty is NaN", () => {
    expect(() => priceFor("render", NaN)).toThrow("qty must be a positive number");
  });
});

describe("admin price overrides (resolver)", () => {
  it("isValidSkillPrice accepts [0, cap], rejects negative / over-cap / non-finite", () => {
    expect(isValidSkillPrice(0)).toBe(true);
    expect(isValidSkillPrice(0.12)).toBe(true);
    expect(isValidSkillPrice(MAX_SKILL_PRICE_USDC)).toBe(true);
    expect(isValidSkillPrice(-0.01)).toBe(false);
    expect(isValidSkillPrice(MAX_SKILL_PRICE_USDC + 0.01)).toBe(false);
    expect(isValidSkillPrice(NaN)).toBe(false);
    expect(isValidSkillPrice(Infinity)).toBe(false);
    expect(isValidSkillPrice("0.5" as unknown as number)).toBe(false);
  });

  it("staticUnitPrice reads clip skills AND base services; undefined for unknown", () => {
    expect(staticUnitPrice("clip.title")).toBe(0.12);
    expect(staticUnitPrice("render")).toBe(0.40);
    expect(staticUnitPrice("clip.unknown")).toBeUndefined();
  });

  it("effectiveUnitPrice: valid override WINS over the static default", () => {
    expect(effectiveUnitPrice("clip.title", 0.25)).toBe(0.25);
    expect(effectiveUnitPrice("clip.title", 0)).toBe(0); // an admin can zero a skill
  });

  it("effectiveUnitPrice: absent override → static default", () => {
    expect(effectiveUnitPrice("clip.title")).toBe(0.12);
    expect(effectiveUnitPrice("clip.title", undefined)).toBe(0.12);
  });

  it("effectiveUnitPrice: INVALID override (negative / over-cap / NaN) is ignored → static (clamp)", () => {
    expect(effectiveUnitPrice("clip.title", -5)).toBe(0.12);
    expect(effectiveUnitPrice("clip.title", MAX_SKILL_PRICE_USDC + 1)).toBe(0.12);
    expect(effectiveUnitPrice("clip.title", NaN)).toBe(0.12);
  });

  it("priceForWithOverride: applies the override × qty, falls back to static, keeps priceFor guards", () => {
    expect(priceForWithOverride("clip.facetrack", 1, 0.99)).toBe(0.99);
    expect(priceForWithOverride("clip.facetrack", 1)).toBe(0.43); // static
    expect(priceForWithOverride("clip.facetrack", 1, -1)).toBe(0.43); // invalid → static
    expect(priceForWithOverride("render", 10, 0.01)).toBe(0.1); // unit × qty
    expect(() => priceForWithOverride("nope", 1)).toThrow("unknown service: nope");
    expect(() => priceForWithOverride("render", 0, 0.01)).toThrow("qty must be a positive number");
  });

  it("clipSkillRunCostWithOverrides: overrides win, dedupes, unknown = $0, static otherwise", () => {
    // captions 0.40 → 0.50 override; hook stays static 0.35; unknown = 0.
    expect(clipSkillRunCostWithOverrides(
      ["clip.captions", "clip.hook", "clip.unknownfree"],
      { "clip.captions": 0.50 },
    )).toBe(0.85);
    // dedup
    expect(clipSkillRunCostWithOverrides(["clip.captions", "clip.captions"], { "clip.captions": 0.50 })).toBe(0.50);
    // no overrides → identical to the static clipSkillRunCost
    expect(clipSkillRunCostWithOverrides(["clip.captions", "clip.hook", "clip.zoom"], {}))
      .toBe(clipSkillRunCost(["clip.captions", "clip.hook", "clip.zoom"]));
    // invalid override ignored → static
    expect(clipSkillRunCostWithOverrides(["clip.captions"], { "clip.captions": -1 })).toBe(0.40);
  });

  it("priceLabelFromUsdc formats an effective price / Free; clipSkillPriceLabel delegates", () => {
    expect(priceLabelFromUsdc(0.25)).toBe("$0.25 / run");
    expect(priceLabelFromUsdc(0)).toBe("Free");
    expect(priceLabelFromUsdc(undefined)).toBe("Free");
    expect(clipSkillPriceLabel("clip.captions")).toBe("$0.40 / run");
  });
});

describe("auto-post (social_post) admin-overridable fee", () => {
  it("social_post is a priceable service the admin can override (staticUnitPrice resolves it)", () => {
    // The list/effective map + setSkillPrice guard all key off staticUnitPrice(id),
    // which resolves social_post to its SERVICE_PRICES default.
    expect(PRICEABLE_SERVICE_IDS).toContain("social_post");
    expect(staticUnitPrice("social_post")).toBe(0.05);
    expect(SERVICE_PRICES.social_post).toBe(0.05);
  });

  it("effectivePostCostUsdc: no override → the static $0.05 full-fee publish", () => {
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post)).toBe(0.05);
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, undefined)).toBe(0.05);
  });

  it("effectivePostCostUsdc: a VALID override re-prices the full-fee publish (0.05 → 0.10 → 0)", () => {
    // setSkillPrice("social_post", 0.10) → a publish now charges 0.10.
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, 0.10)).toBe(0.10);
    // an admin can raise it too.
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, 1.25)).toBe(1.25);
    // clearing back to no override → static default (0.05).
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, undefined)).toBe(0.05);
    // an admin may zero the fee (free posting).
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, 0)).toBe(0);
  });

  it("effectivePostCostUsdc: an INVALID override (>MAX / negative / NaN) is rejected → static $0.05", () => {
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, MAX_SKILL_PRICE_USDC + 1)).toBe(0.05);
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, -1)).toBe(0.05);
    expect(effectivePostCostUsdc(SERVICE_PRICES.social_post, NaN)).toBe(0.05);
  });

  it("effectivePostCostUsdc: a FAILED/partial post floor ($0.001) is NEVER re-priced by an override", () => {
    // The run-task executor bills 0.001 for a failed post — the override must not
    // turn that into the full fee (or the override value).
    expect(effectivePostCostUsdc(0.001)).toBe(0.001);
    expect(effectivePostCostUsdc(0.001, 0.10)).toBe(0.001);
    expect(effectivePostCostUsdc(0, 0.10)).toBe(0); // a $0 skip stays $0
  });
});
