import { describe, it, expect } from "vitest";
import {
  decideEpisodeIntent,
  isRerun,
  choosePremise,
  leastRecentlyUsedTheme,
  pickCastForEpisode,
  buildEpisodeBrief,
  avoidList,
  MAX_CONSECUTIVE_CONTINUATIONS,
  type EpisodeRecord,
} from "./episodePlanner";

const ep = (number: number, premise: string, extra: Partial<EpisodeRecord> = {}): EpisodeRecord => ({ number, premise, ...extra });

describe("decideEpisodeIntent", () => {
  it("an operator prompt always wins", () => {
    const d = decideEpisodeIntent({ episodes: [ep(1, "a", { cliffhanger: true, openThreads: ["keys missing"] })], operatorPrompt: "blob eats the ship" });
    expect(d.intent).toBe("prompted");
  });

  it("the first episode is self-contained", () => {
    expect(decideEpisodeIntent({ episodes: [] })).toMatchObject({ intent: "fresh" });
  });

  it("continues when the last episode ended unresolved", () => {
    const d = decideEpisodeIntent({ episodes: [ep(3, "blob steals the keys", { cliffhanger: true, openThreads: ["the keys are still missing"] })] });
    expect(d).toMatchObject({ intent: "continue", thread: "the keys are still missing" });
    expect(d.continues?.number).toBe(3);
  });

  it("starts fresh when the last episode resolved itself", () => {
    const d = decideEpisodeIntent({ episodes: [ep(3, "rent is due", { cliffhanger: false, openThreads: ["a leftover"] })] });
    expect(d.intent).toBe("fresh");
  });

  it("starts fresh when there is nothing left hanging", () => {
    expect(decideEpisodeIntent({ episodes: [ep(3, "rent is due", { cliffhanger: true })] }).intent).toBe("fresh");
  });

  // A show that only ever continues is unwatchable for someone arriving mid-feed.
  it("breaks a run of cliffhangers at the cap", () => {
    const cliff = (n: number) => ep(n, `part ${n}`, { cliffhanger: true, openThreads: ["still going"] });
    const episodes = Array.from({ length: MAX_CONSECUTIVE_CONTINUATIONS }, (_, i) => cliff(i + 1));
    const d = decideEpisodeIntent({ episodes });
    expect(d.intent).toBe("fresh");
    expect(d.reason).toMatch(/in a row/);
  });

  it("reads the newest episode even when the log is unsorted", () => {
    const episodes = [ep(1, "old", { cliffhanger: true, openThreads: ["x"] }), ep(5, "new", { cliffhanger: false })];
    expect(decideEpisodeIntent({ episodes }).intent).toBe("fresh");
  });
});

describe("isRerun — a reworded repeat is still a repeat", () => {
  it("catches the same premise in different words", () => {
    expect(isRerun("the blob ate all the snacks again", ["blob eats the last snack"])).toBe(true);
  });

  it("passes a genuinely different premise", () => {
    expect(isRerun("orange guy fails his flight exam", ["blob eats the last snack"])).toBe(false);
  });

  it("does not block when the candidate has no content words", () => {
    expect(isRerun("the and it", ["blob eats the last snack"])).toBe(false);
  });
});

describe("choosePremise", () => {
  const episodes = [ep(1, "blob eats the last snack"), ep(2, "orange guy loses the ship keys")];

  it("takes the first candidate that is not a rerun", () => {
    const out = choosePremise({ candidates: ["blob eats every snack", "orange guy adopts a space rat"], episodes });
    expect(out.premise).toBe("orange guy adopts a space rat");
    expect(out.rerunRejected).toBe(1);
    expect(out.usedFallback).toBe(false);
  });

  // Shipping a duplicate is worse than admitting we're reaching for an old theme.
  it("falls back to the least-recently-used theme when every candidate reruns", () => {
    const out = choosePremise({
      candidates: ["blob ate the snacks", "the ship keys get lost again"],
      episodes,
      themes: ["a customer complaint spirals", "blob eats something"],
    });
    expect(out.premise).toBe("a customer complaint spirals");
    expect(out.usedFallback).toBe(true);
  });

  it("still returns something when there are no themes to fall back to", () => {
    const out = choosePremise({ candidates: ["blob ate the snacks"], episodes });
    expect(out.premise).toBe("blob ate the snacks");
    expect(out.usedFallback).toBe(true);
  });
});

describe("leastRecentlyUsedTheme", () => {
  it("prefers a theme no episode has touched", () => {
    const themes = ["rent trouble", "a space rat infestation"];
    const episodes = [ep(1, "rent trouble hits the diner")];
    expect(leastRecentlyUsedTheme(themes, episodes)).toBe("a space rat infestation");
  });

  it("returns undefined with no themes configured", () => {
    expect(leastRecentlyUsedTheme([], [ep(1, "x")])).toBeUndefined();
  });
});

describe("pickCastForEpisode — bounded by the model's 3-reference ceiling", () => {
  const cast = [
    { name: "Orange guy", refImages: ["a.png"] },
    { name: "Blob", refImages: ["b.png"] },
    { name: "Captain", refImages: ["c.png"] },
    { name: "Rat", refImages: ["d.png"] },
  ];

  it("passes a small cast through untouched", () => {
    expect(pickCastForEpisode(cast.slice(0, 2), 1).map((c) => c.name)).toEqual(["Orange guy", "Blob"]);
  });

  it("never exceeds the cap", () => {
    expect(pickCastForEpisode(cast, 1)).toHaveLength(3);
  });

  it("always keeps the lead — that is what makes it a series", () => {
    for (const n of [1, 2, 3, 7, 12]) {
      expect(pickCastForEpisode(cast, n)[0].name).toBe("Orange guy");
    }
  });

  it("rotates the supporting cast across episodes", () => {
    const a = pickCastForEpisode(cast, 1).map((c) => c.name).join();
    const b = pickCastForEpisode(cast, 2).map((c) => c.name).join();
    expect(a).not.toBe(b);
  });

  it("drops unusable entries", () => {
    expect(pickCastForEpisode([{ name: "  " }, { name: "Blob" }], 1).map((c) => c.name)).toEqual(["Blob"]);
  });
});

describe("buildEpisodeBrief", () => {
  const series = {
    premise: "two aliens run a failing space diner",
    world: "a rusted diner orbiting a dead moon",
    cast: [
      { name: "Orange guy", role: "lead", designPrompt: "chubby orange alien, three eyes", refImages: ["orange.png"] },
      { name: "Blob", role: "rival", refImages: ["blob.png"] },
    ],
  };

  it("numbers episodes from the log", () => {
    const decision = decideEpisodeIntent({ episodes: [ep(4, "x")] });
    const brief = buildEpisodeBrief({ series, episodes: [ep(4, "x")], decision, premise: "the fryer becomes sentient" });
    expect(brief.episodeNumber).toBe(5);
    expect(brief.topic).toMatch(/^EP5:/);
  });

  // Persona first: a brief that leads with the episode idea produces videos that
  // drift away from the character.
  it("leads with the series, world and cast before the episode", () => {
    const decision = decideEpisodeIntent({ episodes: [] });
    const brief = buildEpisodeBrief({ series, episodes: [], decision, premise: "the fryer becomes sentient" });
    expect(brief.brief.indexOf("SERIES:")).toBeLessThan(brief.brief.indexOf("PREMISE:"));
    expect(brief.brief).toContain("rusted diner");
    expect(brief.brief).toContain("Orange guy (lead) — chubby orange alien, three eyes");
  });

  it("carries one reference frame per cast member for the identity lock", () => {
    const decision = decideEpisodeIntent({ episodes: [] });
    const brief = buildEpisodeBrief({ series, episodes: [], decision, premise: "p" });
    expect(brief.refImages).toEqual(["orange.png", "blob.png"]);
  });

  it("opens a continuation with a recap of how the last one ended", () => {
    const episodes = [ep(2, "blob steals the keys", { cliffhanger: true, openThreads: ["the keys are gone"], ending: "the keys vanish into the vent" })];
    const decision = decideEpisodeIntent({ episodes });
    const brief = buildEpisodeBrief({ series, episodes, decision, premise: "the vent is searched" });
    expect(brief.intent).toBe("continue");
    expect(brief.recapLine).toBe("Last time: the keys vanish into the vent");
    expect(brief.brief).toContain("THREAD TO PAY OFF: the keys are gone");
  });

  it("pins the medium so the render can't restyle the characters", () => {
    const decision = decideEpisodeIntent({ episodes: [] });
    const brief = buildEpisodeBrief({ series, episodes: [], decision, premise: "p" });
    expect(brief.brief).toMatch(/on-model|no restyling/i);
  });
});

describe("avoidList", () => {
  it("returns recent premises newest-first, bounded", () => {
    const episodes = Array.from({ length: 20 }, (_, i) => ep(i + 1, `premise ${i + 1}`));
    const out = avoidList(episodes, 3);
    expect(out).toEqual(["premise 20", "premise 19", "premise 18"]);
  });
});
