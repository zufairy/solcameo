import { describe, it, expect } from "vitest";
import { DEFAULT_CLIP_CONFIG, normalizeClipConfig } from "./clipConfig";

describe("normalizeClipConfig", () => {
  it("fills defaults for an empty input", () => {
    const c = normalizeClipConfig({});
    expect(c).toEqual(DEFAULT_CLIP_CONFIG);
  });
  it("clamps length + N and filters platforms to the whitelist", () => {
    const c = normalizeClipConfig({ clipLength: { min: 1, max: 999 }, maxClipsPerSource: 99, platforms: ["tiktok", "myspace"] });
    expect(c.clipLength.min).toBeGreaterThanOrEqual(5);
    expect(c.clipLength.max).toBeLessThanOrEqual(180);
    expect(c.maxClipsPerSource).toBe(60);        // upper bound raised 10 → 60 (selectable clip count)
    expect(c.platforms).toEqual(["tiktok"]);
  });

  it("accepts a clip count of 60 and floors N to >= 1", () => {
    expect(normalizeClipConfig({ maxClipsPerSource: 60 }).maxClipsPerSource).toBe(60);
    expect(normalizeClipConfig({ maxClipsPerSource: 0 }).maxClipsPerSource).toBe(1);
    expect(normalizeClipConfig({ maxClipsPerSource: 61 }).maxClipsPerSource).toBe(60);
  });

  // Transitions (clip.transitions) — lifted into clipConfig.transition by compile-graph.
  it("coerces a full transition { id, durationSec } and clamps the duration", () => {
    expect(normalizeClipConfig({ transition: { id: "wipe_left", durationSec: 0.9 } } as never).transition)
      .toEqual({ id: "wipe_left", durationSec: 0.9 });
    // Over-long seam is clamped to the allowed window (1.5s max).
    expect(normalizeClipConfig({ transition: { id: "fade", durationSec: 99 } } as never).transition?.durationSec).toBe(1.5);
  });
  it("accepts a bare transition id string and fills the style's default duration", () => {
    const t = normalizeClipConfig({ transition: "circle_open" } as never).transition;
    expect(t?.id).toBe("circle_open");
    expect(typeof t?.durationSec).toBe("number");
  });
  it("drops an unknown transition id (no transition on the config)", () => {
    expect(normalizeClipConfig({ transition: { id: "not-real" } } as never).transition).toBeUndefined();
    expect(normalizeClipConfig({}).transition).toBeUndefined();
  });

  // Regression: the builder chat emits captionStyle as a SHORTHAND STRING, which
  // broke the Convex object validator on mint. It must always become an object.
  it("coerces a string captionStyle (e.g. 'bold-white') into a valid object", () => {
    const c = normalizeClipConfig({ captionStyle: "bold-white" } as never);
    expect(typeof c.captionStyle).toBe("object");
    expect(c.captionStyle.fontColor).toBe("#FFFFFF");
    expect(c.captionStyle.mode).toBe("karaoke");
    expect(typeof c.captionStyle.fontSize).toBe("number");
    expect(["top", "center", "bottom"]).toContain(c.captionStyle.position);
  });

  it("reads mode/position/color hints from a free-text caption style string", () => {
    const c = normalizeClipConfig({ captionStyle: "minimal line subtitles, yellow, top" } as never);
    expect(c.captionStyle.mode).toBe("line");
    expect(c.captionStyle.position).toBe("top");
    expect(c.captionStyle.fontColor).toBe("#FFEE00");
  });

  it("repairs a partial/garbage captionStyle object without throwing", () => {
    const c = normalizeClipConfig({ captionStyle: { mode: "weird", fontSize: "huge" } } as never);
    expect(c.captionStyle.mode).toBe("karaoke");          // invalid mode → default
    expect(c.captionStyle.fontSize).toBe(64);             // non-number → default
    expect(c.captionStyle.fontColor).toBe("#FFEE00");
  });

  it("never emits a brandLogoUrl key for junk input", () => {
    const c = normalizeClipConfig({ platforms: "tiktok", clipLength: "short" } as never);
    expect(c.platforms).toEqual(["tiktok"]);              // non-array platforms → default
    expect(c.clipLength).toEqual({ min: 20, max: 45 });   // non-object clipLength → default
    expect("brandLogoUrl" in c).toBe(false);
  });
});

// Pools arrive from a canvas node or a persisted cloud config, so the normalizer is
// the last line of defence against a half-finished upload reaching the renderer as
// an empty ffmpeg input.
describe("normalizeClipConfig — video pools", () => {
  it("keeps clean url lists", () => {
    const c = normalizeClipConfig({ hookVideos: ["h1.mp4", "h2.mp4"], mainVideos: ["m1.mp4"] });
    expect(c.hookVideos).toEqual(["h1.mp4", "h2.mp4"]);
    expect(c.mainVideos).toEqual(["m1.mp4"]);
  });

  it("drops blanks, non-strings and duplicates", () => {
    const c = normalizeClipConfig({ hookVideos: ["  h1.mp4  ", "", null, 7, "h1.mp4", "h2.mp4"] as unknown as string[] });
    expect(c.hookVideos).toEqual(["h1.mp4", "h2.mp4"]);
  });

  it("omits the fields entirely when the pools are empty", () => {
    const c = normalizeClipConfig({ hookVideos: [], mainVideos: [] });
    expect(c.hookVideos).toBeUndefined();
    expect(c.mainVideos).toBeUndefined();
  });

  it("ignores mainOnly without a main video to publish", () => {
    expect(normalizeClipConfig({ mainOnly: true }).mainOnly).toBeUndefined();
    expect(normalizeClipConfig({ mainOnly: true, mainVideos: ["m1.mp4"] }).mainOnly).toBe(true);
  });

  it("caps a runaway pool", () => {
    const many = Array.from({ length: 50 }, (_, i) => `v${i}.mp4`);
    expect(normalizeClipConfig({ mainVideos: many }).mainVideos!.length).toBe(30);
  });
});
