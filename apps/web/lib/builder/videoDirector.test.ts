import { describe, it, expect } from "vitest";
import { resolveVideoDirectives, randInRange, DEFAULT_VIDEO_CONFIG, deriveVideoDirectorIntent, type VideoConfig } from "./videoDirector";

const cfg: VideoConfig = {
  ...DEFAULT_VIDEO_CONFIG,
  minSeconds: 16, maxSeconds: 48,
  styles: ["talking_head", "commercial", "ootd"],
  hookStyles: ["question", "bold_claim"],
  settings: ["studio", "home"],
  energy: "high", cta: "follow", customDirective: "always smiling", avoid: "no politics",
};
const agent = { mintAddress: "m1", niche: "fashion", videoConfig: cfg };

describe("randInRange", () => {
  it("stays within [min,max] and snaps to a supported length", () => {
    for (let i = 0; i < 50; i++) {
      const v = randInRange(16, 48, `seed-${i}`);
      expect(v).toBeGreaterThanOrEqual(16);
      expect(v).toBeLessThanOrEqual(48);
      expect([8, 16, 24, 32, 48, 60]).toContain(v);
    }
  });
});

describe("resolveVideoDirectives", () => {
  it("explicit input duration overrides the config range", () => {
    const d = resolveVideoDirectives(agent, { durationSeconds: 24 }, "s1");
    expect(d.durationSeconds).toBe(24);
  });

  it("derives a varied duration from the config range when input omits it", () => {
    const d = resolveVideoDirectives(agent, {}, "s2");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(16);
    expect(d.durationSeconds).toBeLessThanOrEqual(48);
  });

  it("composes a brief from the rolled style + hook + energy + cta + custom + avoid", () => {
    const d = resolveVideoDirectives(agent, {}, "s3");
    const styleFormats = ["talking-head", "commercial spot", "outfit showcase"];
    expect(styleFormats).toContain(d.brief.format);
    expect(d.brief.structureNotes).toContain("always smiling");
    expect(d.brief.structureNotes.toLowerCase()).toContain("avoid");
    expect(d.brief.angle.length).toBeGreaterThan(0);
    expect(d.brief.visualTreatment.length).toBeGreaterThan(0);
  });

  it("parses a 1080p resolution edit into the video config", () => {
    const intent = deriveVideoDirectorIntent("set the influencer videos to 1080p portrait");
    expect(intent.videoConfig?.resolution).toBe("1080p");
    expect(intent.videoConfig?.aspectRatio).toBe("9:16");
  });

  it("avoids repeating the immediately-previous style when more than one style", () => {
    const last = "talking-head";
    const d = resolveVideoDirectives(agent, {}, "s3", last);
    expect(d.brief.format).not.toBe(last);
  });

  it("falls back to sane defaults when videoConfig is absent", () => {
    const d = resolveVideoDirectives({ mintAddress: "m2", niche: "tech" }, {}, "s4");
    expect(d.durationSeconds).toBeGreaterThanOrEqual(8);
    expect(d.brief.format.length).toBeGreaterThan(0);
  });

  // The overlay switches that make captions/hook/music "dynamic based on installed
  // skills" — the contract the UGC generate-content path depends on to burn them.
  describe("overlays driven by installedSkills", () => {
    it("no captions/hook/music overlays when nothing is installed or enabled", () => {
      const d = resolveVideoDirectives(agent, {}, "ov0");
      expect(d.overlays.captions?.enabled).toBeFalsy();
      expect(d.overlays.hookText?.enabled).toBeFalsy();
      expect(d.overlays.music).toBeUndefined();
    });

    it("installing video.captions turns captions on", () => {
      const d = resolveVideoDirectives({ ...agent, installedSkills: ["video.captions"] }, {}, "ov1");
      expect(d.overlays.captions?.enabled).toBe(true);
    });

    it("installing video.autohook turns the hook overlay on", () => {
      const d = resolveVideoDirectives({ ...agent, installedSkills: ["video.autohook"] }, {}, "ov2");
      expect(d.overlays.hookText?.enabled).toBe(true);
    });

    it("installing music.trendingaudio turns the music bed on with a default volume", () => {
      const d = resolveVideoDirectives({ ...agent, installedSkills: ["music.trendingaudio"] }, {}, "ov3");
      expect(d.overlays.music?.enabled).toBe(true);
      expect(d.overlays.music?.volumePct).toBe(30);
    });

    it("installing all three enables all overlays at once", () => {
      const d = resolveVideoDirectives(
        { ...agent, installedSkills: ["video.captions", "video.autohook", "music.trendingaudio"] },
        {}, "ov4",
      );
      expect(d.overlays.captions?.enabled).toBe(true);
      expect(d.overlays.hookText?.enabled).toBe(true);
      expect(d.overlays.music?.enabled).toBe(true);
    });
  });

  describe("wired AI-Clipper apps bridge onto UGC overlays", () => {
    it("wired clip.trendingaudio enables the music bed + pins its track", () => {
      const d = resolveVideoDirectives(agent, {}, "cs1", undefined, [
        { skillId: "clip.trendingaudio", wired: true, config: { autoMusic: false, musicTrackId: "cinderella-overlapped" } },
      ]);
      expect(d.overlays.music?.enabled).toBe(true);
      expect(d.overlays.music?.trackId).toBe("cinderella-overlapped");
      expect(d.overlays.music?.autoMusic).toBe(false);
      expect(d.overlays.music?.volumePct).toBe(30);
    });

    it("wired clip.hook enables the hook + carries its design + duration", () => {
      const d = resolveVideoDirectives(agent, {}, "cs2", undefined, [
        { skillId: "clip.hook", wired: true, config: { hookTemplateId: "black_box", hookDurationSec: 3.5 } },
      ]);
      expect(d.overlays.hookText?.enabled).toBe(true);
      expect(d.overlays.hookText?.templateId).toBe("black_box");
      expect(d.overlays.hookText?.durationSeconds).toBe(3.5);
    });

    it("wired clip.hook carries the saved custom design (size + exact position) too", () => {
      const d = resolveVideoDirectives(agent, {}, "cs2b", undefined, [
        { skillId: "clip.hook", wired: true, config: {
          hookTemplateId: "bold_impact",
          hookCustomDesign: { fontSize: 92, yPct: 62 },
        } },
      ]);
      expect(d.overlays.hookText?.enabled).toBe(true);
      const style = d.overlays.hookText?.style as { fontSize?: number; yPct?: number } | undefined;
      expect(style?.fontSize).toBe(92);
      expect(style?.yPct).toBe(62);
    });

    it("wired clip.captions enables captions + carries the preset", () => {
      const d = resolveVideoDirectives(agent, {}, "cs3", undefined, [
        { skillId: "clip.captions", wired: true, config: { captionPreset: "gold" } },
      ]);
      expect(d.overlays.captions?.enabled).toBe(true);
      expect((d.overlays.captions?.style as { preset?: string }).preset).toBe("gold");
    });

    it("a clip skill explicitly wired:false does NOT enable its overlay", () => {
      const d = resolveVideoDirectives(agent, {}, "cs4", undefined, [
        { skillId: "clip.hook", wired: false, config: { hookTemplateId: "black_box" } },
        { skillId: "clip.trendingaudio", wired: false, config: {} },
      ]);
      expect(d.overlays.hookText?.enabled).toBeFalsy();
      expect(d.overlays.music).toBeUndefined();
    });
  });
});

// The pool apps must reach the render whenever they have uploads. The clip.* ids
// are still honored too, so an agent configured through the clipper canvas keeps
// its uploads when it renders UGC.
describe("resolveVideoDirectives — Hook Videos / Main Content apps", () => {
  const withPools = (extra: Partial<VideoConfig>, installedSkills: string[] = []) =>
    resolveVideoDirectives(
      { ...agent, installedSkills, videoConfig: { ...cfg, ...extra } },
      {},
      "s1",
    ).overlays;

  it("passes the hook pool through even without a separately installed app", () => {
    const ov = withPools({ hookVideos: ["h1.mp4"] }, []);
    expect(ov.hookVideos).toEqual(["h1.mp4"]);
  });

  it("is a no-op when nothing is uploaded", () => {
    const ov = withPools({ hookVideos: [] });
    expect(ov.hookVideos).toBeUndefined();
  });

  it("passes the hook pool through when uploaded", () => {
    const ov = withPools({ hookVideos: ["h1.mp4", "h2.mp4"] }, ["video.hookvideos"]);
    expect(ov.hookVideos).toEqual(["h1.mp4", "h2.mp4"]);
  });

  it("accepts the clipper's app id too (one agent, both render paths)", () => {
    const ov = withPools({ mainVideos: ["m1.mp4"] }, ["clip.maincontent"]);
    expect(ov.mainVideos).toEqual(["m1.mp4"]);
  });

  it("only honors the bypass switch when there is a main video to publish", () => {
    expect(withPools({ mainVideosOnly: true }, ["video.maincontent"]).mainVideosOnly).toBeUndefined();
    expect(withPools({ mainVideos: ["m1.mp4"], mainVideosOnly: true }, ["video.maincontent"]).mainVideosOnly).toBe(true);
  });
});
