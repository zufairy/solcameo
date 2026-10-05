// SKILL SPLIT — the one place that decides, for a clipper agent, which installed
// skills are EDITING EFFECTS (they shape the clip's edit plan at render time) vs
// which describe the agent's AUTONOMOUS behavior (scout campaigns, self-reflect,
// research, auto-post, submit). The Home surface consumes this so it can show a
// clean "what this clip editor does" list separate from "what this agent does on
// its own".
//
// Ground truth (verified): there is NO pre-existing editing-vs-agent flag on the
// skills. We DEFINE the mapping here:
//   • clip.* skills are EDITING EFFECTS — they emit EditOps / drive the renderer —
//     EXCEPT clip.campaignscout and clip.prompt, which steer targeting/discovery
//     (catalog category "Targeting & Discovery") and read as agent-side behavior.
//   • Autonomous TASK TYPES (find_jobs / self_reflect / research, from
//     app/api/agents/run-task/route.ts) are NOT skills — they're behaviors. We
//     surface them as a static curated AGENT_SKILLS list.
//
// Pure module: no I/O, no server runtime. Safe to import from client + server.

import {
  CLIP_SKILL_BY_ID,
  categoryForSkill,
  isClipSkillId,
} from "./clipSkillsCatalog";

/**
 * The subset of run-task TaskTypes that map to a CLIPPER agent's autonomous
 * behaviors. Kept as a local literal union (mirrors the TaskType union in
 * app/api/agents/run-task/route.ts ~L77) so this pure module never imports a
 * Next.js route. Only the clipper-relevant ones are listed.
 */
export type AgentTaskType = "find_jobs" | "self_reflect" | "research";

/** A clipping skill is an EDITING EFFECT when it is a clip.* skill that is NOT in
 *  the "Targeting & Discovery" category (i.e. not clip.campaignscout / clip.prompt).
 *  Those two steer what the agent looks for rather than editing the clip itself. */
export function isEditingClipSkill(skillId: string): boolean {
  if (!isClipSkillId(skillId)) return false;
  return categoryForSkill(skillId) !== "Targeting & Discovery";
}

/** The two clip.* skills that read as agent-side targeting/discovery, not edits. */
export const AGENT_CLIP_SKILL_IDS = ["clip.campaignscout", "clip.prompt"] as const;

/** True for the targeting/discovery clip skills (clip.campaignscout / clip.prompt). */
export function isAgentClipSkill(skillId: string): boolean {
  return isClipSkillId(skillId) && categoryForSkill(skillId) === "Targeting & Discovery";
}

/** One row of the curated "what this CLIPPER agent does autonomously" list. */
export interface AgentSkillEntry {
  /** Stable id (agent.* for behaviors, or the clip.* id when it mirrors a node). */
  id: string;
  /** Short human label for the Home list. */
  label: string;
  /** One-line description of the autonomous behavior. */
  blurb: string;
  /** The run-task TaskType this behavior triggers, when one exists. */
  taskType?: AgentTaskType;
  /** When it runs, in plain words (e.g. "Runs daily", "Weekly", "When ON"). */
  schedule: string;
}

/**
 * Static curated description of what a CLIPPER agent does on its own — separate
 * from the editing effects. Order is the intended display order on Home.
 *  • Scout campaigns  → find_jobs   (also surfaced as the clip.campaignscout node)
 *  • Self-reflect     → self_reflect
 *  • Research trends  → research
 *  • Auto-post clips  → the drip (no run-task TaskType; the auto-post scheduler)
 *  • Submit to campaigns → campaign auto-submit (join_clip_campaign / drip submit)
 */
export const AGENT_SKILLS: AgentSkillEntry[] = [
  {
    id: "agent.scout",
    label: "Scout campaigns",
    blurb:
      "Scans the campaigns marketplace and flags brand campaigns this agent's clips fit. " +
      "Mirrors the Campaign Scout node (clip.campaignscout) when installed.",
    taskType: "find_jobs",
    schedule: "Runs daily",
  },
  {
    id: "agent.reflect",
    label: "Self-reflect",
    blurb:
      "Reviews recent runs and posts, extracts what worked, and tunes its own approach.",
    taskType: "self_reflect",
    schedule: "Weekly",
  },
  {
    id: "agent.research",
    label: "Research trends",
    blurb:
      "Researches trending topics, sounds, and formats in its niche to steer the next clips. " +
      "Pairs with Prompt to Clip (clip.prompt) to target what to look for.",
    taskType: "research",
    schedule: "On demand",
  },
  {
    id: "agent.autopost",
    label: "Auto-post clips",
    blurb:
      "Drips finished clips out to the connected platforms on a stagger so the feed stays alive.",
    // The auto-post drip is its own scheduler, not a run-task TaskType.
    schedule: "When ON",
  },
  {
    id: "agent.submit",
    label: "Submit to campaigns",
    blurb:
      "Auto-submits matching clips to the brand campaigns it scouted, with no manual step.",
    schedule: "When ON",
  },
];

/** A skill reduced to what the Home lists need. */
export interface SkillLabel {
  id: string;
  label: string;
}

/** Result of splitting an agent's installed skills into the two Home buckets. */
export interface SplitSkills {
  /** Installed clip editing effects (label from the catalog). */
  editing: SkillLabel[];
  /** Installed targeting/discovery clip skills, mapped to friendly labels. */
  agent: SkillLabel[];
}

/** Friendly labels for the agent-side clip skills (used when splitting installs). */
const AGENT_CLIP_SKILL_LABELS: Record<string, string> = {
  "clip.campaignscout": "Scout campaigns",
  "clip.prompt": "Prompt-to-clip targeting",
};

/**
 * Split a list of installed skill ids into the two Home buckets.
 *  • editing — installed clip editing effects; label resolves from
 *    CLIP_SKILL_BY_ID (falling back to skillFileTitles, then the raw id).
 *  • agent — installed clip.campaignscout / clip.prompt, mapped to friendly labels.
 * Non-clip ids (persona agentSkills, custom skill files) are ignored here; pass
 * skillFileTitles only to improve the editing label for known clip ids.
 */
export function splitInstalledSkills(
  installedSkillIds: string[],
  skillFileTitles?: Record<string, string>,
): SplitSkills {
  const editing: SkillLabel[] = [];
  const agent: SkillLabel[] = [];
  const seen = new Set<string>();

  for (const id of installedSkillIds) {
    if (!id || seen.has(id) || !isClipSkillId(id)) continue;
    seen.add(id);

    if (isAgentClipSkill(id)) {
      agent.push({
        id,
        label:
          AGENT_CLIP_SKILL_LABELS[id] ??
          CLIP_SKILL_BY_ID[id]?.name ??
          skillFileTitles?.[id] ??
          id,
      });
    } else if (isEditingClipSkill(id)) {
      editing.push({
        id,
        label: CLIP_SKILL_BY_ID[id]?.name ?? skillFileTitles?.[id] ?? id,
      });
    }
  }

  return { editing, agent };
}
