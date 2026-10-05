import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";

/**
 * ONE-OFF R2 MIGRATION HELPERS — secret-gated plumbing for
 * scripts/migrate-videos-to-r2.ts, which moves every video blob out of Convex
 * file storage (130GB+, dominating the bill) into Cloudflare R2 and then
 * sweeps the orphans. Safe to leave deployed: every function requires
 * INTERNAL_CRON_SECRET, and none of them are referenced by the app itself.
 *
 * Table allowlist below = every column that can hold a Convex storage URL for
 * a VIDEO. Small non-video blobs (transcripts JSON, campaign images, résumés,
 * carousel images) intentionally stay in Convex — the sweep keeps anything
 * those tables reference.
 */

function guard(authSecret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

/** table → the url field(s) the script may rewrite. */
export const MIGRATE_TABLES: Record<string, string[]> = {
  clips: ["clipUrl"],
  scheduledContent: ["videoUrl"],
  seriesEpisodes: ["videoUrl"],
  videoRenderJobs: ["videoUrl"],
  documentaryProjects: ["videoUrl"],
  videoRecreateProjects: ["videoUrl"],
  agentStyleReferences: ["videoUrl"],
  sampleRuns: ["clipUrl", "videoUrl"],
  ugcSampleRuns: ["videoUrl"],
  downloadCache: ["url"],
};

/** Tables whose _storage references must SURVIVE the orphan sweep. */
const KEEP_TABLES: Record<string, string[]> = {
  transcriptCache: ["transcriptStorageId"],
  jobApplications: ["resumeStorageId"],
};

// Paginated page over one allowlisted table; returns _id + the url fields.
export const scanTable = query({
  args: { authSecret: v.string(), table: v.string(), cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, table, cursor, limit }) => {
    guard(authSecret);
    const fields = MIGRATE_TABLES[table];
    if (!fields) throw new Error(`table not allowlisted: ${table}`);
    const page = await ctx.db.query(table as TableNames).paginate({ cursor: cursor ?? null, numItems: limit ?? 200 });
    return {
      rows: page.page.map((d) => {
        const rec = d as unknown as Record<string, unknown>;
        return { _id: d._id, fields: Object.fromEntries(fields.map((f) => [f, typeof rec[f] === "string" ? rec[f] : null])) };
      }),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

// Rewrite one url field on one row (post-copy). Allowlisted table+field only.
export const patchUrl = mutation({
  args: { authSecret: v.string(), table: v.string(), id: v.string(), field: v.string(), url: v.string() },
  handler: async (ctx, { authSecret, table, id, field, url }) => {
    guard(authSecret);
    if (!MIGRATE_TABLES[table]?.includes(field)) throw new Error(`not allowlisted: ${table}.${field}`);
    await ctx.db.patch(id as Id<TableNames>, { [field]: url } as never);
    return { ok: true };
  },
});

/** Tables the DEEP url-rewrite below may touch — every table found holding
 *  dead bold-ram-39 storage URLs or expiring tempfile.aiquickdraw URLs after
 *  the server change (scripts/rescue-dead-media.ts). Deep = nested objects,
 *  arrays, and URLs embedded inside JSON-encoded string fields all rewrite. */
const REWRITE_TABLES = new Set([
  "influencers", "videoRenderJobs", "agentTasks", "agentStyleReferences",
  "campaigns", "agentSkillFiles", "clipGraphs", "sampleRuns", "ugcSampleRuns",
  "clipJobs", "downloadJobs", "videoRecreateProjects", "clips", "scheduledContent",
  "seriesEpisodes", "documentaryProjects",
]);

/** Substring-replace every `from`→`to` in every string anywhere in a value. */
function deepReplace(value: unknown, pairs: { from: string; to: string }[]): { out: unknown; changed: boolean } {
  if (typeof value === "string") {
    let s = value;
    for (const { from, to } of pairs) s = s.split(from).join(to);
    return { out: s, changed: s !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v2) => {
      const r = deepReplace(v2, pairs);
      changed = changed || r.changed;
      return r.out;
    });
    return { out, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v2] of Object.entries(value)) {
      const r = deepReplace(v2, pairs);
      changed = changed || r.changed;
      out[k] = r.out;
    }
    return { out, changed };
  }
  return { out: value, changed: false };
}

// Deep URL rewrite on one row: replaces every occurrence of each `from` URL
// (including inside JSON-encoded string fields like agentTasks.input/output
// and videoRenderJobs.renderArgs) with its `to`. No-op when nothing matches.
export const rewriteUrls = mutation({
  args: {
    authSecret: v.string(),
    table: v.string(),
    id: v.string(),
    pairs: v.array(v.object({ from: v.string(), to: v.string() })),
  },
  handler: async (ctx, { authSecret, table, id, pairs }) => {
    guard(authSecret);
    if (!REWRITE_TABLES.has(table)) throw new Error(`table not allowlisted for rewrite: ${table}`);
    const doc = await ctx.db.get(id as Id<TableNames>);
    if (!doc) return { ok: false, reason: "not found" };
    const { _id, _creationTime, ...rest } = doc as unknown as Record<string, unknown>;
    void _id; void _creationTime;
    const { out, changed } = deepReplace(rest, pairs);
    if (!changed) return { ok: true, changed: false };
    await ctx.db.replace(id as Id<TableNames>, out as never);
    return { ok: true, changed: true };
  },
});

// Delete one row (downloadCache purge). Allowlisted tables only.
export const deleteRow = mutation({
  args: { authSecret: v.string(), table: v.string(), id: v.string() },
  handler: async (ctx, { authSecret, table, id }) => {
    guard(authSecret);
    if (!MIGRATE_TABLES[table]) throw new Error(`table not allowlisted: ${table}`);
    await ctx.db.delete(id as Id<TableNames>);
    return { ok: true };
  },
});

// Page over the _storage system table: id, size, contentType, serving url.
export const listStorageFiles = query({
  args: { authSecret: v.string(), cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, cursor, limit }) => {
    guard(authSecret);
    const page = await ctx.db.system.query("_storage").paginate({ cursor: cursor ?? null, numItems: limit ?? 100 });
    return {
      files: await Promise.all(page.page.map(async (f) => ({
        id: f._id as string,
        size: f.size,
        contentType: f.contentType ?? null,
        url: await ctx.storage.getUrl(f._id),
      }))),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

// Storage ids that must never be swept: everything the keep-tables reference.
export const listKeepStorageIds = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    guard(authSecret);
    const keep: string[] = [];
    for (const [table, fields] of Object.entries(KEEP_TABLES)) {
      const rows = await ctx.db.query(table as TableNames).collect();
      for (const row of rows) {
        const rec = row as unknown as Record<string, unknown>;
        for (const f of fields) if (typeof rec[f] === "string") keep.push(rec[f] as string);
      }
    }
    // campaigns: image ids live in two shapes (single id + list) — collect raw docs.
    for (const row of await ctx.db.query("campaigns").collect()) {
      const rec = row as unknown as Record<string, unknown>;
      for (const val of Object.values(rec)) {
        if (typeof val === "string" && /^[a-z0-9]{31,34}$/.test(val)) keep.push(val);
        if (Array.isArray(val)) for (const x of val) if (typeof x === "string" && /^[a-z0-9]{31,34}$/.test(x)) keep.push(x);
      }
    }
    return keep;
  },
});

// Delete one storage object by id (the sweep). Same power as
// clipStorage.deleteStorage, duplicated here so the sweep is self-contained.
export const deleteStorageObject = mutation({
  args: { authSecret: v.string(), storageId: v.string() },
  handler: async (ctx, { authSecret, storageId }) => {
    guard(authSecret);
    try { await ctx.storage.delete(storageId as Id<"_storage">); return { ok: true as const }; }
    catch { return { ok: false as const }; }
  },
});
