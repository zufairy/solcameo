import { describe, it, expect } from "vitest";
import { CLIP_TEMPLATES, TEMPLATE_BY_ID } from "./templates";
import { compileGraph, reachableFromSource } from "../lib/compile-graph";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";
import { isCaptionPresetId } from "@/lib/builder/captionPresets";

describe("clip templates", () => {
  it("registry is consistent", () => {
    expect(CLIP_TEMPLATES.length).toBe(8);
    for (const t of CLIP_TEMPLATES) expect(TEMPLATE_BY_ID[t.id]).toBe(t);
    // Every template carries the picker essentials (title + one-line use case).
    for (const t of CLIP_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.useCase.length).toBeGreaterThan(0);
    }
  });

  for (const t of CLIP_TEMPLATES) {
    describe(t.id, () => {
      it("builds a valid, fully-wired graph", () => {
        const { nodes, edges } = t.build();
        // unique ids
        expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
        // every edge references existing nodes
        const ids = new Set(nodes.map((n) => n.id));
        for (const e of edges) {
          expect(ids.has(e.source), e.id).toBe(true);
          expect(ids.has(e.target), e.id).toBe(true);
        }
        // every non-source node participates in the run (reachability gate)
        const reach = reachableFromSource(nodes, edges);
        for (const n of nodes) expect(reach.has(n.id), `${t.id}: ${n.data.title} unreachable`).toBe(true);
      });

      it("references only real skills and presets", () => {
        const { nodes } = t.build();
        for (const id of t.skillIds) expect(CLIP_SKILL_BY_ID[id], id).toBeDefined();
        for (const n of nodes) {
          const c = n.data.config as { skillId?: string; captionPreset?: string };
          if (c.skillId) expect(t.skillIds, `${t.id} skillIds missing ${c.skillId}`).toContain(c.skillId);
          if (c.captionPreset) expect(isCaptionPresetId(c.captionPreset)).toBe(true);
        }
      });

      it("two builds produce disjoint id sets (factory freshness)", () => {
        const a = new Set(t.build().nodes.map((n) => n.id));
        const b = t.build().nodes.map((n) => n.id);
        for (const id of b) expect(a.has(id)).toBe(false);
      });

      it("wires the Compose hub topology (Source -> Compose -> Publish; skills hang off Compose)", () => {
        const { nodes, edges } = t.build();
        const source = nodes.find((n) => n.data.kind === "source");
        const composes = nodes.filter((n) => n.data.kind === "compose");
        const publish = nodes.find((n) => n.data.kind === "publish");
        const skills = nodes.filter((n) => n.data.kind === "skill");
        expect(source, "has a Source").toBeDefined();
        expect(publish, "has a Publish").toBeDefined();
        // exactly one Compose hub
        expect(composes.length, "exactly one Compose hub").toBe(1);
        const compose = composes[0];

        const has = (s: string, tgt: string) => edges.some((e) => e.source === s && e.target === tgt);
        // backbone: Source -> Compose -> Publish
        expect(has(source!.id, compose.id), "Source -> Compose").toBe(true);
        expect(has(compose.id, publish!.id), "Compose -> Publish").toBe(true);

        // every skill is a DIRECT child of Compose (Compose -> skill), and no
        // skill is chained off Source or another skill (hub shape, not a chain).
        const parentsOf = (id: string) => edges.filter((e) => e.target === id).map((e) => e.source);
        for (const s of skills) {
          expect(parentsOf(s.id), `${s.data.title} parents`).toEqual([compose.id]);
        }
        // Source feeds ONLY the Compose hub (no inline skill chain off Source).
        expect(edges.filter((e) => e.source === source!.id).map((e) => e.target)).toEqual([compose.id]);
        // Publish is a leaf fed only by Compose.
        expect(parentsOf(publish!.id)).toEqual([compose.id]);
      });
    });
  }

  it("podcast clipper compiles with captions on, podcast genre, 3 clips", () => {
    const { nodes, edges } = TEMPLATE_BY_ID["podcast-clipper"].build();
    const g = compileGraph(nodes, edges);
    expect(g.clipConfig.captionsOn).toBe(true);
    expect(g.genre).toBe("podcast");
    expect(g.clipConfig.maxClipsPerSource).toBe(3);
    expect(g.clipConfig.clipLength).toEqual({ min: 25, max: 60 });
  });

  it("hormozi bold compiles with shocking feel", () => {
    const { nodes, edges } = TEMPLATE_BY_ID["hormozi-bold"].build();
    const g = compileGraph(nodes, edges);
    expect(g.clipFeel).toBe("shocking");
    expect(g.clipConfig.captionsOn).toBe(true);
  });

  it("campaign hunter compiles to 5 clips; auto-post stays OFF (Posting tab owns it)", () => {
    const { nodes, edges } = TEMPLATE_BY_ID["campaign-hunter"].build();
    const g = compileGraph(nodes, edges);
    expect(g.clipConfig.maxClipsPerSource).toBe(5);
    // The Publish node is a read-only mirror - it never sets auto-post. compileGraph
    // always emits OFF; the operator enables posting in the Posting tab, and the
    // canvas persist guard then keeps that saved toggle on top of this.
    expect(g.clipConfig.autoPost).toBe(false);
  });
});

// Blank Canvas is the "clear it and start over" template: the pipeline's three
// mandatory nodes and nothing else. A stray skill node (or a skillId that installs
// an app) would defeat the whole point of picking it.
describe("Blank Canvas", () => {
  const blank = TEMPLATE_BY_ID["blank-canvas"];

  it("is registered and installs nothing", () => {
    expect(blank).toBeDefined();
    expect(blank.skillIds).toEqual([]);
  });

  it("builds exactly Source → Compose → Publish", () => {
    const { nodes, edges } = blank.build();
    expect(nodes.map((n) => n.data.kind).sort()).toEqual(["compose", "publish", "source"]);
    // Both rails wired: an unconnected Publish means the run has nowhere to land.
    const src = nodes.find((n) => n.data.kind === "source")!;
    const compose = nodes.find((n) => n.data.kind === "compose")!;
    const publish = nodes.find((n) => n.data.kind === "publish")!;
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.source === src.id && e.target === compose.id)).toBe(true);
    expect(edges.some((e) => e.source === compose.id && e.target === publish.id)).toBe(true);
  });

  it("every node is reachable from the Source (nothing orphaned)", () => {
    const { nodes, edges } = blank.build();
    const reachable = reachableFromSource(nodes, edges);
    for (const n of nodes) expect(reachable.has(n.id), `${n.data.kind} is orphaned`).toBe(true);
  });

  it("compiles to a runnable config with no skills", () => {
    const { nodes, edges } = blank.build();
    const { clipConfig } = compileGraph(nodes, edges);
    expect(clipConfig.maxClipsPerSource).toBeGreaterThan(0);
    expect(clipConfig.hookVideos).toBeUndefined();
    expect(clipConfig.mainOnly).toBeUndefined();
  });

  it("mints fresh ids per apply, so re-applying can't collide", () => {
    const a = blank.build().nodes.map((n) => n.id);
    const b = blank.build().nodes.map((n) => n.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});
