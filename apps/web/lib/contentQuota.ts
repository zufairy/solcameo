/* Daily posting budget for AUTOMATIC Content Control posts (pure, shared by Convex and the tests).

   X lets one account post 20 times per rolling 24 hours (provider cap). We spend that budget by post type:
     launch        new agent or coin minted   up to 10 a day, spaced 15 minutes apart
     digest        new coins roundup          up to 2 a day, spaced 6 hours apart
     milestone100k a video past 100k views    up to 2 a day, spaced 6 hours apart
     milestone10k  a video past 10k views     1 a day
   Those add up to 13, and automatic posts stop once the account has used 17 of the 20, so
   a manual post always has room. Anything over its quota is not dropped: it waits in the
   queue and goes out at the first free slot (milestones: the highest-viewed one goes first). */

export type PostClass = "launch" | "digest" | "milestone100k" | "milestone10k" | "manual";

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const X_DAILY_CAP = 20;
/** Slots always kept free for manual posts. */
export const MANUAL_RESERVE = 3;
export const POST_LIMITS: Record<PostClass, { perDay: number; gapMs: number }> = {
  launch: { perDay: 10, gapMs: 15 * 60_000 },
  digest: { perDay: 2, gapMs: 6 * HOUR },
  milestone100k: { perDay: 2, gapMs: 6 * HOUR },
  milestone10k: { perDay: 1, gapMs: 0 },
  manual: { perDay: Infinity, gapMs: 0 },
};

export function postClass(post: { source: string; milestoneViews?: number }): PostClass {
  if (post.source === "mint" || post.source === "token") return "launch";
  if (post.source === "digest") return "digest";
  if (post.source === "milestone") return (post.milestoneViews ?? 0) > 100_000 ? "milestone100k" : "milestone10k";
  return "manual";
}

export interface PostedEntry { cls: PostClass; at: number }
export type Slot = { ok: true } | { ok: false; notBefore: number; reason: string };

/** Can an automatic post of `cls` go out now? `history` = posts published (or publishing) by the account. */
export function nextSlot(cls: PostClass, history: PostedEntry[], now: number): Slot {
  if (cls === "manual") return { ok: true };
  const recent = history.filter((h) => h.at > now - DAY).sort((a, b) => a.at - b.at);
  const rule = POST_LIMITS[cls];
  let notBefore = now, reason = "";
  const push = (at: number, why: string) => { if (at > notBefore) { notBefore = at; reason = why; } };

  const mine = recent.filter((h) => h.cls === cls);
  if (mine.length >= rule.perDay) push(mine[mine.length - rule.perDay].at + DAY, `daily limit of ${rule.perDay} reached`);
  const last = mine[mine.length - 1];
  if (last && rule.gapMs && now - last.at < rule.gapMs) push(last.at + rule.gapMs, "spacing out posts");
  const autoBudget = X_DAILY_CAP - MANUAL_RESERVE;
  if (recent.length >= autoBudget) push(recent[recent.length - autoBudget].at + DAY, `keeping ${MANUAL_RESERVE} of X's ${X_DAILY_CAP} daily posts free`);
  return notBefore > now ? { ok: false, notBefore, reason } : { ok: true };
}

/** The provider's own "daily posting cap" rejection — retry later instead of failing the post. */
export const isProviderCapError = (message: string | undefined | null) => /daily posting cap|used_last_24h|posting cap on x|X request failed \(429\)/i.test(message ?? "");
/** When to retry after a provider cap rejection. */
export const providerCapRetryAt = (now: number) => now + HOUR;

/** Of several waiting milestone posts of one class, the one that should take the next slot: most views, then oldest. */
export function bestMilestone<T extends { milestoneViews?: number; createdAt: number }>(candidates: T[]): T | undefined {
  return [...candidates].sort((a, b) => (b.milestoneViews ?? 0) - (a.milestoneViews ?? 0) || a.createdAt - b.createdAt)[0];
}
