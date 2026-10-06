import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { verifyToken } from "./lib/supabaseAuth";
import { recordDailyActivity } from "./analytics";
import { grantSignupCredits } from "./userCredits";

// Platform OWNER emails — ALWAYS admin, independent of the ADMIN_SEED_EMAILS env.
// These are the trusted owners (a deliberate superuser constant), NOT an open
// allowlist, so they can't be locked out by an env that's fiddly to change (it
// needs Convex dashboard access). New non-owner admins still go through the env or
// the admin UI's setUserAdmin toggle — this is only the owner floor.
const OWNER_EMAILS = ["zufairyk@gmail.com", "primaliqlabs@gmail.com"];

/** The effective set of admin emails: the owner constant UNIONED with whatever
 *  ADMIN_SEED_EMAILS holds, all lower-cased. Re-read on every sign-in so adding an
 *  email (here or in the env) promotes an already-existing account too. */
function adminEmailSet(): Set<string> {
  const env = (process.env.ADMIN_SEED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set<string>([...OWNER_EMAILS.map((e) => e.toLowerCase()), ...env]);
}

/* ── Internal DB ops (no auth — only called by verified actions) ─────────── */

export const getBySupabaseId = internalQuery({
  args: { supabaseId: v.string() },
  handler: async (ctx, { supabaseId }) =>
    ctx.db
      .query("users")
      .withIndex("by_supabase", (q) => q.eq("supabaseId", supabaseId))
      .first(),
});

export const getById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => ctx.db.get(userId),
});

/** Create or update the user for a verified Supabase profile. Grants admin ONLY
 *  to emails listed in ADMIN_SEED_EMAILS. There is deliberately NO first-user
 *  auto-grant: on a fresh deploy that would let the first stranger to hit the URL
 *  (e.g. an attacker probing it) become admin. */
export const upsertFromSupabase = internalMutation({
  args: {
    supabaseId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { supabaseId, email, name, image }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_supabase", (q) => q.eq("supabaseId", supabaseId))
      .first();

    if (existing) {
      const seedEmailsExisting = adminEmailSet();
      const nextEmail = email ?? existing.email;
      // Re-check the allowlist on every sign-in (not just first insert) so adding
      // an email to OWNER_EMAILS / ADMIN_SEED_EMAILS promotes an already-existing
      // account too — still gated on the trusted allowlist, never an auto-grant.
      const shouldBeAdmin = existing.isAdmin === true
        || (nextEmail ? seedEmailsExisting.has(nextEmail.toLowerCase()) : false);
      await ctx.db.patch(existing._id, {
        email: email ?? existing.email,
        name: name ?? existing.name,
        image: image ?? existing.image,
        lastSeenAt: now,
        isAdmin: shouldBeAdmin,
      });
      // DAU: this whoami counts as the user opening the platform today.
      await recordDailyActivity(ctx, existing._id, now, false);
      return existing._id;
    }

    const seedEmails = adminEmailSet();
    const byEmail = email ? seedEmails.has(email.toLowerCase()) : false;

    const userId = await ctx.db.insert("users", {
      supabaseId,
      email,
      name,
      image,
      isAdmin: byEmail,
      status: "active",
      createdAt: now,
      lastSeenAt: now,
    });
    // DAU + signup: first-ever activity for this brand-new user.
    await recordDailyActivity(ctx, userId, now, true);
    // Fire-and-forget welcome email — only on this true first-insert branch,
    // never on returning-user sign-ins. Wallet-only signups have no email yet
    // (Privy didn't link Google/email), so this quietly no-ops for them.
    if (email) {
      await ctx.scheduler.runAfter(0, internal.email.sendWelcomeEmail, { email, name });
    }
    return userId;
  },
});

/** All wallets linked to a user: the normalized walletLinks rows unioned with
 *  the legacy `users.walletAddress` (so accounts that linked before walletLinks
 *  existed still resolve). De-duplicated, primary first. */
async function listLinkedWallets(
  ctx: { db: QueryCtx["db"] },
  userId: Id<"users">,
  primary?: string,
): Promise<string[]> {
  const links = await ctx.db
    .query("walletLinks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const set = new Set<string>();
  if (primary) set.add(primary);            // legacy / active wallet
  for (const l of links) set.add(l.walletAddress);
  return [...set];
}

export const linkWalletInternal = internalMutation({
  args: { userId: v.id("users"), walletAddress: v.string(), walletType: v.string() },
  handler: async (ctx, { userId, walletAddress, walletType }) => {
    // A wallet may belong to at most one account.
    const owner = await ctx.db
      .query("walletLinks")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();
    if (owner && owner.userId !== userId) {
      throw new Error("This wallet is already linked to another account.");
    }
    // Also guard against a legacy primary on a different user.
    const legacyOwner = await ctx.db
      .query("users")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .first();
    if (legacyOwner && legacyOwner._id !== userId) {
      throw new Error("This wallet is already linked to another account.");
    }

    if (!owner) {
      await ctx.db.insert("walletLinks", {
        userId,
        walletAddress,
        walletType,
        createdAt: Date.now(),
      });
    }
    // Backfill: ensure any pre-existing legacy primary also has a link row.
    const me = await ctx.db.get(userId);
    if (me?.walletAddress && me.walletAddress !== walletAddress) {
      const existingLegacyLink = await ctx.db
        .query("walletLinks")
        .withIndex("by_wallet", (q) => q.eq("walletAddress", me.walletAddress!))
        .first();
      if (!existingLegacyLink) {
        await ctx.db.insert("walletLinks", {
          userId,
          walletAddress: me.walletAddress,
          walletType: me.walletType ?? "external",
          createdAt: Date.now(),
        });
      }
    }
    // Make the just-linked wallet the active/primary one.
    await ctx.db.patch(userId, { walletAddress, walletType });

    // "3 free videos on signup": grant once per USER on their first-ever
    // wallet link (credits are wallet-keyed, so this is the earliest point a
    // grant has somewhere to land). signupCreditsGrantedAt is the idempotency
    // guard — linking more wallets later never re-grants.
    if (me && !me.signupCreditsGrantedAt) {
      await grantSignupCredits(ctx, walletAddress);
      await ctx.db.patch(userId, { signupCreditsGrantedAt: Date.now() });
    }
    return { ok: true };
  },
});

export const unlinkWalletInternal = internalMutation({
  args: { userId: v.id("users"), walletAddress: v.optional(v.string()) },
  handler: async (ctx, { userId, walletAddress }) => {
    if (walletAddress) {
      // Remove just this wallet's link.
      const link = await ctx.db
        .query("walletLinks")
        .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
        .first();
      if (link && link.userId === userId) await ctx.db.delete(link._id);
      // If it was the active/primary, promote another remaining wallet (if any).
      const me = await ctx.db.get(userId);
      if (me?.walletAddress === walletAddress) {
        const remaining = await ctx.db
          .query("walletLinks")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first();
        await ctx.db.patch(userId, {
          walletAddress: remaining?.walletAddress,
          walletType: remaining?.walletType,
        });
      }
      return { ok: true };
    }
    // No address → unlink ALL wallets (legacy behaviour).
    const links = await ctx.db
      .query("walletLinks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);
    await ctx.db.patch(userId, { walletAddress: undefined, walletType: undefined });
    return { ok: true };
  },
});

/** Display name + avatar are the only self-service editable identity fields —
 *  email/wallets are owned by the auth provider (Privy/Supabase), not a plain
 *  text field a user can retype here. */
export const updateProfileInternal = internalMutation({
  args: { userId: v.id("users"), name: v.optional(v.string()), image: v.optional(v.string()) },
  handler: async (ctx, { userId, name, image }) => {
    const patch: Record<string, string> = {};
    if (name !== undefined) {
      const trimmed = name.trim().slice(0, 80);
      if (trimmed) patch.name = trimmed;
    }
    if (image !== undefined) patch.image = image;
    if (Object.keys(patch).length > 0) await ctx.db.patch(userId, patch);
    return { ok: true };
  },
});

export const saveOnboardingInternal = internalMutation({
  args: {
    userId: v.id("users"),
    accountType: v.union(v.literal("personal"), v.literal("business")),
    niche: v.optional(v.string()),
    goal: v.union(
      v.literal("grow_views"),
      v.literal("sell_product"),
      v.literal("build_audience"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, { userId, accountType, niche, goal }) => {
    await ctx.db.patch(userId, {
      accountType,
      niche: niche?.trim().slice(0, 120) || undefined,
      goal,
      onboardingCompletedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const skipOnboardingInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.db.patch(userId, { onboardingSkippedAt: Date.now() });
    return { ok: true };
  },
});

export const listWalletsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await ctx.db.get(userId);
    return listLinkedWallets(ctx, userId, me?.walletAddress ?? undefined);
  },
});

/**
 * PUBLIC query: all Solana wallets linked to the account(s) whose email matches
 * `email` (case-insensitive). Unions `users.walletAddress` (legacy/primary) with
 * every `walletLinks` row, across ALL user rows sharing that email (one email can
 * map to multiple supabaseId rows). Used by the server-side restricted-campaign
 * allow check to resolve the single allowed account's wallet set — it needs to be
 * a `query` (not internalQuery) because a Next route calls it over HTTP via
 * ConvexHttpClient.
 *
 * There is no `by_email` index (email is optional), so this scans the users
 * table; the caller memoizes the result server-side, so the scan runs rarely.
 * Returns only wallet strings — no PII beyond the wallets already public on-chain.
 */
export const walletsForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const target = email.trim().toLowerCase();
    if (!target) return [] as string[];
    const users = await ctx.db.query("users").collect();
    const set = new Set<string>();
    for (const u of users) {
      if ((u.email ?? "").trim().toLowerCase() !== target) continue;
      if (u.walletAddress) set.add(u.walletAddress);
      const links = await ctx.db
        .query("walletLinks")
        .withIndex("by_user", (q) => q.eq("userId", u._id))
        .collect();
      for (const l of links) set.add(l.walletAddress);
    }
    return [...set];
  },
});

/* ── Public actions (verify Supabase token, then act) ───────────────────── */

export type WhoAmI = {
  userId: string;
  email?: string;
  name?: string;
  image?: string;
  isAdmin: boolean;
  status: string;
  /** Active/primary linked wallet (most recently linked). */
  walletAddress?: string;
  /** ALL wallets linked to this account — any of them can transact. */
  walletAddresses: string[];
  /** First-run onboarding — undefined until the operator finishes or skips it. */
  accountType?: "personal" | "business";
  niche?: string;
  goal?: "grow_views" | "sell_product" | "build_audience" | "other";
  onboardingCompletedAt?: number;
  onboardingSkippedAt?: number;
  /** When the account was created (epoch ms). */
  joinedAt?: number;
} | null;

/** Verify the caller's Supabase session, upsert the user, return their profile. */
export const whoami = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<WhoAmI> => {
    // `walletAddress` is the user's Privy wallet (embedded or external); strip it
    // out before the upsert (whose validator only accepts identity fields), then
    // auto-link it so it shows as a linked wallet on the account.
    const { walletAddress, ...profile } = await verifyToken(accessToken);
    const userId = await ctx.runMutation(internal.users.upsertFromSupabase, profile);
    const user = await ctx.runQuery(internal.users.getById, { userId });
    if (!user) return null;
    if (walletAddress) {
      try {
        await ctx.runMutation(internal.users.linkWalletInternal, {
          userId,
          walletAddress,
          walletType: "privy",
        });
      } catch {
        // Wallet already linked to another account — ignore (don't block login).
      }
    }
    const walletAddresses = await ctx.runQuery(internal.users.listWalletsInternal, { userId });
    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      image: user.image,
      isAdmin: user.isAdmin === true,
      status: user.status ?? "active",
      walletAddress: user.walletAddress,
      walletAddresses,
      accountType: user.accountType,
      niche: user.niche,
      goal: user.goal,
      onboardingCompletedAt: user.onboardingCompletedAt,
      onboardingSkippedAt: user.onboardingSkippedAt,
      joinedAt: user.createdAt ?? user._creationTime,
    };
  },
});

export const linkWallet = action({
  args: {
    accessToken: v.string(),
    walletAddress: v.string(),
    walletType: v.optional(v.string()),
  },
  handler: async (ctx, { accessToken, walletAddress, walletType }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    if (!user) throw new Error("User not found");
    return await ctx.runMutation(internal.users.linkWalletInternal, {
      userId: user._id,
      walletAddress,
      walletType: walletType ?? "external",
    });
  },
});

export const unlinkWallet = action({
  args: { accessToken: v.string(), walletAddress: v.optional(v.string()) },
  handler: async (ctx, { accessToken, walletAddress }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    if (!user) throw new Error("User not found");
    return await ctx.runMutation(internal.users.unlinkWalletInternal, { userId: user._id, walletAddress });
  },
});

/** Self-service display-name / avatar edit from the Profile page. Neither field
 *  is required per-call so the caller can patch just one (e.g. avatar-only on
 *  upload, without re-sending the current name). */
export const updateProfile = action({
  args: { accessToken: v.string(), name: v.optional(v.string()), image: v.optional(v.string()) },
  handler: async (ctx, { accessToken, name, image }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    if (!user) throw new Error("User not found");
    return await ctx.runMutation(internal.users.updateProfileInternal, { userId: user._id, name, image });
  },
});

/** Finishes the /home first-run onboarding modal — personal/business, niche,
 *  and stated goal, all captured in one shot on its last step. */
export const completeOnboarding = action({
  args: {
    accessToken: v.string(),
    accountType: v.union(v.literal("personal"), v.literal("business")),
    niche: v.optional(v.string()),
    goal: v.union(
      v.literal("grow_views"),
      v.literal("sell_product"),
      v.literal("build_audience"),
      v.literal("other"),
    ),
  },
  handler: async (ctx, { accessToken, accountType, niche, goal }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    if (!user) throw new Error("User not found");
    return await ctx.runMutation(internal.users.saveOnboardingInternal, { userId: user._id, accountType, niche, goal });
  },
});

/** Dismisses the /home onboarding modal without finishing it — marks it
 *  skipped so it stops auto-triggering, distinct from actually completed. */
export const skipOnboarding = action({
  args: { accessToken: v.string() },
  handler: async (ctx, { accessToken }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    if (!user) throw new Error("User not found");
    return await ctx.runMutation(internal.users.skipOnboardingInternal, { userId: user._id });
  },
});

/** Public display identity for on-chain leaderboard wallets. No account/contact fields. */
export const leaderboardProfiles = query({
  args: { wallets: v.array(v.string()) },
  handler: async (ctx, { wallets }) => {
    if (wallets.length > 100) return [];
    return Promise.all([...new Set(wallets)].map(async wallet => {
      const link = await ctx.db.query("walletLinks").withIndex("by_wallet", q => q.eq("walletAddress", wallet)).first();
      const user = link ? await ctx.db.get(link.userId) : await ctx.db.query("users").withIndex("by_wallet", q => q.eq("walletAddress", wallet)).first();
      return { wallet, name: user?.name, image: user?.image };
    }));
  },
});
