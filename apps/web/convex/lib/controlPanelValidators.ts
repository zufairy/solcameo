import { v } from "convex/values";

/** One /control chat message — shared by the schema and controlPanel.ts so the
 *  stored shape and the accepted shape can never drift. */
export const controlMessageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  at: v.number(),
  speaker: v.optional(v.string()),
  showVideos: v.optional(v.object({
    count: v.number(),
    filter: v.union(v.literal("all"), v.literal("posted"), v.literal("ready")),
    sort: v.optional(v.union(v.literal("recent"), v.literal("views"), v.literal("viral"))),
  })),
  openBuilder: v.optional(v.object({ tab: v.string(), href: v.string() })),
  notes: v.optional(v.array(v.string())),
  error: v.optional(v.boolean()),
  /** A mission plan proposed in chat + its live execution state (steps, task /
   *  clip-job ids, review + post status). Client-owned shape
   *  (components/control/store.ts → Plan); capped in size by the writer. */
  plan: v.optional(v.any()),
});
