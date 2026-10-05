// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { saveGraph, loadGraph, graphKey, migrateClipNamespace } from "./clipGraphStorage";
import { clipHistoryKey } from "./clipHistoryStorage";

describe("clipGraphStorage", () => {
  beforeEach(() => localStorage.clear());

  it("namespaces the key by mint", () => {
    expect(graphKey("abc")).toBe("vello-clipgraph:abc");
  });

  it("returns null when nothing saved", () => {
    expect(loadGraph("abc")).toBeNull();
  });

  it("round-trips nodes and edges, resetting run state on load", () => {
    const graph = {
      nodes: [{ id: "n1", data: { kind: "source", title: "Source", status: "running", output: { type: "crop", ratio: "9:16" }, error: "x", config: {} } }] as any,
      edges: [{ id: "e1" }] as any,
    };
    saveGraph("abc", graph);
    const loaded = loadGraph("abc");
    expect(loaded?.edges).toEqual(graph.edges);
    expect(loaded?.nodes[0].id).toBe("n1");
    // Statuses are run-scoped: a graph saved mid-run must come back idle, not
    // with a forever-spinning node.
    expect(loaded?.nodes[0].data.status).toBe("idle");
    expect(loaded?.nodes[0].data.output).toBeUndefined();
    expect(loaded?.nodes[0].data.error).toBeUndefined();
    expect(loaded?.nodes[0].data.config).toEqual({});
  });

  it("isolates graphs per mint", () => {
    saveGraph("a", { nodes: [{ id: "x" }] as any, edges: [] });
    expect(loadGraph("b")).toBeNull();
  });
});

describe("migrateClipNamespace (pre-mint clips survive mint)", () => {
  beforeEach(() => localStorage.clear());

  it("copies graph + history from the old namespace to the new (non-destructive)", () => {
    localStorage.setItem(graphKey("sess1"), '{"nodes":[],"edges":[]}');
    localStorage.setItem(clipHistoryKey("sess1"), '[{"id":"a"}]');
    migrateClipNamespace("sess1", "MINT");
    expect(localStorage.getItem(graphKey("MINT"))).toBe('{"nodes":[],"edges":[]}');
    expect(localStorage.getItem(clipHistoryKey("MINT"))).toBe('[{"id":"a"}]');
    expect(localStorage.getItem(graphKey("sess1"))).toBeTruthy(); // source left in place
  });

  it("does NOT clobber a non-empty target namespace (real minted data wins)", () => {
    localStorage.setItem(graphKey("sess1"), "OLD");
    localStorage.setItem(graphKey("MINT"), "REAL");
    migrateClipNamespace("sess1", "MINT");
    expect(localStorage.getItem(graphKey("MINT"))).toBe("REAL");
  });

  it("is a no-op for from===to or an empty key", () => {
    migrateClipNamespace("x", "x");
    migrateClipNamespace("", "MINT");
    expect(localStorage.getItem(graphKey("MINT"))).toBeNull();
  });
});
