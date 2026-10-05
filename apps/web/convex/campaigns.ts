import { query, mutation, internalMutation, internalQuery, action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { consumeSignature } from "./lib/payments";
import { verifyToken } from "./lib/supabaseAuth";
import { assertAdminUser } from "./lib/auth";
import { isRestrictedCampaign } from "../lib/restrictedCampaigns";
import { CLIPPING_FR_ORIGIN } from "../lib/clippingFr";
import { isBudgetSufficient } from "../lib/campaignBudget";
import type { Doc, Id } from "./_generated/dataModel";
import { enqueueVideoMilestone } from "./contentControl";
import { bumpLiveViews } from "./platformStats";

/** The stored `status` is frozen at "open" forever — create() sets it and nothing
 *  transitions it. Derive a real lifecycle for display from the deadline + budget
 *  burn. Pure + no migration. Respects an explicit non-"open" status if one is
 *  ever written. */
function deriveCampaignStatus(c: Doc<"campaigns">): string {
  if (c.status && c.status !== "open") return c.status;
  const spent = c.spentUsdc ?? 0;
  if (c.budget > 0 && spent >= c.budget) return "completed";
  const deadlineMs = Date.parse(c.deadline);
  if (!Number.isNaN(deadlineMs) && deadlineMs < Date.now()) return "ended";
  return "open";
}

function isStageCampaign(c: Doc<"campaigns">): boolean {
  return !!c.pdaAddress?.trim() && (c.onchainVersion ?? 1) >= 2 && c.origin !== CLIPPING_FR_ORIGIN;
}

/** Fields an admin may edit on a campaign BEFORE its escrow is funded. */
const ADMIN_EDITABLE = {
  brandName: v.optional(v.string()),
  title: v.optional(v.string()),
  brief: v.optional(v.string()),
  budget: v.optional(v.number()),
  ratePerThousandViews: v.optional(v.number()),
  rewardPerCompletion: v.optional(v.number()),
  deliverables: v.optional(v.string()),
  deadline: v.optional(v.string()),
  targetNiche: v.optional(v.array(v.string())),
  targetLanguage: v.optional(v.array(v.string())),
  campaignImageUrl: v.optional(v.string()),
  contentFileUrls: v.optional(v.array(v.string())),
  requiredTag: v.optional(v.string()),
  requirements: v.optional(v.array(v.string())),
};

/** Admin-only edit of a campaign that has NOT yet locked its escrow on-chain.
 *  Once `pdaAddress` is set (budget locked), the campaign is immutable. */
export const adminUpdate = action({
  args: { accessToken: v.string(), id: v.id("campaigns"), patch: v.object(ADMIN_EDITABLE) },
  handler: async (ctx, { accessToken, id, patch }): Promise<{ ok: boolean }> => {
    const { supabaseId } = await verifyToken(accessToken);
    const user = await ctx.runQuery(internal.users.getBySupabaseId, { supabaseId });
    assertAdminUser(user); // throws "admin access required" if not an active admin
    return await ctx.runMutation(internal.campaigns.adminPatchInternal, { id, patch });
  },
});

export const adminPatchInternal = internalMutation({
  args: { id: v.id("campaigns"), patch: v.object(ADMIN_EDITABLE) },
  handler: async (ctx, { id, patch }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("campaign not found");
    if (campaign.pdaAddress) {
      throw new Error("Escrow is already funded — this campaign can no longer be edited.");
    }
    // Drop undefined keys so we only patch fields the editor actually changed.
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    if (Object.keys(clean).length > 0) await ctx.db.patch(id, clean);
    return { ok: true as const };
  },
});

/** Owner edits to an unfunded draft are forwarded only by the SIWS-gated API. */
export const updateDraft = mutation({
  args: { authSecret: v.string(), id: v.id("campaigns"), patch: v.object(ADMIN_EDITABLE) },
  handler: async (ctx, { authSecret, id, patch }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.pdaAddress) throw new Error("Funded campaigns cannot be edited");
    const budget = patch.budget ?? campaign.budget;
    const rate = patch.ratePerThousandViews ?? campaign.ratePerThousandViews;
    if (!Number.isFinite(budget) || budget <= 0 || (campaign.campaignType === "marketing" && (!Number.isFinite(rate) || rate <= 0 || !isBudgetSufficient(budget, rate, campaign.campaignType)))) {
      throw new Error("Budget must cover at least one view reward");
    }
    if (patch.title !== undefined && !patch.title.trim()) throw new Error("Title is required");
    if (patch.brief !== undefined && !patch.brief.trim()) throw new Error("Brief is required");
    const deadline = patch.deadline ?? campaign.deadline;
    const deadlineMs = Date.parse(deadline);
    if (!Number.isFinite(deadlineMs) || deadlineMs < Date.now() + 6 * 60 * 60 * 1000) throw new Error("Deadline must be at least six hours from now");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    await ctx.db.patch(id, clean);
    return { ok: true as const };
  },
});

// RESIDUAL (left public, ungated): both are called directly from the browser
// (campaign-form + campaign-detail useMutation) during campaign image upload, so they
// can't carry the internal secret. generateUploadUrl mints a short-lived, single-use
// Convex upload URL (no data exposure; worst case is anonymous blob upload — bounded by
// Convex storage limits); getStorageUrl only resolves a storageId the caller already
// holds to its public URL. Low value; left open to keep the campaign upload UX working.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getStorageUrl = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId as `_storage/${string}`);
  },
});

/** One-off repair: overwrite a campaign's media URLs. Used to re-point migrated
 *  campaigns whose images were uploaded to a previous (local) Convex deployment
 *  and re-uploaded to this one.
 *  INTERNAL-ONLY: as a public mutation this let anyone with the Convex URL
 *  overwrite ANY campaign's image/source media by id (and re-point the clip
 *  pipeline at attacker content). It has no app caller, so it is gated to trusted
 *  server/Convex code only; funded campaigns stay immutable (mirrors adminPatchInternal). */
export const setMediaUrls = internalMutation({
  args: {
    id: v.id("campaigns"),
    campaignImageUrl: v.optional(v.string()),
    contentFileUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, campaignImageUrl, contentFileUrls }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("campaign not found");
    if (campaign.pdaAddress) {
      throw new Error("Escrow is already funded — this campaign can no longer be edited.");
    }
    const patch: Record<string, unknown> = {};
    if (campaignImageUrl !== undefined) patch.campaignImageUrl = campaignImageUrl;
    if (contentFileUrls !== undefined) patch.contentFileUrls = contentFileUrls;
    await ctx.db.patch(id, patch);
    return id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Bounded so it can't exceed Convex's per-query read limit as campaigns grow.
    const rows = await ctx.db.query("campaigns").order("desc").take(2000);
    // RESTRICTED campaigns: this query is UNAUTHENTICATED and exposes source URLs
    // (contentLinks + contentFileUrls). A restricted reward's "Clipping FR" MIRROR
    // campaign copies the real jobtepi source URLs into those fields, so a raw
    // `api.campaigns.list` call would leak the 12 restricted campaigns' sources to
    // anyone. Blank the source fields on restricted rows.
    //
    // Safe for the ALLOWED user: their real clip flow for these rewards does NOT
    // read these contentLinks — CampaignSourcePicker sources the restricted 12
    // from the Stage content_reward list and resolves them through the GATED
    // /api/clip/campaign-sources route (which the allowed account passes and which
    // reads jobtepi `available_content` directly). The blanked mirror simply drops
    // out of the redundant "Web3 · …" Convex list; the same campaign stays wireable
    // via its "Clipping · …" Stage entry. The admin mirror planner keys off
    // contentRewardId/origin/pdaAddress (see MirrorCampaignRow), never these source
    // fields, so dedup/resume is unaffected.
    //
    // preferUuid: match ONLY the real restricted rows (by their known
    // contentRewardId) — a genuinely DIFFERENT public campaign that merely shares
    // a normalized title with one of the 12 keeps its own sources (FIX 3).
    return rows.map((c) =>
      isRestrictedCampaign({ contentRewardId: c.contentRewardId, title: c.title, preferUuid: true })
        ? { ...c, contentLinks: [], contentFileUrls: [] }
        : c,
    );
  },
});

/** Public Stage inventory: only finalized, on-chain v2 campaigns. The unfiltered
 * `list` query remains for owners, admin tools, and background jobs. */
export const listStage = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("campaigns").order("desc").take(2000);
    return rows.filter(isStageCampaign).map((c) =>
      isRestrictedCampaign({ contentRewardId: c.contentRewardId, title: c.title, preferUuid: true })
        ? { ...c, contentLinks: [], contentFileUrls: [] }
        : c,
    );
  },
});

export const getById = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/** Stage detail cannot open an unfunded draft or a legacy mirror through a
 * guessed URL. Other internal/owner workflows may still use getById. */
export const getStageById = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign || !isStageCampaign(campaign)) return null;
    return isRestrictedCampaign({ contentRewardId: campaign.contentRewardId, title: campaign.title, preferUuid: true })
      ? { ...campaign, contentLinks: [], contentFileUrls: [] }
      : campaign;
  },
});

/** The FUNDED on-chain USDC treasury campaign linked to a jobtepi/ryze
 *  content_reward, or null. Returns a campaign ONLY if it can actually pay USDC:
 *  it has a locked vault (`pdaAddress`) AND is on the on-chain rail
 *  (`onchainVersion >= 2`). The clip pipeline calls this to decide whether an
 *  agent's content-reward clip should ALSO create a Convex submission (the USDC
 *  money rail). No funded treasury → null → the clip just lands in ryze
 *  (display) and NO unbacked NAV is credited. Internal-only (clipJobs action). */
export const getFundedByContentRewardId = internalQuery({
  args: { contentRewardId: v.string() },
  handler: async (ctx, { contentRewardId }) => {
    if (!contentRewardId) return null;
    // Scan ALL campaigns linked to this content_reward and return the FUNDED v2
    // one. Pay USDC only from a locked, on-chain-rail treasury (pdaAddress AND
    // onchainVersion>=2) — a v1/unfunded link must NOT create a Convex submission
    // (markVerified would credit unbacked NAV). Scanning (not `.first()`) means a
    // stray unfunded/v1 row that happens to share this contentRewardId can never
    // shadow the funded vault and silently short the agent. Bounded: a
    // content_reward has at most a handful of linked campaigns.
    for await (const c of ctx.db
      .query("campaigns")
      .withIndex("by_content_reward", (q) => q.eq("contentRewardId", contentRewardId))) {
      if (c.pdaAddress && (c.onchainVersion ?? 1) >= 2) {
        return { _id: c._id, creatorWallet: c.creatorWallet, onchainVersion: c.onchainVersion ?? null };
      }
    }
    return null;
  },
});

/** Internal: the source links a campaign pre-transcribe pass needs (campaignTranscribe.pretranscribe). */
export const getSourcesInternal = internalQuery({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get(id);
    if (!c) return null;
    return {
      campaignType: c.campaignType,
      contentLinks: c.contentLinks ?? [],
      contentFileUrls: c.contentFileUrls ?? [],
    };
  },
});

/**
 * Internal: enumerate every CLIPPING campaign that qualifies for transcript
 * pre-processing — `campaignType === "marketing"` AND at least one source
 * (a pasted `contentLinks` URL or a resolved `contentFileUrls` upload).
 *
 * Used by `campaignTranscribe.backfillAll` to schedule a `pretranscribe` pass
 * over campaigns that were created before pre-transcribe-on-create existed.
 * Returns only ids + a flag so the caller stays small. `onlyOpen` restricts to
 * still-running campaigns (status "open"); the `by_status` index keeps that path
 * cheap.
 */
export const listClippingForBackfill = internalQuery({
  args: { onlyOpen: v.optional(v.boolean()) },
  handler: async (ctx, { onlyOpen }) => {
    const rows = onlyOpen
      ? await ctx.db
          .query("campaigns")
          .withIndex("by_status", (q) => q.eq("status", "open"))
          .collect()
      : await ctx.db.query("campaigns").collect();

    return rows
      .filter(
        (c) =>
          c.campaignType === "marketing" &&
          (((c.contentLinks?.length ?? 0) > 0) || ((c.contentFileUrls?.length ?? 0) > 0)),
      )
      .map((c) => ({ id: c._id, status: c.status }));
  },
});

export const listByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
  },
});

/** Unfunded campaign drafts for a creator — launches that never completed the
 *  escrow deposit (no on-chain vault yet). Used by the launch wizard to offer a
 *  Resume instead of silently re-creating (which is what double-charged users). */
export const listDraftsByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .collect();
    return rows.filter(
      (c) => !c.pdaAddress && (c.onchainVersion ?? 1) < 2 && c.status === "open",
    );
  },
});

/** Multi-wallet twin of listByCreator — unions a user's full linked-wallet set so
 *  the dashboard surfaces campaigns regardless of which wallet is currently
 *  resolved (same identity fix as influencers.listByCreators). Dedupes by id and
 *  maps a DERIVED status onto each row (the stored status is permanently "open"). */
export const listByCreators = query({
  args: { creatorWallets: v.array(v.string()) },
  handler: async (ctx, { creatorWallets }) => {
    const wallets = [...new Set(creatorWallets.filter(Boolean))];
    const seen = new Set<string>();
    const out: Doc<"campaigns">[] = [];
    for (const w of wallets) {
      const rows = await ctx.db
        .query("campaigns")
        .withIndex("by_creator", (q) => q.eq("creatorWallet", w))
        .collect();
      for (const c of rows) {
        if (seen.has(c._id)) continue;
        seen.add(c._id);
        out.push({ ...c, status: deriveCampaignStatus(c) });
      }
    }
    return out;
  },
});

/** Cap on the combined contentLinks + contentFileUrls a single create call may
 *  persist. `create` is a PUBLIC mutation (campaigns are creatable pre-login), and
 *  each stored source is fanned out to the PAID STT vendor by `pretranscribe`, so
 *  an uncapped array = unbounded paid work per call. 100 comfortably covers legit
 *  clipping campaigns (a channel expands to ~5; a Drive folder link re-expands
 *  server-side, so the raw link — not the whole expanded list — is what matters). */
const MAX_CAMPAIGN_SOURCES = 100;

export const create = mutation({
  args: {
    creatorWallet: v.string(),
    brandName: v.string(),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    /** Optional MARKETING per-submission payout cap (USDC). No single submission's
     *  rate×views payout may exceed this; enforced in computePayoutUsdc at settle. */
    maxPayoutUsdc: v.optional(v.number()),
    campaignType: v.optional(v.string()),
    rewardPerCompletion: v.optional(v.number()),
    agentTaskCategory: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    contentLinks: v.optional(v.array(v.string())),
    /** Pre-resolved per-video URLs (e.g. a Drive FOLDER Reference link expanded on
     *  the campaign form) merged with the storage-resolved uploads below, de-duped. */
    contentFileUrls: v.optional(v.array(v.string())),
    sourceRightsConfirmed: v.optional(v.boolean()),
    requiresProfileCta: v.optional(v.boolean()),
    contentFileStorageIds: v.optional(v.array(v.string())),
    campaignImageStorageId: v.optional(v.string()),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    platforms: v.optional(v.array(v.string())),
    requiredTag: v.optional(v.string()),
    /** MANDATORY requirements every agent post/clip for this campaign must obey.
     *  Cleaned (trimmed, empties dropped, capped) + enforced non-empty below. */
    requirements: v.optional(v.array(v.string())),
    deadline: v.string(),
    pdaAddress: v.optional(v.string()),
    /** Link this campaign's USDC treasury to a jobtepi/ryze content_reward so an
     *  agent clipping that content_reward is paid from this vault. */
    contentRewardId: v.optional(v.string()),
    /** On-chain rail version set at create time. undefined/1 = legacy off-chain.
     *  2 = on-chain treasury rail (passed from the form if the escrow step happens
     *  inline with create, or set later via updateCampaignPda on escrow success). */
    onchainVersion: v.optional(v.number()),
    /** Provenance marker (e.g. "clipping_fr" for jobtepi clipping mirrors). */
    origin: v.optional(v.string()),
    /** Board tab this organic campaign lists under on /stage: ugc|clipping (the
     *  Web3 board was removed). Normalized to the allow-list below (fallback
     *  "clipping"). Display-only. */
    category: v.optional(v.string()),
    /** Pre-resolved image URL for callers that don't upload to Convex storage
     *  (the Clipping FR mirror reuses the jobtepi thumbnail URL directly).
     *  campaignImageStorageId, when present, takes precedence. */
    campaignImageUrl: v.optional(v.string()),
    /** A live SIWS session token (H09/BUG-032). The row insert stays OPEN (campaigns
     *  are creatable pre-login), but the PAID side-effect (pretranscribe /
     *  autoLinkContentReward, which POST attacker-supplied URLs to the STT vendor)
     *  is only scheduled when the caller presents one. The Next campaign form threads
     *  the token it already minted (ensureSiwsSession runs BEFORE create); a raw
     *  Convex client bypassing the app has no session and cannot trigger paid work.
     *  Never persisted (stripped before insert). */
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // MANDATORY: at least one non-empty requirement. Clean (trim + drop empties),
    // cap at 20 so a pathological caller can't bloat the row, then enforce non-empty.
    const cleanReqs = (args.requirements ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 20);
    if (cleanReqs.length === 0) throw new Error("At least one campaign requirement is required.");

    // MONEY-SAFETY (defense-in-depth): a marketing campaign priced per-1K-views
    // must deposit at least one 1,000-view payout (budget >= rate), else the
    // treasury can never pay out and the user's locked USDC is stranded. The
    // client blocks this BEFORE moving funds; reject here too so a forged/direct
    // call can't create an unpayable (but potentially funded) campaign row.
    if (!isBudgetSufficient(args.budget, args.ratePerThousandViews, args.campaignType ?? "")) {
      throw new Error(
        "Budget must be at least the per-1K rate — the treasury must cover at least one 1,000-view payout.",
      );
    }

    // Sanitize the optional per-submission cap: keep only a positive finite number
    // (and only meaningful for marketing — the client omits it otherwise).
    const maxPayoutUsdc =
      typeof args.maxPayoutUsdc === "number" && Number.isFinite(args.maxPayoutUsdc) && args.maxPayoutUsdc > 0
        ? args.maxPayoutUsdc
        : undefined;

    const brandLogoUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(args.brandName)}&backgroundColor=1a1a2e`;

    // Resolve Convex storage IDs to permanent URLs. A pre-resolved
    // campaignImageUrl arg (e.g. the Clipping FR mirror reusing a jobtepi
    // thumbnail) seeds the value; a storage upload takes precedence.
    let campaignImageUrl: string | undefined = args.campaignImageUrl;
    if (args.campaignImageStorageId) {
      campaignImageUrl = (await ctx.storage.getUrl(args.campaignImageStorageId as Id<"_storage">)) ?? campaignImageUrl;
    }

    const contentFileUrls: string[] = [];
    // Caller-supplied resolved URLs first (Drive-folder videos expanded on the
    // campaign form), then the storage-resolved uploads — de-duped, blanks dropped.
    const seenFileUrls = new Set<string>();
    for (const raw of args.contentFileUrls ?? []) {
      const u = raw.trim();
      if (u && !seenFileUrls.has(u)) {
        seenFileUrls.add(u);
        contentFileUrls.push(u);
      }
    }
    for (const sid of args.contentFileStorageIds ?? []) {
      const url = await ctx.storage.getUrl(sid as Id<"_storage">);
      if (url && !seenFileUrls.has(url)) {
        seenFileUrls.add(url);
        contentFileUrls.push(url);
      }
    }

    // Normalize the board category to the allow-list so a forged/bad value can't
    // mis-file a campaign into an unreachable tab (display-only, so no gate needed
    // beyond the enum). The Web3 board has been removed, so "web3" is no longer an
    // allowed category — a "web3"/absent/invalid value falls back to "clipping" (a
    // valid, visible tab) so no new campaign can be created onto the dead Web3 tab.
    // Clipping FR mirrors don't pass a category and route via `origin` instead, so
    // this fallback never affects them.
    const ALLOWED_CATEGORIES = ["ugc", "clipping"];
    const normalizedCategory = ALLOWED_CATEGORIES.includes((args.category ?? "").toLowerCase())
      ? (args.category as string).toLowerCase()
      : "clipping";

    // Cap combined sources (H09/BUG-032) so a single PUBLIC create call can't fan
    // out UNBOUNDED paid pretranscribe work. contentLinks take priority (they
    // include the re-expandable Drive-folder / YouTube-channel provenance links the
    // server re-expands anyway); contentFileUrls fill the remaining budget. Mirrors
    // the existing cleanReqs.slice(0, 20) pattern.
    const cappedContentLinks = (args.contentLinks ?? []).slice(0, MAX_CAMPAIGN_SOURCES);
    const cappedContentFileUrls = contentFileUrls.slice(
      0,
      Math.max(0, MAX_CAMPAIGN_SOURCES - cappedContentLinks.length),
    );

    // Strip the transient storage-ID fields; only resolved URLs are persisted.
    // `category` is re-set explicitly (normalized) below. The raw `contentFileUrls`/
    // `contentLinks` args are dropped here too — the merged+de-duped, CAPPED locals
    // are what's written on the insert. `sessionToken` is a transient auth signal
    // (H09/BUG-032) and is NEVER persisted.
    //
    // FAIL-CLOSED (C2 auth hole): this is a PUBLIC mutation, so a raw client could
    // pass `pdaAddress` + `onchainVersion:2` — together the FUNDED-vault predicate in
    // getFundedByContentRewardId (which routes an agent's content-reward clip + USDC
    // to a row where `pdaAddress && onchainVersion>=2`). Strip both here so a created
    // row is ALWAYS born v1/unfunded; funded v2 is set ONLY later by the secret+SIWS-
    // gated updateCampaignPda, after the on-chain deposit is proven. (`contentRewardId`
    // stays — a link is harmless without the pda+version pair.) The args validator
    // still accepts these keys for backwards compatibility; they are just never
    // persisted from the public path.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contentFileStorageIds, campaignImageStorageId, category, contentFileUrls: _rawContentFileUrls, contentLinks: _rawContentLinks, pdaAddress: _forgedPda, onchainVersion: _forgedOnchainVersion, sessionToken: _sessionToken, ...rest } = args;

    const campaignId = await ctx.db.insert("campaigns", {
      ...rest,
      // Override the raw arg with the sanitized cap (undefined drops it).
      maxPayoutUsdc,
      brandLogoUrl,
      campaignImageUrl,
      category: normalizedCategory,
      contentLinks: cappedContentLinks.length > 0 ? cappedContentLinks : undefined,
      contentFileUrls: cappedContentFileUrls.length > 0 ? cappedContentFileUrls : undefined,
      // Persist the CLEANED requirements (the raw `...rest.requirements` is
      // overridden here so trimmed/capped entries are what's stored).
      requirements: cleanReqs,
      status: "open",
      submissionsCount: 0,
    });

    // Pre-transcribe a CLIPPING campaign's sources into the shared transcript
    // cache (Feature E) so the first agent to clip it doesn't pay the cold STT
    // cost. Clipping campaign = marketing type WITH at least one contentLink.
    // Fire-and-forget via the scheduler; the route caches by sourceKey, so this
    // is idempotent and safe to re-run. (contentFileUrls are also handled inside
    // pretranscribe — the gate here only needs one source present.)
    //
    // SESSION GATE (H09/BUG-032): the PAID side-effect below (each source is POSTed
    // to the STT vendor by pretranscribe) is scheduled ONLY when the caller presents
    // a live-session token. The Next campaign form always has one (ensureSiwsSession
    // runs before create); a raw Convex client bypassing the app does not, so it can
    // create a row (that stays open) but cannot trigger free unmetered transcription.
    const hasLinks = cappedContentLinks.length > 0;
    const hasFiles = cappedContentFileUrls.length > 0;
    const hasSession = typeof args.sessionToken === "string" && args.sessionToken.trim().length > 0;
    if (args.campaignType === "marketing" && (hasLinks || hasFiles) && hasSession) {
      await ctx.scheduler.runAfter(0, internal.campaignTranscribe.pretranscribe, { campaignId });
    }

    return campaignId;
  },
});

export const updateCampaignPda = mutation({
  // SECRET-GATED: previously "authorized" by comparing a client-supplied
  // `callerWallet` to campaign.creatorWallet — but creatorWallet is PUBLIC data,
  // so an attacker just passes the real creator's address and hijacks the
  // campaign's PDA/onchainVersion (IDOR, E2E hunt #13). Reach it ONLY through
  // /api/campaigns/set-pda, which proves ownership (SIWS or the on-chain create
  // tx) before forwarding the internal secret. Also persists the FINALIZED
  // on-chain terms (budget/rate/deadline) so a retried deposit that re-read live
  // form state can't leave the Convex row diverged from the vault (#16).
  args: {
    id: v.id("campaigns"),
    pdaAddress: v.string(),
    authSecret: v.string(),
    // When the campaign was created on the NEW on-chain treasury rail (real
    // rate + deadline locked), the caller sets onchainVersion:2 so the oracle
    // records performance on-chain and the claim keeper cranks payout. Omitted/
    // 1 keeps a campaign on the legacy off-chain rail.
    onchainVersion: v.optional(v.number()),
    /** Optionally link the funded v2 vault to a jobtepi/ryze content_reward.
     *  Set by the form's escrow-success path when it knows the contentRewardId
     *  (explicit pick or resolved from the campaign's source URL). If provided,
     *  only writes when the campaign does not yet have a contentRewardId so that
     *  the autoLinkContentReward action (which may run concurrently) cannot
     *  overwrite a deliberate choice. */
    contentRewardId: v.optional(v.string()),
    /** The exact economic terms actually locked on-chain by createCampaignTx,
     *  persisted so the Convex row mirrors the vault (fixes retry-divergence). */
    budget: v.optional(v.number()),
    ratePerThousandViews: v.optional(v.number()),
    deadline: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { id, pdaAddress, authSecret, onchainVersion, contentRewardId, budget, ratePerThousandViews, deadline },
  ) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    // MONEY-SAFETY (H06/BUG-029): Convex `v.number()` accepts non-finite floats
    // (Infinity from JSON.parse("1e400")) and negatives, which corrupt payout math
    // (Infinity - Infinity = NaN) for every submitter on this campaign. This mutation
    // is the last line of defense for the DB write, so reject junk economic terms
    // here — mirrors isBudgetSufficient's own "reject NaN/Infinity" guard and the
    // Number.isFinite checks on every sibling money route (topup, withdraw, ...).
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 0))
      throw new Error("budget must be a non-negative finite number");
    if (ratePerThousandViews !== undefined && (!Number.isFinite(ratePerThousandViews) || ratePerThousandViews < 0))
      throw new Error("ratePerThousandViews must be a non-negative finite number");
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    await ctx.db.patch(id, {
      pdaAddress,
      ...(onchainVersion !== undefined ? { onchainVersion } : {}),
      // Only write contentRewardId when it isn't already set (don't overwrite an
      // explicit choice with a freshly resolved match from the escrow path).
      ...(contentRewardId && !campaign.contentRewardId ? { contentRewardId } : {}),
      // Persist the finalized on-chain terms so the row can't diverge from the vault.
      ...(budget !== undefined ? { budget } : {}),
      ...(ratePerThousandViews !== undefined ? { ratePerThousandViews } : {}),
      ...(deadline !== undefined ? { deadline } : {}),
    });
  },
});

export const markReclaimed = mutation({
  // SECRET-GATED best-effort mirror of an on-chain `refund_remaining` (the creator
  // sweeping the unspent escrow back after expiry). Records the refund tx signature
  // so the campaign page + admin history reflect the reclaimed state across reloads.
  // The ON-CHAIN refund is the source of truth (it re-checks the deadline+grace and
  // the creator seed, and sets the vault status to Closed); this write is
  // NON-AUTHORITATIVE and moves no money. Reach it ONLY through
  // /api/campaigns/reclaim, which SIWS-proves the caller owns the campaign's creator
  // wallet before forwarding the internal secret (never trusts a client field).
  args: {
    id: v.id("campaigns"),
    refundTxSignature: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, refundTxSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    // Idempotent: keep the FIRST recorded refund signature. A second reclaim can't
    // move money anyway (the vault is empty and the on-chain status is Closed), so
    // never overwrite the original tx with a later no-op sweep.
    if (campaign.refundTxSignature) return;
    await ctx.db.patch(id, { refundTxSignature, refundedAt: Date.now() });
  },
});

/** Internal: set `contentRewardId` on a campaign when it isn't already linked.
 *  Called by the `autoLinkContentReward` Convex action after it resolves the
 *  campaign's source URLs against active clipping content rewards. */
export const patchContentRewardId = internalMutation({
  args: { campaignId: v.id("campaigns"), contentRewardId: v.string() },
  handler: async (ctx, { campaignId, contentRewardId }) => {
    const c = await ctx.db.get(campaignId);
    if (!c || c.contentRewardId) return; // not found or already linked — no-op
    await ctx.db.patch(campaignId, { contentRewardId });
  },
});

export const topUpBudget = mutation({
  // SECRET-GATED: inflates a campaign's off-chain budget. Ungated (as it was),
  // anyone could pass a fabricated txSignature + arbitrary amount and inflate ANY
  // campaign's budget/NAV (E2E hunt #6/7/12/15 — the client wallet + amount were
  // never verified). Reach it ONLY through /api/campaigns/topup, which verifies
  // the on-chain USDC deposit (amount + destination vault + sender) before
  // forwarding the internal secret and the SERVER-verified amount.
  args: {
    id: v.id("campaigns"),
    amount: v.number(),
    txSignature: v.string(),
    callerWallet: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, amount, txSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    if (!(amount > 0)) throw new Error("Invalid amount");
    // Single-use proof: a replayed txSignature cannot top up the budget again (JOB-85).
    await consumeSignature(ctx, {
      txSignature,
      purpose: "campaign_topup",
      ref: id,
      amount,
    });
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    await ctx.db.patch(id, { budget: campaign.budget + amount });
    return { newBudget: campaign.budget + amount, txSignature };
  },
});

// INTERNAL-ONLY: bumps a campaign's submissionsCount. The only callers are the
// submissions.* mutations (via ctx.runMutation), so this is internalMutation now —
// a public+ungated version let anyone inflate any campaign's submission counter.
export const incrementSubmissions = internalMutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("Campaign not found");
    await ctx.db.patch(id, {
      submissionsCount: campaign.submissionsCount + 1,
    });
  },
});

/**
 * Delete a campaign (and cascade-remove its submissions so none are orphaned).
 * Wired to the trash control on campaign cards for quick cleanup.
 */
/**
 * ARCHIVE a campaign — retire it from every board without destroying anything.
 *
 * Deleting was the only way to get a campaign off the boards, and `remove`
 * cascade-deletes its submissions; for a FUNDED campaign that also orphans the
 * on-chain vault, since the row carrying its address is what the reclaim flow reads.
 * Meanwhile `adminPatchInternal` refuses any funded campaign outright, so a funded
 * campaign could not be retired AT ALL — it stayed in every picker forever, which is
 * exactly the "I deleted it and it's still there" complaint.
 *
 * Setting the status to "closed" is enough: every surface treats a terminal status as
 * gone (lib/campaignVisibility). The row, its submissions and its vault address all
 * survive, so `canReclaim` — which never looked at status — still lets the creator
 * pull their USDC back.
 *
 * SECRET-GATED; reach it through /api/campaigns/archive, which SIWS-proves ownership.
 */
export const archive = mutation({
  args: { id: v.id("campaigns"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const campaign = await ctx.db.get(id);
    if (!campaign) throw new Error("campaign not found");
    await ctx.db.patch(id, { status: "closed" });
    return { ok: true as const, reclaimable: !!campaign.pdaAddress };
  },
});

export const remove = mutation({
  // SECRET-GATED: cascade-deletes a campaign + ALL its submissions (destroying the
  // payout/attestation audit trail). Ungated, anyone could delete any campaign.
  // Reach it only through /api/campaigns/delete, which SIWS-proves the caller owns
  // the campaign before forwarding the internal secret.
  args: { id: v.id("campaigns"), authSecret: v.string() },
  handler: async (ctx, { id, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    for (const s of subs) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
    return { ok: true, removedSubmissions: subs.length };
  },
});

/**
 * Compute the USDC payout owed for an approved submission.
 *
 * Pricing model: `ratePerThousandViews` USDC per 1,000 platform views, clamped
 * to the campaign's remaining budget so a single submission can never drain more
 * than is available. Returns 0 when there are no views or no rate configured.
 */
export function computePayoutUsdc(
  viewCount: number,
  ratePerThousandViews: number,
  remainingBudget: number,
  maxPayoutUsdc?: number,
): number {
  if (viewCount <= 0 || ratePerThousandViews <= 0) return 0;
  const raw = (viewCount / 1000) * ratePerThousandViews;
  // FLOOR to 6 decimals (USDC base-unit precision) before clamping to budget.
  // The on-chain accrual truncates (floor) — `Math.round` could promise 1 base
  // unit MORE than claim_payout ever disburses, leaving a permanently-unpaid
  // 0.000001 dust on every claim. Floor keeps the off-chain estimate ≤ the
  // on-chain floored amount, so the mirror never over-promises.
  const floored = Math.floor(raw * 1e6) / 1e6;
  // Per-submission MAX PAYOUT (marketing cap): a single submission never earns
  // more than the creator's configured maximum, no matter how many views it gets.
  // Applied BEFORE the remaining-budget clamp so the cap always binds first.
  const capped =
    typeof maxPayoutUsdc === "number" && maxPayoutUsdc > 0
      ? Math.min(floored, maxPayoutUsdc)
      : floored;
  return Math.max(0, Math.min(capped, Math.max(0, remainingBudget)));
}

/**
 * Oracle entry point (JOB-51): record a verifier attestation against a Vello
 * submission. Called by the `/oracle/attestation` HTTP webhook after the oracle
 * has pushed the on-chain `attest_submission` transaction.
 *
 * - "rejected"  → marks the submission rejected, no payout.
 * - "approved"  → marks it verified, records the view count, and computes the
 *                 USDC payout owed (released later by the on-chain payout rail).
 *
 * Idempotent: a submission that has already been verified/rejected is returned
 * unchanged so webhook retries are safe.
 */
export const markVerified = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    viewCount: v.number(),
    scoreHash: v.optional(v.string()),
    attestationTx: v.optional(v.string()),
    // Set TRUE only by the `/oracle/attestation` webhook path (convex/http.ts).
    // For an on-chain (v2) campaign the oracle WORKER (`settleFromOracle`, which
    // produces the real on-chain attestationTx via record_performance) must be the
    // SOLE driver of settlement — a webhook-driven markVerified would write a
    // divergent/empty attestationTx and strand the claim. So a v2 webhook call is
    // a no-op skip; the worker (which does NOT pass viaWebhook) still settles v2.
    viaWebhook: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");

    // Idempotency: don't re-process a submission the oracle already settled.
    if (
      submission.verificationDecision === "approved" ||
      submission.verificationDecision === "rejected"
    ) {
      return {
        alreadyProcessed: true,
        status: submission.status,
        payoutAmountUsdc: submission.payoutAmountUsdc ?? 0,
      };
    }

    const campaign = await ctx.db.get(submission.campaignId);
    if (!campaign) throw new Error("Campaign not found");

    // v2 webhook deferral: the on-chain rail is driven SOLELY by the oracle worker
    // (settleFromOracle), which carries the real on-chain attestationTx. A webhook
    // call for a v2 submission must NOT settle/mirror (it would write a divergent
    // or empty attestationTx). Return early WITHOUT mutating. v1 webhook path and
    // the worker path (viaWebhook unset) are unaffected.
    if (args.viaWebhook === true && (campaign.onchainVersion ?? 1) >= 2) {
      return { ok: false as const, skipped: "v2 handled by oracle worker" as const };
    }

    // Transition gate: v1 (undefined/1) = legacy off-chain — markVerified is the
    // payer (schedules distributions.dispatch → NAV credit). v2 = on-chain
    // treasury — the vault holds the budget; payout + NAV credit happen in the
    // claim keeper AFTER claim_payout confirms, so markVerified is a pure mirror
    // (records the verified state + payout ESTIMATE + attestation, decrements the
    // spentUsdc mirror) and must NOT schedule dispatch.
    const onChain = (campaign.onchainVersion ?? 1) >= 2;

    const verifiedAt = Date.now();

    if (args.decision === "rejected") {
      await ctx.db.patch(args.submissionId, {
        status: "rejected",
        verificationDecision: "rejected",
        viewCount: args.viewCount,
        scoreHash: args.scoreHash,
        attestationTx: args.attestationTx,
        verifiedAt,
      });
      await bumpLiveViews(ctx, args.viewCount - (submission.viewCount ?? 0)); // live hero counter
      return { alreadyProcessed: false, status: "rejected", payoutAmountUsdc: 0 };
    }

    // Clamp the payout to the campaign's REMAINING budget (budget minus what
    // prior approvals already committed). Convex mutations are serializable, so
    // concurrent settles serialize and the second sees the decremented remaining
    // — total payouts across all submissions can never exceed `budget`.
    const spentUsdc = campaign.spentUsdc ?? 0;
    const remaining = campaign.budget - spentUsdc;
    const payoutAmountUsdc = computePayoutUsdc(
      args.viewCount,
      campaign.ratePerThousandViews,
      remaining,
      (campaign as { maxPayoutUsdc?: number }).maxPayoutUsdc,
    );

    await ctx.db.patch(args.submissionId, {
      status: "verified",
      verificationDecision: "approved",
      viewCount: args.viewCount,
      scoreHash: args.scoreHash,
      attestationTx: args.attestationTx,
      payoutAmountUsdc,
      verifiedAt,
    });
    await bumpLiveViews(ctx, args.viewCount - (submission.viewCount ?? 0)); // live hero counter
    if (submission.postUrl) await enqueueVideoMilestone(ctx, {
      mintAddress: submission.influencerMint, views: args.viewCount, key: `submission:${submission._id}`,
      postUrl: submission.postUrl, platform: submission.platform, platformPostId: submission.platformPostId,
    });

    // Decrement the campaign budget in the SAME mutation so the next settle
    // sees a smaller remaining. Idempotency early-return above guarantees a
    // given submission contributes to spentUsdc at most once.
    if (payoutAmountUsdc > 0) {
      await ctx.db.patch(submission.campaignId, {
        spentUsdc: spentUsdc + payoutAmountUsdc,
      });
    }

    // v1 ONLY: distribute the verified payout to share investors (50%), builder
    // (45%) and protocol (5%). Runs as a background action so the verification
    // mutation returns immediately; idempotent on submissionId.
    //
    // v2 deliberately SKIPS this — the on-chain claim_payout has not run yet, so
    // there is no real USDC to split. The claim keeper triggers the split off the
    // NET actually paid on-chain after claim_payout confirms (a later task). This
    // keeps the legacy v1 path byte-for-byte identical while v2 becomes a mirror.
    if (!onChain && payoutAmountUsdc > 0) {
      await ctx.scheduler.runAfter(0, internal.distributions.dispatch, {
        mintAddress: submission.influencerMint,
        payoutUsdc: payoutAmountUsdc,
        campaignId: submission.campaignId,
        submissionId: args.submissionId,
      });
    }

    return { alreadyProcessed: false, status: "verified", payoutAmountUsdc };
  },
});
