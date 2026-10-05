// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CLIP_SKILLS, CLIP_SKILL_BY_ID, CAPTION_SKILL_STYLE, isCaptionSkillId, isClipSkillId, MARKETPLACE_CLIP_SKILLS, CLIP_SKILL_CATEGORIES, categoryForSkill, isDeprecatedSkill, isAppOnlySkill } from "./clipSkillsCatalog";

const moment = { title: "The Big Hook", captionText: "Most people get this wrong", startSeconds: 10, endSeconds: 35 };
const config = { captionsOn: true, captionStyle: { mode: "karaoke" as const, fontColor: "#FFEE00", fontSize: 64, position: "bottom" as const } };

describe("clip skills catalog", () => {
  it("snapshot: skill ids, names and tags (marketplace contract)", () => {
    expect(CLIP_SKILLS.map((s) => `${s.id} · ${s.name} · ${s.tag}`)).toMatchSnapshot();
  });

  it("snapshot: deterministic floor ops per skill (the guaranteed effects)", () => {
    const floors = Object.fromEntries(
      CLIP_SKILLS.filter((s) => s.floor).map((s) => [s.id, s.floor!(moment, config)]),
    );
    expect(floors).toMatchSnapshot();
  });

  it("snapshot: caption style presets", () => {
    expect(CAPTION_SKILL_STYLE).toMatchSnapshot();
  });

  it("every skill id is clip.-prefixed and unique", () => {
    const ids = CLIP_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(isClipSkillId(id)).toBe(true));
  });

  it("caption skills are recognized; non-caption skills are not", () => {
    expect(isCaptionSkillId("clip.captions")).toBe(true);
    expect(isCaptionSkillId("clip.style.mozi")).toBe(true);
    expect(isCaptionSkillId("clip.zoom")).toBe(false);
    expect(CLIP_SKILL_BY_ID["clip.captions"].name).toBe("Dynamic Captions");
  });

  it("app-only skills (Photo Carousel Builder) are flagged and never emit floor ops", () => {
    const car = CLIP_SKILL_BY_ID["clip.carouselbuilder"];
    expect(car).toBeDefined();
    expect(isAppOnlySkill("clip.carouselbuilder")).toBe(true);
    expect(car.appOnly).toBe(true);
    // app-only = a builder TAB, not a canvas node → no deterministic floor
    expect(car.floor).toBeUndefined();
    // every OTHER clip skill is node-scoped (not app-only)
    expect(isAppOnlySkill("clip.captions")).toBe(false);
    // listed in the marketplace so it can be installed
    expect(MARKETPLACE_CLIP_SKILLS.map((s) => s.id)).toContain("clip.carouselbuilder");
    // categorized (test 1 already asserts every marketplace skill has a category)
    expect(categoryForSkill("clip.carouselbuilder")).toBe("Apps");
    expect(CLIP_SKILL_CATEGORIES).toContain("Apps");
  });
});

describe("marketplace categorization + deprecation", () => {
  it("every non-deprecated skill has a category", () => {
    for (const s of MARKETPLACE_CLIP_SKILLS) {
      expect(categoryForSkill(s.id), `${s.id} uncategorized`).toBeDefined();
      expect(CLIP_SKILL_CATEGORIES).toContain(categoryForSkill(s.id)!);
    }
  });
  it("excludes the deprecated caption-style skills from the marketplace", () => {
    const ids = MARKETPLACE_CLIP_SKILLS.map((s) => s.id);
    for (const dep of ["clip.style.beasty", "clip.style.mozi", "clip.style.podp"]) {
      expect(isDeprecatedSkill(dep)).toBe(true);
      expect(ids).not.toContain(dep);
    }
  });
  it("keeps deprecated styles resolvable via CAPTION_SKILL_STYLE (existing installs still work)", () => {
    for (const dep of ["clip.style.beasty", "clip.style.mozi", "clip.style.podp"]) {
      expect(CAPTION_SKILL_STYLE[dep]).toBeDefined();
      expect(CLIP_SKILL_BY_ID[dep]).toBeDefined();
    }
  });
});
