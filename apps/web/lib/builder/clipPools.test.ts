import { describe, it, expect } from "vitest";
import { mergePoolConfig, ugcOutputCount } from "./clipPools";

// THE BUG: the operator installed Hook Videos / Main Content, wired the node and
// uploaded — then the run produced clips with no hook and no uploaded body. The
// uploads live on the skill ROW (synced on every canvas change), but the render
// read clipConfig, which only carries what the graph held at its last COMPILE.
describe("mergePoolConfig — the skill row is the fresher store and wins", () => {
  const hookRow = (videoUrls: unknown, wired?: boolean) => ({ skillId: "clip.hookvideos", config: { videoUrls }, ...(wired === undefined ? {} : { wired }) });
  const mainRow = (videoUrls: unknown, mainOnly?: boolean, wired?: boolean) => ({ skillId: "clip.maincontent", config: { videoUrls, mainOnly }, ...(wired === undefined ? {} : { wired }) });

  it("applies uploads that the last-compiled config never saw", () => {
    const out = mergePoolConfig({}, [hookRow(["h1.mp4"]), mainRow(["m1.mp4"], true)]);
    expect(out.hookVideos).toEqual(["h1.mp4"]);
    expect(out.mainVideos).toEqual(["m1.mp4"]);
    expect(out.mainOnly).toBe(true);
  });

  it("overrides a STALE clipConfig list with the row's current uploads", () => {
    const out = mergePoolConfig({ hookVideos: ["old.mp4"] }, [hookRow(["new1.mp4", "new2.mp4"])]);
    expect(out.hookVideos).toEqual(["new1.mp4", "new2.mp4"]);
  });

  // Removing every upload must actually stop them rendering.
  it("an installed-but-EMPTY pool clears the stale list", () => {
    const out = mergePoolConfig({ hookVideos: ["old.mp4"] }, [hookRow([])]);
    expect(out.hookVideos).toEqual([]);
  });

  it("an unwired row (node deleted from the canvas) does not apply", () => {
    const out = mergePoolConfig({ hookVideos: ["kept.mp4"] }, [hookRow(["ignored.mp4"], false)]);
    expect(out.hookVideos).toEqual(["kept.mp4"]);
  });

  it("a legacy row with no `wired` flag counts as wired", () => {
    expect(mergePoolConfig({}, [hookRow(["h.mp4"], undefined)]).hookVideos).toEqual(["h.mp4"]);
  });

  it("leaves the config untouched when neither app is installed", () => {
    const raw = { maxClipsPerSource: 3, hookVideos: ["kept.mp4"] };
    expect(mergePoolConfig(raw, [{ skillId: "clip.captions", config: {} }])).toEqual(raw);
  });

  it("does not mutate the input config", () => {
    const raw = { hookVideos: ["old.mp4"] };
    mergePoolConfig(raw, [hookRow(["new.mp4"])]);
    expect(raw.hookVideos).toEqual(["old.mp4"]);
  });

  it("drops junk entries and trims", () => {
    const out = mergePoolConfig({}, [hookRow([" h1.mp4 ", "", null, 5, "h2.mp4"])]);
    expect(out.hookVideos).toEqual(["h1.mp4", "h2.mp4"]);
  });

  it("tolerates a missing/!object row config", () => {
    expect(mergePoolConfig({}, [{ skillId: "clip.hookvideos" }]).hookVideos).toEqual([]);
    expect(mergePoolConfig({}, null).hookVideos).toBeUndefined();
  });

  it("preserves clipConfig.mainOnly when the row omits it (sync lag)", () => {
    expect(mergePoolConfig({ mainOnly: true }, [mainRow(["m.mp4"])]).mainOnly).toBe(true);
  });

  it("row mainOnly:false clears a stale clipConfig flag", () => {
    expect(mergePoolConfig({ mainOnly: true }, [mainRow(["m.mp4"], false)]).mainOnly).toBe(false);
  });
});

describe("ugcOutputCount — clip count rules, the pool cycles to fill it", () => {
  it("a small pool still fills the requested count", () => {
    expect(ugcOutputCount({ poolSize: 2, maxClipsPerSource: 5 })).toBe(5);
  });

  it("a large pool is not forced to air in one run", () => {
    expect(ugcOutputCount({ poolSize: 10, maxClipsPerSource: 3 })).toBe(3);
  });

  // Nothing is transcribed in this mode, so "let AI decide" has no analysis to
  // decide from — one per upload is the honest reading.
  it("autoPlan means one post per uploaded video", () => {
    expect(ugcOutputCount({ poolSize: 4, maxClipsPerSource: 1, autoPlan: true })).toBe(4);
  });

  it("no uploads means no posts", () => {
    expect(ugcOutputCount({ poolSize: 0, maxClipsPerSource: 5 })).toBe(0);
  });

  it("clamps to the same 1..60 bound as the normal cut stage", () => {
    expect(ugcOutputCount({ poolSize: 1, maxClipsPerSource: 0 })).toBe(1);
    expect(ugcOutputCount({ poolSize: 90, maxClipsPerSource: 90 })).toBe(60);
    expect(ugcOutputCount({ poolSize: 90, maxClipsPerSource: 1, autoPlan: true })).toBe(60);
  });

  // Free-plan gate (/api/agents/config writes autoPlanMaxClips: 10 for
  // non-subscribed owners) — without this, "let AI decide" took the WHOLE
  // pool regardless of plan, one of the actual reported abuse paths.
  it("autoPlanMaxClips caps the autoPlan branch for free-plan accounts", () => {
    expect(ugcOutputCount({ poolSize: 40, maxClipsPerSource: 1, autoPlan: true, autoPlanMaxClips: 10 })).toBe(10);
  });

  it("autoPlanMaxClips does not affect manual (non-autoPlan) mode", () => {
    expect(ugcOutputCount({ poolSize: 40, maxClipsPerSource: 8, autoPlan: false, autoPlanMaxClips: 10 })).toBe(8);
  });

  it("absent autoPlanMaxClips (paid accounts) keeps the full-pool autoPlan behavior", () => {
    expect(ugcOutputCount({ poolSize: 40, maxClipsPerSource: 1, autoPlan: true })).toBe(40);
  });
});
