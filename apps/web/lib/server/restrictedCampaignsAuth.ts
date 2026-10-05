import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { RESTRICTED_CAMPAIGN_EMAIL, isAllowedRestrictedEmail } from "@/lib/restrictedCampaigns";

/**
 * SERVER-ONLY authorization for the restricted clipping campaigns.
 *
 * `isAccountAllowedForRestricted` answers: does the acting account (identified by
 * email and/or one or more wallets) belong to the single allowed account
 * (RESTRICTED_CAMPAIGN_EMAIL)? Enforcement points (source-resolve, submit/join)
 * call this ONLY for campaigns `isRestrictedCampaign(...)` already flagged.
 *
 * FAIL CLOSED: when the caller's account cannot be POSITIVELY confirmed as the
 * allowed one (missing email + wallet not in the allowed set, or the allowed-set
 * lookup could not be resolved at all), this returns false → deny.
 *
 * SCOPE / KNOWN LIMIT (raw jobtepi DB read is NOT sealed by this restriction):
 * A jobtepi `content_rewards` row's source URLs live in its `available_content`
 * free-text, which is readable client-side via the PUBLIC, hardcoded Supabase
 * anon key (see `lib/supabase.ts`) — jobtepi treats content_reward data as
 * platform-public. So the restricted campaigns' source links are NOT secret at
 * the DB layer. What THIS restriction enforces is Vello's own surface: UI
 * visibility (pickers hide the 12), source-resolve via /api/clip/campaign-sources
 * (403 for non-allowed), the money/submit boundary (/api/content-rewards/submit +
 * the run-task clip rails), and the public `api.campaigns.list` mirror leak (the
 * Clipping-FR mirror's copied source URLs are blanked). Fully sealing the raw-DB
 * read requires a jobtepi-side RLS policy / restricted view — out of scope here.
 */

let cache: { at: number; wallets: Set<string> } | null = null;
const TTL_MS = 60_000;

/** The allowed account's wallet set (users.walletAddress ∪ walletLinks for the
 *  allowed email), memoized for a short TTL. On a Convex read failure we reuse a
 *  stale cache if present, else return an EMPTY set (deny) and DO NOT cache the
 *  failure — so a transient blip can't lock the allowed account out for the TTL. */
async function getAllowedWallets(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.wallets;
  try {
    const convex = getConvexClient();
    const wallets = (await convex.query(api.users.walletsForEmail, {
      email: RESTRICTED_CAMPAIGN_EMAIL,
    })) as string[] | null;
    const set = new Set<string>((wallets ?? []).map((w) => String(w)).filter(Boolean));
    cache = { at: now, wallets: set };
    return set;
  } catch {
    if (cache) return cache.wallets; // reuse last-known-good on a transient failure
    return new Set<string>();         // never resolved → fail closed (deny)
  }
}

export interface RestrictedAllowOpts {
  /** The acting account's email (from Privy auth), if known. */
  email?: string | null;
  /** A single wallet to test membership for (e.g. a submission's ownerWallet). */
  wallet?: string | null;
  /** Additional wallets to test (e.g. all of the user's Privy-linked wallets). */
  wallets?: (string | null | undefined)[] | null;
}

/**
 * True only when the account is POSITIVELY the allowed one:
 *   1. email fast-path — a matching email is decisive (no Convex round-trip);
 *   2. else any supplied wallet is in the allowed account's resolved wallet set.
 * Anything else (no email match, no wallet match, empty inputs, unresolved set)
 * → false (fail closed).
 */
export async function isAccountAllowedForRestricted(opts: RestrictedAllowOpts): Promise<boolean> {
  if (isAllowedRestrictedEmail(opts.email)) return true;

  const candidates: string[] = [];
  if (opts.wallet) candidates.push(opts.wallet);
  for (const w of opts.wallets ?? []) if (w) candidates.push(w);
  if (candidates.length === 0) return false; // nothing to confirm → deny

  const allowed = await getAllowedWallets();
  if (allowed.size === 0) return false; // couldn't resolve the allowed set → deny
  return candidates.some((w) => allowed.has(w));
}

/** Drop the memoized allowed-wallet set (tests / after the allowed account links
 *  a new wallet and needs it recognized before the TTL elapses). */
export function clearRestrictedAllowCache(): void {
  cache = null;
}
