// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("@/providers/supabase-auth-provider", () => ({ useSupabaseAuth: () => ({ accessToken: null, loading: false }) }));
import { repairEditorDraft, type EditorDraft } from "./VideoEditorTab";

type Item = NonNullable<EditorDraft["timeline"]>[number];
type Ov = NonNullable<EditorDraft["overlays"]>[number];
const item = (id: string, url: string, taskId?: string): Item => ({ id, url, title: id, taskId, duration: 10, trimIn: 0, trimOut: 10 } as Item);
const hook = (id: string, itemId: string, text: string): Ov => ({ id, itemId, text, startSec: 0, endSec: 3, position: "top", hookDesignId: "bold" } as Ov);
const caption = (id: string, itemId: string): Ov => ({ id, itemId, text: "", startSec: 0, endSec: 10, position: "bottom", presetId: "clean" } as Ov);
const media = (id: string, itemId: string): Ov => ({ id, itemId, text: "", startSec: 0, endSec: 10, position: "center", imageUrl: "x.png" } as Ov);

describe("repairEditorDraft", () => {
  it("collapses stacked hook/caption overlays per clip, keeping the most recent, and leaves media overlays alone", () => {
    const d = repairEditorDraft({
      timeline: [item("a", "https://x/a.mp4")],
      overlays: [hook("h1", "a", "old"), caption("c1", "a"), hook("h2", "a", "older"), hook("h3", "a", "newest"), caption("c2", "a"), media("m1", "a"), media("m2", "a")],
    });
    const ids = d.overlays!.map((o) => o.id);
    expect(ids).toEqual(["h3", "c2", "m1", "m2"]);
    expect(d.overlays!.find((o) => o.id === "h3")!.text).toBe("newest");
  });

  it("merges duplicate clips (same url/taskId) and remaps their overlays onto the survivor", () => {
    const d = repairEditorDraft({
      timeline: [item("a", "https://x/a.mp4", "t1"), item("b", "https://x/a.mp4", "t1"), item("c", "https://x/c.mp4")],
      overlays: [hook("h1", "a", "one"), hook("h2", "b", "two"), media("m1", "b")],
    });
    expect(d.timeline!.map((t) => t.id)).toEqual(["a", "c"]);
    expect(d.overlays!.every((o) => o.itemId === "a")).toBe(true);
    expect(d.overlays!.map((o) => o.id)).toEqual(["h2", "m1"]); // latest hook wins, media kept
  });

  it("drops overlays whose clip no longer exists", () => {
    const d = repairEditorDraft({ timeline: [item("a", "u")], overlays: [hook("h1", "a", "x"), hook("h9", "gone", "y")] });
    expect(d.overlays!.map((o) => o.id)).toEqual(["h1"]);
  });

  it("tolerates an empty / partial draft", () => {
    expect(repairEditorDraft({})).toEqual({ timeline: [], overlays: [] });
  });
});
