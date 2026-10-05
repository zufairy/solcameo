import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashPassword, mintPasswordToken, verifyPassword } from "./lib/passwordAuth";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getPasswordAuthByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    ctx.db
      .query("passwordAuth")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first(),
});

export const insertPasswordAuth = internalMutation({
  args: { email: v.string(), passwordHash: v.string(), supabaseId: v.string() },
  handler: async (ctx, { email, passwordHash, supabaseId }) => {
    await ctx.db.insert("passwordAuth", { email, passwordHash, supabaseId, createdAt: Date.now() });
  },
});

/** Create an email+password account. Also creates the shared `users` row via
 *  the same upsert Privy login uses, so everything downstream (whoami, wallet
 *  linking, admin) works identically regardless of login method. */
export const passwordSignUp = action({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, password, name }): Promise<{ accessToken: string }> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) throw new Error("Enter a valid email address.");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const existing = await ctx.runQuery(internal.auth.getPasswordAuthByEmail, { email: normalizedEmail });
    if (existing) throw new Error("An account with this email already exists. Try signing in instead.");

    const supabaseId = `password:${crypto.randomUUID()}`;
    const passwordHash = await hashPassword(password);
    await ctx.runMutation(internal.auth.insertPasswordAuth, { email: normalizedEmail, passwordHash, supabaseId });
    await ctx.runMutation(internal.users.upsertFromSupabase, { supabaseId, email: normalizedEmail, name });

    const accessToken = await mintPasswordToken(supabaseId, normalizedEmail);
    return { accessToken };
  },
});

export const passwordSignIn = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<{ accessToken: string }> => {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await ctx.runQuery(internal.auth.getPasswordAuthByEmail, { email: normalizedEmail });
    // Same generic message on "no account" and "wrong password" — don't leak
    // which emails have accounts.
    if (!existing || !(await verifyPassword(password, existing.passwordHash))) {
      throw new Error("Invalid email or password.");
    }

    await ctx.runMutation(internal.users.upsertFromSupabase, {
      supabaseId: existing.supabaseId,
      email: normalizedEmail,
    });

    const accessToken = await mintPasswordToken(existing.supabaseId, normalizedEmail);
    return { accessToken };
  },
});
