import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HOOK_ALWAYS_ON_END_SEC } from "@/lib/builder/hookDesigns";
import { validateEditPlan } from "./clipEditOps";
import { planClipEdits, isDialogueHeavy } from "./clipEditPlanner";
import { trendingAudioUrl, TRENDING_AUDIO_IDS, TRENDING_AUDIO, pickTrendingTrackByMood } from "./trendingAudioPack";
import type { ClipConfig, ClipMoment, TranscriptSegment, TranscriptWord } from "./clipTypes";

const config: ClipConfig = {
  clipLength: { min: 20, max: 40 }, maxClipsPerSource: 3, captionsOn: true,
  captionStyle: { mode: "karaoke", fontColor: "#FFEE00", fontSize: 48, position: "bottom" },
  hookStyle: "cold_open", platforms: ["tiktok"], autoPost: true,
};
const moment: ClipMoment = { startSeconds: 5, endSeconds: 30, title: "Hook", reason: "x", viralScore: 90, captionText: "Ship fast" };
const window: TranscriptSegment[] = [{ start: 5, end: 30, text: "ship fast and learn" }];
const skills = [{ name: "Hook captions", instructions: "Always burn karaoke subs and a bold hook caption in the first 2 seconds." }];

describe("planClipEdits", () => {
  it("returns a validated plan honoring the skill (subtitles + hook text_overlay), reframe first", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "subtitles", style: config.captionStyle },
      { op: "text_overlay", text: "POV: you ship fast", position: "top", startSec: 0, endSec: 2, style: { fontColor: "#fff", fontSize: 56, bold: true } },
    ] });
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    expect(out[0].op).toBe("reframe");
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
    expect(out.some((o) => o.op === "text_overlay")).toBe(true);
  });

  it("degrades to reframe + subtitles when the LLM fails", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    expect(out[0].op).toBe("reframe");
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
  });

  it("filters LLM ops down to the wired skills' kinds (no invented overlays)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "subtitles", style: config.captionStyle },
      // LLM invented these — captions-only graph should NOT get them:
      { op: "text_overlay", text: "RANDOM HUGE TEXT", position: "top", startSec: 0, endSec: 9, style: { fontColor: "#fff", fontSize: 42, bold: true } },
      { op: "title_card", text: "Uninvited", durationSec: 2, style: { fontColor: "#fff", fontSize: 64, bold: true } },
    ] });
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.captions", name: "Dynamic Captions", instructions: "karaoke subs" }], config, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
    expect(out.some((o) => o.op === "text_overlay")).toBe(false);
    expect(out.some((o) => o.op === "title_card")).toBe(false);
  });

  it("LLM-failure floor includes every wired skill's guaranteed op", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("402"));
    const out = await planClipEdits(
      { skills: [
          { skillId: "clip.title", name: "Hook Title Card", instructions: "title" },
          { skillId: "clip.meme", name: "Meme Text", instructions: "meme" },
          { skillId: "clip.zoom", name: "Zoom Punch", instructions: "zoom" },
        ], config, window, moment },
      { callJSON },
    );
    // clip.title is retired: a wired node no longer prepends a slate.
    expect(out.some((o) => o.op === "title_card")).toBe(false);
    expect(out.some((o) => o.op === "text_overlay")).toBe(true);
    // Zoom Punch's default style is the blurred full-person frame (blur_frame op).
    expect(out.some((o) => o.op === "blur_frame")).toBe(true);
  });

  it("Zoom Punch style 'punch' emits the classic momentary zoom_punch emphasis", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.zoom", name: "Zoom Punch", instructions: "zoom", zoomStyle: "punch" }], config, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "emphasis" && o.kind === "zoom_punch")).toBe(true);
    expect(out.some((o) => o.op === "blur_frame")).toBe(false);
  });

  it("never keeps an LLM zoom_punch when Zoom Punch (clip.zoom) isn't wired, even with a custom skill (no op filtering)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "subtitles", style: config.captionStyle },
      { op: "emphasis", kind: "zoom_punch", atSec: 3 },
    ] });
    // `skills` has no skillId → allowedOpKinds returns null (no filtering) — the
    // zoom still must not leak onto a clip whose operator switched Zoom Punch off.
    const out = await planClipEdits({ skills, config, window, moment }, { callJSON });
    expect(out.some((o) => o.op === "emphasis" && o.kind === "zoom_punch")).toBe(false);
    expect(out.some((o) => o.op === "subtitles")).toBe(true);
  });

  it("clip.memeaudio floor emits a vine-boom overlay on a SHOCK moment (dynamic), and the LLM can't invent other ops", async () => {
    const prev = process.env.REACTION_SFX_BASE_URL;
    process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx";
    try {
      const callJSON = vi.fn().mockResolvedValue({ ops: [
        // LLM invents a title the memeaudio-only graph must NOT get:
        { op: "title_card", text: "Uninvited", durationSec: 2, style: { fontColor: "#fff", fontSize: 64, bold: true } },
      ] });
      const shockMoment = { ...moment, emotion: "shocking" };
      const out = await planClipEdits(
        { skills: [{ skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "reaction sfx" }], config: { ...config, captionsOn: false }, window, moment: shockMoment },
        { callJSON },
      );
      const ao = out.find((o) => o.op === "audio_overlay");
      expect(ao && "audioUrl" in ao ? ao.audioUrl : "").toBe("https://cdn.test/sfx/vine-boom.mp3");
      expect(ao && "gainDb" in ao ? ao.gainDb : 0).toBe(-3);
      expect(out.some((o) => o.op === "title_card")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.REACTION_SFX_BASE_URL; else process.env.REACTION_SFX_BASE_URL = prev;
    }
  });

  it("clip.memeaudio floor stays empty (no overlay) on a neutral moment", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "reaction sfx" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "audio_overlay")).toBe(false);
  });

  it("clip.trendingaudio floor emits the PICKED music overlay, and the LLM can't invent other ops", async () => {
    const prev = process.env.TRENDING_AUDIO_BASE_URL;
    process.env.TRENDING_AUDIO_BASE_URL = "https://cdn.test/music";
    try {
      const callJSON = vi.fn().mockResolvedValue({ ops: [
        // LLM invents a title the trendingaudio-only graph must NOT get (proves
        // SKILL_OP_KINDS is set — else allowedOpKinds returns null and this survives):
        { op: "title_card", text: "Uninvited", durationSec: 2, style: { fontColor: "#fff", fontSize: 64, bold: true } },
      ] });
      const pick = TRENDING_AUDIO_IDS[0];
      const out = await planClipEdits(
        { skills: [{ skillId: "clip.trendingaudio", name: "Trending Audio", instructions: "music", musicTrackId: pick }], config: { ...config, captionsOn: false }, window, moment },
        { callJSON },
      );
      const ao = out.find((o) => o.op === "audio_overlay");
      expect(ao && "audioUrl" in ao ? ao.audioUrl : "").toBe(trendingAudioUrl(pick));
      expect(ao && "gainDb" in ao ? ao.gainDb : 0).toBe(-28); // default quiet bed (~20% slider, speech dominant)
      expect(out.some((o) => o.op === "title_card")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TRENDING_AUDIO_BASE_URL; else process.env.TRENDING_AUDIO_BASE_URL = prev;
    }
  });

  it("clip.trendingaudio + clip.memeaudio both wired → two audio overlays coexist (amix)", async () => {
    const prevT = process.env.TRENDING_AUDIO_BASE_URL;
    const prevS = process.env.REACTION_SFX_BASE_URL;
    process.env.TRENDING_AUDIO_BASE_URL = "https://cdn.test/music";
    process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx";
    try {
      const callJSON = vi.fn().mockRejectedValue(new Error("down")); // floor path
      const pick = TRENDING_AUDIO_IDS[0];
      const shockMoment = { ...moment, emotion: "shocking" };
      const out = await planClipEdits(
        { skills: [
            { skillId: "clip.trendingaudio", name: "Trending Audio", instructions: "music", musicTrackId: pick },
            { skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "sfx" },
          ], config: { ...config, captionsOn: false }, window, moment: shockMoment },
        { callJSON },
      );
      const overlays = out.filter((o) => o.op === "audio_overlay");
      expect(overlays).toHaveLength(2);
      const urls = overlays.map((o) => ("audioUrl" in o ? o.audioUrl : "")).join(" ");
      expect(urls).toContain(trendingAudioUrl(pick)); // the music bed
      expect(urls).toContain("vine-boom");            // the reaction sting
    } finally {
      if (prevT === undefined) delete process.env.TRENDING_AUDIO_BASE_URL; else process.env.TRENDING_AUDIO_BASE_URL = prevT;
      if (prevS === undefined) delete process.env.REACTION_SFX_BASE_URL; else process.env.REACTION_SFX_BASE_URL = prevS;
    }
  });

  it("clip.brainrot floor emits a VERTICAL composite_bg only when GAMEPLAY_PACK_BASE_URL is set", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const prev = process.env.GAMEPLAY_PACK_BASE_URL;
    try {
      process.env.GAMEPLAY_PACK_BASE_URL = "https://cdn.example.com/gp";
      // bgLayout is ignored now (vertical only); bgId still picks the loop. The
      // bg id rides the SKILL object (the per-node inspector pick) — the global
      // ClipConfig never carries it — and is REQUIRED for the composite to fire.
      const cfg = { ...config, captionsOn: false } as typeof config;
      const out = await planClipEdits(
        { skills: [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgId: "minecraft" }], config: cfg, window, moment },
        { callJSON },
      );
      const cb = out.find((o) => o.op === "composite_bg");
      expect(cb && "layout" in cb ? cb.layout : "").toBe("vstack");
      expect(cb && "bgUrl" in cb ? cb.bgUrl : "").toBe("https://cdn.example.com/gp/Minecraft.mp4");
    } finally {
      if (prev === undefined) delete process.env.GAMEPLAY_PACK_BASE_URL; else process.env.GAMEPLAY_PACK_BASE_URL = prev;
    }
  });

  it("clip.brainrot with NO bgId emits no composite_bg even when the pack base is set (stale-install / unconfigured-node leak guard)", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const prev = process.env.GAMEPLAY_PACK_BASE_URL;
    try {
      process.env.GAMEPLAY_PACK_BASE_URL = "https://cdn.example.com/gp";
      // No bgId on the skill (and ClipConfig never carries one): this is what a
      // Brain Rot row left installed after its canvas node was removed looks like,
      // or an installed-but-never-configured node. The gameplay bg must NOT appear.
      const cfg = { ...config, captionsOn: false } as typeof config;
      const out = await planClipEdits(
        { skills: [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg" }], config: cfg, window, moment },
        { callJSON },
      );
      expect(out.some((o) => o.op === "composite_bg")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GAMEPLAY_PACK_BASE_URL; else process.env.GAMEPLAY_PACK_BASE_URL = prev;
    }
  });

  it("clip.brainrot with bgId 'random' still composites (explicit RANDOM pick is honored)", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const prev = process.env.GAMEPLAY_PACK_BASE_URL;
    try {
      process.env.GAMEPLAY_PACK_BASE_URL = "https://cdn.example.com/gp";
      const cfg = { ...config, captionsOn: false } as typeof config;
      const out = await planClipEdits(
        { skills: [{ skillId: "clip.brainrot", name: "Brain Rot", instructions: "gameplay bg", bgId: "random" }], config: cfg, window, moment },
        { callJSON },
      );
      expect(out.some((o) => o.op === "composite_bg")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GAMEPLAY_PACK_BASE_URL; else process.env.GAMEPLAY_PACK_BASE_URL = prev;
    }
  });

  it("clip.hook emits an opening hook overlay when genuinely configured (inspector pick present)", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down")); // floor path
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookTemplateId: "bold" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "text_overlay" && o.startSec === 0)).toBe(true);
  });

  it("clip.hook with ONLY a prompt (no other picks) still activates the hook overlay", async () => {
    // The prompt box alone counts as 'configured' — the operator gave a hook idea,
    // so the overlay must render (LLM writes it; here no apiKey → deterministic fallback).
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookPrompt: "tease the surprising result" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "text_overlay" && o.startSec === 0)).toBe(true);
  });

  it("clip.hook with NO inspector config emits no hook overlay (stale-install / unconfigured-node leak guard)", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    // No hookDurationSec/hookTemplateId/hookPosition/hookCustomDesign: this is a
    // Hook row left installed after its canvas node was removed, or never
    // configured. hookText() always yields a string, so without the gate this
    // would still burn an opening overlay. It must NOT appear.
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "text_overlay")).toBe(false);
  });

  it("clip.sticker with NO inspector config emits no sticker overlay (stale-install / unconfigured-node leak guard)", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.sticker", name: "Viral Sticker", instructions: "sticker" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "text_overlay")).toBe(false);
  });

  it("clip.overlayimage floor burns the uploaded image in FRAME mode (video-box scale + full-canvas backdrop)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [] });
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.overlayimage", name: "Overlay Image", instructions: "frame it", overlayImageUrl: "https://cdn.test/frame.png", overlayMode: "frame", overlayScale: 0.7, overlayOpacity: 0.8 }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    const ov = out.find((o) => o.op === "image_overlay");
    expect(ov && "mode" in ov ? ov.mode : undefined).toBe("frame");
    expect(ov && "frameScale" in ov ? ov.frameScale : undefined).toBe(0.7);
    expect(ov && "opacity" in ov ? ov.opacity : undefined).toBe(0.8);
    expect(ov && "imageUrl" in ov ? ov.imageUrl : undefined).toBe("https://cdn.test/frame.png");
  });

  it("clip.overlayimage floor defaults to OVERLAY mode, and a bare node stays inert", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.overlayimage", name: "Overlay Image", instructions: "image" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "image_overlay")).toBe(false);
  });

  it("merge fills floor ops the LLM skipped, and drops the retired title_card slate", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "title_card", text: "LLM's better hook", durationSec: 2, style: { fontColor: "#fff", fontSize: 64, bold: true } },
      // LLM forgot the meme overlay — floor must fill it.
    ] });
    const out = await planClipEdits(
      { skills: [
          { skillId: "clip.title", name: "Hook Title Card", instructions: "title" },
          { skillId: "clip.meme", name: "Meme Text", instructions: "meme" },
        ], config, window, moment },
      { callJSON },
    );
    // The opening slate delayed every clip — it never survives into a plan now.
    expect(out.some((o) => o.op === "title_card")).toBe(false);
    expect(out.some((o) => o.op === "text_overlay")).toBe(true);                  // floor filled meme
  });

  it("clip.title (retired) emits no slate, even with a picked news template", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down")); // floor path
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.title", name: "Hook Title Card", instructions: "title", titleTemplateId: "news_alert", titleDurationSec: 2 }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    expect(out.some((o) => o.op === "title_card")).toBe(false);
  });

  it("clip.hook Always on holds the hook overlay to the end of the clip, with the design's motion", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down")); // floor path
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookTemplateId: "bold_impact", hookDurationSec: 4, hookAlwaysOn: true }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    const hook = out.find((o) => o.op === "text_overlay" && o.startSec === 0);
    expect(hook && hook.op === "text_overlay" ? hook.endSec : 0).toBe(HOOK_ALWAYS_ON_END_SEC);
    expect(hook && hook.op === "text_overlay" ? hook.style.hookMotion?.entrance : undefined).toBe("wipe");
  });

  it("a dragged caption (captionYPct) reaches the burned subtitles style and survives re-validation", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.captions", name: "Dynamic Captions", instructions: "captions", captionAlign: "bottom", captionYPct: 71.4 }], config: { ...config, captionsOn: true }, window, moment },
      { callJSON },
    );
    const sub = validateEditPlan(out).find((o) => o.op === "subtitles");
    expect(sub && sub.op === "subtitles" ? sub.style.yPct : undefined).toBe(71.4);
  });

  it("clip.hook without Always on keeps the picked duration", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("down"));
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.hook", name: "Auto Hook", instructions: "hook", hookTemplateId: "bold_impact", hookDurationSec: 4 }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    const hook = out.find((o) => o.op === "text_overlay" && o.startSec === 0);
    expect(hook && hook.op === "text_overlay" ? hook.endSec : 0).toBe(4);
  });

  // ── 2026-06-29 bug-hunt regressions (clippingbughunt1.md) ──

  it("[#1] clip.sticker RESTYLES the LLM's own overlay in place — ONE sticker out, not a double", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "reframe", mode: "crop" },
      // The sticker MD tells the LLM to add ONE text_overlay; it lands at startSec 0, not 0.3.
      { op: "text_overlay", text: "WATCH THIS", position: "top", startSec: 0, endSec: 3, style: { fontColor: "#fff", fontSize: 40, bold: true } },
    ] });
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.sticker", name: "Viral Sticker", instructions: "Add exactly ONE text_overlay", stickerStyleId: "hype" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays.length).toBe(1); // was 2 (the LLM's raw overlay + an appended styled sticker)
    const ov = overlays[0];
    if (ov.op !== "text_overlay") throw new Error("no overlay");
    expect(ov.style.bgColor).toBe("#FF2D78"); // the "hype" sticker pink box — the LLM's plain overlay was restyled
  });

  it("[#6/#10] clip.meme forces its white-on-black style onto the LLM's mid-clip overlay (keeps the LLM text)", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [
      { op: "reframe", mode: "crop" },
      // The meme MD has the LLM emit an overlay 'timed to a key beat' (startSec >= 1); its
      // bright/yellow style would otherwise blend into the #FFEE00 karaoke captions.
      { op: "text_overlay", text: "lol no way", position: "top", startSec: 2, endSec: 4, style: { fontColor: "#FFEE00", fontSize: 32, bold: true } },
    ] });
    const out = await planClipEdits(
      { skills: [{ skillId: "clip.meme", name: "Meme Text", instructions: "meme" }], config: { ...config, captionsOn: false }, window, moment },
      { callJSON },
    );
    const overlays = out.filter((o) => o.op === "text_overlay");
    expect(overlays.length).toBe(1);
    const ov = overlays[0];
    if (ov.op !== "text_overlay") throw new Error("no overlay");
    expect(ov.text).toBe("lol no way");        // LLM text/timing preserved
    expect(ov.style.fontColor).toBe("#FFFFFF"); // forced white (not the LLM's yellow)
    expect(ov.style.bgColor).toBe("#000000");   // forced black box
    expect(ov.style.outlineWidth).toBe(8);      // forced meme outline
  });
});

// Content-aware MEME reaction SFX timing: the audio_overlay.atSec is DERIVED from
// the moment's per-word content peak (with a small lead-in), not a fixed constant.
// The emotion-derived sound choice (vine-boom for shock) is preserved.
describe("clip.memeaudio content-aware atSec", () => {
  const memeConfig: ClipConfig = { ...config, captionsOn: false };
  const memeSkills = [{ skillId: "clip.memeaudio", name: "MEME reaction SFX", instructions: "reaction sfx" }];
  // moment window is [5,30] → 25s; words are absolute, the floor clips+rebases them.
  const shock: ClipMoment = { startSeconds: 5, endSeconds: 30, title: "t", reason: "r", viralScore: 90, captionText: "c", emotion: "shocking" };
  const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "reframe", mode: "crop" }] });

  const run = async (words?: TranscriptWord[]) => {
    const prev = process.env.REACTION_SFX_BASE_URL;
    process.env.REACTION_SFX_BASE_URL = "https://cdn.test/sfx";
    try {
      const out = await planClipEdits({ skills: memeSkills, config: memeConfig, window, words, moment: shock }, { callJSON });
      const ao = out.find((o) => o.op === "audio_overlay");
      return ao && ao.op === "audio_overlay" ? ao : null;
    } finally {
      if (prev === undefined) delete process.env.REACTION_SFX_BASE_URL; else process.env.REACTION_SFX_BASE_URL = prev;
    }
  };

  it("two moments with different peak positions yield DIFFERENT atSec (and keep the same sound)", async () => {
    // Emphatic-punctuation peak (rule 2). Early-peak moment: the "!" word starts at +3s.
    const early: TranscriptWord[] = [
      { word: "calm", start: 5, end: 5.5 },
      { word: "boom!", start: 8, end: 8.4 },
      { word: "after", start: 12, end: 12.4 },
    ];
    // Late-peak moment: the "!" word starts at +18s (abs 23).
    const late: TranscriptWord[] = [
      { word: "calm", start: 5, end: 5.5 },
      { word: "still", start: 9, end: 9.4 },
      { word: "boom!", start: 23, end: 23.4 },
    ];
    const a = await run(early);
    const b = await run(late);
    expect(a?.audioUrl).toBe("https://cdn.test/sfx/vine-boom.mp3"); // sound preserved
    expect(b?.audioUrl).toBe("https://cdn.test/sfx/vine-boom.mp3");
    // early peak at rel 3 → atSec ≈ 3 - 0.12; late peak at rel 18 → atSec ≈ 18 - 0.12.
    expect(a?.atSec).toBeCloseTo(2.88);
    expect(b?.atSec).toBeCloseTo(17.88);
    expect(a?.atSec).not.toBeCloseTo(b?.atSec ?? -1);
  });

  it("falls back to the emotion constant when no words are supplied", async () => {
    const ao = await run(undefined);
    expect(ao?.audioUrl).toBe("https://cdn.test/sfx/vine-boom.mp3");
    expect(ao?.atSec).toBeCloseTo(0.2); // vine-boom emotion constant, untouched
  });
});

// REPORT: "I applied the B&W filter and it is not applying." The renderer burns the
// grade correctly (clipFilterGraph.colorfilter.test.ts proves it frame by frame), so
// the only place it can go missing is here — the operator's pick has to survive the
// journey from the node's config into a color_filter op.
describe("clip.filters — the operator's pick always reaches the plan", () => {
  const filterSkill = { skillId: "clip.filters", name: "Video Filters", instructions: "Apply the chosen grade.", filterPreset: "bw" as const };

  it("emits the picked preset even when the LLM returns none", async () => {
    const callJSON = vi.fn().mockResolvedValue({ ops: [{ op: "subtitles", style: config.captionStyle }] });
    const out = await planClipEdits({ skills: [filterSkill], config, window, moment }, { callJSON });
    const grade = out.find((o) => o.op === "color_filter");
    expect(grade, "no color_filter in the plan — the grade would never render").toBeDefined();
    expect(grade).toMatchObject({ preset: "bw" });
  });

  it("still emits the grade when the LLM call fails entirely", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("kie down"));
    const out = await planClipEdits({ skills: [filterSkill], config, window, moment }, { callJSON });
    expect(out.some((o) => o.op === "color_filter" && o.preset === "bw")).toBe(true);
  });

  it("carries the sliders when no preset is picked", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("kie down"));
    const sliderSkill = { skillId: "clip.filters", name: "Video Filters", instructions: "", filterSaturation: 0.2, filterBrightness: 0.1 };
    const out = await planClipEdits({ skills: [sliderSkill], config, window, moment }, { callJSON });
    expect(out.find((o) => o.op === "color_filter")).toMatchObject({ saturation: 0.2, brightness: 0.1 });
  });

  it("an unconfigured Video Filters node stays a no-op", async () => {
    const callJSON = vi.fn().mockRejectedValue(new Error("kie down"));
    const bare = { skillId: "clip.filters", name: "Video Filters", instructions: "" };
    const out = await planClipEdits({ skills: [bare], config, window, moment }, { callJSON });
    expect(out.some((o) => o.op === "color_filter")).toBe(false);
  });
});

function wordsAt(text: string, startSeconds: number, endSeconds: number): TranscriptWord[] {
  // Evenly spread the text's words across the window — mirrors a real
  // Whisper word-align closely enough for the density heuristic.
  const toks = text.split(/\s+/).filter(Boolean);
  const span = endSeconds - startSeconds;
  const step = span / Math.max(1, toks.length);
  return toks.map((word, i) => ({ word, start: startSeconds + i * step, end: startSeconds + i * step + step * 0.8 }));
}

describe("isDialogueHeavy", () => {
  const m: ClipMoment = { startSeconds: 0, endSeconds: 10, title: "t", reason: "r", viralScore: 80, captionText: "c" };

  it("true for near-continuous speech (~2.5 wps over 10s)", () => {
    const text = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" "); // 25 words / 10s = 2.5 wps
    expect(isDialogueHeavy(m, wordsAt(text, 0, 10), undefined)).toBe(true);
  });

  it("false for sparse/occasional speech (a few words over 10s)", () => {
    expect(isDialogueHeavy(m, wordsAt("hey check this out", 0, 10), undefined)).toBe(false);
  });

  it("false for a silent/visual clip (no words at all)", () => {
    expect(isDialogueHeavy(m, [], undefined)).toBe(false);
  });

  it("only counts words INSIDE the moment window, not the whole source", () => {
    // 30 dense words, but they land at 20-30s — entirely outside this 0-10s moment.
    const outside = wordsAt(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "), 20, 30);
    expect(isDialogueHeavy(m, outside, undefined)).toBe(false);
  });

  it("falls back to window text when no per-word timestamps exist", () => {
    const window: TranscriptSegment[] = [{ start: 0, end: 10, text: Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ") }];
    expect(isDialogueHeavy(m, undefined, window)).toBe(true);
    expect(isDialogueHeavy(m, [], window)).toBe(true);
  });
});

describe("planClipEdits — Trending Audio picks an instrumental for a dialogue-heavy clip", () => {
  const prev = process.env.TRENDING_AUDIO_BASE_URL;
  beforeEach(() => { process.env.TRENDING_AUDIO_BASE_URL = "https://cdn.test/music"; });
  afterEach(() => { if (prev === undefined) delete process.env.TRENDING_AUDIO_BASE_URL; else process.env.TRENDING_AUDIO_BASE_URL = prev; });

  const musicSkill = { skillId: "clip.trendingaudio", name: "Trending Audio", instructions: "Add music.", autoMusic: true };

  it("a dense-transcript clip auto-picks an INSTRUMENTAL track end-to-end", async () => {
    const denseWords = wordsAt(Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "), 5, 30); // 60 words / 25s = 2.4 wps
    const callJSON = vi.fn().mockRejectedValue(new Error("kie down")); // exercise the deterministic floor
    const out = await planClipEdits({ skills: [musicSkill], config, window, moment, words: denseWords }, { callJSON });
    const op = out.find((o) => o.op === "audio_overlay");
    expect(op).toBeTruthy();
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    // TRENDING_AUDIO's own `.url` field is resolved at MODULE LOAD time (before
    // this test's env is set) so it can't be compared directly — resolve each
    // candidate id live instead, via the same trendingAudioUrl() the floor uses.
    const picked = TRENDING_AUDIO.find((t) => trendingAudioUrl(t.id) === op.audioUrl);
    expect(picked?.instrumental).toBe(true);
  });

  it("a sparse-transcript clip can still auto-pick a vocal track", async () => {
    const sparseWords = wordsAt("hey check this out today", 5, 30);
    const callJSON = vi.fn().mockRejectedValue(new Error("kie down"));
    const out = await planClipEdits({ skills: [musicSkill], config, window, moment, words: sparseWords }, { callJSON });
    const op = out.find((o) => o.op === "audio_overlay");
    expect(op).toBeTruthy();
    if (!op || op.op !== "audio_overlay") throw new Error("no audio_overlay");
    // Same seed/mood math the floor uses when NOT restricted to instrumentals.
    expect(op.audioUrl).toBe(trendingAudioUrl(pickTrendingTrackByMood(moment.emotion, Math.round(moment.startSeconds * 1000), false)));
  });
});
