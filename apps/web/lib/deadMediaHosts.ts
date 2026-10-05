/**
 * Hosts that no longer serve media. Shared by the browser (avatar fallbacks)
 * and the server (Kie reference normalization, media packs) so a dead URL is
 * treated as "no image" everywhere instead of being fetched, sent to Kie, or
 * rendered as a broken <img>.
 *
 * slmlubxaclmoqxivcurz.supabase.co — the old Supabase project. Quota-restricted
 * since 2026-09-02: every storage/db request answers HTTP 402 "Service for this
 * project is restricted". Avatars, campaign refs and the audio/sfx/gameplay
 * packs lived there; the bytes are gone unless the plan is upgraded. Rows are
 * being re-pointed at R2 (scripts/regenerate-dead-avatars.ts).
 */
export const DEAD_MEDIA_HOSTS = ["slmlubxaclmoqxivcurz.supabase.co"] as const;

export function isDeadMediaUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  return DEAD_MEDIA_HOSTS.some((h) => url.includes(`://${h}/`) || url.endsWith(`://${h}`));
}

/** Filter a list of URLs down to the ones that can still be served. */
export function dropDeadMedia<T extends string | null | undefined>(urls: T[]): Exclude<T, null | undefined>[] {
  return urls.filter((u): u is Exclude<T, null | undefined> => typeof u === "string" && !!u && !isDeadMediaUrl(u));
}
