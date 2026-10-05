// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TRENDING_AUDIO,
  TRENDING_AUDIO_IDS,
  isTrendingAudioId,
  trendingAudioUrl,
  pickTrendingTrackByMood,
  resolveWiredTrendingAudio,
} from "./trendingAudioPack";

const ENV = "TRENDING_AUDIO_BASE_URL";

describe("trendingAudioPack", () => {
  const prev = process.env[ENV];
  beforeEach(() => { delete process.env[ENV]; });
  afterEach(() => { if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev; });

  it("ships a non-empty curated library with well-formed entries", () => {
    expect(TRENDING_AUDIO_IDS.length).toBeGreaterThan(0);
    for (const id of TRENDING_AUDIO_IDS) {
      expect(isTrendingAudioId(id)).toBe(true);
      const e = TRENDING_AUDIO.find((t) => t.id === id);
      expect(e).toBeTruthy();
      expect(e!.label.length).toBeGreaterThan(0);
      expect(e!.mood.length).toBeGreaterThan(0);
    }
  });

  it("resolves a known id against the env base, tolerating a trailing slash", () => {
    process.env[ENV] = "https://cdn.example.com/music/";
    const id = TRENDING_AUDIO_IDS[0];
    const url = trendingAudioUrl(id);
    expect(url.startsWith("https://cdn.example.com/music/")).toBe(true);
    expect(url).not.toContain("/music//");
  });

  it("returns '' for an unknown id even when the base is set", () => {
    process.env[ENV] = "https://cdn.example.com/music";
    expect(trendingAudioUrl("not-a-track")).toBe("");
  });

  it("returns '' for every id when the base env is unset (graceful degrade)", () => {
    for (const id of TRENDING_AUDIO_IDS) expect(trendingAudioUrl(id)).toBe("");
  });

  it("isTrendingAudioId guards the curated set", () => {
    expect(isTrendingAudioId(TRENDING_AUDIO_IDS[0])).toBe(true);
    expect(isTrendingAudioId("nope")).toBe(false);
    expect(isTrendingAudioId(123)).toBe(false);
    expect(isTrendingAudioId(undefined)).toBe(false);
  });

  it("auto-picks deterministically and matches mood when present", () => {
    const a = pickTrendingTrackByMood("this was shocking and insane", 7);
    const b = pickTrendingTrackByMood("this was shocking and insane", 7);
    expect(a).toBe(b);
    expect(isTrendingAudioId(a)).toBe(true);
    expect(TRENDING_AUDIO.find((t) => t.id === a)!.mood).toBe("hype");
  });

  it("auto-picks a track via rotation when emotion is absent (pack loaded)", () => {
    const id = pickTrendingTrackByMood(undefined, 3);
    expect(isTrendingAudioId(id)).toBe(true);
    expect(pickTrendingTrackByMood(undefined, 3)).toBe(id);
  });

  it("ships at least one instrumental (no-vocals) track for dialogue-heavy auto-pick to fall back on", () => {
    expect(TRENDING_AUDIO.some((t) => t.instrumental === true)).toBe(true);
  });

  it("preferInstrumental restricts every pick (any mood, any seed) to instrumental tracks", () => {
    const moods = [undefined, "this was shocking and insane", "so funny lol", "so sad and touching", "chill relax study"];
    for (const mood of moods) {
      for (let seed = 0; seed < 10; seed++) {
        const id = pickTrendingTrackByMood(mood, seed, true);
        expect(isTrendingAudioId(id)).toBe(true);
        expect(TRENDING_AUDIO.find((t) => t.id === id)!.instrumental).toBe(true);
      }
    }
  });

  it("preferInstrumental stays deterministic (same mood+seed -> same track)", () => {
    const a = pickTrendingTrackByMood("chill relax", 5, true);
    const b = pickTrendingTrackByMood("chill relax", 5, true);
    expect(a).toBe(b);
  });

  it("without preferInstrumental, a vocal (non-instrumental) track can still be picked", () => {
    // The default pack is overwhelmingly vocal pop songs — some seed in a small
    // range should land on one when instrumental preference is off.
    const ids = Array.from({ length: 20 }, (_, seed) => pickTrendingTrackByMood("hype energy", seed));
    expect(ids.some((id) => TRENDING_AUDIO.find((t) => t.id === id)!.instrumental !== true)).toBe(true);
  });

  it("URL-encodes filenames so spaced track names resolve (no raw spaces; %20 used)", () => {
    process.env[ENV] = "https://cdn.example.com/music";
    for (const id of TRENDING_AUDIO_IDS) expect(trendingAudioUrl(id)).not.toContain(" ");
    // the real library has spaced filenames → at least one URL must carry %20
    expect(TRENDING_AUDIO_IDS.some((id) => trendingAudioUrl(id).includes("%20"))).toBe(true);
  });
});

// The clipJobs wired-but-default injection: a genuinely-WIRED Trending Audio node
// that the operator never touched must still add music (autoMusic defaults ON), while
// a bare/stale row stays leak-safe upstream via the wired!==false filter.
describe("resolveWiredTrendingAudio", () => {
  it("ignores non-trendingaudio skills", () => {
    expect(resolveWiredTrendingAudio("clip.brainrot", { bgId: "minecraft" })).toEqual({});
  });
  it("defaults a bare WIRED node to autoMusic:true (accept-the-defaults still renders)", () => {
    expect(resolveWiredTrendingAudio("clip.trendingaudio", {})).toEqual({ autoMusic: true });
  });
  it("keeps a picked track and does NOT force autoMusic", () => {
    const id = TRENDING_AUDIO_IDS[0];
    expect(resolveWiredTrendingAudio("clip.trendingaudio", { musicTrackId: id })).toEqual({ musicTrackId: id });
  });
  it("respects an explicit autoMusic:false (operator turned auto off)", () => {
    expect(resolveWiredTrendingAudio("clip.trendingaudio", { autoMusic: false })).toEqual({ autoMusic: false });
  });
  it("passes an explicit autoMusic:true through", () => {
    expect(resolveWiredTrendingAudio("clip.trendingaudio", { autoMusic: true })).toEqual({ autoMusic: true });
  });
  it("keeps both a picked track and an explicit autoMusic flag", () => {
    const id = TRENDING_AUDIO_IDS[1];
    expect(resolveWiredTrendingAudio("clip.trendingaudio", { musicTrackId: id, autoMusic: false }))
      .toEqual({ musicTrackId: id, autoMusic: false });
  });
  it("ignores an empty-string track (treats it as no pick → autoMusic default)", () => {
    expect(resolveWiredTrendingAudio("clip.trendingaudio", { musicTrackId: "" })).toEqual({ autoMusic: true });
  });
});
