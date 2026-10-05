// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isEditingClipSkill,
  isAgentClipSkill,
  AGENT_CLIP_SKILL_IDS,
  AGENT_SKILLS,
  splitInstalledSkills,
} from "./skillSplit";

describe("skillSplit — editing vs agent classification", () => {
  it("clip.* editing effects are editing, not agent", () => {
    for (const id of ["clip.captions", "clip.title", "clip.zoom", "clip.fillercut", "clip.brainrot", "clip.memeaudio"]) {
      expect(isEditingClipSkill(id)).toBe(true);
      expect(isAgentClipSkill(id)).toBe(false);
    }
  });

  it("targeting/discovery clip skills are agent, not editing", () => {
    for (const id of AGENT_CLIP_SKILL_IDS) {
      expect(isAgentClipSkill(id)).toBe(true);
      expect(isEditingClipSkill(id)).toBe(false);
    }
    // belt-and-braces: the literal ids we depend on
    expect([...AGENT_CLIP_SKILL_IDS]).toEqual(["clip.campaignscout", "clip.prompt"]);
  });

  it("non-clip ids are neither editing nor agent", () => {
    for (const id of ["persona.tone", "self_reflect", "", "find_jobs"]) {
      expect(isEditingClipSkill(id)).toBe(false);
      expect(isAgentClipSkill(id)).toBe(false);
    }
  });
});

describe("skillSplit — AGENT_SKILLS shape", () => {
  it("has the curated clipper behaviors with required fields", () => {
    expect(AGENT_SKILLS.length).toBeGreaterThanOrEqual(5);
    for (const s of AGENT_SKILLS) {
      expect(typeof s.id).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
      expect(typeof s.label).toBe("string");
      expect(typeof s.blurb).toBe("string");
      expect(typeof s.schedule).toBe("string");
      if (s.taskType !== undefined) {
        expect(["find_jobs", "self_reflect", "research"]).toContain(s.taskType);
      }
    }
  });

  it("covers scout/reflect/research with the right task types and schedules", () => {
    const byTask = Object.fromEntries(
      AGENT_SKILLS.filter((s) => s.taskType).map((s) => [s.taskType, s]),
    );
    expect(byTask.find_jobs?.schedule).toBe("Runs daily");
    expect(byTask.self_reflect?.schedule).toBe("Weekly");
    expect(byTask.research?.schedule).toBe("On demand");
    // auto-post + submit have no run-task TaskType, run "When ON"
    const noTask = AGENT_SKILLS.filter((s) => !s.taskType);
    expect(noTask.length).toBeGreaterThanOrEqual(2);
    expect(noTask.every((s) => s.schedule === "When ON")).toBe(true);
  });
});

describe("skillSplit — splitInstalledSkills", () => {
  it("buckets installed clip skills, dedupes, ignores non-clip ids", () => {
    const out = splitInstalledSkills([
      "clip.captions",
      "clip.title",
      "clip.captions", // dup
      "clip.campaignscout",
      "clip.prompt",
      "persona.tone", // non-clip, ignored
    ]);
    expect(out.editing.map((e) => e.id)).toEqual(["clip.captions", "clip.title"]);
    expect(out.editing.map((e) => e.label)).toEqual(["Dynamic Captions", "Hook Title Card"]);
    expect(out.agent.map((a) => a.id)).toEqual(["clip.campaignscout", "clip.prompt"]);
    expect(out.agent.map((a) => a.label)).toEqual(["Scout campaigns", "Prompt-to-clip targeting"]);
  });

  it("falls back to skillFileTitles then raw id for unknown clip editing ids", () => {
    const out = splitInstalledSkills(["clip.unknownfx"], { "clip.unknownfx": "Custom FX" });
    expect(out.editing).toEqual([{ id: "clip.unknownfx", label: "Custom FX" }]);
    const out2 = splitInstalledSkills(["clip.bare"]);
    expect(out2.editing).toEqual([{ id: "clip.bare", label: "clip.bare" }]);
  });

  it("returns empty buckets for empty input", () => {
    expect(splitInstalledSkills([])).toEqual({ editing: [], agent: [] });
  });
});
