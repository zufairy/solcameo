import { v } from "convex/values";

// Shared arg validators for the video-render job — used by BOTH videoJobs.ts
// (the plain mutation that enqueues it, isolate runtime) and
// videoJobsGenerate.ts (the "use node" action that runs it). Kept in their own
// node-free file so neither caller has to import the other: videoJobs.ts must
// stay import-clean of Node APIs (Convex bundles it for the isolate runtime),
// and importing FROM the "use node" file would drag its node:child_process /
// node:fs dependency chain along for the ride.

// Slow inputs to generateVideoFromScript, passed through the scheduler.
const videoPayload = v.object({
  agentName: v.string(),
  agentNiche: v.string(),
  // Videos-tab "No Persona": render from the prompt/script alone (no persona
  // kernel / voice / character bible anywhere in the prompts).
  noPersona: v.optional(v.boolean()),
  agentArchetype: v.optional(v.string()),
  characterBible: v.optional(v.string()),
  avatarUrl: v.string(),
  referenceImageUrls: v.array(v.string()),
  // The campaign's product image — used as 1 of the 3 Veo reference images.
  productImageUrl: v.optional(v.string()),
  // All campaign images (cover + attachments) — extra storyboard references (≤5).
  campaignImageUrls: v.optional(v.array(v.string())),
  // Full campaign context for the storyboard planner (brand, brief, crawled site).
  campaignContext: v.optional(v.string()),
  topic: v.string(),
  hook: v.string(),
  scriptText: v.string(),
  durationSeconds: v.optional(v.number()),
  videoModel: v.string(),
  // Video Director — render aspect ratio + post-render overlays (hook text / captions).
  aspectRatio: v.optional(v.string()),
  overlays: v.optional(v.object({
    captions: v.optional(v.object({
      enabled: v.boolean(),
      // `preset` = caption-template id (lib/builder/captionPresets.ts) — carried
      // through to render-step → overlay-burn, which burns captions in that template.
      style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string(), preset: v.optional(v.string()) }),
    })),
    hookText: v.optional(v.object({
      enabled: v.boolean(),
      source: v.string(),
      text: v.optional(v.string()),
      // Hook-design id + on-screen duration + generation brief — carried through to
      // render-step → overlay-burn, which resolves the design and burns the hook.
      templateId: v.optional(v.string()),
      durationSeconds: v.optional(v.number()),
      prompt: v.optional(v.string()),
      style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
    })),
    brandLogoUrl: v.optional(v.string()),
    // Trending Audio bed — mixed under the voiceover by render-step → overlay-burn.
    // Without this the builder/legacy path dropped music even when the skill was on.
    music: v.optional(v.object({
      enabled: v.boolean(),
      trackId: v.optional(v.string()),
      autoMusic: v.optional(v.boolean()),
      volumePct: v.optional(v.number()),
      customUrl: v.optional(v.string()),
      customStorageId: v.optional(v.string()),
    })),
    // Video Call To Action app: URL of the clip appended to the end of the video.
    ctaVideo: v.optional(v.string()),
    // A real news/reference photo burned as an on-screen inset (picture-in-
    // picture) — never an identity reference. See run-task's overlays doc.
    newsImageUrl: v.optional(v.string()),
    hookVideos: v.optional(v.array(v.string())),
    mainVideos: v.optional(v.array(v.string())),
    mainVideosOnly: v.optional(v.boolean()),
  })),
  personality: v.optional(v.object({
    warmth: v.optional(v.number()),
    humor: v.optional(v.number()),
    authority: v.optional(v.number()),
    boldness: v.optional(v.number()),
  })),
  voiceArchetype: v.optional(v.string()),
  language: v.optional(v.string()),
  avatarUrls: v.optional(v.array(v.string())),
  // Pre-composed engine-neutral prompt from the format catalog (spec: format
  // catalog prompts) — forwarded from run-task's create_video handler when the
  // idea pipeline templated one. buildVideoPrompt (kie-video-pipeline.ts) adapts
  // this to the render engine's dialect instead of its legacy composition.
  formatPrompt: v.optional(v.string()),
  // The catalog format id formatPrompt was templated from (diagnostic).
  formatId: v.optional(v.string()),
  creativeBrief: v.optional(v.object({
    format: v.string(),
    angle: v.string(),
    // The script generator includes the topic in the brief — accept it so the
    // enqueue doesn't fail validation (it carries useful storyboard context).
    topic: v.optional(v.string()),
    structureNotes: v.optional(v.string()),
    visualTreatment: v.optional(v.string()),
  })),
  skills: v.optional(v.array(v.object({
    name: v.string(),
    instructions: v.string(),
  }))),
  autoPost: v.optional(v.object({
    platforms: v.array(v.string()),
    campaignId: v.optional(v.string()),
    submissionId: v.optional(v.string()),
    caption: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    ownerWallet: v.optional(v.string()),
  })),
  memories: v.array(v.object({ kind: v.string(), summary: v.string(), importance: v.number() })),
  knowledge: v.array(v.object({ title: v.string(), content: v.string() })),
});

export const jobArgs = {
  taskId: v.id("agentTasks"),
  mintAddress: v.string(),
  scriptJson: v.string(),   // the script result JSON, echoed into the final output
  video: videoPayload,
  costFloor: v.number(),    // billed if only the script (no video) is produced
  // Credentials forwarded from the Next enqueue so the render works even when
  // the Convex deployment's own env vars aren't set. Convex env wins if present.
  kieApiKey: v.optional(v.string()),
  appUrl: v.optional(v.string()),
};
