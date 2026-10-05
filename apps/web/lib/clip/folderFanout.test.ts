// @vitest-environment node
// (clipFolderMaxJobs reads process.env — the node env guarantees a real process.env)
import { describe, it, expect } from "vitest";
import { planClipFanout, clipFolderMaxJobs, DEFAULT_CLIP_FOLDER_MAX_JOBS } from "./folderFanout";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://drive.google.com/uc?id=vid${i}`, name: `v${i}` }));

describe("planClipFanout — Master Videos fan-out decision (pure)", () => {
  it("clipAll=false → ONLY the top video (single-video default unchanged)", () => {
    const plan = planClipFanout(mk(8), false, 20);
    expect(plan.urls).toEqual(["https://drive.google.com/uc?id=vid0"]);
    expect(plan.total).toBe(8);
    expect(plan.capped).toBe(false);
  });

  it("clipAll=true, 8 videos under cap → 8 enqueues in ranked order, not capped", () => {
    const plan = planClipFanout(mk(8), true, 20);
    expect(plan.urls).toHaveLength(8);
    expect(plan.urls[0]).toBe("https://drive.google.com/uc?id=vid0");
    expect(plan.urls[7]).toBe("https://drive.google.com/uc?id=vid7");
    expect(plan.total).toBe(8);
    expect(plan.capped).toBe(false);
  });

  it("clipAll=true, over cap → capped to the first N (ranked), capped:true, total preserved", () => {
    const plan = planClipFanout(mk(25), true, 20);
    expect(plan.urls).toHaveLength(20);
    expect(plan.urls[0]).toBe("https://drive.google.com/uc?id=vid0");
    expect(plan.urls[19]).toBe("https://drive.google.com/uc?id=vid19");
    expect(plan.total).toBe(25);
    expect(plan.capped).toBe(true);
  });

  it("clipAll=true, exactly at cap → all kept, not capped", () => {
    const plan = planClipFanout(mk(20), true, 20);
    expect(plan.urls).toHaveLength(20);
    expect(plan.capped).toBe(false);
    expect(plan.total).toBe(20);
  });

  it("empty source → no urls (caller short-circuits with 'contents not enough')", () => {
    expect(planClipFanout([], false, 20)).toEqual({ urls: [], total: 0, capped: false });
    expect(planClipFanout([], true, 20)).toEqual({ urls: [], total: 0, capped: false });
  });

  it("clipAll=true with a single video → one job, not capped", () => {
    const plan = planClipFanout(mk(1), true, 20);
    expect(plan.urls).toHaveLength(1);
    expect(plan.capped).toBe(false);
  });

  it("a non-positive/garbage cap falls back to the default cap (never enqueues 0)", () => {
    expect(planClipFanout(mk(3), true, 0).urls).toHaveLength(3);
    expect(planClipFanout(mk(3), true, Number.NaN).urls).toHaveLength(3);
    // A default-capped huge folder truncates to DEFAULT_CLIP_FOLDER_MAX_JOBS.
    const plan = planClipFanout(mk(50), true, 0);
    expect(plan.urls).toHaveLength(DEFAULT_CLIP_FOLDER_MAX_JOBS);
    expect(plan.capped).toBe(true);
  });
});

describe("clipFolderMaxJobs — env-tunable cap", () => {
  it("defaults to 20 when CLIP_FOLDER_MAX_JOBS is unset", () => {
    const prev = globalThis.process?.env?.CLIP_FOLDER_MAX_JOBS;
    if (globalThis.process?.env) delete globalThis.process.env.CLIP_FOLDER_MAX_JOBS;
    expect(clipFolderMaxJobs()).toBe(20);
    if (prev !== undefined && globalThis.process?.env) globalThis.process.env.CLIP_FOLDER_MAX_JOBS = prev;
  });

  it("honors CLIP_FOLDER_MAX_JOBS when set", () => {
    const prev = globalThis.process?.env?.CLIP_FOLDER_MAX_JOBS;
    if (globalThis.process?.env) globalThis.process.env.CLIP_FOLDER_MAX_JOBS = "5";
    expect(clipFolderMaxJobs()).toBe(5);
    if (globalThis.process?.env) {
      if (prev === undefined) delete globalThis.process.env.CLIP_FOLDER_MAX_JOBS;
      else globalThis.process.env.CLIP_FOLDER_MAX_JOBS = prev;
    }
  });
});
