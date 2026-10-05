/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SESSION = "sess-clipgraph-1111";
const MINT = "ClipGraphTestMint1111111111111111111111111";

const NODES = [{ id: "source-1", type: "source", position: { x: 0, y: 0 }, data: { kind: "source", title: "Source", status: "running", config: {} } }];
const EDGES = [{ id: "source-1->compose-1", source: "source-1", target: "compose-1", type: "smoothstep" }];

describe("clipGraphs persistence", () => {
  it("getByKey returns null before anything is saved", async () => {
    const t = convexTest(schema, modules);
    const got = await t.query(api.clipGraphs.getByKey, { sessionId: SESSION });
    expect(got).toBeNull();
  });

  it("saves and loads a graph by sessionId (pre-mint)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.clipGraphs.save, { sessionId: SESSION, nodes: NODES, edges: EDGES });
    const got = await t.query(api.clipGraphs.getByKey, { sessionId: SESSION });
    expect(got).not.toBeNull();
    expect(got!.nodes).toHaveLength(1);
    expect(got!.edges).toHaveLength(1);
    expect((got!.nodes as typeof NODES)[0].id).toBe("source-1");
  });

  it("save UPSERTS the same session row (no duplicate)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.clipGraphs.save, { sessionId: SESSION, nodes: NODES, edges: [] });
    await t.mutation(api.clipGraphs.save, { sessionId: SESSION, nodes: [], edges: EDGES });
    const got = await t.query(api.clipGraphs.getByKey, { sessionId: SESSION });
    expect(got!.nodes).toHaveLength(0);
    expect(got!.edges).toHaveLength(1);
    // exactly one row for this session
    const rows = await t.run(async (ctx) =>
      ctx.db.query("clipGraphs").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("is mint-preferred: a minted save patches the mint row and getByKey(mint) wins", async () => {
    const t = convexTest(schema, modules);
    // pre-mint draft under session
    await t.mutation(api.clipGraphs.save, { sessionId: SESSION, nodes: NODES, edges: [] });
    // post-mint save carries the mintAddress
    await t.mutation(api.clipGraphs.save, { mintAddress: MINT, sessionId: SESSION, nodes: [], edges: EDGES });
    // mint-keyed read wins
    const byMint = await t.query(api.clipGraphs.getByKey, { mintAddress: MINT, sessionId: SESSION });
    expect(byMint!.edges).toHaveLength(1);
    expect(byMint!.nodes).toHaveLength(0);
  });

  it("post-mint getByKey falls back to the session draft until a mint row exists", async () => {
    const t = convexTest(schema, modules);
    // only a pre-mint draft exists (no mintAddress on it)
    await t.mutation(api.clipGraphs.save, { sessionId: SESSION, nodes: NODES, edges: EDGES });
    // first post-mint load (mint row not written yet) → falls back to the draft
    const got = await t.query(api.clipGraphs.getByKey, { mintAddress: MINT, sessionId: SESSION });
    expect(got).not.toBeNull();
    expect(got!.nodes).toHaveLength(1);
  });
});
