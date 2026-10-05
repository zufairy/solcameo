/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

// Regression tests for the skill-leak fix (commit 1d3ecd2). The cloud render
// (clipJobs.process) decides which skills to APPLY + BILL by reading
// agentSkillFiles via listByMint and honoring the canvas-synced `wired` flag.
// These pin the data-layer contract that filter depends on:
//   - setWired patches an EXISTING installed row only (never creates one) so an
//     uninstalled skill can't be resurrected, and toggles the boolean.
//   - listByMint surfaces the `wired` flag (and undefined for legacy rows).

const modules = import.meta.glob("./**/*.ts");
const MINT = "SkillFilesTestMint1111111111111111111111";
const SESSION = "sess-skillfiles-1";

function newT(): TestConvex<typeof schema> {
  return convexTest(schema, modules);
}

/** Install a skill row exactly as the Library install does (upsert). */
async function install(
  t: TestConvex<typeof schema>,
  skillId: string,
  opts: { mint?: string; session?: string } = {},
) {
  await t.mutation(api.agentSkillFiles.upsert, {
    sessionId: opts.session ?? SESSION,
    mintAddress: opts.mint ?? MINT,
    skillId,
    title: skillId,
    markdown: `# ${skillId}\ninstructions`,
  });
}

describe("agentSkillFiles.setWired", () => {
  it("patches an EXISTING installed row and toggles the flag (uninstall-safety: never creates)", async () => {
    const t = newT();
    await install(t, "clip.brainrot");

    // Wire it off, then on.
    const idOff = await t.mutation(api.agentSkillFiles.setWired, {
      sessionId: SESSION, skillId: "clip.brainrot", wired: false, mintAddress: MINT,
    });
    expect(idOff).not.toBeNull();
    let rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    expect(rows).toHaveLength(1);
    expect(rows[0].wired).toBe(false);

    const idOn = await t.mutation(api.agentSkillFiles.setWired, {
      sessionId: SESSION, skillId: "clip.brainrot", wired: true, mintAddress: MINT,
    });
    expect(idOn).toBe(idOff); // same row patched, not a new insert
    rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    expect(rows).toHaveLength(1);
    expect(rows[0].wired).toBe(true);
  });

  it("is a NO-OP for a skill that is not installed (returns null, creates nothing)", async () => {
    const t = newT();
    // Nothing installed — setWired must not insert a phantom row.
    const id = await t.mutation(api.agentSkillFiles.setWired, {
      sessionId: SESSION, skillId: "clip.facetrack", wired: false, mintAddress: MINT,
    });
    expect(id).toBeNull();
    const rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    expect(rows).toHaveLength(0);
  });
});

describe("agentSkillFiles.listByMint", () => {
  it("returns the wired flag per row; a freshly installed row leaves it undefined (legacy = wired)", async () => {
    const t = newT();
    await install(t, "clip.captions"); // never setWired → undefined
    await install(t, "clip.brainrot");
    await t.mutation(api.agentSkillFiles.setWired, {
      sessionId: SESSION, skillId: "clip.brainrot", wired: false, mintAddress: MINT,
    });

    const rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    const byId = Object.fromEntries(rows.map((r: Doc<"agentSkillFiles">) => [r.skillId, r.wired]));
    expect(byId["clip.captions"]).toBeUndefined(); // legacy/never-synced → reader treats as wired
    expect(byId["clip.brainrot"]).toBe(false);     // explicitly unwired
  });

  it("scopes to the mint (an OTHER agent's rows never leak in)", async () => {
    const t = newT();
    await install(t, "clip.captions", { mint: MINT });
    await install(t, "clip.zoom", { mint: "OtherMint2222222222222222222222222222", session: "sess-other" });
    const rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    expect(rows.map((r: Doc<"agentSkillFiles">) => r.skillId)).toEqual(["clip.captions"]);
  });
});

describe("agentSkillFiles mint-preferred editor saves", () => {
  it("upsert patches the existing minted skill row even from a different editor session", async () => {
    const t = newT();
    await install(t, "clip.hook", { mint: MINT, session: "original-session" });

    await t.mutation(api.agentSkillFiles.upsert, {
      sessionId: "new-editor-session",
      mintAddress: MINT,
      skillId: "clip.hook",
      title: "Auto Hook",
      markdown: "# Auto Hook\n\nnew style",
    });
    await t.mutation(api.agentSkillFiles.setConfig, {
      sessionId: "new-editor-session",
      mintAddress: MINT,
      skillId: "clip.hook",
      config: { hookTemplateId: "yellow_pop" },
    });

    const rows = await t.query(api.agentSkillFiles.listByMint, { mintAddress: MINT });
    expect(rows.filter((r: Doc<"agentSkillFiles">) => r.skillId === "clip.hook")).toHaveLength(1);
    expect(rows[0].sessionId).toBe("new-editor-session");
    expect((rows[0].config as { hookTemplateId?: string } | undefined)?.hookTemplateId).toBe("yellow_pop");
  });

  it("getOne reads the minted row before a stale same-session row", async () => {
    const t = newT();
    await install(t, "clip.hook", { mint: MINT, session: "mint-session" });
    await t.mutation(api.agentSkillFiles.setConfig, {
      sessionId: "mint-session",
      mintAddress: MINT,
      skillId: "clip.hook",
      config: { hookTemplateId: "black_box" },
    });
    await t.mutation(api.agentSkillFiles.upsert, {
      sessionId: SESSION,
      skillId: "clip.hook",
      title: "clip.hook",
      markdown: "# clip.hook\nstale session config",
    });
    await t.mutation(api.agentSkillFiles.setConfig, {
      sessionId: SESSION,
      skillId: "clip.hook",
      config: { hookTemplateId: "bold_impact" },
    });

    const row = await t.query(api.agentSkillFiles.getOne, {
      sessionId: SESSION,
      mintAddress: MINT,
      skillId: "clip.hook",
    });
    expect((row?.config as { hookTemplateId?: string } | undefined)?.hookTemplateId).toBe("black_box");
  });
});
