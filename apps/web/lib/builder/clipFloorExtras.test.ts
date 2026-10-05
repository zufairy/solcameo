// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CLIP_SKILL_BY_ID } from "./clipSkillsCatalog";
import type { ClipFloorConfig, ClipFloorMoment } from "./clipSkillsCatalog";
import { planClipEdits } from "../server/clipEditPlanner";
import { trendingAudioUrl, pickTrendingTrackByMood, TRENDING_AUDIO_IDS } from "../server/trendingAudioPack";
import type { ClipConfig, ClipMoment, TranscriptSegment } from "../server/clipTypes";

const baseCfg: ClipFloorConfig = {
  captionsOn: false,
  captionStyle: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" },
};
const moment = (emotion?: string, startSeconds = 0): ClipFloorMoment => ({
  title: "t", captionText: "c", startSeconds, endSeconds: startSeconds + 30, emotion,
});

// DYNAMIC: the floor picks WHICH reaction SFX + WHEN purely from the moment's
// (AI-assigned) emotion — no user config. Neutral moments get no sting.
describe("clip.memeaudio — dynamic emotion-driven SFX", () => {
  const prev = process.env.REACTION_SFX_BASE_URL;
  beforeEach(() => { process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx"; });
  afterEach(() => { if (prev === undefined) delete process.env.REACTION_SFX_BASE_URL; else process.env.REACTION_SFX_BASE_URL = prev; });
  const sting = (emotion?: string) => {
    const op = CLIP_SKILL_BY_ID["clip.memeaudio"].floor!(moment(emotion), baseCfg)[0];
    return op && op.op === "audio_overlay" ? op : null;
  };
  it("picks the SFX + beat from the moment's emotion (no config, fixed -3 dB gain)", () => {
    expect(sting("shocking")?.audioUrl).toContain("vine-boom.mp3");
    expect(sting("shocking")?.atSec).toBeCloseTo(0.2);
    expect(sting("controversial")?.audioUrl).toContain("vine-boom.mp3");
    expect(sting("funny")?.audioUrl).toContain("bruh.mp3");
    expect(sting("funny")?.atSec).toBeCloseTo(1.2);
    expect(sting("inspiring")?.audioUrl).toContain("fah.mp3");
    expect(sting("inspiring")?.atSec).toBeCloseTo(1.6);
    expect(sting("shocking")?.gainDb).toBe(-3);
  });
  it("a NEUTRAL moment gets no sting (the AI doesn't force one)", () => {
    expect(sting("informative")).toBeNull();
    expect(sting(undefined)).toBeNull();
  });
  it("emits NOTHING when REACTION_SFX_BASE_URL is unset (graceful degrade)", () => {
    delete process.env.REACTION_SFX_BASE_URL;
    expect(CLIP_SKILL_BY_ID["clip.memeaudio"].floor!(moment("funny"), baseCfg)).toEqual([]);
  });
});

describe("clip.brainrot — random pool rotation", () => {
  const prev = process.env.GAMEPLAY_PACK_BASE_URL;
  afterEach(() => { if (prev === undefined) delete process.env.GAMEPLAY_PACK_BASE_URL; else process.env.GAMEPLAY_PACK_BASE_URL = prev; });

  it("'random' bgId resolves a pool video (deterministic per clip) when the base is set", () => {
    process.env.GAMEPLAY_PACK_BASE_URL = "https://cdn.test";
    const floor = CLIP_SKILL_BY_ID["clip.brainrot"].floor!;
    const ops = floor(moment(undefined, 5), { ...baseCfg, bgId: "random" });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "composite_bg") throw new Error("no composite_bg");
    expect(op.bgUrl).toMatch(/^https:\/\/cdn\.test\/.+\.mp4$/);
    // same clip (same start) → same bg; different clip → may differ
    const op2 = floor(moment(undefined, 5), { ...baseCfg, bgId: "random" })[0];
    if (!op2 || op2.op !== "composite_bg") throw new Error("no composite_bg");
    expect(op2.bgUrl).toBe(op.bgUrl);
  });

  it("emits NOTHING when GAMEPLAY_PACK_BASE_URL is unset (graceful degrade)", () => {
    delete process.env.GAMEPLAY_PACK_BASE_URL;
    const ops = CLIP_SKILL_BY_ID["clip.brainrot"].floor!(moment(undefined, 5), { ...baseCfg, bgId: "random" });
    expect(ops).toEqual([]);
  });
});

describe("clip.trendingaudio — music bed (library pick + auto-by-mood)", () => {
  const prev = process.env.TRENDING_AUDIO_BASE_URL;
  beforeEach(() => { process.env.TRENDING_AUDIO_BASE_URL = "https://cdn.test/music"; });
  afterEach(() => { if (prev === undefined) delete process.env.TRENDING_AUDIO_BASE_URL; else process.env.TRENDING_AUDIO_BASE_URL = prev; });
  const floor = (m: ClipFloorMoment, cfg: ClipFloorConfig) => CLIP_SKILL_BY_ID["clip.trendingaudio"].floor!(m, cfg);
  const PICK = TRENDING_AUDIO_IDS[0]; // a real library id

  it("emits one quiet audio_overlay at atSec 0 for a picked track", () => {
    const ops = floor(moment(""), { ...baseCfg, musicTrackId: PICK });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    expect(op.atSec).toBe(0);
    expect(op.audioUrl).toBe(trendingAudioUrl(PICK)); // url is the resolved (encoded) file
    expect(op.gainDb).toBe(-28); // default quiet bed (~20% slider)
  });

  it("auto-picks a mood-matched track when autoMusic is on and no track is picked", () => {
    const ops = floor(moment("hilarious comedy bit"), { ...baseCfg, autoMusic: true });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    // moment("hilarious comedy bit") → startSeconds 0 → seed 0; floor must match the picker
    expect(op.audioUrl).toBe(trendingAudioUrl(pickTrendingTrackByMood("hilarious comedy bit", 0)));
  });

  it("is INERT when neither a track nor autoMusic is set (leak-safe)", () => {
    expect(floor(moment("funny"), { ...baseCfg })).toEqual([]);
  });

  it("falls back to mood auto-pick for a STALE/removed track id (never silent)", () => {
    const ops = floor(moment("hilarious comedy bit"), { ...baseCfg, musicTrackId: "removed-track-xyz" });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    expect(op.audioUrl).toBe(trendingAudioUrl(pickTrendingTrackByMood("hilarious comedy bit", 0)));
  });

  it("degrades to [] when TRENDING_AUDIO_BASE_URL is unset", () => {
    delete process.env.TRENDING_AUDIO_BASE_URL;
    expect(floor(moment(""), { ...baseCfg, musicTrackId: PICK })).toEqual([]);
  });

  it("heavyDialogue restricts auto-pick to an instrumental track (no vocal fighting the speaker)", () => {
    const ops = floor(moment("hilarious comedy bit"), { ...baseCfg, autoMusic: true, heavyDialogue: true });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    expect(op.audioUrl).toBe(trendingAudioUrl(pickTrendingTrackByMood("hilarious comedy bit", 0, true)));
  });

  it("heavyDialogue is ignored for a manual musicTrackId pick (operator's explicit choice wins)", () => {
    const ops = floor(moment(""), { ...baseCfg, musicTrackId: PICK, heavyDialogue: true });
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    expect(op.audioUrl).toBe(trendingAudioUrl(PICK));
  });

  it("honors an explicit gainDb override", () => {
    const ops = floor(moment(""), { ...baseCfg, musicTrackId: PICK, gainDb: -8 });
    const op = ops[0];
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    expect(op.gainDb).toBe(-8);
  });
});

// The "global-config trap" fix: per-node brainrot/memeaudio config must reach the
// floor THROUGH planClipEdits (it rides the skills array, not the global ClipConfig).
describe("per-node config reaches the floor via planClipEdits", () => {
  const config: ClipConfig = {
    clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: false,
    captionStyle: { mode: "karaoke", fontColor: "#fff", fontSize: 48, position: "bottom" },
    hookStyle: "cold_open", platforms: ["tiktok"], autoPost: false,
  };
  const window: TranscriptSegment[] = [{ start: 0, end: 30, text: "boom" }];
  const moment = (emotion?: string): ClipMoment => ({ startSeconds: 0, endSeconds: 30, title: "t", reason: "r", viralScore: 80, captionText: "c", emotion });

  it("clip.memeaudio: a shock moment → a vine-boom audio_overlay (dynamic, no config)", async () => {
    process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx";
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [{ skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "x" }];
    const out = await planClipEdits({ skills, config, window, moment: moment("shocking") }, { callJSON });
    delete process.env.REACTION_SFX_BASE_URL;
    const a = out.find((o) => o.op === "audio_overlay");
    if (!a || a.op !== "audio_overlay") throw new Error("no audio_overlay — the dynamic floor did not run");
    expect(a.audioUrl).toBe("https://cdn.test/sfx/vine-boom.mp3");
    expect(a.gainDb).toBe(-3);
    expect(a.atSec).toBeCloseTo(0.2); // emotion=shocking → early sting
  });

  it("clip.memeaudio: a NEUTRAL moment → no audio_overlay (AI doesn't force one)", async () => {
    process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx";
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [{ skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "x" }];
    const out = await planClipEdits({ skills, config, window, moment: moment() }, { callJSON });
    delete process.env.REACTION_SFX_BASE_URL;
    expect(out.find((o) => o.op === "audio_overlay")).toBeUndefined();
  });

  it("clip.brainrot: bgId on the skill → a composite_bg (when the pack base is set)", async () => {
    process.env.GAMEPLAY_PACK_BASE_URL = "https://cdn.test";
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });
    const skills = [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "x", bgLayout: "vstack" as const, bgId: "minecraft" }];
    const out = await planClipEdits({ skills, config, window, moment: moment() }, { callJSON });
    const b = out.find((o) => o.op === "composite_bg");
    delete process.env.GAMEPLAY_PACK_BASE_URL;
    if (!b || b.op !== "composite_bg") throw new Error("no composite_bg — config did not reach the floor");
    expect(b.bgUrl).toContain("Minecraft.mp4");
    expect(b.layout).toBe("vstack");
  });
});
