import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Resume upload — the client POSTs the file to this URL, gets back a storageId. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Save a job application from the public Hiring page. */
export const submit = mutation({
  args: {
    role: v.string(),
    fullName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    telegram: v.optional(v.string()),
    country: v.optional(v.string()),
    location: v.optional(v.string()),
    portfolioUrl: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    coverLetter: v.optional(v.string()),
    resumeStorageId: v.optional(v.id("_storage")),
    resumeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim();
    const fullName = args.fullName.trim();
    const role = args.role.trim();
    if (!fullName) throw new Error("Full name is required.");
    if (!role) throw new Error("Please pick a role.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email.");

    const clip = (s: string | undefined, n: number) => (s ? s.trim().slice(0, n) || undefined : undefined);
    const id = await ctx.db.insert("jobApplications", {
      role: role.slice(0, 120),
      fullName: fullName.slice(0, 120),
      email: email.slice(0, 160),
      phone: clip(args.phone, 40),
      telegram: clip(args.telegram, 80),
      country: clip(args.country, 80),
      location: clip(args.location, 120),
      portfolioUrl: clip(args.portfolioUrl, 400),
      linkedinUrl: clip(args.linkedinUrl, 400),
      coverLetter: clip(args.coverLetter, 5000),
      resumeStorageId: args.resumeStorageId,
      resumeName: clip(args.resumeName, 200),
      status: "new",
      createdAt: Date.now(),
    });
    return { ok: true, id };
  },
});

/** List applications (newest first) with resolved résumé download URLs — for the
 *  internal/admin submissions view at /hiring/submissions.
 *
 *  SECRET-GATED: these rows carry applicant PII (email/phone/telegram/linkedin)
 *  plus signed résumé download URLs, so this MUST NOT be reachable by an
 *  unauthenticated caller. The browser can no longer call it directly; access
 *  goes through the admin-gated Next route /api/hiring/submissions, which proves
 *  the caller is an admin and then forwards INTERNAL_CRON_SECRET here. */
export const list = query({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    const rows = await ctx.db.query("jobApplications").withIndex("by_created").order("desc").take(300);
    return await Promise.all(
      rows.map(async (a) => ({
        ...a,
        resumeUrl: a.resumeStorageId ? await ctx.storage.getUrl(a.resumeStorageId) : null,
      })),
    );
  },
});
