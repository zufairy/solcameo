// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchTrendingAudio } from "./trendingAudio";

const URL_ENV = "MEME_AUDIO_API_URL";
const KEY_ENV = "MEME_AUDIO_API_KEY";

describe("fetchTrendingAudio", () => {
  const prevUrl = process.env[URL_ENV];
  const prevKey = process.env[KEY_ENV];
  beforeEach(() => { delete process.env[URL_ENV]; delete process.env[KEY_ENV]; vi.restoreAllMocks(); });
  afterEach(() => {
    if (prevUrl === undefined) delete process.env[URL_ENV]; else process.env[URL_ENV] = prevUrl;
    if (prevKey === undefined) delete process.env[KEY_ENV]; else process.env[KEY_ENV] = prevKey;
    vi.restoreAllMocks();
  });

  it("returns [] when the API url env is unset (no fetch attempted)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await fetchTrendingAudio()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps a bare array of sounds and passes the bearer key", async () => {
    process.env[URL_ENV] = "https://sounds.example.com/trending";
    process.env[KEY_ENV] = "sekret";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        { id: "a1", title: "Oh no", audioUrl: "https://cdn/a1.mp3", durationSec: 4 },
        { id: "a2", name: "Bruh", url: "https://cdn/a2.mp3" },
      ]), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const out = await fetchTrendingAudio(10);
    expect(out).toEqual([
      { id: "a1", title: "Oh no", audioUrl: "https://cdn/a1.mp3", durationSec: 4 },
      { id: "a2", title: "Bruh", audioUrl: "https://cdn/a2.mp3" },
    ]);
    const [, init] = spy.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sekret");
  });

  it("unwraps an { items: [...] } envelope and drops records missing id/audioUrl", async () => {
    process.env[URL_ENV] = "https://sounds.example.com/trending";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [
        { id: "ok", audioUrl: "https://cdn/ok.mp3" },
        { title: "no id or url" },
        { id: "no-url" },
      ] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const out = await fetchTrendingAudio();
    expect(out).toEqual([{ id: "ok", title: "ok", audioUrl: "https://cdn/ok.mp3" }]);
  });

  it("returns [] on a non-200 response", async () => {
    process.env[URL_ENV] = "https://sounds.example.com/trending";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await fetchTrendingAudio()).toEqual([]);
  });

  it("returns [] when fetch throws (network error)", async () => {
    process.env[URL_ENV] = "https://sounds.example.com/trending";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await fetchTrendingAudio()).toEqual([]);
  });

  it("caps the result count to the requested limit", async () => {
    process.env[URL_ENV] = "https://sounds.example.com/trending";
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, audioUrl: `https://cdn/${i}.mp3` }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(many), { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect((await fetchTrendingAudio(5)).length).toBe(5);
  });
});
