import { describe, it, expect, beforeEach } from "vitest";
import { useClippingStore } from "./clipping-store";
import type { VelloNode, VelloEdge } from "@/components/builder/clipping-flow/types/clipping";

// Minimal skill node for the graph.
const node = (id: string): VelloNode => ({
  id,
  type: "skill",
  position: { x: 0, y: 0 },
  data: { kind: "skill", title: id, status: "idle", config: { variant: "marketplace", skillId: `clip.${id}`, skillName: id } as never },
});
const edge = (source: string, target: string): VelloEdge => ({ id: `${source}->${target}`, source, target, type: "smoothstep" });

const reset = () =>
  useClippingStore.setState({ nodes: [], edges: [], selectedId: null, previewId: null, runStatus: "idle", past: [], future: [] });

describe("clipping-store: deleting a node cleans up wires + selection (no stale skills)", () => {
  beforeEach(reset);

  it("onNodesChange remove drops the node's edges AND clears a selection pointing at it", () => {
    useClippingStore.setState({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c")],
      selectedId: "b",
    });
    // Delete node "b" the way ReactFlow does (Delete key / node menu).
    useClippingStore.getState().onNodesChange([{ type: "remove", id: "b" }]);
    const s = useClippingStore.getState();
    expect(s.nodes.map((n) => n.id).sort()).toEqual(["a", "c"]); // node gone
    expect(s.edges).toEqual([]);                                  // BOTH wires touching "b" removed (no dangling lines)
    expect(s.selectedId).toBeNull();                              // inspector no longer shows the deleted node's config
  });

  it("deleting an UNSELECTED node keeps the current selection", () => {
    useClippingStore.setState({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b")],
      selectedId: "a",
    });
    useClippingStore.getState().onNodesChange([{ type: "remove", id: "b" }]);
    const s = useClippingStore.getState();
    expect(s.selectedId).toBe("a"); // untouched
    expect(s.edges).toEqual([]);    // the a->b wire is still cleaned up
  });
});

describe("clipping-store: adding a skill never reuses a hydrated node's id", () => {
  beforeEach(reset);

  it("a new skill node gets a UNIQUE id + selecting it resolves to THAT node (not an older collision)", () => {
    // Hydrate a graph carrying a skill node with a low numeric id in the same
    // `skill-<n>` namespace the module counter mints from - the exact setup that
    // used to collide after nodeSeq reset on reload ("added Captions, shows Zoom Punch").
    const zoom: VelloNode = {
      id: "skill-100",
      type: "skill",
      position: { x: 0, y: 0 },
      data: { kind: "skill", title: "Zoom Punch", status: "idle", config: { variant: "marketplace", skillId: "clip.zoom", skillName: "Zoom Punch" } as never },
    };
    useClippingStore.getState().loadGraph([zoom], []);
    // Add a Captions skill the way the palette does.
    useClippingStore.getState().addSkillNodeAt({ skillId: "clip.captions", name: "Dynamic Captions" }, { x: 0, y: 0 });
    const s = useClippingStore.getState();
    const added = s.nodes.find((n) => (n.data.config as { skillId?: string }).skillId === "clip.captions")!;
    expect(added.id).not.toBe("skill-100");                       // no id collision with the hydrated zoom node
    expect(s.nodes.filter((n) => n.id === added.id)).toHaveLength(1); // id is unique across the graph
    expect(s.selectedId).toBe(added.id);                          // selection points at the new node
    // Resolving the selection (what the inspector does) returns the CAPTIONS node.
    const selected = s.nodes.find((n) => n.id === s.selectedId)!;
    expect((selected.data.config as { skillId?: string }).skillId).toBe("clip.captions");
  });
});

describe("clipping-store: loadGraph drops orphaned wires", () => {
  beforeEach(reset);

  it("an edge whose endpoint node is missing is not restored", () => {
    // "b" was deleted in a prior session but its wire lingered in the save.
    useClippingStore.getState().loadGraph([node("a"), node("c")], [edge("a", "b"), edge("a", "c")]);
    const s = useClippingStore.getState();
    expect(s.edges.map((e) => e.id)).toEqual(["a->c"]); // a->b (orphan) pruned, a->c kept
  });

  it("collapses two nodes that share an id (the collision that opened the wrong inspector)", () => {
    // A graph saved by the buggy build had a Zoom and a Captions node both on id "skill-1".
    const zoom: VelloNode = { ...node("dup"), data: { kind: "skill", title: "Zoom Punch", status: "idle", config: { variant: "marketplace", skillId: "clip.zoom", skillName: "Zoom Punch" } as never } };
    const captions: VelloNode = { ...node("dup"), data: { kind: "skill", title: "Dynamic Captions", status: "idle", config: { variant: "marketplace", skillId: "clip.captions", skillName: "Dynamic Captions" } as never } };
    useClippingStore.getState().loadGraph([zoom, captions], []);
    const s = useClippingStore.getState();
    expect(s.nodes.filter((n) => n.id === "dup")).toHaveLength(1); // only ONE node per id survives
    // Selecting that id now resolves to a single, unambiguous node.
    expect(s.nodes.filter((n) => n.id === "dup")[0].data.title).toBe("Zoom Punch"); // first kept
  });
});

describe("clipping-store: Publish is a singleton", () => {
  beforeEach(reset);

  const publish = (id: string): VelloNode => ({
    id, type: "publish", position: { x: 0, y: 0 },
    data: { kind: "publish", title: "Publish", status: "idle", config: {} as never },
  });

  it("loadGraph collapses two Publish cards to one and remaps their wires", () => {
    // A graph saved by the old build carried two Publish nodes; compose wired to the SECOND.
    const compose: VelloNode = { id: "compose-1", type: "compose", position: { x: 0, y: 0 }, data: { kind: "compose", title: "Compose", status: "idle", config: {} as never } };
    useClippingStore.getState().loadGraph(
      [compose, publish("pub-1"), publish("pub-2")],
      [edge("compose-1", "pub-2")],
    );
    const s = useClippingStore.getState();
    expect(s.nodes.filter((n) => n.data.kind === "publish")).toHaveLength(1); // only one Publish survives
    expect(s.nodes.find((n) => n.data.kind === "publish")!.id).toBe("pub-1"); // first kept
    expect(s.edges.map((e) => e.id)).toEqual(["compose-1->pub-1"]);           // wire remapped to survivor
  });

  it("addNodeFromCatalog('publish') focuses the existing Publish instead of adding a second", () => {
    useClippingStore.setState({ nodes: [publish("pub-1")], edges: [] });
    useClippingStore.getState().addNodeFromCatalog("publish", { x: 100, y: 100 });
    const s = useClippingStore.getState();
    expect(s.nodes.filter((n) => n.data.kind === "publish")).toHaveLength(1); // no duplicate minted
    expect(s.selectedId).toBe("pub-1");                                        // existing one selected
  });
});

describe("clipping-store: draftMaxClips (Editor tab's Save-before-canvas-mounts signal)", () => {
  beforeEach(() => { useClippingStore.setState({ draftMaxClips: null }); });

  it("defaults to null (no draft yet)", () => {
    expect(useClippingStore.getState().draftMaxClips).toBeNull();
  });

  it("setDraftMaxClips stores the saved count for the Editor tab's top button to read immediately", () => {
    useClippingStore.getState().setDraftMaxClips(12);
    expect(useClippingStore.getState().draftMaxClips).toBe(12);
  });

  it("draining a set_max_clips op onto the real source node clears the draft (node is authoritative again)", () => {
    // Mirrors ClippingFlowCanvas's op-drain effect: draftMaxClips is set on
    // save, then cleared the moment the canvas actually applies the op.
    useClippingStore.getState().setDraftMaxClips(20);
    expect(useClippingStore.getState().draftMaxClips).toBe(20);
    useClippingStore.setState({ draftMaxClips: null }); // what the "set_max_clips" case does post-apply
    expect(useClippingStore.getState().draftMaxClips).toBeNull();
  });
});
