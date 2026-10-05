import { describe, expect, it } from "vitest";
import {
  parseCampaignRequirements,
  applyRequiredTagsToCaption,
  buildRequiredTagInput,
  unionParsedRequirements,
} from "./campaignRequirements";

describe("parseCampaignRequirements", () => {
  it("parses a Malay brief into mentions, brand names, and free-text rules", () => {
    const parsed = parseCampaignRequirements([
      "caption setiap video wajib letak nama daddymin_offical",
      "wajib letak link di bio usernam @daddymin_offical",
      "organic traffic only",
    ]);

    // @-handle from the bio rule
    expect(parsed.mentions).toContain("@daddymin_offical");
    // bare brand token from the "letak nama <brand>" rule (best-effort)
    expect(parsed.brandNames).toContain("daddymin_offical");
    // the leftover rule sentence feeds the description LLM
    expect(parsed.freeTextRules).toContain("organic traffic only");
    // the two tag/brand directives are NOT treated as free-text rules
    expect(parsed.freeTextRules).toHaveLength(1);
  });

  it("extracts and de-dups #hashtags case-insensitively", () => {
    const parsed = parseCampaignRequirements([
      "use #VelloClip in every post",
      "must include #velloclip and #ad",
    ]);
    expect(parsed.hashtags).toContain("#VelloClip");
    expect(parsed.hashtags).toContain("#ad");
    // #VelloClip vs #velloclip collapse to one entry
    expect(parsed.hashtags.filter((h) => h.toLowerCase() === "#velloclip")).toHaveLength(1);
  });

  it("never throws on empty / malformed input", () => {
    expect(parseCampaignRequirements([])).toEqual({
      mentions: [],
      hashtags: [],
      brandNames: [],
      freeTextRules: [],
    });
    expect(parseCampaignRequirements(["", "   "]).freeTextRules).toHaveLength(0);
  });

  it("extracts the @handle from a Convex-campaign requirement ('tag @alongrocket on tiktok')", () => {
    // The exact mandatory-requirements example from the campaign create flow: the
    // agent must enforce the @alongrocket mention on every clip caption.
    const parsed = parseCampaignRequirements([
      "clip along rocket videos from youtube, tag @alongrocket on tiktok",
    ]);
    expect(parsed.mentions).toContain("@alongrocket");
    // A rule that contributes a mention is a tag directive, not a free-text rule.
    expect(parsed.freeTextRules).toHaveLength(0);
    // And the deterministic applier appends it to a caption that lacks it.
    expect(applyRequiredTagsToCaption("new rocket clip", parsed)).toBe("new rocket clip @alongrocket");
  });
});

describe("unionParsedRequirements (content_reward ∪ Convex campaign)", () => {
  it("merges two parsed sets and de-dups each field case-insensitively", () => {
    const a = parseCampaignRequirements([
      "tag @alongrocket on tiktok",
      "use #rockets",
      "organic traffic only",
    ]);
    const b = parseCampaignRequirements([
      "mention @AlongRocket and @spacefan",
      "use #Rockets and #ad",
      "keep it high energy",
    ]);
    const merged = unionParsedRequirements(a, b);
    // @alongrocket appears in both → collapses to one (first-seen casing kept)
    expect(merged.mentions.filter((m) => m.toLowerCase() === "@alongrocket")).toHaveLength(1);
    expect(merged.mentions).toContain("@alongrocket");
    expect(merged.mentions).toContain("@spacefan");
    // #rockets collapses across casing; #ad is added
    expect(merged.hashtags.filter((h) => h.toLowerCase() === "#rockets")).toHaveLength(1);
    expect(merged.hashtags).toContain("#ad");
    // both distinct free-text rules survive
    expect(merged.freeTextRules).toContain("organic traffic only");
    expect(merged.freeTextRules).toContain("keep it high energy");
  });

  it("returns empty structure for no parts and never throws", () => {
    expect(unionParsedRequirements()).toEqual({
      mentions: [],
      hashtags: [],
      brandNames: [],
      freeTextRules: [],
    });
  });
});

describe("applyRequiredTagsToCaption", () => {
  it("appends a missing @mention", () => {
    const out = applyRequiredTagsToCaption("check this out", { mentions: ["@daddymin_offical"] });
    expect(out).toBe("check this out @daddymin_offical");
  });

  it("does not duplicate a mention already present (case-insensitive)", () => {
    const out = applyRequiredTagsToCaption("shoutout @DaddyMin_Offical!", {
      mentions: ["@daddymin_offical"],
    });
    expect(out).toBe("shoutout @DaddyMin_Offical!");
  });

  it("does not double-tag a brand already covered by its @mention", () => {
    const out = applyRequiredTagsToCaption("hello", {
      mentions: ["@daddymin_offical"],
      brandNames: ["daddymin_offical"],
    });
    // brand is subsumed by the appended mention → only the mention is added
    expect(out).toBe("hello @daddymin_offical");
  });

  it("keeps the required @mention after a cap-trim of the caption body", () => {
    const longCaption = "a".repeat(80);
    const out = applyRequiredTagsToCaption(longCaption, { mentions: ["@brand"] }, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    // the caption body is trimmed but the required tag survives at the end
    expect(out.endsWith("@brand")).toBe(true);
  });

  it("emits the required tag even when the caption is empty", () => {
    expect(applyRequiredTagsToCaption("", { mentions: ["@brand"], hashtags: ["#ad"] }))
      .toBe("@brand #ad");
  });

  it("normalizes bare mention/hashtag tokens to @/#", () => {
    const out = applyRequiredTagsToCaption("post", { mentions: ["brand"], hashtags: ["ad"] });
    expect(out).toBe("post @brand #ad");
  });
});

describe("buildRequiredTagInput (content_reward → post_content forwarding)", () => {
  it("forwards contentRewardId (and parsed tags) for a content_reward clip", () => {
    const input = buildRequiredTagInput({
      contentRewardId: "cr-123",
      required: { mentions: ["@daddymin_offical"], hashtags: [], brandNames: ["daddymin_offical"] },
      freeTextRules: ["organic traffic only"],
    });
    expect(input.contentRewardId).toBe("cr-123");
    expect(input.campaignId).toBeUndefined();
    expect(input.requiredMentions).toEqual(["@daddymin_offical"]);
    expect(input.requiredBrands).toEqual(["daddymin_offical"]);
    expect(input.requiredHashtags).toBeUndefined(); // empty arrays are omitted
    expect(input.requiredFreeTextRules).toEqual(["organic traffic only"]);
  });

  it("forwards only campaignId for a Convex-campaign clip (no content_reward)", () => {
    const input = buildRequiredTagInput({ campaignId: "conv-1" });
    expect(input.campaignId).toBe("conv-1");
    expect(input.contentRewardId).toBeUndefined();
    expect(input.requiredMentions).toBeUndefined();
  });
});
