import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveAdmin } from "./admin";
import {
  CLIP_SKILL_PRICE_USDC,
  MAX_SKILL_PRICE_USDC,
  PRICEABLE_SERVICE_IDS,
  isValidSkillPrice,
  staticUnitPrice,
} from "../lib/economy/servicePrices";

/**
 * Admin-editable marketplace skill pricing.
 *
 * The static per-run skill prices live in lib/economy/servicePrices.ts
 * (CLIP_SKILL_PRICE_USDC). An admin can OVERRIDE any of them via the
 * `skillPriceOverrides` table: a row = an active override, absence = the static
 * default. The single money-computing chokepoint (usage.recordUsage) reads the
 * override here and applies it, so a changed price flows to every metered charge
 * (canvas clip-precheck, cloud clipJobs, autoClip scout) — all of which route
 * their charge through recordUsage. Swept fees land in the platform treasury
 * (NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET) unchanged; only the amount changes.
 *
 * Writes are gated with resolveAdmin(accessToken) — the same Supabase-admin
 * pattern the other admin-dashboard actions use (admin.ts / adminEconomy.ts).
 */

/** Read the admin override unit price for a skill/service id (only if valid).
 *  Undefined = no (valid) override → the caller uses the static default. */
export async function getSkillPriceOverride(
  ctx: QueryCtx | MutationCtx,
  skillId: string,
): Promise<number | undefined> {
  // .first() (not .unique()): the charge path must NEVER throw. Writes go through
  // setSkillPriceData which patches the existing row (serializable txns prevent
  // dupes), but a defensive .first() means a stray duplicate can't break billing.
  const row = await ctx.db
    .query("skillPriceOverrides")
    .withIndex("by_skill", (q) => q.eq("skillId", skillId))
    .first();
  if (!row) return undefined;
  return isValidSkillPrice(row.priceUsdc) ? row.priceUsdc : undefined;
}

/** PUBLIC + non-sensitive: the effective per-run price map (static defaults with
 *  valid admin overrides applied) plus the raw override map. Prices are shown in
 *  the marketplace to every builder, so exposing the effective map is fine; the
 *  ADMIN list (below, with edit metadata) stays gated. Consumed by the
 *  marketplace UI and the clip-precheck / cloud-run cost estimates so the
 *  pre-flight number matches what recordUsage actually charges. */
export const effectiveSkillPrices = query({
  args: {},
  handler: async (ctx): Promise<{ effective: Record<string, number>; overrides: Record<string, number> }> => {
    const rows = await ctx.db.query("skillPriceOverrides").collect();
    const overrides: Record<string, number> = {};
    for (const r of rows) if (isValidSkillPrice(r.priceUsdc)) overrides[r.skillId] = r.priceUsdc;
    const effective: Record<string, number> = { ...CLIP_SKILL_PRICE_USDC };
    // Priceable metered services (e.g. social_post) also carry a static default so
    // a pre-flight estimate matches what the charge path bills after an override.
    for (const id of PRICEABLE_SERVICE_IDS) {
      const def = staticUnitPrice(id);
      if (def !== undefined) effective[id] = def;
    }
    for (const [id, p] of Object.entries(overrides)) effective[id] = p;
    return { effective, overrides };
  },
});

export type SkillPriceRow = {
  skillId: string;
  staticDefaultUsdc: number;
  effectiveUsdc: number;
  overrideUsdc?: number;
  updatedByEmail?: string;
  updatedAt?: number;
};

/** Every priced marketplace skill with its effective price (override ?? static),
 *  the static default (for the "reset" reference), and override edit metadata. */
export const listSkillPricesData = internalQuery({
  args: {},
  handler: async (ctx): Promise<SkillPriceRow[]> => {
    const rows = await ctx.db.query("skillPriceOverrides").collect();
    const byId = new Map(rows.map((r) => [r.skillId, r]));
    // Clip skills PLUS the priceable metered services (e.g. social_post / Auto Post):
    // one static-default entry each, so the admin can override the auto-post fee in
    // the same table. Dedupe defensively in case an id appears in both maps.
    const catalog: Array<[string, number]> = [...Object.entries(CLIP_SKILL_PRICE_USDC)];
    for (const id of PRICEABLE_SERVICE_IDS) {
      if (id in CLIP_SKILL_PRICE_USDC) continue;
      const def = staticUnitPrice(id);
      if (def !== undefined) catalog.push([id, def]);
    }
    return catalog
      .map(([skillId, staticDefaultUsdc]): SkillPriceRow => {
        const o = byId.get(skillId);
        const has = o !== undefined && isValidSkillPrice(o.priceUsdc);
        return {
          skillId,
          staticDefaultUsdc,
          effectiveUsdc: has ? o!.priceUsdc : staticDefaultUsdc,
          ...(has ? { overrideUsdc: o!.priceUsdc, updatedByEmail: o!.updatedByEmail, updatedAt: o!.updatedAt } : {}),
        };
      })
      .sort((a, b) => a.skillId.localeCompare(b.skillId));
  },
});

export const setSkillPriceData = internalMutation({
  args: { skillId: v.string(), priceUsdc: v.number(), updatedByEmail: v.string() },
  handler: async (ctx, { skillId, priceUsdc, updatedByEmail }) => {
    const id = skillId.trim();
    if (!id) throw new Error("skillId is required.");
    // Only allow overriding a KNOWN price id — a clip skill OR a priceable metered
    // service (e.g. social_post). staticUnitPrice resolves both; an unknown id would
    // create a dangling row that charges nothing but clutters the list.
    if (staticUnitPrice(id) === undefined) throw new Error(`Unknown marketplace skill: ${id}`);
    // Validate + clamp: finite, ≥ 0, ≤ cap (fat-finger guard against an absurd charge).
    if (!isValidSkillPrice(priceUsdc)) {
      throw new Error(`Price must be a number between $0 and $${MAX_SKILL_PRICE_USDC}.`);
    }
    const clean = +priceUsdc.toFixed(6);
    const now = Date.now();
    const existing = await ctx.db
      .query("skillPriceOverrides")
      .withIndex("by_skill", (q) => q.eq("skillId", id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { priceUsdc: clean, updatedByEmail, updatedAt: now });
    } else {
      await ctx.db.insert("skillPriceOverrides", { skillId: id, priceUsdc: clean, updatedByEmail, updatedAt: now });
    }
    return { ok: true as const, skillId: id, priceUsdc: clean };
  },
});

export const clearSkillPriceData = internalMutation({
  args: { skillId: v.string() },
  handler: async (ctx, { skillId }) => {
    // Delete every row for the id (unique index makes this at most one) — after
    // this the skill falls back to its static default.
    const rows = await ctx.db
      .query("skillPriceOverrides")
      .withIndex("by_skill", (q) => q.eq("skillId", skillId.trim()))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return { ok: true as const, cleared: rows.length };
  },
});

/* ── Admin-gated public wrappers (Supabase-admin, like admin.ts) ──────────── */

export const listSkillPrices = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<SkillPriceRow[]> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runQuery(internal.adminPricing.listSkillPricesData, {});
  },
});

export const setSkillPrice = action({
  args: { accessToken: v.string(), skillId: v.string(), priceUsdc: v.number() },
  handler: async (ctx, { accessToken, skillId, priceUsdc }): Promise<{ ok: boolean; skillId: string; priceUsdc: number }> => {
    const caller = await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.adminPricing.setSkillPriceData, {
      skillId,
      priceUsdc,
      updatedByEmail: caller.email ?? caller.walletAddress ?? "unknown-admin",
    });
  },
});

export const clearSkillPrice = action({
  args: { accessToken: v.string(), skillId: v.string() },
  handler: async (ctx, { accessToken, skillId }): Promise<{ ok: boolean; cleared: number }> => {
    await resolveAdmin(ctx, accessToken);
    return await ctx.runMutation(internal.adminPricing.clearSkillPriceData, { skillId });
  },
});
