import { describe, it, expect } from "vitest";
import { compileGraph } from "./compile-graph";
import type { VelloNode, NodeKind, NodeConfig } from "@/components/builder/clipping-flow/types/clipping";

/** Minimal VelloNode for compile tests - only id/kind/config are read by compileGraph. */
function node(kind: NodeKind, config: Record<string, unknown>, id: string = kind): VelloNode {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { kind, title: kind, status: "idle", config: config as NodeConfig },
  } as unknown as VelloNode;
}

const source = node("source", { sourceUrl: "https://youtube.com/watch?v=abc" });

describe("compileGraph watermark preference", () => {
  it("enables fresh graphs and carries explicit off into the persisted run config", () => {
    expect(compileGraph([source]).clipConfig.velloWatermark).toBe(true);
    const off = node("source", { sourceUrl: "https://example.com/video.mp4", velloWatermark: false });
    expect(compileGraph([off]).clipConfig.velloWatermark).toBe(false);
  });
});

// Auto-post is owned SOLELY by the Posting tab (clipConfig.autoPost). The canvas
// Publish node is a read-only MIRROR, so compileGraph must NEVER derive auto-post
// from it - it always emits the safe default OFF, and the canvas persist guard
// keeps the operator's saved Posting-tab toggle on top. (Regression context: the
// Publish node's old "After rendering" dropdown drove this via an INVERTED boolean,
// so "Save only" compiled to autoPost:true and clips posted despite "Save only".)
describe("compileGraph - auto-post is Posting-tab-owned, never node-driven", () => {
  it("no Publish node → autoPost defaults OFF", () => {
    expect(compileGraph([source]).clipConfig.autoPost).toBe(false);
  });

  it("Publish node present → autoPost stays OFF regardless of any legacy schedule value", () => {
    for (const schedule of ["now", "scheduled", undefined]) {
      const { clipConfig } = compileGraph([source, node("publish", { schedule, caption: "" })]);
      expect(clipConfig.autoPost, `schedule=${String(schedule)}`).toBe(false);
    }
  });
});

// The Source node's "Number of clips" slider (maxClips) threads into
// clipConfig.maxClipsPerSource. The cap was raised 5 → 60 so the cloud path can
// fan a source into up to 60 clips (via per-moment variations).
describe("compileGraph - clip count (maxClips) threads up to 60", () => {
  it("passes maxClips through to clipConfig.maxClipsPerSource", () => {
    const src = node("source", { sourceUrl: "https://youtube.com/watch?v=abc", maxClips: 40 });
    expect(compileGraph([src]).clipConfig.maxClipsPerSource).toBe(40);
  });

  it("clamps maxClips to [1, 60]", () => {
    const hi = node("source", { sourceUrl: "https://x.com/v", maxClips: 999 }, "hi");
    const lo = node("source", { sourceUrl: "https://x.com/v", maxClips: 0 }, "lo");
    expect(compileGraph([hi]).clipConfig.maxClipsPerSource).toBe(60);
    expect(compileGraph([lo]).clipConfig.maxClipsPerSource).toBe(1);
  });

  it("defaults to 1 clip when no slider value is set", () => {
    expect(compileGraph([source]).clipConfig.maxClipsPerSource).toBe(1);
  });
});

// captionsOn defaults ON (DEFAULT_CLIP_CONFIG.captionsOn) and must never be
// forced off just because the canvas has no explicit Captions node/skill wired
// — most graphs (chat-built, or a plain Source→Compose→Publish) never add one.
// Regression: compileGraph used to compile `captionsOn: !!captionsNode || ...`,
// which silently produced caption-less clips on any graph without that node.
describe("compileGraph — captions default ON regardless of node wiring", () => {
  it("no Captions node at all → captionsOn stays ON", () => {
    expect(compileGraph([source]).clipConfig.captionsOn).toBe(true);
  });

  it("a Publish/skill-only graph with no caption node → captionsOn stays ON", () => {
    const skill = node("skill", { variant: "marketplace", skillId: "clip.hook" }, "hook");
    expect(compileGraph([source, skill]).clipConfig.captionsOn).toBe(true);
  });
});

// The Hook Videos / Main Content apps are POOLS of uploaded videos held on their
// nodes. compileGraph lifts them onto clipConfig so the local run and the persisted
// cloud config both render with the same uploads.
describe("compileGraph — video pools (Hook Videos / Main Content)", () => {
  const skill = (skillId: string, config: Record<string, unknown>) =>
    node("skill", { variant: "marketplace", skillId, ...config }, skillId);

  it("lifts the hook pool onto clipConfig.hookVideos", () => {
    const { clipConfig } = compileGraph([source, skill("clip.hookvideos", { videoUrls: ["h1.mp4", "h2.mp4"] })]);
    expect(clipConfig.hookVideos).toEqual(["h1.mp4", "h2.mp4"]);
  });

  it("lifts the main pool and the bypass switch", () => {
    const { clipConfig } = compileGraph([
      source,
      skill("clip.maincontent", { videoUrls: ["m1.mp4"], mainOnly: true }),
    ]);
    expect(clipConfig.mainVideos).toEqual(["m1.mp4"]);
    expect(clipConfig.mainOnly).toBe(true);
  });

  // Bypass with nothing to publish would skip clipping AND have no content, so the
  // normalizer drops it.
  it("ignores the bypass switch when the main pool is empty", () => {
    const { clipConfig } = compileGraph([source, skill("clip.maincontent", { videoUrls: [], mainOnly: true })]);
    expect(clipConfig.mainOnly).toBeUndefined();
  });

  it("omits the pools entirely when neither app is on the canvas", () => {
    const { clipConfig } = compileGraph([source]);
    expect(clipConfig.hookVideos).toBeUndefined();
    expect(clipConfig.mainVideos).toBeUndefined();
  });
});
