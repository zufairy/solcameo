import type { Doc } from "../_generated/dataModel";

/**
 * Throws unless the given user doc is an active admin. The authoritative
 * server-side gate, applied after a Supabase token has been verified and the
 * user resolved. The client `isAdmin` flag is convenience only.
 */
export function assertAdminUser(user: Doc<"users"> | null): Doc<"users"> {
  if (!user || user.isAdmin !== true || user.status === "suspended") {
    throw new Error("Admin access required");
  }
  return user;
}
