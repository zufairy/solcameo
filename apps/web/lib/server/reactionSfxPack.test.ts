// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  reactionSfxUrl,
  REACTION_SFX_IDS,
  isReactionSfxId,
  REACTION_SFX_PACKS,
  DEFAULT_REACTION_SFX_PACK_ID,
  isReactionSfxPackId,
  reactionSfxPackById,
  reactionBucketForEmotion,
  reactionSfxTargetSec,
  pickSfxFromKeywords,
} from "./reactionSfxPack";
import type { TranscriptWord } from "./clipTypes";
import { CLIP_SKILL_BY_ID } from "../builder/clipSkillsCatalog";
import type { ClipFloorConfig, ClipFloorMoment } from "../builder/clipSkillsCatalog";

const ENV = "REACTION_SFX_BASE_URL";

describe("reactionSfxPack", () => {
  const prev = process.env[ENV];
  beforeEach(() => { delete process.env[ENV]; });
  afterEach(() => { if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev; });

  it("resolves a known id against the env base, tolerating a trailing slash", () => {
    process.env[ENV] = "https://cdn.example.com/sfx/";
    expect(reactionSfxUrl("vine-boom")).toBe("https://cdn.example.com/sfx/vine-boom.mp3");
  });

  it("returns '' for an unknown id even when the base is set", () => {
    process.env[ENV] = "https://cdn.example.com";
    expect(reactionSfxUrl("not-a-sound")).toBe("");
  });

  it("returns '' for every id when the base env is unset (graceful degrade)", () => {
    for (const id of REACTION_SFX_IDS) expect(reactionSfxUrl(id)).toBe("");
  });

  it("isReactionSfxId guards the curated set", () => {
    expect(isReactionSfxId("vine-boom")).toBe(true);
    expect(isReactionSfxId("nope")).toBe(false);
    expect(isReactionSfxId(123)).toBe(false);
  });
});

// The PACK selector: the AI still auto-picks WHICH bucket fires (by emotion); a
// pack only swaps which sting each bucket maps to. atSec is keyed by the bucket,
// not the sting file, so a new pack's files keep the right per-emotion timing.
describe("reactionSfxPack — pack registry", () => {
  it("the default 'Gen Z Meme' pack maps each bucket to the current sting file ids", () => {
    const pack = reactionSfxPackById("genz-meme");
    expect(pack.id).toBe("genz-meme");
    expect(pack.stings.shock).toBe("vine-boom");
    expect(pack.stings.funny).toBe("bruh");
    expect(pack.stings.hype).toBe("fah");
    // Every seeded pack's stings must reference REAL sfx file ids.
    for (const p of REACTION_SFX_PACKS) {
      for (const id of Object.values(p.stings)) expect(isReactionSfxId(id)).toBe(true);
    }
  });

  it("an unknown / missing pack id resolves to the default pack", () => {
    expect(reactionSfxPackById("does-not-exist").id).toBe(DEFAULT_REACTION_SFX_PACK_ID);
    expect(reactionSfxPackById(undefined).id).toBe(DEFAULT_REACTION_SFX_PACK_ID);
    expect(reactionSfxPackById("").id).toBe(DEFAULT_REACTION_SFX_PACK_ID);
  });

  it("isReactionSfxPackId guards the registered set", () => {
    expect(isReactionSfxPackId("genz-meme")).toBe(true);
    expect(isReactionSfxPackId("nope")).toBe(false);
    expect(isReactionSfxPackId(123)).toBe(false);
  });

  it("emotion → bucket mapping (neutral = no sting)", () => {
    expect(reactionBucketForEmotion("shocking")).toBe("shock");
    expect(reactionBucketForEmotion("controversial")).toBe("shock");
    expect(reactionBucketForEmotion("funny")).toBe("funny");
    expect(reactionBucketForEmotion("inspiring")).toBe("hype");
    expect(reactionBucketForEmotion("informative")).toBeNull();
    expect(reactionBucketForEmotion(undefined)).toBeNull();
  });

  it("atSec target is keyed by the emotion BUCKET, not the sting file", () => {
    expect(reactionSfxTargetSec("shock")).toBeCloseTo(0.2);
    expect(reactionSfxTargetSec("funny")).toBeCloseTo(1.2);
    expect(reactionSfxTargetSec("hype")).toBeCloseTo(1.6);
  });
});

// Ships THREE packs now (Gen Z Meme + Cinematic Impact + Cartoon Comedy). This
// suite also registers one THROWAWAY in-test-only pack to prove the swap
// mechanism itself is generic, independent of which packs happen to be shipped.
describe("clip.memeaudio floor — pack selector switches the sting", () => {
  const prevEnv = process.env[ENV];
  const baseCfg: ClipFloorConfig = {
    captionsOn: false,
    captionStyle: { mode: "line", fontColor: "#fff", fontSize: 40, position: "bottom" },
  };
  const moment = (emotion: string): ClipFloorMoment => ({
    title: "t", captionText: "c", startSeconds: 0, endSeconds: 30, emotion,
  });
  const floorOp = (emotion: string, sfxPackId?: string) => {
    const cfg: ClipFloorConfig = sfxPackId ? { ...baseCfg, sfxPackId } : baseCfg;
    const op = CLIP_SKILL_BY_ID["clip.memeaudio"].floor!(moment(emotion), cfg)[0];
    return op && op.op === "audio_overlay" ? op : null;
  };

  beforeEach(() => {
    process.env[ENV] = "https://cdn.test/sfx";
    // shock→bruh, funny→fah, hype→vine-boom: a deliberate re-map of the SAME files.
    REACTION_SFX_PACKS.push({ id: "test-swap", label: "Test Swap", stings: { shock: "bruh", funny: "fah", hype: "vine-boom" } });
  });
  afterEach(() => {
    const i = REACTION_SFX_PACKS.findIndex((p) => p.id === "test-swap");
    if (i >= 0) REACTION_SFX_PACKS.splice(i, 1);
    if (prevEnv === undefined) delete process.env[ENV]; else process.env[ENV] = prevEnv;
  });

  it("default pack (unset id) fires the Gen Z Meme sting for the emotion", () => {
    expect(floorOp("shocking")?.audioUrl).toContain("vine-boom.mp3");
    expect(floorOp("funny")?.audioUrl).toContain("bruh.mp3");
    expect(floorOp("inspiring")?.audioUrl).toContain("fah.mp3");
  });

  it("a non-default pack fires THAT pack's sting for the same emotion", () => {
    // Same shock emotion → the test-swap pack's shock sting (bruh), not vine-boom.
    const op = floorOp("shocking", "test-swap");
    expect(op?.audioUrl).toContain("bruh.mp3");
    // atSec still keyed by the shock BUCKET (0.2) regardless of which file plays.
    expect(op?.atSec).toBeCloseTo(0.2);
    // funny bucket in the swapped pack → fah; timing stays the funny-bucket 1.2.
    const op2 = floorOp("funny", "test-swap");
    expect(op2?.audioUrl).toContain("fah.mp3");
    expect(op2?.atSec).toBeCloseTo(1.2);
  });

  it("an unknown pack id falls back to the default pack (no crash)", () => {
    expect(floorOp("shocking", "ghost-pack")?.audioUrl).toContain("vine-boom.mp3");
  });

  it("the shipped Cinematic Impact pack fires its own stings per bucket", () => {
    expect(floorOp("shocking", "cinematic-impact")?.audioUrl).toContain("riser-hit.mp3");
    expect(floorOp("funny", "cinematic-impact")?.audioUrl).toContain("record-scratch.mp3");
    expect(floorOp("inspiring", "cinematic-impact")?.audioUrl).toContain("whoosh-impact.mp3");
  });

  it("the shipped Cartoon Comedy pack fires its own stings per bucket", () => {
    expect(floorOp("shocking", "cartoon-comedy")?.audioUrl).toContain("cartoon-boing.mp3");
    expect(floorOp("funny", "cartoon-comedy")?.audioUrl).toContain("slide-whistle.mp3");
    expect(floorOp("inspiring", "cartoon-comedy")?.audioUrl).toContain("cartoon-tada.mp3");
  });
});

// ── Sound Effect tool (Editor tab) — keyword algo ────────────────────────────
function w(word: string, start: number, end = start + 0.3): TranscriptWord {
  return { word, start, end };
}

describe("pickSfxFromKeywords", () => {
  it("returns null for a transcript with no trigger word (never forced)", () => {
    expect(pickSfxFromKeywords([w("just", 0), w("a", 0.3), w("normal", 0.6), w("sentence", 1)])).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(pickSfxFromKeywords([])).toBeNull();
  });

  it("matches a shock trigger word and returns its timestamp", () => {
    const words = [w("so", 0), w("wait", 0.5), w("what", 0.9), w("happened", 1.3)];
    const m = pickSfxFromKeywords(words);
    expect(m?.bucket).toBe("shock");
    expect(m?.atSec).toBeCloseTo(0.5);
    expect(m?.word).toBe("wait");
  });

  it("matches a funny trigger word", () => {
    const m = pickSfxFromKeywords([w("that", 0), w("was", 0.3), w("hilarious", 0.6)]);
    expect(m?.bucket).toBe("funny");
    expect(m?.word).toBe("hilarious");
  });

  it("matches a hype trigger word", () => {
    const m = pickSfxFromKeywords([w("this", 0), w("is", 0.3), w("epic", 0.6)]);
    expect(m?.bucket).toBe("hype");
  });

  it("the FIRST matching word wins, in spoken order (not the strongest match)", () => {
    const words = [w("lol", 0), w("wait", 1), w("wow", 2)];
    const m = pickSfxFromKeywords(words);
    expect(m?.bucket).toBe("funny"); // "lol" comes first, even though shock/hype appear later
    expect(m?.word).toBe("lol");
  });

  it("is case-insensitive and strips surrounding punctuation", () => {
    const m = pickSfxFromKeywords([w("WAIT,", 0)]);
    expect(m?.bucket).toBe("shock");
    expect(m?.word).toBe("wait");
  });

  it("does NOT match a trigger word as a substring of a longer word (anchored)", () => {
    // "waiting" must not fire the "wait" shock trigger.
    expect(pickSfxFromKeywords([w("waiting", 0), w("around", 0.5)])).toBeNull();
  });

  it("every bucket's trigger set is reachable (smoke test, no bucket dead)", () => {
    expect(pickSfxFromKeywords([w("omg", 0)])?.bucket).toBe("shock");
    expect(pickSfxFromKeywords([w("lmao", 0)])?.bucket).toBe("funny");
    expect(pickSfxFromKeywords([w("amazing", 0)])?.bucket).toBe("hype");
  });
});
