import { calloutTradeV } from "./lib/calloutTrade";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { launchOptionsValidator } from "./lib/launchOptions";
import { controlMessageValidator } from "./lib/controlPanelValidators";

export default defineSchema({
  xAccounts: defineTable({ profile: v.string(), encrypted: v.string() }).index("by_profile", ["profile"]),
  ssCharacters: defineTable({
    ownerWallet: v.string(), name: v.string(), bio: v.string(), referenceImageUrl: v.string(),
    category: v.string(), status: v.union(v.literal("draft"), v.literal("approved"), v.literal("archived")),
    rightsAttested: v.boolean(), rightsReviewed: v.boolean(), createdAt: v.number(),
    launchOptions: v.optional(launchOptionsValidator),
    idempotencyKey: v.optional(v.string()), imageStorageId: v.optional(v.id("_storage")),
    // Optional public links the owner chose to attach to the token; shown only when set.
    xUrl: v.optional(v.string()), websiteUrl: v.optional(v.string()),
  }).index("by_owner", ["ownerWallet"]).index("by_status", ["status"]).index("by_idempotency", ["idempotencyKey"]),
  ssTokens: defineTable({
    characterId: v.id("ssCharacters"),
    network: v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet")),
    name: v.string(), ticker: v.string(), description: v.string(),
    economy: v.optional(v.union(v.literal("creator-only"), v.literal("sustainable-v1"))), treasuryWallet: v.optional(v.string()), dammPool: v.optional(v.string()),
    dbcConfig: v.optional(v.string()), dbcPool: v.optional(v.string()),
    mint: v.optional(v.string()), launchSignature: v.optional(v.string()), sharingSignature: v.optional(v.string()),
    state: v.union(v.literal("paper"), v.literal("pending"), v.literal("live"), v.literal("graduated"), v.literal("migrated"), v.literal("failed")),
    solReserve: v.int64(), tokenReserve: v.int64(),
    createdAt: v.number(),
  }).index("by_network", ["network"]).index("by_character", ["characterId"])
    .index("by_network_ticker", ["network", "ticker"]).index("by_mint", ["mint"]),
  ssEpisodes: defineTable({
    tokenId: v.id("ssTokens"), index: v.number(), videoUrl: v.string(), posterUrl: v.string(),
    title: v.string(), prompt: v.optional(v.string()), source: v.union(v.literal("sample"), v.literal("generated")),
    engine: v.optional(v.string()), // video model that rendered the episode, e.g. "Genjutsu", "Veo 3"
    createdAt: v.number(),
  }).index("by_token", ["tokenId", "index"]),
  ssLedger: defineTable({
    tokenId: v.id("ssTokens"),
    network: v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet")),
    kind: v.union(
      v.literal("protocol"), v.literal("creator_earning"), v.literal("platform_ops"), v.literal("content_funding"),
      v.literal("reservation"), v.literal("release"), v.literal("spend"),
    ),
    amountLamports: v.int64(), idempotencyKey: v.string(), source: v.string(), createdAt: v.number(),
  }).index("by_idem", ["idempotencyKey"]).index("by_token", ["tokenId", "network"]),
  ssBudgets: defineTable({
    tokenId: v.id("ssTokens"),
    network: v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet")),
    fundedLamports: v.int64(), reservedLamports: v.int64(), spentLamports: v.int64(),
  }).index("by_token", ["tokenId"]),
  ssFlywheels: defineTable({
    tokenId: v.id("ssTokens"), enabled: v.boolean(), nextRunAt: v.number(), leaseUntil: v.number(),
    status: v.string(), error: v.optional(v.string()), claimSignature: v.optional(v.string()), claimTransaction: v.optional(v.string()), claimVault: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_token", ["tokenId"]).index("by_next_run", ["nextRunAt"]),
  ssContentJobs: defineTable({
    tokenId: v.id("ssTokens"), roundId: v.id("ssCommunityRounds"), key: v.string(), status: v.string(),
    costLamports: v.int64(), prompt: v.string(), referenceImageUrl: v.optional(v.string()), taskId: v.optional(v.string()), videoUrl: v.optional(v.string()), error: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_key", ["key"]).index("by_token", ["tokenId"]).index("by_status", ["status"]),
  ssMarketSummary: defineTable({
    tokenId: v.id("ssTokens"), characterId: v.id("ssCharacters"),
    followers: v.number(), episodes: v.number(), posterUrl: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_token", ["tokenId"]).index("by_character", ["characterId"]),
  ssFollows: defineTable({ wallet: v.string(), characterId: v.id("ssCharacters"), createdAt: v.number() })
    .index("by_wallet_character", ["wallet", "characterId"]).index("by_character", ["characterId"]),
  ssTrades: defineTable({
    tokenId: v.id("ssTokens"), network: v.literal("paper"), wallet: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    amountIn: v.int64(), amountOut: v.int64(), fee: v.int64(), idempotencyKey: v.string(), createdAt: v.number(),
  }).index("by_idem", ["idempotencyKey"]).index("by_wallet_token", ["wallet", "tokenId"]).index("by_token", ["tokenId"]),
  ssCommunityMessages: defineTable({
    characterId: v.id("ssCharacters"), author: v.string(), role: v.union(v.literal("fan"), v.literal("agent")), body: v.string(), imageUrl: v.optional(v.string()), createdAt: v.number(),
    /** Fan's public profile picture at the time of posting (https only). Chat falls back to the Solcameo mark. */
    authorImage: v.optional(v.string()),
    /** An emoji the agent reacted with while reviewing this fan message. */
    agentReaction: v.optional(v.string()),
    /** On an agent reply: a one-line teaser of what the next video could look like. */
    hint: v.optional(v.string()),
  }).index("by_character_created", ["characterId", "createdAt"]).index("by_created", ["createdAt"]).index("by_author_created", ["author", "createdAt"]),
  ssCommunityRounds: defineTable({
    characterId: v.id("ssCharacters"), window: v.number(), status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")), leaseUntil: v.number(), plot: v.optional(v.string()), summary: v.optional(v.string()), referenceImageUrl: v.optional(v.string()), createdAt: v.number(),
  }).index("by_character_window", ["characterId", "window"]),
  ssFeed: defineTable({
    kind: v.union(v.literal("chat"), v.literal("event")),
    eventType: v.optional(v.union(v.literal("character_created"), v.literal("trade"), v.literal("follow"))),
    wallet: v.optional(v.string()), body: v.string(),
    tokenId: v.optional(v.id("ssTokens")), characterId: v.optional(v.id("ssCharacters")),
    amountLamports: v.optional(v.string()), side: v.optional(v.union(v.literal("buy"), v.literal("sell"))),
    /** Callout share-card template and the market cap (SOL) when the call was made. */
    theme: v.optional(v.string()), callCapSol: v.optional(v.number()),
    calloutMetric: v.optional(v.union(v.literal("earnings"), v.literal("views"), v.literal("trade"))),
    tradePnlUsd: v.optional(v.number()),
    onchainTrade: v.optional(calloutTradeV),
    attachments: v.optional(v.array(v.object({ url: v.string(), type: v.union(v.literal("image"), v.literal("gif")), alt: v.string() }))),
    network: v.union(v.literal("paper"), v.literal("devnet"), v.literal("mainnet")), createdAt: v.number(),
  }).index("by_created", ["createdAt"]).index("by_wallet_kind_created", ["wallet", "kind", "createdAt"]).index("by_kind_created", ["kind", "createdAt"]),
  /** Thread replies under a callout post in the home feed. */
  ssCalloutReplies: defineTable({
    calloutId: v.id("ssFeed"), wallet: v.string(), body: v.string(), createdAt: v.number(),
    /** Set when this is a reply to another reply (Reddit-style nesting). */
    parentId: v.optional(v.id("ssCalloutReplies")),
  }).index("by_callout_created", ["calloutId", "createdAt"]).index("by_wallet_created", ["wallet", "createdAt"]),
  /** One row per paid describe-box video made without an influencer; the signature is the payment that bought it. */
  describeVideoRuns: defineTable({
    account: v.string(), txSignature: v.string(), amountUsd: v.number(), taskId: v.optional(v.id("agentTasks")),
    /** Set instead of taskId when the paid render is a motion-transfer job at the video provider. */
    requestId: v.optional(v.string()), createdAt: v.number(),
  }).index("by_signature", ["txSignature"]).index("by_account", ["account", "createdAt"]).index("by_request", ["requestId"]),
  /** Chat under a made video. `videoKey` is the video's URL, which every surface already has and which never changes. */
  ssVideoComments: defineTable({
    videoKey: v.string(), characterId: v.optional(v.id("ssCharacters")), wallet: v.string(), body: v.string(), createdAt: v.number(),
  }).index("by_video_created", ["videoKey", "createdAt"]).index("by_wallet_created", ["wallet", "createdAt"]),
  contentControlSettings: defineTable({
    key: v.string(), targetMint: v.optional(v.string()), autoAnnounce: v.boolean(), autoMilestones: v.optional(v.boolean()), updatedAt: v.number(),
  }).index("by_key", ["key"]),
  contentControlPosts: defineTable({
    videoPostKey: v.optional(v.string()), dedupeKey: v.string(), source: v.string(), targetMint: v.optional(v.string()),
    agentMint: v.optional(v.string()), agentName: v.optional(v.string()), tokenId: v.optional(v.id("ssTokens")),
    milestoneViews: v.optional(v.number()), videoUrl: v.optional(v.string()), postUrl: v.optional(v.string()), platform: v.optional(v.string()),
    caption: v.string(), mediaUrl: v.optional(v.string()), kind: v.string(),
    platforms: v.array(v.string()), status: v.string(), error: v.optional(v.string()),
    requestId: v.optional(v.string()), result: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(), attempts: v.number(),
    /** When it first went out (posted/submitted) — drives the rolling 24h quota. */
    publishedAt: v.optional(v.number()),
    /** Held in the queue until this time (daily quota, spacing, or the provider's own cap). */
    notBefore: v.optional(v.number()),
  }).index("by_videoPostKey", ["videoPostKey"]).index("by_dedupeKey", ["dedupeKey"]).index("by_status_and_updatedAt", ["status", "updatedAt"]),
  x402Reports: defineTable({
    proofHash: v.string(), resource: v.string(), report: v.string(), paymentHeader: v.string(),
    state: v.union(v.literal("settling"), v.literal("paid"), v.literal("unknown"), v.literal("cancelled")),
    receipt: v.optional(v.string()), createdAt: v.number(),
  }).index("by_proofHash", ["proofHash"]),
  x402Policies: defineTable({
    mintAddress: v.string(), enabled: v.boolean(), perRequestMicros: v.number(),
    dailyMicros: v.number(), updatedAt: v.number(), walletAddress: v.string(), walletSecret: v.string(), network: v.string(),
  }).index("by_mintAddress", ["mintAddress"]),
  x402Purchases: defineTable({
    taskId: v.id("agentTasks"), mintAddress: v.string(), day: v.number(),
    amountMicros: v.number(), resource: v.string(),
    state: v.union(v.literal("reserved"), v.literal("signed"), v.literal("paid"), v.literal("cancelled")),
    paymentHeader: v.optional(v.string()), proofHash: v.optional(v.string()), receipt: v.optional(v.string()),
    report: v.optional(v.string()), createdAt: v.number(),
  }).index("by_taskId", ["taskId"])
    .index("by_mintAddress_day", ["mintAddress", "day"])
    .index("by_mintAddress_state", ["mintAddress", "state"]),
  // App users. Identity comes from Supabase (Google login on the shared
  // jobtepi Supabase project); `supabaseId` is the Supabase auth user id.
  users: defineTable({
    supabaseId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    /** Linked Solana wallet pubkey — bridges this account to all wallet-keyed data. */
    walletAddress: v.optional(v.string()),
    walletType: v.optional(v.string()), // "external" | "embedded"
    /** Gates the admin panel. Enforced server-side via requireAdmin(). */
    isAdmin: v.optional(v.boolean()),
    status: v.optional(v.string()),     // "active" | "suspended"
    createdAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    /** Set once when the free signup video credits were granted — the
     *  idempotency guard for the "3 free videos on signup" offer. Keyed on the
     *  USER (not the wallet) so linking extra wallets can never re-grant. */
    signupCreditsGrantedAt: v.optional(v.number()),
    /** Per-account override of mintFee.AGENT_LIMIT_PER_WALLET. undefined = the
     *  paid plan default; -1 = unlimited; any other number = a custom cap
     *  for this account. Set via users.setAgentLimitOverride (admin-only). */
    agentLimitOverride: v.optional(v.number()),
    /** First-run onboarding — the /home welcome modal. All undefined until the
     *  operator finishes (or skips) it once. */
    accountType: v.optional(v.union(v.literal("personal"), v.literal("business"))),
    niche: v.optional(v.string()),
    goal: v.optional(v.union(
      v.literal("grow_views"),
      v.literal("sell_product"),
      v.literal("build_audience"),
      v.literal("other"),
    )),
    onboardingCompletedAt: v.optional(v.number()),
    /** Set when the operator dismisses the modal without finishing — distinct
     *  from onboardingCompletedAt so a future "resume setup" entry point (e.g.
     *  Settings) can tell "skipped" apart from "done". */
    onboardingSkippedAt: v.optional(v.number()),
  })
    .index("by_supabase", ["supabaseId"])
    .index("by_wallet", ["walletAddress"]),

  // Email+password credentials for accounts created via the /login page's
  // email form (as opposed to Privy Google/wallet login). `supabaseId` here is
  // a self-minted "password:<uuid>" identity, linked 1:1 into `users.supabaseId`
  // — everything downstream (whoami, wallet linking, admin) is identity-agnostic.
  passwordAuth: defineTable({
    email: v.string(), // lowercased, unique via by_email
    passwordHash: v.string(),
    supabaseId: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // One row per (user, wallet) link. A user can link MANY wallets (Phantom,
  // Solflare, …); each wallet can belong to at most one account (enforced in
  // linkWalletInternal via by_wallet). `users.walletAddress` mirrors the most
  // recently linked wallet as the "active/primary" one for legacy single-wallet
  // readers (agent creator ownership, admin, etc.).
  walletLinks: defineTable({
    userId: v.id("users"),
    walletAddress: v.string(),
    walletType: v.optional(v.string()), // "external" | "embedded"
    createdAt: v.number(),
  })
    .index("by_wallet", ["walletAddress"])
    .index("by_user", ["userId"]),

  // ── Product analytics ──────────────────────────────────────────────────────
  // High-churn activity is split off the stable `users` profile doc (per Convex
  // guidelines). `day` is a UTC epoch-day integer (floor(ts / 86_400_000)) so
  // consecutive days differ by exactly 1 — trivial range queries + gap-filling.
  //
  // One row per (user, day): the source of truth for Daily Active Users. A row's
  // mere existence = that user was active that day (deduped via by_user_and_day),
  // so DAU for a day = count of rows for that day.
  dailyActivity: defineTable({
    userId: v.id("users"),
    day: v.number(),            // UTC epoch-day
    firstSeenAt: v.number(),    // first whoami/login that day (ms)
    lastSeenAt: v.number(),     // most recent activity that day (ms)
    opens: v.number(),          // total platform opens (whoami hits) that day
    loggedIn: v.boolean(),      // did the user perform a fresh login that day
  })
    .index("by_day", ["day"])
    .index("by_user_and_day", ["userId", "day"]),

  // Denormalized one-row-per-day rollup — the admin time-series chart reads these
  // directly (O(range) rows), so the chart never scans the activity table.
  // `activeUsers` is incremented once per user per day (on their first activity),
  // `logins` on every login event, `newUsers` on first-ever signup.
  dailyStats: defineTable({
    day: v.number(),            // UTC epoch-day
    activeUsers: v.number(),    // DAU: distinct users active that day
    logins: v.number(),         // login events that day
    newUsers: v.number(),       // signups that day
  })
    .index("by_day", ["day"]),

  influencers: defineTable({
    solstarCharacterId: v.optional(v.id("ssCharacters")),
    solstarTokenId: v.optional(v.id("ssTokens")),
    mintAddress: v.string(),
    /** Real on-chain NFT (Metaplex). Optional: agents minted before the
     *  on-chain NFT path, or when the mint authority was unfunded, have a
     *  synthetic mintAddress and no nftMintAddress. */
    nftMintAddress: v.optional(v.string()),
    nftTxSignature: v.optional(v.string()),
    nftExplorerUrl: v.optional(v.string()),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    /** Lowercased, "@"-stripped, dedupe-suffixed handle — the /market/<handleLower>
     *  URL slug. Kept separate from the display `handle` so a collision suffix
     *  (e.g. "-2") only affects the URL, never the shown @handle text. Backfilled
     *  for pre-existing rows by convex/migrations/backfillHandleLower.ts. */
    handleLower: v.optional(v.string()),
    avatarUrl: v.string(),
    /** The individual still NFT frames (http URLs) generated at mint — used as
     *  the agent's reference images for video generation. The display avatarUrl
     *  is often an animated GIF, which Kie's image/video models can't read, so
     *  the still frames are stored separately and fed to the pipeline instead. */
    avatarStills: v.optional(v.array(v.string())),
    // Clipping-agent config (only set when agentType === "clipping").
    // PERMISSIVE on purpose: a STRICT v.object() here rejects any client write
    // that adds a new field OR omits a required one — which surfaced to users as
    // a redacted "[CONVEX] Server Error" whenever the deployed schema lagged the
    // frontend (e.g. postIntervalMs/maxPerDay) or a partial config was written.
    // The real shape contract lives in lib/builder/clipConfig.normalizeClipConfig,
    // which coerces+defaults every field on every read. So adding clipConfig
    // fields never again needs a lock-step schema deploy. (setClipConfig's arg is
    // already v.any(); nftAgents.saveInfluencer's is already v.optional(v.any()).)
    clipConfig: v.optional(v.any()),
    niche: v.string(),
    language: v.string(),
    isHalal: v.optional(v.boolean()),
    archetype: v.string(),
    description: v.string(),
    // One of: "influencer" | "trader" | "worker" — drives marketplace sorting/filtering.
    agentType: v.optional(v.string()),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
    generationFunding: v.optional(v.literal("agent_wallet")),
    agentWallet: v.optional(v.string()),       // dedicated Solana keypair public key
    agentWalletSecret: v.optional(v.string()), // base64-encoded 64-byte secret key (devnet only)
    tvl: v.number(),
    monthlyEarnings: v.number(),
    /** All-time USDC earned from verified work (sum of distribution payouts). */
    lifetimeEarningsUsdc: v.optional(v.number()),
    sharePrice: v.number(),
    totalShares: v.number(),
    availableShares: v.number(),
    /** Marketplace skills the operator has installed for this agent. Persists across page refreshes. */
    installedSkills: v.optional(v.array(v.string())),
    /** Cached list of social platform ids this agent has CONNECTED (tiktok/instagram/
     *  youtube/x/facebook/…). The live source is the external upload-post service
     *  (owner-gated, one HTTP call per agent), so we cache the platform ids here —
     *  refreshed whenever /api/social/status runs for the agent — so the public
     *  /agents marketplace can show a connected-accounts icon overlay per card
     *  without N owner-gated upstream calls. */
    connectedPlatforms: v.optional(v.array(v.string())),
    /** Public identity fields from the agent's connected Upload-Post accounts.
     * No OAuth token or private connection detail is stored here. */
    connectedSocialAccounts: v.optional(v.record(v.string(), v.object({
      id: v.optional(v.string()),
      handle: v.optional(v.string()),
      displayName: v.optional(v.string()),
    }))),
    // Live follower counts pulled from upload-post profile analytics
    // (/api/social/sync-connected, every 30 min). followerCount = sum across
    // connected platforms; followerHistory = hourly-ish samples for the 24h delta.
    followerCount: v.optional(v.number()),
    followersByPlatform: v.optional(v.record(v.string(), v.number())),
    followerDelta24h: v.optional(v.number()),
    followerHistory: v.optional(v.array(v.object({ at: v.number(), count: v.number() }))),
    followersSyncedAt: v.optional(v.number()),
    /** Autonomous clipping toggle (Home page). When true, a clip agent auto-seeks a
     *  fit-matched funded campaign each daily scout, resolves its next un-clipped
     *  source video, and runs the clip pipeline (→ auto-post → auto-submit). One clip
     *  per cycle; off by default (money-spending loop → explicit opt-in). Set via
     *  influencers.setAutoClip; the auto-clip step reads it in convex/autoClip.ts. */
    autoClipEnabled: v.optional(v.boolean()),
    /** Owner-authorized campaign participation. Auto-join is separate from auto-clipping. */
    campaignWorkConsent: v.optional(v.object({
      autoJoin: v.boolean(),
      allowThirdPartySources: v.boolean(),
      allowProfileCtaCampaigns: v.boolean(),
      consentedAt: v.number(),
    })),
    /** Self-Organizing Memory skill — when memory was last consolidated, and the
     *  memory count at that point, so the heartbeat only re-organizes once it grows. */
    memoryOrganizedAt: v.optional(v.number()),
    memoryCountAtOrganize: v.optional(v.number()),
    /** Heartbeat config — schedule + manual override + last-edited timestamp. */
    heartbeatEnabled: v.optional(v.boolean()),
    heartbeatCron: v.optional(v.string()),
    heartbeatMarkdown: v.optional(v.string()),
    /** Last server-side heartbeat fire time. Used by crons to enforce per-agent intervals. */
    heartbeatLastFiredAt: v.optional(v.number()),
    /** Next wall-clock-aligned fire instant (epoch ms). Single source of truth for
     *  the cron driver and the /agents countdown. Persistent + per-account staggered
     *  so heartbeats fire at real clock times, spread out — never all at once. */
    heartbeatNextFireAt: v.optional(v.number()),
    /** Video engine selected by the operator for storyboard→video generation. */
    videoEngine: v.optional(v.string()),
    /** Operator-authored persona identity kernel (Director tab). When set, this
     *  EXACT text rides every video clip prompt as the CHARACTER block instead
     *  of the LLM-distilled kernel — the operator's direct lever over how the
     *  persona renders. Empty/unset → auto-distilled (personaKernel.ts). */
    personaKernelOverride: v.optional(v.string()),
    /** Per-agent video length range (seconds). The agent picks a concrete length
     *  within this window per video so output length varies naturally. Unset →
     *  DEFAULT_VIDEO_MIN/MAX. Always clamped to [MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS]. */
    videoMinSeconds: v.optional(v.number()),
    videoMaxSeconds: v.optional(v.number()),
    /** Paper-trade wallet — starts at 10_000 USDC, decrements on paper BUY,
     *  credits on paper SELL. Independent from on-chain agentWallet balance. */
    paperUsdcBalance: v.optional(v.number()),
    /** Open paper positions — { asset, amountUsdc, units, fillPrice, openedAt } */
    paperPositions: v.optional(v.array(v.object({
      asset: v.string(),
      amountUsdc: v.number(),
      units: v.number(),
      fillPrice: v.number(),
      openedAt: v.number(),
    }))),
    /** Cumulative realized paper PnL — every paper SELL adds (exit - entry) * units. */
    paperRealizedPnlUsdc: v.optional(v.number()),
    /**
     * Client-facing monetization config, surfaced on the /agents hire flow.
     * Driven by the "Marketplace Hiring" + "Charge Per Video" builder skills:
     *  - hiring*    → a monthly retainer (N videos/month at a rate)
     *  - perVideo*  → pay-per-video pricing + the brief the agent follows
     */
    monetization: v.optional(v.object({
      hiringEnabled: v.optional(v.boolean()),
      videosPerMonth: v.optional(v.number()),
      monthlyRate: v.optional(v.number()),
      perVideoEnabled: v.optional(v.boolean()),
      costPerVideo: v.optional(v.number()),
      requirementPrompt: v.optional(v.string()),
    })),
    /** Video Director config — per-agent creative control over generated videos.
     *  Resolved per video by lib/builder/videoDirector.ts. See
     *  docs/superpowers/specs/2026-06-05-video-director-design.md */
    videoConfig: v.optional(v.object({
      /** Set on EVERY setVideoConfig write. Chat "standing order" directives
       *  recorded BEFORE this moment are ignored at render time — a manual
       *  Director-tab save is the operator's latest word and must not be
       *  overridden by stale copilot directives (see agentDirectives.ts). */
      manualUpdatedAt: v.optional(v.number()),
      minSeconds: v.number(),
      maxSeconds: v.number(),
      videosPerDay: v.number(),
      /** Optional monthly USDC budget — drives the cadence cost estimate + max. */
      monthlyBudget: v.optional(v.number()),
      /** Max brand campaigns the agent collabs on + posts per day. */
      maxBrandsPerDay: v.optional(v.number()),
      /** Preferred posting anchor — minutes past UTC midnight (0-1439). */
      postingTimeUtcMinutes: v.optional(v.number()),
      /** Minimum hours between consecutive auto-posts. */
      minGapHours: v.optional(v.number()),
      aspectRatio: v.string(),
      /** Output resolution ("720p"|"1080p"|"4k"). Sent by the Director tab on
       *  every save (VideoConfig.resolution is non-optional client-side) — was
       *  missing here, so every Director save wrote a field the schema didn't
       *  know about and Convex threw a redacted internal error on the patch,
       *  failing EVERY save with no diagnosable message. */
      resolution: v.optional(v.string()),
      styles: v.array(v.string()),
      customStyles: v.optional(v.array(v.string())),
      hookStyles: v.optional(v.array(v.string())),
      settings: v.optional(v.array(v.string())),
      moods: v.optional(v.array(v.string())),
      energy: v.optional(v.string()),
      cameraStyle: v.optional(v.string()),
      colorGrade: v.optional(v.string()),
      voiceover: v.optional(v.boolean()),
      cta: v.optional(v.string()),
      ctaText: v.optional(v.string()),
      customDirective: v.optional(v.string()),
      avoid: v.optional(v.string()),
      brandLogoUrl: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      // Video Call To Action app: URL of an operator-uploaded clip appended to the
      // END of every generated video (aspect-normalized concat in the finalize phase).
      ctaVideo: v.optional(v.string()),
      // Hook Videos app (video.hookvideos): pool of uploaded clips, one PREPENDED to
      // every video. Joined before the overlay burn so the hook text lands on it.
      hookVideos: v.optional(v.array(v.string())),
      // Main Content app (video.maincontent): pool of uploaded body videos, plus the
      // "No clip / UGC needed" switch that skips generation and publishes them.
      mainVideos: v.optional(v.array(v.string())),
      mainVideosOnly: v.optional(v.boolean()),
      // SERIES MODE: the persona runs an episodic show (cartoon/animated character
      // and cast). `cast[].refImages` are the generated design-sheet frames that
      // lock each character's look across episodes.
      series: v.optional(v.object({
        enabled: v.optional(v.boolean()),
        premise: v.optional(v.string()),
        world: v.optional(v.string()),
        themes: v.optional(v.array(v.string())),
        cast: v.optional(v.array(v.object({
          name: v.string(),
          role: v.optional(v.string()),
          designPrompt: v.optional(v.string()),
          refImages: v.optional(v.array(v.string())),
        }))),
      })),
      // IMAGE POSTS app: generate a still with KIE instead of (or as well as) video.
      // `imageOnly` skips the video model entirely — a post costs one image.
      imagePosts: v.optional(v.object({
        enabled: v.optional(v.boolean()),
        imageOnly: v.optional(v.boolean()),
        idea: v.optional(v.string()),
        engine: v.optional(v.string()),
      })),
      hookText: v.optional(v.object({
        enabled: v.boolean(),
        // "auto" = use the per-video script hook; "custom" = use `text` (usually
        // Kie-generated from `prompt` in the AppStore Auto Hook picker).
        source: v.string(),
        text: v.optional(v.string()),
        // `templateId` = a hook-design id from lib/builder/hookDesigns.ts
        // (bold_white/yellow_pop/black_box/…). It drives the burned-in look
        // (color/outline/box/caps/position); the legacy `style` object is kept for
        // back-compat. `durationSeconds` = how long the hook stays on screen (1-15s).
        // `prompt` = the operator's brief the hook text is generated from.
        templateId: v.optional(v.string()),
        durationSeconds: v.optional(v.number()),
        prompt: v.optional(v.string()),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
      captions: v.optional(v.object({
        enabled: v.boolean(),
        // `preset` = a caption-template id from lib/builder/captionPresets.ts
        // (default/gold/beasty/karaoke/…). The render (render-step → overlay-burn →
        // renderCaptionsAss) already reads it; it just needed to be allowed to persist.
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string(), preset: v.optional(v.string()) }),
      })),
      /** Trending Audio app: music bed under the voiceover. volumePct 0-100 (default 30). */
      music: v.optional(v.object({
        enabled: v.boolean(),
        trackId: v.optional(v.string()),
        autoMusic: v.optional(v.boolean()),
        volumePct: v.optional(v.number()),
        // Operator's own uploaded MP3 — wins over trackId/autoMusic when set
        // (see app/api/video/overlay-burn/route.ts's music resolution).
        customUrl: v.optional(v.string()),
        customStorageId: v.optional(v.string()),
      })),
      // Integrations · Web Search: fetch live grounded web results for the video's
      // topic before the script is written (lib/server/kie-gemini.ts's Google
      // Search grounding), so the script — and every downstream Veo/image prompt
      // built from it — is grounded in current real-world info regardless of style.
      webSearchEnabled: v.optional(v.boolean()),
      // Integrations · Standing Promotion: a free-text value-message the operator
      // wants naturally worked into EVERY future video, regardless of format —
      // e.g. "mention Vello, the AI agent platform this show is built on, and
      // what it does" for a self-promotional show. Reuses the SAME enforced
      // "mention the product + build to a CTA" script instruction a real
      // marketplace campaign gets (videoScript.ts's campaignBlock), via
      // run-task's campaignContext fallback chain — see
      // app/api/agents/run-task/route.ts around `baseContext`. Unset = no
      // forced product mention (unchanged default behavior).
      standingPromotion: v.optional(v.string()),
      // Generate tab · "My Images" → "Use for videos": an operator-picked image
      // that every future video generation (manual AND the agent's own scheduled
      // runs) uses as its primary identity reference instead of the generic
      // minted avatarStills[0] — see app/api/agents/run-task/route.ts's
      // `primaryRef` resolution. Unset = default behavior, unchanged.
      pinnedVideoReferenceUrl: v.optional(v.string()),
    })),
    /** Show Bible — the agent's creative source of truth, LLM-compiled from the
     *  operator's concept prompt. PERMISSIVE (v.any()) on purpose — the shape
     *  contract lives in lib/builder/showBible.normalizeShowBible, mirroring
     *  clipConfig, so bible fields never need a lock-step schema deploy. */
    showBible: v.optional(v.any()),
    /** Deterministic variety cursor — advanced once per produced video.
     *  Shape contract: lib/builder/showBible.normalizeRotationState. */
    rotationState: v.optional(v.any()),
    /** LLM-maintained prose summary of the operator's content taste.
     *  Shape: { prose: string, updatedAt: number, eventCount: number }. */
    tasteProfile: v.optional(v.any()),
    /** "full-auto" | "review-ideas" | "review-video" — how much human approval
     *  the heartbeat pipeline requires. Unset = "full-auto" (legacy behavior). */
    autonomyMode: v.optional(v.string()),
    /** Additional wallet addresses that can manage this agent alongside the primary
     *  creatorWallet — used to share access with a second account without
     *  transferring ownership. Resolved in influencers.listByCreators. */
    coCreatorWallets: v.optional(v.array(v.string())),
    updatedAt: v.optional(v.number()),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_solstar_character", ["solstarCharacterId"])
    .index("by_creator", ["creatorWallet"])
    // Per-minute heartbeat cron reads only DUE agents (enabled + nextFireAt ≤ now)
    // through this index instead of scanning the whole table.
    .index("by_heartbeat", ["heartbeatEnabled", "heartbeatNextFireAt"])
    // Powers /market/<handle> — every profile's public URL.
    .index("by_handle_lower", ["handleLower"]),

  campaigns: defineTable({
    creatorWallet: v.string(),
    brandName: v.string(),
    brandLogoUrl: v.string(),
    campaignImageUrl: v.optional(v.string()),
    title: v.string(),
    brief: v.string(),
    budget: v.number(),
    ratePerThousandViews: v.number(),
    /** Optional MARKETING per-submission payout cap (USDC) — see computePayoutUsdc. */
    maxPayoutUsdc: v.optional(v.number()),
    campaignType: v.optional(v.string()),
    rewardPerCompletion: v.optional(v.number()),
    agentTaskCategory: v.optional(v.string()),
    deliverables: v.optional(v.string()),
    contentLinks: v.optional(v.array(v.string())),
    contentFileUrls: v.optional(v.array(v.string())),
    /** Campaign creator attests they may authorize agents to republish supplied sources. */
    sourceRightsConfirmed: v.optional(v.boolean()),
    /** A participating account must put the brand's link in its profile/bio. */
    requiresProfileCta: v.optional(v.boolean()),
    targetNiche: v.array(v.string()),
    targetLanguage: v.array(v.string()),
    /** Social platforms this campaign accepts a submission on (upload-post ids:
     *  tiktok|instagram|youtube|facebook|linkedin|x|threads). Empty/absent =
     *  any connected platform is acceptable. Drives agent join-eligibility. */
    platforms: v.optional(v.array(v.string())),
    /** Account handle the post MUST tag (e.g. "@brand"). When set, the agent
     *  appends it to every post caption/description for this campaign. */
    requiredTag: v.optional(v.string()),
    /** MANDATORY campaign requirements the AI agents must obey on EVERY post/clip
     *  for this campaign (e.g. "clip along rocket videos from youtube, tag
     *  @alongrocket on tiktok"). Optional at the schema level so pre-existing rows
     *  validate, but the `create` mutation enforces ≥1 non-empty entry. Parsed by
     *  lib/server/campaignRequirements.parseCampaignRequirements into deterministic
     *  @mentions/#hashtags/brand tags + free-text tone rules that the clip pipeline
     *  (clipJobs.finalizeJob) and post_content (run-task) apply to every caption. */
    requirements: v.optional(v.array(v.string())),
    isHalalOnly: v.optional(v.boolean()),
    status: v.string(),
    submissionsCount: v.number(),
    deadline: v.string(),
    pdaAddress: v.optional(v.string()),
    /** Running total of USDC already committed to approved submissions. The
     *  oracle decrements `budget - spentUsdc` on each settle so total payouts
     *  across all submissions can never exceed `budget` (solvency clamp). */
    spentUsdc: v.optional(v.number()),
    /** On-chain rail version. undefined/1 = legacy off-chain (markVerified
     *  schedules distributions.dispatch directly). 2 = on-chain treasury — the
     *  vault holds the budget and payout lands via the claim keeper after
     *  claim_payout confirms; markVerified is a pure mirror for these. The gate
     *  keeps existing v1 campaigns on the EXACT current behavior during the
     *  transition. */
    onchainVersion: v.optional(v.number()),
    /** When this campaign IS the on-chain USDC treasury for a jobtepi/ryze
     *  content_reward (clipping campaign), the linked content_reward UUID. The
     *  clip pipeline resolves it (getFundedByContentRewardId) so an agent's
     *  content-reward clip ALSO lands as a Convex submission here → the oracle
     *  records views on-chain + the claim keeper pays the agent USDC from this
     *  treasury. The ryze content_rewards_submissions row is display-only. */
    contentRewardId: v.optional(v.string()),
    /** Provenance marker. "clipping_fr" = a Clipping FR mirror: this campaign
     *  was minted from a jobtepi clipping content_reward at the RM 100 → 1 USDC
     *  scale (RM 5,000 budget → 50 USDC vault) and is listed under the /stage
     *  "Clipping FR" tab instead of Web3. Absent = an organic campaign. */
    origin: v.optional(v.string()),
    /** Board tab this organic campaign is listed under on /stage: "web3" |
     *  "ugc" | "clipping". Absent/default = "web3". Display-only routing —
     *  Clipping FR still routes via `origin`, not this field. */
    category: v.optional(v.string()),
    /** When the creator has swept the unspent escrow back to their wallet via the
     *  on-chain `refund_remaining` (allowed 6h after the deadline), the refund tx
     *  signature. The CHAIN is the source of truth (status → Closed); this mirror
     *  is written best-effort by /api/campaigns/reclaim so the campaign page + the
     *  admin history reflect the reclaimed state across reloads. Never moves money. */
    refundTxSignature: v.optional(v.string()),
    /** Epoch ms the reclaim was recorded (best-effort mirror; see refundTxSignature). */
    refundedAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorWallet"])
    .index("by_status", ["status"])
    .index("by_content_reward", ["contentRewardId"]),

  // Content-reward (Stage /reward) clip post → upload-post analytics-handle registry.
  // A row is created at post time (contentRewardMeasurements.upsert, from clipJobs);
  // the admin view-sync oracle (/api/oracle/scrape-views, mode "all") reads the
  // handles via `activeHandles` to fetch live views from upload-post before falling
  // back to the residential-proxy scrape. NEVER carries money; cannot trigger a payout.
  contentRewardMeasurements: defineTable({
    /** jobtepi content_reward UUID this clip was posted to. */
    contentRewardId: v.string(),
    /** The ryze `content_rewards_submissions` row id to backfill views onto (unique). */
    contentRewardSubmissionId: v.string(),
    /** The clipping agent that posted. */
    mintAddress: v.string(),
    /** Platform the clip was posted to (upload-post id: tiktok/instagram/...). */
    platform: v.string(),
    /** Native platform post id — the durable analytics key. */
    platformPostId: v.optional(v.string()),
    /** Upload-post request_id (async-upload analytics handle). */
    uploadPostRequestId: v.optional(v.string()),
    /** Epoch ms the post went live (age anchor for the stop rule). */
    postedAt: v.number(),
    /** Last measured view count (mirrored to the ryze display row). */
    viewCount: v.optional(v.number()),
    /** Epoch ms of the last successful measurement (cadence gate). */
    lastMeasuredAt: v.optional(v.number()),
    /** "active" = keep re-measuring; "stopped" = aged out / done. */
    status: v.string(),
  })
    .index("by_submission", ["contentRewardSubmissionId"])
    .index("by_status", ["status"])
    // The measure-views worker reads the oldest-measured DUE active rows through
    // this index (status + lastMeasuredAt) instead of collecting all active rows.
    .index("by_status_lastMeasured", ["status", "lastMeasuredAt"]),

  /** Live progress for the admin Submissions view-sync (one row per platform).
   *  The `/api/oracle/scrape-views` worker upserts this as it scrapes so the admin
   *  page can render a realtime "X/Y synced" progress bar via a Convex subscription. */
  viewSyncProgress: defineTable({
    platform: v.string(),            // "tiktok" | "instagram" | "youtube"
    total: v.number(),               // rows to process this run
    done: v.number(),                // rows processed so far
    updated: v.number(),             // rows whose view count increased
    running: v.boolean(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    note: v.optional(v.string()),    // final summary line
  }).index("by_platform", ["platform"]),

  submissions: defineTable({
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    // "pending" (joined, not yet posted) → "submitted" (post link attached) →
    // "verified" | "approved" | "rejected" (oracle / brand).
    status: v.string(),
    /** Platform the deliverable was posted to (upload-post id). */
    platform: v.optional(v.string()),
    /** Live URL of the published post — the "submission link". */
    postUrl: v.optional(v.string()),
    payoutTxSignature: v.optional(v.string()),
    // Oracle attestation fields (JOB-51)
    verificationDecision: v.optional(v.union(v.literal("approved"), v.literal("rejected"))),
    viewCount: v.optional(v.number()),
    scoreHash: v.optional(v.string()),
    attestationTx: v.optional(v.string()),
    payoutAmountUsdc: v.optional(v.number()),
    /** Mirror of on-chain `ClaimRecord.paid` (USDC actually disbursed by
     *  claim_payout). The claim keeper backfills this after each on-chain claim
     *  confirms; `dueForClaim` uses `paidUsdc < payoutAmountUsdc` to find rows
     *  still owed money. Absent/0 = nothing paid on-chain yet. */
    paidUsdc: v.optional(v.number()),
    /** Terminal claim flag: the on-chain claim will never pay more (budget
     *  exhausted on a 0-progress crank, or fully settled per the estimate). Once
     *  true the row leaves `dueForClaim` so the keeper stops cranking — closes
     *  the forever-cranking gas leak on a budget-clamped/wedged row. */
    claimDone: v.optional(v.boolean()),
    /** Cumulative NET USDC already credited to the agent's NAV for THIS
     *  submission (gross − protocol fee, summed across claim tranches). The
     *  per-tranche idempotency guard: each tick credits only
     *  (newCumulativeNet − navCreditedUsdc), so a multi-tranche payout never
     *  under- or double-credits, and a transient credit failure self-heals
     *  (this only advances by the amount actually credited). */
    navCreditedUsdc: v.optional(v.number()),
    /** On-chain ClaimRecord PDA for this submission (from recordPerformanceTx).
     *  Recorded for UI/reconcile; not load-bearing for the mirror. */
    claimPda: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    /** Epoch ms of the latest on-chain RE-attestation (staleness-basis refresh).
     *  The oracle re-records `record_performance` with the same stored viewCount
     *  every tick for approved-but-unpaid v2 clips so `last_recorded_slot` stays
     *  fresh and claims never go permanently `AttestationStale`. Audit/UI only —
     *  not load-bearing for the mirror. */
    lastReattestAt: v.optional(v.number()),
    /** Consecutive analytics sample awaiting a second, stable reading. */
    growthCandidateViews: v.optional(v.number()),
    growthCandidateAt: v.optional(v.number()),
    lastGrowthMeasuredAt: v.optional(v.number()),
    /** Upload-post request_id captured at post time (async/scheduled uploads). */
    uploadPostRequestId: v.optional(v.string()),
    /** Native platform post id (e.g. TikTok video id) — the durable analytics key. */
    platformPostId: v.optional(v.string()),
    /** Epoch ms the post went live (maturation anchor for the oracle). */
    postedAt: v.optional(v.number()),
    /** Oracle marked this submission for human review (proxy/unsupported/unreadable
     *  analytics). TERMINAL off the "submitted" scan — status becomes "needs_review"
     *  and this records why. Admins list these via the `by_status` index. */
    reviewReason: v.optional(v.string()),
    /** Non-blocking fraud signals carried on an APPROVED payout (audit trail) — e.g.
     *  ["engagement:low_ratio"]. Suspicious-but-paid submissions stay reviewable. */
    reviewFlags: v.optional(v.array(v.string())),
    /** When this Convex submission is the USDC money-rail mirror of a jobtepi/ryze
     *  `content_rewards_submissions` row (an agent posted to a content_reward that
     *  has a funded treasury), that Supabase submission's id. The oracle backfills
     *  the measured views onto it (ryze display) after settling. NEVER used to move
     *  money — the USDC moves via this Convex submission + the on-chain claim. */
    contentRewardSubmissionId: v.optional(v.string()),
  })
    .index("by_campaign", ["campaignId"])
    // Per-post dedupe (submitForCampaign) reads exactly THIS agent's rows for THIS
    // campaign — bounded + complete (never scans other agents' rows), so a duplicate
    // post can't slip past the read window and mint a second on-chain ClaimRecord.
    .index("by_campaign_and_mint", ["campaignId", "influencerMint"])
    .index("by_submitter", ["submitterWallet"])
    .index("by_influencer_mint", ["influencerMint"])
    .index("by_status", ["status"]),

  /** Immutable on-chain payout receipts, one row per cumulative-paid watermark. */
  campaignPayoutEvents: defineTable({
    submissionId: v.id("submissions"),
    mintAddress: v.string(),
    campaignId: v.id("campaigns"),
    txSignature: v.string(),
    grossDeltaUsdc: v.number(),
    cumulativePaidUsdc: v.number(),
    recordedAt: v.number(),
  }).index("by_mint", ["mintAddress"]).index("by_submission_paid", ["submissionId", "cumulativePaidUsdc"]),

  // JOB-68 — worker-specific B2B profile, 1:1 with a canonical `influencers`
  // agent (agentType="worker"). Replaces the retired `aiWorkers` table: the
  // agent identity (mint, wallet, shares, on-chain equity) now lives on
  // `influencers`, while these operational/marketplace fields hang off it here.
  workerProfiles: defineTable({
    influencerId: v.id("influencers"),
    mintAddress: v.string(),
    builderWallet: v.string(),
    builderName: v.string(),
    category: v.string(),
    vertical: v.string(),
    capabilities: v.array(v.string()),
    monthlyPrice: v.number(),
    personality: v.object({
      warmth: v.number(),
      professionalism: v.number(),
      empathy: v.number(),
      assertiveness: v.number(),
    }),
    rating: v.number(),
    reviewCount: v.number(),
    totalCustomers: v.number(),
    status: v.string(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_influencer", ["influencerId"])
    .index("by_mint", ["mintAddress"])
    .index("by_builder", ["builderWallet"])
    .index("by_category", ["category"])
    .index("by_status", ["status"]),

  workerHires: defineTable({
    workerId: v.id("influencers"),
    businessWallet: v.string(),
    businessName: v.string(),
    businessLogoUrl: v.optional(v.string()),
    vertical: v.string(),
    monthlyBudget: v.number(),
    status: v.string(),
    integrations: v.array(
      v.object({
        platform: v.string(),
        connected: v.boolean(),
        accountId: v.optional(v.string()),
      })
    ),
    businessContext: v.object({
      whatYouSell: v.string(),
      targetCustomer: v.string(),
      brandVoice: v.string(),
      priceRange: v.string(),
      shippingPolicy: v.string(),
      returnPolicy: v.string(),
      workingHours: v.string(),
    }),
    policies: v.object({
      maxDiscountPct: v.number(),
      approvalThresholdAmount: v.number(),
      escalateOn: v.array(v.string()),
      languages: v.array(v.string()),
    }),
    startedAt: v.string(),
  })
    .index("by_worker", ["workerId"])
    .index("by_business", ["businessWallet"])
    .index("by_status", ["status"]),

  workerActivity: defineTable({
    hireId: v.id("workerHires"),
    workerId: v.id("influencers"),
    type: v.string(),
    summary: v.string(),
    platform: v.string(),
    amount: v.optional(v.number()),
    customerHandle: v.optional(v.string()),
  })
    .index("by_hire", ["hireId"])
    .index("by_worker", ["workerId"]),

  builderWorkspaces: defineTable({
    ownerWallet: v.string(),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    audience: v.optional(v.string()),
    knowledgeBaseText: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.string(),
  })
    .index("by_owner", ["ownerWallet"])
    .index("by_slug", ["slug"]),

  builderProducts: defineTable({
    workspaceId: v.id("builderWorkspaces"),
    ownerWallet: v.string(),
    name: v.string(),
    headline: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    deliverables: v.optional(v.array(v.string())),
    status: v.string(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerWallet"]),

  builderCampaigns: defineTable({
    workspaceId: v.id("builderWorkspaces"),
    productId: v.optional(v.id("builderProducts")),
    ownerWallet: v.string(),
    name: v.string(),
    angle: v.optional(v.string()),
    campaignType: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    budgetUsdc: v.optional(v.number()),
    ratePerThousandViews: v.optional(v.number()),
    status: v.string(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_owner", ["ownerWallet"]),

  nftDrafts: defineTable({
    sessionId: v.string(),
    creatorWallet: v.optional(v.string()),
    name: v.string(),
    handle: v.optional(v.string()),
    niche: v.string(),
    characterBible: v.optional(v.string()),
    avatarUrls: v.array(v.string()),
    /** The REAL photos the user uploaded as likeness references during avatar
     *  generation (hosted public URLs) — surfaced by the wizard's "Pick the
     *  face" step and default-selected as the identity reference. */
    referencePhotoUrls: v.optional(v.array(v.string())),
    questionnaire: v.object({
      backstory: v.optional(v.string()),
      traits: v.optional(v.array(v.string())),
      beliefs: v.optional(v.array(v.string())),
      catchphrase: v.optional(v.string()),
      dreamCollab: v.optional(v.string()),
      contentPillars: v.optional(v.array(v.string())),
      voiceArchetype: v.optional(v.string()),
      language: v.optional(v.string()),
      avoidTopics: v.optional(v.array(v.string())),
      audience: v.optional(v.string()),
    }),
    mintStatus: v.string(),
    mintTxSignature: v.optional(v.string()),
    mintAddress: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_creator", ["creatorWallet"])
    .index("by_status", ["mintStatus"])
    .index("by_mint", ["mintAddress"]),

  /** Append-only agent-mint fee ledger — the money-safe backing for "first two agents
   *  free, then $10" (see convex/mintFee.ts). One row per builder session; only
   *  internal-secret mutations write it, and rows are never deleted, so neither a
   *  client-flipped draft nor an agent deletion can re-earn the freebie. */
  agentMintCharges: defineTable({
    sessionId: v.string(),
    creatorWallet: v.string(),
    creatorDid: v.optional(v.string()),
    creatorWallets: v.optional(v.array(v.string())),
    agentLimit: v.optional(v.number()),
    mintAddress: v.optional(v.string()),
    feeUsdc: v.number(),
    reason: v.string(),
    /** reserved → claimed/paid → minted */
    status: v.string(),
    /** The verified $10 USDC fee-transfer signature (paid mints only). */
    txSignature: v.optional(v.string()),
    createdAt: v.number(),
    /** When the row became committed (claimed/paid). A "claimed" free row whose
     *  agent creation died mid-flight ages out of the prior-mint count after
     *  CLAIM_TTL so the account's real first mint isn't wrongly charged. */
    committedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_wallet", ["creatorWallet"])
    .index("by_did", ["creatorDid"])
    .index("by_mint", ["mintAddress"]),

  agentKnowledge: defineTable({
    sessionId: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    category: v.string(),
    links: v.array(v.string()),
    entryType: v.optional(v.string()), // "user_added" | "auto_skill" | "auto_persona" | "auto_memory"
    localId: v.optional(v.string()),   // mirrors localStorage id for deduplication
  })
    .index("by_session", ["sessionId"])
    .index("by_session_category", ["sessionId", "category"]),

  /**
   * Tasks the agent has executed or is queued to run.
   * Powers the autonomy loop described in VELLO_VISION § 5.4 — observe → recall → think → act → learn.
   */
  agentTasks: defineTable({
    mintAddress: v.string(),      // links to influencer NFT
    sessionId: v.string(),        // links to builder session
    type: v.string(),             // "create_video" | "post_content" | "analyze_trend" | "engage_comment" | "research" | "campaign_submit" | "custom"
    status: v.string(),           // "pending" | "running" | "succeeded" | "failed" | "cancelled" | "awaiting_approval"
    title: v.string(),            // human-readable summary
    input: v.optional(v.string()),    // JSON-encoded task parameters
    output: v.optional(v.string()),   // JSON-encoded result
    errorMessage: v.optional(v.string()),
    cost: v.optional(v.number()),     // USDC equivalent consumed
    revenue: v.optional(v.number()),  // USDC equivalent earned
    triggeredBy: v.optional(v.string()), // "user" | "scheduler" | "campaign_match" | "incoming_message"
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    /** Credits reserved UP FRONT when a paid task starts (create_video): taken
     *  from the payer's balance atomically before any render, then settled on
     *  success (actual cost kept, rest refunded) or refunded in full on
     *  fail/cancel/timeout. Without it credits were only charged AFTER a render
     *  finished, so a free account could start many videos at once on 300
     *  credits and the extras rendered unpaid. */
    walletHold: v.optional(v.object({ amountUsdc: v.number(), settled: v.boolean() })),
    // Paid on-chain from the agent wallet BEFORE the render started (pay-first). `succeed` bills only any overage; `fail` voids it.
    prepaid: v.optional(v.object({ usdc: v.number(), runId: v.string() })),
    creditHold: v.optional(v.object({ wallet: v.string(), credits: v.number(), settled: v.boolean() })),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_session", ["sessionId"])
    .index("by_status", ["status"])
    .index("by_mint_status", ["mintAddress", "status"]),

  /**
   * Episodic memory — notable events the agent should recall.
   * Distinct from agentKnowledge (which is the user-curated knowledge base).
   * This is the AI's own recollection of past task outcomes, lessons, customer interactions.
   */
  agentMemory: defineTable({
    mintAddress: v.string(),
    // Per-project identity that exists BEFORE mint (the builder session). Memory is
    // scoped by this pre-mint so it never pools with other projects under "" and the
    // builder graph shows only the current project's memory. Post-mint reads use
    // mintAddress. See lib/agentMemoryScope.ts.
    sessionId: v.optional(v.string()),
    kind: v.string(),             // "lesson" | "preference" | "relationship" | "performance" | "warning"
    summary: v.string(),           // 1-2 sentence takeaway
    context: v.optional(v.string()), // JSON-encoded fuller context
    importance: v.number(),        // 0-100, used for retrieval ranking
    sourceTaskId: v.optional(v.id("agentTasks")),
    embedding: v.optional(v.array(v.float64())), // optional vector for semantic search
  })
    .index("by_mint", ["mintAddress"])
    .index("by_mint_importance", ["mintAddress", "importance"])
    .index("by_session_importance", ["sessionId", "importance"]),

  /**
   * Per-skill markdown instructions for an agent. Editable in the builder
   * (pre-mint by sessionId) and persisted post-mint via mintAddress.
   */
  /**
   * Ads Library cache (/recreate/library): the scraped trending/top-converting
   * UGC ads feed, ONE row per cache key ("topads"). `payload` is the JSON blob
   * of ad items; refreshed server-side when stale (video CDN URLs expire).
   */
  adsLibraryCache: defineTable({
    key: v.string(),
    payload: v.string(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Learn tab (influencer): operator-uploaded EXAMPLE videos the agent studies.
   * Each row is one example — transcribed + vision-analyzed into a detailed
   * styleProfile; `selected` rows steer every future render (style block in the
   * prompts + a sampled frame as a visual reference). Keyed like agentSkillFiles:
   * mintAddress for minted agents, sessionId for drafts (mintKey = whichever).
   */
  agentStyleReferences: defineTable({
    mintKey: v.string(),
    videoUrl: v.string(),
    title: v.string(),
    status: v.union(v.literal("analyzing"), v.literal("ready"), v.literal("failed")),
    // Spoken words of the example (whole-video transcript).
    transcript: v.optional(v.string()),
    // Agentic style analysis: format, hook mechanics, pacing, camera, lighting,
    // grade, presenter energy, speech style, caption style, structure.
    styleProfile: v.optional(v.string()),
    // Hosted sampled frames (https) — visual references for the render engines.
    frameUrls: v.optional(v.array(v.string())),
    // Operator toggle: use this example as a live style reference for renders.
    selected: v.boolean(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mintKey", ["mintKey"]),

  agentSkillFiles: defineTable({
    mintAddress: v.optional(v.string()), // empty before mint
    sessionId: v.string(),
    skillId: v.string(),                  // matches SkillDef.id (e.g. "sk-aesthetic")
    title: v.string(),                    // skill label
    markdown: v.string(),                 // the MD content (max ~50KB)
    // Per-skill inspector config (clip skill nodes only) — the same per-node knobs
    // the canvas forwards on the skills array (captionPreset / captionPrompt /
    // hookDurationSec / hookTemplateId). Synced from the canvas so the CLOUD
    // auto-clip path (clipJobs.process) can honor them too. Loose blob.
    config: v.optional(v.any()),
    /** Canvas-synced: true when a skill NODE for this skillId exists on the graph,
     *  false when no node is wired. Library/Marketplace own row existence; this
     *  flag mirrors canvas presence so the cloud render only applies wired skills.
     *  undefined (legacy / pre-sync rows) is treated as wired by readers. */
    wired: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_mint", ["mintAddress"])
    .index("by_session_skill", ["sessionId", "skillId"]),

  /**
   * Generated images from the Photo Carousel Builder app (clip.carouselbuilder).
   * Each row is one KIE-generated still for a clipper agent, kept for the Carousel
   * tab's history grid + carousel selection. imageUrl is a durable public URL
   * (persistStill → Supabase), never the raw expiring KIE URL. status tracks whether
   * the image was posted to TikTok yet (best-effort).
   */
  carouselImages: defineTable({
    mintAddress: v.optional(v.string()), // empty before mint
    sessionId: v.string(),
    prompt: v.string(),
    engineId: v.string(),
    engineLabel: v.string(),
    imageUrl: v.string(),
    aspectRatio: v.optional(v.string()),
    status: v.union(v.literal("generated"), v.literal("posted")),
    postedAt: v.optional(v.number()),
    postUrl: v.optional(v.string()),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_session", ["sessionId"]),

  /**
   * Standalone Photo Carousel app (/carousel) — a per-USER tool, not tied to any
   * AI-influencer agent/mintAddress (unlike carouselImages above). One row per
   * "idea → auto-generated carousel" run. `slides` is a small bounded array (max
   * ~7, one per style's slide count), safe to embed rather than a child table.
   */
  /** Standalone Documentary app (/documentary) — story videos assembled from
   *  internet stock photos + ElevenLabs voiceover + a music bed. Per-USER tool
   *  (Privy ownerId), written only by the server route (secret-gated). */
  documentaryProjects: defineTable({
    ownerId: v.string(),
    prompt: v.string(),
    productUrl: v.optional(v.string()),
    voiceId: v.string(),
    musicMood: v.string(),
    /** Target spoken length in seconds, chosen on the composer slider (default 60). */
    durationSec: v.optional(v.number()),
    title: v.optional(v.string()),
    script: v.optional(v.string()),
    /** JSON scenes: [{narration, query, imageUrl?}] */
    scenes: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    statusMessage: v.string(),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"]),

  carouselProjects: defineTable({
    ownerId: v.string(), // Privy user id (AuthUser.id)
    prompt: v.string(),
    style: v.string(),
    websiteUrl: v.optional(v.string()),
    referenceImageUrl: v.optional(v.string()),
    title: v.string(),
    hook: v.string(),
    caption: v.optional(v.string()),
    slides: v.array(v.object({
      prompt: v.string(),
      imageUrl: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("generated"), v.literal("failed")),
      error: v.optional(v.string()),
    })),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
  })
    .index("by_owner", ["ownerId"]),

  /**
   * Standalone Recreate app (/recreate) — a per-USER tool (like carouselProjects
   * above), NOT tied to an AI-influencer agent/mintAddress. Durable state for a
   * chunked, Vercel-safe Veo render (mirrors videoRenderJobs' clip-chain fields —
   * see app/api/recreate/render-step/route.ts), but scoped to ownerId and with no
   * autoPost/economy coupling (this app never posts or bills an agent tab).
   */
  videoRecreateProjects: defineTable({
    ownerId: v.string(), // Privy user id (AuthUser.id)
    driveToken: v.string(), // unguessable per-job token — render-step auth
    sourceVideoUrl: v.string(),
    productImageUrl: v.optional(v.string()),
    // JSON string[] — extra product angle/detail images (user upload plus any
    // AI-picked shots scraped off the product's website) ridden as additional
    // Kie reference images for a more precise product render.
    productImageUrls: v.optional(v.string()),
    // Vision description of the uploaded product image (type/colors/packaging/
    // label text) — threads the EXACT replacement product into replan + KIE prompts.
    productDescription: v.optional(v.string()),
    // User's brand/product link — crawled by the research step at kickoff.
    referenceUrl: v.optional(v.string()),
    // Operator's free-text instruction — rides the replan + every render prompt
    // (grok), or steers the Aleph edit directly.
    userPrompt: v.optional(v.string()),
    // What the recreation promotes: "product" (photo upload), "web" (site link →
    // live screenshots), or "app" (App Store/Play link → real store screenshots).
    refMode: v.optional(v.string()),
    appStoreUrl: v.optional(v.string()),
    // JSON string[] — hosted site/app screenshots used as render references.
    screenshotUrls: v.optional(v.string()),
    // Research output: compact focus brief (product, real claims, tone, CTA)
    // fused from the crawled link + the uploaded image description.
    focusBrief: v.optional(v.string()),
    language: v.string(),
    race: v.string(),
    // Render engine: "grok" (default — full shot-for-shot recreation) or "wan"
    // (Wan 2.2 Animate Replace — swaps the presenter in the ORIGINAL footage).
    engine: v.optional(v.string()),
    // Wan: the person to swap into the footage (user upload, or a generated
    // candid iPhone-style presenter when nothing was uploaded).
    characterImageUrl: v.optional(v.string()),
    // Wan: source re-hosted after compression under Kie's 10MB input cap.
    wanSourceUrl: v.optional(v.string()),
    avatarUrl: v.optional(v.string()), // generated stand-in presenter reference
    /** KIE aspect bucket probed off the uploaded source ("9:16"|"16:9"|"1:1") —
     *  the render mirrors the upload's shape instead of defaulting vertical. */
    sourceAspect: v.optional(v.string()),
    phase: v.union(
      v.literal("understanding"), v.literal("planning"), v.literal("video"),
      v.literal("stitching"), v.literal("done"), v.literal("failed"),
    ),
    statusMessage: v.string(),
    // Understanding-phase output: JSON-encoded OriginalScene[] (scene cuts +
    // transcript segment + vision description per scene of the SOURCE video).
    scenes: v.optional(v.string()),
    // Planning-phase output: JSON-encoded StoryBeat[] (the recreation script).
    beats: v.optional(v.string()),
    // Grok chunked-chain state: JSON-encoded GrokChainPlan (built once at clip 0)
    // + seconds of cumulative video already rendered (extend_at anchor).
    grokPlan: v.optional(v.string()),
    accumulatedSeconds: v.optional(v.number()),
    // Clip-level Veo chain state — same shape/purpose as videoRenderJobs.
    segmentPrompts: v.optional(v.string()),
    standalonePrompts: v.optional(v.string()),
    refImages: v.optional(v.string()),
    totalSegments: v.optional(v.number()),
    clipIndex: v.optional(v.number()),
    veoTaskId: v.optional(v.string()),
    veoSeed: v.optional(v.number()),
    stitchMode: v.optional(v.boolean()),
    stitchClips: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    videoNote: v.optional(v.string()),
    attempts: v.number(),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]),

  /**
   * The clipping node graph (nodes + edges), persisted so it survives across
   * devices/browsers and is the SAME for anyone viewing the agent. Previously
   * localStorage-only (clipGraphStorage), so a different device/browser/user saw
   * an empty canvas (the template picker) — the operator's pipeline appeared
   * "gone". Keyed mint-preferred (the cloud-stable key) with a sessionId fallback
   * for pre-mint drafts, exactly like agentSkillFiles. nodes/edges are loose blobs
   * (the React-Flow shape lives in the client types); run-scoped status is stripped
   * on load by the client, so we store whatever the canvas serializes.
   */
  clipGraphs: defineTable({
    mintAddress: v.optional(v.string()), // empty before mint
    sessionId: v.string(),
    nodes: v.any(),
    edges: v.any(),
    updatedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_mint", ["mintAddress"]),

  /**
   * Builder chat transcripts, synced (debounced) from /builder for
   * wallet-connected users only. Powers the admin "Conversations" tab so
   * admins can read why a session did or didn't reach mint. Mint status is
   * NOT stored here — it is joined live from nftDrafts by sessionId.
   */
  builderSessions: defineTable({
    sessionId: v.string(),
    wallet: v.string(),
    agentType: v.optional(v.string()),     // "influencer" | "trader" | "worker" | ...
    projectName: v.optional(v.string()),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),                 // server-capped at 2,000 chars
      at: v.number(),
    })),                                   // server-capped at last 200 entries
    messageCount: v.number(),              // true total, including trimmed
    startedAt: v.number(),
    lastActivityAt: v.number(),
    mintAddress: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_wallet", ["wallet"])
    .index("by_lastActivity", ["lastActivityAt"]),

  /**
   * Live support-chat transcripts from the public landing widget (anonymous
   * visitors + logged-in users). Each turn (visitor message + AI reply) is
   * appended here; powers the admin "Live Chat" tab. Keyed by a client-generated
   * sessionId. Server-capped at the last 200 messages / 4,000 chars each.
   */
  // ── /control panel — per-account teams + chat history (synced across devices) ──
  controlTeams: defineTable({
    userId: v.id("users"),
    teamId: v.string(),                    // client-generated id (optimistic create)
    name: v.string(),
    memberMints: v.array(v.string()),
    brief: v.optional(v.string()),         // pinned team brief/goal, sent to every member
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_team", ["userId", "teamId"]),

  controlThreads: defineTable({
    userId: v.id("users"),
    key: v.string(),                       // agent mint, or "team:<teamId>"
    messages: v.array(controlMessageValidator), // server-capped at last 80 entries
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_key", ["userId", "key"]),

  liveChats: defineTable({
    sessionId: v.string(),
    wallet: v.optional(v.string()),        // set once a visitor is logged in
    name: v.optional(v.string()),          // optional display name captured up-front
    email: v.optional(v.string()),         // logged-in account email (server-verified token)
    userDid: v.optional(v.string()),       // logged-in account identity (users.supabaseId)
    page: v.optional(v.string()),          // the path the chat was opened from
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      at: v.number(),
    })),
    messageCount: v.number(),
    startedAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_session_live", ["sessionId"])
    .index("by_lastActivity_live", ["lastActivityAt"]),

  investments: defineTable({
    mintAddress: v.string(),        // agent NFT mint
    investorWallet: v.string(),
    sharesBought: v.number(),
    usdcAmount: v.number(),
    txSignature: v.string(),        // on-chain devnet tx
    sharePrice: v.number(),         // price at time of purchase
    investedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_investor", ["investorWallet"]),

  // Earnings distributions — when an agent's verified campaign work pays out, the
  // USDC is split (investors 50% / builder 45% / protocol 5%) and recorded here.
  // `splits` carries the per-investor cut + on-chain tx (or "pending" on devnet).
  distributions: defineTable({
    mintAddress: v.string(),
    campaignId: v.optional(v.string()),
    submissionId: v.optional(v.string()),     // idempotency key — one distribution per submission (v1 / single-tranche)
    /** Per-tranche idempotency key (`${submissionId}:${cumulativeNetUsdc}`) for
     *  the v2 on-chain claim path, where one submission is paid across several
     *  claim ticks. When set, dedup keys on THIS instead of submissionId so each
     *  tranche records its own row (multi-tranche under-credit fix) while a true
     *  re-crank of the same tranche stays a no-op. */
    trancheKey: v.optional(v.string()),
    totalPayoutUsdc: v.number(),
    investorUsdc: v.number(),
    builderUsdc: v.number(),
    protocolUsdc: v.number(),
    splits: v.array(v.object({
      wallet: v.string(),
      role: v.string(),                        // "investor" | "builder" | "protocol"
      shares: v.optional(v.number()),
      usdc: v.number(),
      txSignature: v.optional(v.string()),
      status: v.string(),                      // "paid" | "pending" | "failed"
    })),
    status: v.string(),                        // "paid" | "partial" | "pending"
    /** What produced this earning, so the wallet can label it as the agent's
     *  earned income: "hire" (a commissioned video) | "campaign" (verified
     *  campaign payout). Absent on legacy rows → treated as "campaign". */
    source: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_submission", ["submissionId"])
    .index("by_tranche", ["trancheKey"]),

  // ─── Agent economic account (spine) ─────────────────────────────────────────
  // One authoritative money account per agent. `escrowUsdc`/`liquidUsdc` mirror
  // on-chain cash; the ledgers below own shares + what's owed. Spec §4.2.
  agentAccount: defineTable({
    mintAddress: v.string(),
    sharesOutstanding: v.number(),
    escrowUsdc: v.number(),
    liquidUsdc: v.number(),          // escrow not deployed in open positions
    generationReservedUsdc: v.optional(v.number()),
    unsettledTabUsdc: v.number(),    // accrued, not-yet-settled service fees
    status: v.union(v.literal("active"), v.literal("needs_funding"), v.literal("suspended")),
    seedSharePrice: v.number(),
    plannedSupply: v.number(),       // fixed buy-cap denominator (default INITIAL_SHARE_SUPPLY)
    // Cumulative signed sum of admin escrow adjustments. Reconciliation reads
    // escrow as (on-chain balance + this offset) so admin changes survive it.
    adminAdjustmentUsdc: v.optional(v.number()),
    // Cumulative off-chain earnings credited to escrow that have NO on-chain
    // counterpart (v1 creditEarnings/creditAndRecord raise NAV as pure ledger
    // bookkeeping — no USDC ever lands in the wallet). Like adminAdjustmentUsdc,
    // reconcile RE-ADDS this on top of the live on-chain balance so a chain read
    // (which can't see it) never ERASES legitimately-credited NAV (H5). Absent →
    // treated as 0 (legacy rows / agents with no off-chain earnings).
    offchainCreditedUsdc: v.optional(v.number()),
    /** Per-agent daily spend cap (USDC). Unset → global env default; 0 → no
     *  limit. Edited from the agent's home tab. */
    dailyCapUsdc: v.optional(v.number()),
    /** On-chain vault PDA address (base58). Set at mint if PLATFORM_VAULT_AUTHORITY_SECRET is configured. */
    vaultAddress: v.optional(v.string()),
    /** Hex-encoded sha256(sessionId) — the 32-byte agent_id used as the on-chain vault seed. */
    vaultAgentId: v.optional(v.string()),
    /** True once the vault has been initialized on-chain and is ready to receive funds. */
    vaultEnabled: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    // Hourly settle-due cron range-reads accounts with a positive unsettled tab
    // through this index instead of scanning the whole agentAccount table.
    .index("by_unsettled_tab", ["unsettledTabUsdc"]),

  // ─── User credit balance (spine for web2-feeling billing) ──────────────────
  // One row per owning wallet — pooled across every agent that wallet owns.
  // Fiat top-ups, subscription grants, and crypto deposits ALL land here; this
  // is the single balance recordUsage() checks before falling back to the
  // per-agent agentAccount USDC path. Spec: docs/superpowers/specs/2026-08-20-user-credits-billing-design.md
  // Paid per-agent add-ons (TikTok posting, $10 USD per month). activeUntil is
  // extended by each paid Stripe invoice; the connect route refuses without it.
  agentAddons: defineTable({
    mintAddress: v.string(),
    addon: v.literal("tiktok"),
    ownerWallet: v.string(),
    activeUntil: v.number(),
    lastStripeEventId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_mint_addon", ["mintAddress", "addon"]),

  // Explore "Schedule": a motion-transfer render queued for later. A per-minute cron submits
  // due rows to Higgsfield, then polls submitted rows until the video lands.
  scheduledRecreations: defineTable({
    mintAddress: v.string(),
    referenceId: v.string(),
    referenceTitle: v.string(),
    referencePoster: v.optional(v.string()),
    videoUrl: v.string(),
    imageUrls: v.array(v.string()),
    prompt: v.string(),
    mode: v.union(v.literal("motion-transfer"), v.literal("object-swap")),
    resolution: v.union(v.literal("480p"), v.literal("720p"), v.literal("1080p")),
    runAt: v.number(),
    repeat: v.union(v.literal("once"), v.literal("daily"), v.literal("weekly")),
    remaining: v.number(),
    status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("submitted"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    requestId: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    // Billing + auto-post. Price is recomputed server side from the trusted reference duration.
    durationSec: v.optional(v.number()),
    billingRunId: v.optional(v.string()),
    autoPost: v.optional(v.boolean()),
    postStatus: v.optional(v.union(v.literal("posted"), v.literal("failed"))),
    caption: v.optional(v.string()),
    postError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_mint", ["mintAddress", "createdAt"]).index("by_status_runAt", ["status", "runAt"]),

  userCredits: defineTable({
    ownerWallet: v.string(),
    balanceCredits: v.number(),
    totalPurchasedCredits: v.number(),
    totalSpentCredits: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerWallet"]),

  // Append-only history of every credit in/out for a wallet: purchases,
  // subscription grants, crypto deposits, spend, refunds, admin adjustments.
  // Separate from usageLedger (which is per-agent/mintAddress and spend-only) —
  // this is per-wallet and covers money moving BOTH directions.
  creditLedger: defineTable({
    ownerWallet: v.string(),
    kind: v.union(
      v.literal("purchase"),
      v.literal("subscription_grant"),
      v.literal("crypto_deposit"),
      v.literal("spend"),
      v.literal("refund"),
      v.literal("admin_adjustment"),
      v.literal("signup_grant"),
    ),
    deltaCredits: v.number(),
    balanceAfter: v.number(),
    relatedMintAddress: v.optional(v.string()),
    relatedUsageLedgerId: v.optional(v.id("usageLedger")),
    stripeEventId: v.optional(v.string()),
    txSignature: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerWallet", "createdAt"])
    .index("by_stripe_event", ["stripeEventId"])
    .index("by_tx_signature", ["txSignature"]),

  // Every share buy / redeem / founder grant. Authoritative share ownership.
  shareLedger: defineTable({
    mintAddress: v.string(),
    wallet: v.string(),
    kind: v.union(v.literal("buy"), v.literal("redeem"), v.literal("founder")),
    shares: v.number(),              // signed: + on buy/founder, − on redeem
    navPerShare: v.number(),
    usdcAmount: v.number(),          // deposit (buy) or payout (redeem)
    exitFeeUsdc: v.optional(v.number()),
    txSignature: v.optional(v.string()),
    at: v.number(),
  }).index("by_mint", ["mintAddress"]).index("by_wallet", ["wallet"]),

  // ─── Share-redemption idempotency + recovery ledger (H4) ─────────────────────
  // One row per redemption INTENT, keyed by a caller-stable `idempotencyKey`. The
  // burn (a shareLedger `redeem` row + the escrow debit) and this row are created
  // ATOMICALLY by shareRedemptions.begin; the USDC transfer follows. A same-key
  // retry of a confirm-timeout returns the SAME row (never re-burns, never
  // re-broadcasts); the recovery keeper (recover-redemptions) finalizes a stranded
  // pending row — verifying any broadcast signature on-chain BEFORE re-transferring
  // — or REVERSES the burn when the payout provably never moved. Mirrors the
  // feeSettlements settlement-recovery pattern but as a dedicated table (a
  // redemption has no pre-existing row to overload a sentinel onto).
  shareRedemptions: defineTable({
    mintAddress: v.string(),
    holderWallet: v.string(),
    /** Caller-stable dedup key — a client retry MUST reuse it so the second call
     *  is recognised as the same intent (returns the existing row, no re-burn). */
    idempotencyKey: v.string(),
    sharesBurned: v.number(),
    /** USDC the holder is owed (shares × NAV − 2% exit fee) — the keeper needs it
     *  to (re-)transfer, and markFailed to reverse the exact escrow debit. */
    payoutUsdc: v.number(),
    exitFeeUsdc: v.number(),
    /** The shareLedger `redeem` row this burn wrote — deleted on reversal
     *  (markFailed) and stamped with the payout sig on success (markPaid). */
    redeemRowId: v.id("shareLedger"),
    /** pending → paid (transfer confirmed) | failed (burn reversed). While pending
     *  a set `txSignature` means "broadcast but unconfirmed" (the keeper verifies
     *  it on-chain before deciding to re-transfer). */
    status: v.string(),
    /** A broadcast payout signature: the CONFIRMED one when status=paid, or a
     *  confirm-ambiguous one while still pending (the keeper's re-transfer guard).
     *  Absent = no transfer has been broadcast, so no USDC has moved. */
    txSignature: v.optional(v.string()),
    /** The ambiguous tx's blockhash lastValidBlockHeight — lets the keeper prove
     *  expiry (tip past it ⇒ the sig can never land ⇒ safe to re-transfer). */
    lastValidBlockHeight: v.optional(v.number()),
    /** Keeper passes this row has survived — drives the reverse + alert policy. */
    attempts: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    /** Bumped on every mutation; the keeper's grace/soft-lease basis (a touched
     *  row leaves the stranded list for REDEMPTION_GRACE_MS). */
    updatedAt: v.number(),
  })
    .index("by_idem", ["idempotencyKey"])
    .index("by_mint_status", ["mintAddress", "status"])
    .index("by_pending_at", ["status", "updatedAt"]),

  // Every priced service the agent consumed (the metered tab line items).
  // Async source-download jobs: long YouTube videos through the residential
  // proxy exceed a single request's timeout, so the download runs off-thread
  // and the client polls this row for the resulting storage URL.
  downloadJobs: defineTable({
    sourceUrl: v.string(),
    status: v.union(v.literal("downloading"), v.literal("done"), v.literal("error")),
    url: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    error: v.optional(v.string()),
    at: v.number(),
  }),

  // History of admin "Samples" tool runs (apps/web/app/admin/samples) — one row
  // per generate call, written once all 3 clips finish (success or fail). Powers
  // the page's history list AND the "reuse a past link" selector (distinct
  // sourceUrls, newest first) so re-picking a link the admin already sample-
  // clipped skips re-typing it — the actual credit saving on a repeat link comes
  // from transcriptCache (transcribe-clip route), not from this table itself.
  // No custom index: `.order("desc")` on the default table scan sorts by
  // _creationTime, which is all a "recent history" list needs.
  sampleRuns: defineTable({
    sourceUrl: v.string(),
    createdAt: v.number(),
    clips: v.array(v.object({
      templateId: v.string(),
      templateLabel: v.string(),
      ok: v.boolean(),
      clipUrl: v.optional(v.string()),
      title: v.optional(v.string()),
      captionText: v.optional(v.string()),
      viralScore: v.optional(v.number()),
      startSeconds: v.optional(v.number()),
      endSeconds: v.optional(v.number()),
      error: v.optional(v.string()),
    })),
  }),

  // Admin "UGC Sample" demo runs (app/admin/ugc-sample) — one row per client
  // demo: a website URL + the operator's uploaded presenter photo, broken down
  // into a product summary and exactly 3 fixed-format sample videos (reaction /
  // cartoon soft-sell / realistic review). Slots update independently as their
  // background renders progress, so the page's cards animate live via useQuery.
  // Distinct from `sampleRuns` above, which is the CLIPPER sample tool (cuts an
  // existing podcast/video); this one GENERATES original UGC from a website.
  // Public LAUNCH funnel runs (index page → paste website → auto-named + minted
  // agent → 3 sample videos). One doc per launch; the video slots live on a
  // linked ugcSampleRuns doc (same workers as the admin tool), clipper clips
  // (when a long-form link was given) are stored inline. Rate-limited per owner
  // in `create` — every stage burns Kie credits.
  launchRuns: defineTable({
    ownerDid: v.string(),
    creatorWallet: v.string(),
    websiteUrl: v.string(),
    sourceUrl: v.optional(v.string()),
    /** analyzing | naming | minting | rendering | done | failed */
    stage: v.string(),
    error: v.optional(v.string()),
    productSummary: v.optional(v.string()),
    agentName: v.optional(v.string()),
    handle: v.optional(v.string()),
    niche: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    mintAddress: v.optional(v.string()),
    ugcRunId: v.optional(v.id("ugcSampleRuns")),
    /** Set when the presenter/avatar generation failed → no UGC samples run. */
    samplesSkipped: v.optional(v.boolean()),
    clips: v.optional(v.array(v.object({
      templateId: v.string(),
      templateLabel: v.string(),
      ok: v.boolean(),
      clipUrl: v.optional(v.string()),
      title: v.optional(v.string()),
      error: v.optional(v.string()),
    }))),
    clipsError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerDid", "createdAt"]),

  ugcSampleRuns: defineTable({
    websiteUrl: v.string(),
    /** Display name for the pack card — derived from the site's domain. */
    clientName: v.optional(v.string()),
    /** Language every script/story in this run was written in. */
    language: v.optional(v.string()),
    /** "physical" | "app" | "service" — persisted so single-slot retries rebuild
     *  the exact same script/visual guidance. */
    clientType: v.optional(v.string()),
    /** Scraped site text (trimmed) — persisted for the same retry reason. */
    websiteText: v.optional(v.string()),
    photoUrl: v.string(),
    productSummary: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    productImageUrl: v.optional(v.string()),
    /** Vision-ranked product references (best first, ≤3, Kie-normalized) — every
     *  image/video prompt attaches ALL of them so the model actually sees the
     *  product (physical: multi-angle photos; app: real UI screens). */
    productImageUrls: v.optional(v.array(v.string())),
    createdAt: v.number(),
    slots: v.array(v.object({
      type: v.string(),             // "reaction" | "cartoon" | "review"
      label: v.string(),
      engine: v.string(),           // engine id shown in the UI ("grok-imagine-15" / "gemini-omni")
      status: v.string(),           // "pending" | "scripting" | "rendering" | "done" | "failed"
      concept: v.optional(v.string()),
      script: v.optional(v.string()),
      videoUrl: v.optional(v.string()),
      /** Carousel slots: the generated slide images, in order. */
      imageUrls: v.optional(v.array(v.string())),
      error: v.optional(v.string()),
    })),
  }),

  // Byte-cache of source downloads (yt-dlp/direct/Drive pulls made while
  // clipping), so re-pasting the same link — or re-cutting the same clip
  // window — reuses the already-downloaded Convex storage object instead of
  // re-running yt-dlp + re-uploading. Keyed by (sourceUrl, mode, sectionKey):
  // "full"/"audio" pulls key on the URL alone (sectionKey ""); a "segment"
  // pull additionally keys on its [start,end] window (sectionKey "12-34"),
  // since two different windows of the same source are different artifacts.
  // mintAddress is the agent that most recently used the link, so the
  // builder's Downloads tab can list "content downloaded for this agent" even
  // though the underlying storage object may be shared/reused across agents
  // pasting the same link.
  downloadCache: defineTable({
    sourceUrl: v.string(),
    // Optional (not just widened-for-migration): a handful of rows were written
    // by the very first version of this table, before mode/sectionKey existed —
    // keeping them optional means a schema push never needs to validate old rows
    // against a newly-required field (which needs a data:view grant this repo's
    // deploy key doesn't have). Readers treat a missing mode as "full".
    mode: v.optional(v.string()),
    sectionKey: v.optional(v.string()),
    url: v.string(),
    storageId: v.string(),
    durationSeconds: v.optional(v.number()),
    mintAddress: v.optional(v.string()),
    createdAt: v.number(),
  })
    // Deliberately still keyed on sourceUrl ALONE (not [sourceUrl,mode,sectionKey])
    // — this repo's deploy key lacks the deployment:data:view grant an index
    // rename/add on an existing table needs (it has to scan+backfill existing
    // rows), so a NEW composite index can't be pushed without dashboard access.
    // At most ~3 rows share a sourceUrl (full/audio/segment variants), so the
    // handlers just filter that tiny result set in JS instead of indexing on it.
    .index("by_url", ["sourceUrl"])
    .index("by_mint", ["mintAddress", "createdAt"]),

  usageLedger: defineTable({
    mintAddress: v.string(),
    service: v.string(),
    qty: v.number(),
    unitPriceUsdc: v.number(),
    /** The REAL cost of the metered work, ALWAYS written regardless of which
     *  balance paid for it. Daily caps, spend analytics, reconcile and the
     *  refund path all read this as ground truth, so a credits-funded charge
     *  must NOT write 0 here (that silently zeroed every spend report). Who
     *  paid is recorded separately in `paidWith`. */
    costUsdc: v.number(),
    /** Which balance actually paid: the owner's prepaid `userCredits` pool, or
     *  the agent's own on-chain USDC (`agentAccount.unsettledTabUsdc` → swept to
     *  the treasury). Optional for legacy rows written before the field existed
     *  — absent means the agent-account path (the only one that existed then).
     *  ONLY `agent_account` rows may ever touch `unsettledTabUsdc`. */
    paidWith: v.optional(v.union(v.literal("credits"), v.literal("agent_account"))),
    /** Set once swept by a fee settlement. Also carries two SENTINELS that mean
     *  "never sweep this row": `refund:<jobId>` (voided by a refund) and
     *  `credits` (paid from the owner's credit balance — it never rode the
     *  agent's tab, so settleTab/reconcile must not see it as unsettled). */
    settledBatchId: v.optional(v.string()),
    /** Caller-supplied idempotency key (e.g. `${runId}:render:2`) — a retry of
     *  the same billable step returns the prior row instead of double-charging. */
    idemKey: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_mint_idem", ["mintAddress", "idemKey"])
    .index("by_mint_at", ["mintAddress", "at"])
    // settleTab reads only the UNSETTLED tail (settledBatchId === undefined) for a
    // mint through this index instead of collecting the agent's whole lifetime
    // ledger and filtering in JS.
    .index("by_mint_settled", ["mintAddress", "settledBatchId"]),

  // Each batched keeper sweep of the tab from escrow → treasury.
  feeSettlements: defineTable({
    mintAddress: v.string(),
    amountUsdc: v.number(),
    coversUsageIds: v.array(v.string()),
    txSignature: v.optional(v.string()),
    /** Denormalized index key kept in lockstep with `isPaidSig(txSignature)`:
     *  false when booked/INFLIGHT, true once a real on-chain signature is stamped
     *  (markSettlementPaid). Lets the recovery keeper range-read ONLY unpaid rows
     *  via `by_paid_at` instead of scanning every (mostly-paid) settlement. Legacy
     *  rows have it undefined until the one-time `backfillSettlementPaid` runs. */
    paid: v.optional(v.boolean()),
    at: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_paid_at", ["paid", "at"])
    // Per-mint unpaid slice: lets reconcile sum the unpaid-settlement hold-out from
    // ONLY the (small) paid!=true rows for a mint, instead of an unbounded by_mint
    // scan of the mostly-paid lifetime history (which throws past Convex's ~16k-row
    // read cap on a busy agent). Query paid===false + legacy paid===undefined.
    .index("by_mint_paid", ["mintAddress", "paid"]),

  // Owner-initiated withdrawals of an agent's spendable on-chain USDC to the
  // owner's (creatorWallet) wallet. One row per client idempotencyKey — a retried
  // request with the same key NEVER re-sends (the by_idem unique index + the
  // begin() single-in-flight lock are the double-spend guards). `txSignature` is
  // set once a transfer is broadcast (paid, OR confirm-ambiguous where the tx MAY
  // have landed → the recover-withdrawals keeper verifies before re-transferring).
  // `lastValidBlockHeight` lets the keeper prove blockhash expiry before a safe
  // re-transfer. Mirrors the feeSettlements recovery machinery.
  agentWithdrawals: defineTable({
    mintAddress: v.string(),
    ownerWallet: v.string(),           // destination = agent.creatorWallet (server-set, never client)
    amountUsdc: v.number(),
    idempotencyKey: v.string(),        // client UUID, reused on a network retry
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("failed")),
    txSignature: v.optional(v.string()),        // broadcast sig (paid or confirm-ambiguous)
    lastValidBlockHeight: v.optional(v.number()), // blockhash expiry for the keeper
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idem", ["idempotencyKey"])
    .index("by_mint_status", ["mintAddress", "status"])
    .index("by_pending_at", ["status", "createdAt"]),

  // Audit log of manual admin escrow adjustments (off-chain ledger only —
  // no on-chain USDC moves). One row per adjustment, reason required.
  adminAdjustments: defineTable({
    mintAddress: v.string(),
    adminEmail: v.string(),
    deltaUsdc: v.number(),          // signed: + credit, − deduction
    reason: v.string(),
    escrowBefore: v.number(),
    escrowAfter: v.number(),
    at: v.number(),
  }).index("by_mint", ["mintAddress"]),

  // Admin override of a marketplace skill's per-run price (charged to agents).
  // A row = an active override for `skillId`; ABSENCE = use the static default in
  // lib/economy/servicePrices.ts. The charge path (usage.recordUsage) reads the
  // override here and applies it via priceForWithOverride; there is at most one
  // row per skillId (by_skill unique).
  skillPriceOverrides: defineTable({
    skillId: v.string(),
    priceUsdc: v.number(),
    updatedByEmail: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_skill", ["skillId"]),

  // ─── AI Trader vertical ────────────────────────────────────────────────────
  // StrategySpec for an AI Trader — the executable plan that drives the loop.
  // One row per agent (linked by mintAddress when minted, sessionId pre-mint).
  traderStrategies: defineTable({
    sessionId: v.string(),
    mintAddress: v.optional(v.string()),
    creatorWallet: v.optional(v.string()),
    name: v.string(),
    summary: v.optional(v.string()),
    spec: v.string(),                 // JSON-encoded StrategySpec
    status: v.string(),               // "draft" | "paper_trading" | "live" | "paused" | "archived"
    lastRunAt: v.optional(v.number()),
    signalsSeen: v.optional(v.number()),
    tradesExecuted: v.optional(v.number()),
    pnlUsdc: v.optional(v.number()),
    isHalalCompliant: v.optional(v.boolean()),
  })
    .index("by_session", ["sessionId"])
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"])
    .index("by_creator", ["creatorWallet"]),

  // Every signal ingested by a trader — full audit trail.
  traderSignals: defineTable({
    strategyId: v.id("traderStrategies"),
    source: v.string(),               // "x_keywords" | "x_accounts" | "solana_onchain" | ...
    payload: v.string(),              // raw signal as JSON
    sentimentScore: v.optional(v.number()), // -1.0 .. 1.0 when applicable
    decisionAction: v.optional(v.string()), // "BUY" | "SELL" | "HOLD" | "ALERT" | "SKIP"
    decisionReason: v.optional(v.string()),
    seenAt: v.number(),
  })
    .index("by_strategy", ["strategyId"])
    .index("by_strategy_seen", ["strategyId", "seenAt"]),

  // Shared OHLCV / price cache — multiple agents watching the same asset
  // hit the cache instead of burning Birdeye rate-limit on every poll.
  traderPriceCache: defineTable({
    asset: v.string(),              // e.g. "SOL"
    timeframe: v.string(),           // "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
    candlesJson: v.string(),         // JSON-encoded BirdeyeCandle[]
    currentPrice: v.optional(v.number()),
    fetchedAt: v.number(),
    source: v.string(),              // "birdeye" | "jupiter" | "coingecko" | "synthetic"
  })
    .index("by_asset_timeframe", ["asset", "timeframe"]),

  // MASTER transcript+analysis cache, keyed by a video's stable sourceKey
  // (lib/server/sourceKey.ts). SHARED across ALL agents so a video is
  // transcribed + analyzed exactly ONCE. The transcript JSON lives in storage
  // (a 1-hr word list can exceed the 1MB doc limit); the small analysis (ranked
  // viral moments + chapters) is inline.
  transcriptCache: defineTable({
    sourceKey: v.string(),
    version: v.number(),                 // bump (ANALYSIS_VERSION) re-processes stale rows
    durationSeconds: v.number(),
    transcriptStorageId: v.id("_storage"),
    analysis: v.any(),                   // ClipAnalysis (moments/chapters/summary)
    provider: v.string(),                // "elevenlabs" | "kie-gemini"
    // Spoken language the STT provider decoded (ISO 639-1, e.g. "ms"). Optional:
    // rows cached before language detection existed simply have none. Reused to PIN
    // the language on later passes over the same source instead of re-detecting.
    language: v.optional(v.string()),
    sourceModifiedTime: v.optional(v.string()), // Drive modifiedTime (invalidates on replace)
    createdAt: v.number(),
  })
    .index("by_source", ["sourceKey"]),

  // Operator-funded deposits into agent wallets — the "salary" rail.
  traderDeposits: defineTable({
    mintAddress: v.string(),
    operatorWallet: v.string(),
    amountUsdc: v.number(),                  // amount deposited
    amountSolEquivalent: v.optional(v.number()), // if deposit was in SOL, equivalent USDC at time of tx
    txSignature: v.string(),                  // on-chain reference
    network: v.string(),                      // "devnet" | "mainnet-beta"
    note: v.optional(v.string()),
    depositedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_operator", ["operatorWallet"]),

  // Binary directional / prediction-market bets the agent has placed.
  // Hyperliquid-style leveraged perp positions (paper for now).
  // Each row is one open or closed leveraged position with full PnL history.
  perpPositions: defineTable({
    mintAddress: v.string(),
    /** "live" or "paper" — paper sims fills against live mark price */
    mode: v.string(),
    asset: v.string(),                  // "BTC", "ETH", "SOL"
    side: v.string(),                   // "LONG" | "SHORT"
    leverage: v.number(),               // 2..50
    /** Margin posted = notional / leverage */
    marginUsdc: v.number(),
    /** Notional = entry * size in USD */
    notionalUsdc: v.number(),
    /** Position size in asset units */
    size: v.number(),
    entryPrice: v.number(),
    /** Liquidation price — auto-calculated at open */
    liquidationPrice: v.number(),
    /** Funding paid since open (negative = received) */
    fundingPaidUsdc: v.optional(v.number()),
    /** "open" | "closed" | "liquidated" */
    status: v.string(),
    /** Set on close — exit price + realized PnL */
    exitPrice: v.optional(v.number()),
    realizedPnlUsdc: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    /** Reason for the trade — surfaced in history */
    reasoning: v.optional(v.string()),
    openedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_mint_status", ["mintAddress", "status"]),

  traderBets: defineTable({
    mintAddress: v.string(),
    strategyId: v.optional(v.id("traderStrategies")),
    /** "binary_directional" | "polymarket" | "custom" */
    kind: v.string(),
    /** What was bet on: "BTC-5min-UP" / polymarket market id / etc */
    market: v.string(),
    /** "UP" | "DOWN" | "YES" | "NO" */
    side: v.string(),
    stakeUsdc: v.number(),
    /** Agent's confidence 0..1 when bet was placed */
    confidence: v.number(),
    /** Reasoning summary the AI gave for the bet */
    reasoning: v.optional(v.string()),
    /** Asset price snapshot at bet time (for binary directional settlement) */
    referencePrice: v.optional(v.number()),
    /** When the bet settles — Date.now() + horizonMinutes*60_000 for binary */
    settlesAt: v.number(),
    /** "pending" | "won" | "lost" | "void" */
    status: v.string(),
    /** Settlement details */
    settlementPrice: v.optional(v.number()),
    payoutUsdc: v.optional(v.number()),       // net of stake — positive on win
    settledAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"])
    .index("by_settles_at", ["settlesAt"]),

  // Every trade executed (or proposed for approval).
  traderTrades: defineTable({
    strategyId: v.id("traderStrategies"),
    mintAddress: v.optional(v.string()),
    side: v.string(),                 // "BUY" | "SELL"
    asset: v.string(),                // "SOL" | "JUP" | ...
    amountUsdc: v.number(),
    pricePerUnit: v.optional(v.number()),
    txSignature: v.optional(v.string()), // Jupiter / on-chain
    status: v.string(),               // "proposed" | "awaiting_approval" | "executed" | "failed" | "skipped"
    sourceSignalId: v.optional(v.id("traderSignals")),
    profitUsdc: v.optional(v.number()),
    notes: v.optional(v.string()),
    /** "live" (mainnet Jupiter swap) | "paper" (devnet simulation, virtual PnL). Defaults to "live" for backfill. */
    mode: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_strategy", ["strategyId"])
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"]),

  // ─── AI Worker — per-client learning + conversation memory (JOB-50 / EX-3) ──
  // Accumulated, per-client knowledge a worker builds over an engagement.
  // Phases: ingestion (learn the business) → calibration (tune voice/offers)
  // → conversion (optimize for sales). One row per (workerId, clientId).
  clientLearnings: defineTable({
    workerId: v.id("influencers"), // workers are canonical influencers rows (agentType="worker"); aiWorkers table retired
    clientId: v.string(), // SMB owner wallet or unique business ID
    phase: v.union(
      v.literal("ingestion"),
      v.literal("calibration"),
      v.literal("conversion")
    ),
    daysSinceStart: v.number(),
    brandVoiceNotes: v.array(v.string()),
    conversionPatterns: v.array(
      v.object({ pattern: v.string(), successRate: v.number() })
    ),
    productCatalogHash: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_worker", ["workerId"])
    .index("by_client", ["clientId"])
    .index("by_worker_client", ["workerId", "clientId"]),

  // ─── Per-client tenant model (JOB-50 acceptance: per-client isolation) ──────
  // Normalized multi-tenant store. Every read path is scoped by clientId so one
  // SME's menu/prices/customer chat can never surface in another SME's agent.
  // Convex guideline: conversation turns are separate rows (NOT an unbounded
  // array on a parent doc), so writes never rewrite the whole history.
  clients: defineTable({
    name: v.string(),
    // WhatsApp Cloud API phone_number_id — how an inbound webhook maps to a tenant.
    phoneNumberId: v.string(),
  }).index("by_phone_number_id", ["phoneNumberId"]),

  // Operator-curated facts (menu, prices, policies) keyed by a stable key.
  knowledge: defineTable({
    clientId: v.id("clients"),
    key: v.string(),
    value: v.string(),
  }).index("by_client", ["clientId"]),

  // Facts the agent has inferred about customers/this business over time.
  learned_facts: defineTable({
    clientId: v.id("clients"),
    fact: v.string(),
    confidence: v.number(),
  }).index("by_client", ["clientId"]),

  // One row per message turn, scoped by tenant + customer phone.
  conversations: defineTable({
    clientId: v.id("clients"),
    customerPhone: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    text: v.string(),
    timestamp: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_client_customer", ["clientId", "customerPhone"]),

  // Conversation transcripts handled by a worker, per client + platform.
  // Powers per-client learning and outcome tracking.
  workerConversations: defineTable({
    workerId: v.id("influencers"), // workers are canonical influencers rows (agentType="worker"); aiWorkers table retired
    clientId: v.string(),
    platform: v.union(v.literal("whatsapp"), v.literal("instagram_dm")),
    messages: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
    outcome: v.optional(
      v.union(
        v.literal("sale"),
        v.literal("support_resolved"),
        v.literal("lost"),
        v.literal("pending")
      )
    ),
    createdAt: v.number(),
  })
    .index("by_worker", ["workerId"])
    .index("by_client", ["clientId"])
    .index("by_worker_client", ["workerId", "clientId"]),

  // ─── Clipping Agent vertical ───────────────────────────────────────────────
  clipJobs: defineTable({
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    /** Control-panel mission: clip but never auto-post — the owner approves each
     *  clip in chat and the approval schedules it. */
    holdForApproval: v.optional(v.boolean()),
    sourceUrl: v.string(),
    sourceType: v.string(),               // "url" | "campaign_asset"
    campaignId: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    ownerWallet: v.optional(v.string()),
    // Master Videos "clip all" grouping: the N jobs fanned out from ONE folder/channel
    // run share a batchId so the UI can group their cards under one "Folder run".
    // Optional so every pre-existing (single-video) job row stays valid without backfill.
    batchId: v.optional(v.string()),
    // CROSS-VIDEO FILL (fill-short): the SIBLING member videos of this job's
    // folder/channel collection. Populated ONLY on a multi-video fan-out; used by
    // `process` to top up a SHORT source (too brief for a full clip) with moments
    // from these siblings. Optional + absent on single-video jobs → the default
    // single-video path is byte-for-byte unchanged.
    poolSourceUrls: v.optional(v.array(v.string())),
    status: v.string(),                   // queued|downloading|transcribing|analyzing|clipping|posting|completed|error
    durationSeconds: v.optional(v.number()),
    transcript: v.optional(v.string()),
    error: v.optional(v.string()),
    clipsTotal: v.optional(v.number()),
    clipsReady: v.optional(v.number()),
    // Live run log (bounded, append-only) + denormalized last-progress, so the UI
    // shows fine-grained progress (download %, transcribe chunk x/y, clip i/N)
    // instead of only the coarse `status`. Written by clipJobs.appendLog, which
    // ALSO bumps updatedAt — so it doubles as the reaper heartbeat (a live job no
    // longer looks dead while a long step runs).
    progressPct: v.optional(v.number()),
    progressNote: v.optional(v.string()),
    log: v.optional(v.array(v.object({
      ts: v.number(),
      phase: v.string(),
      note: v.string(),
      pct: v.optional(v.number()),
    }))),
    // Inter-stage state for the scheduler-chained decomposition (Phase 1): the
    // download runs off-thread; these carry its handle + result across stages so
    // no single action holds the whole pipeline open past Convex's ~10min wall.
    downloadJobId: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"]),

  clips: defineTable({
    jobId: v.id("clipJobs"),
    mintAddress: v.string(),
    title: v.string(),
    reason: v.string(),
    startSeconds: v.number(),
    endSeconds: v.number(),
    viralScore: v.number(),
    clipUrl: v.optional(v.string()),
    captionText: v.string(),
    status: v.string(),                   // rendering|ready|posting|posted|skipped|failed
    // Why a status:"failed" clip died (ffmpeg stderr tail / meter reason / thrown
    // error). Populated by clipJobs.process so the run/Generations card can show
    // the reason instead of a bare "FAILED". Mirrors clipJobs.error (job-level).
    failReason: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    /** Upload-post request_id captured at post time (async/scheduled uploads). */
    uploadPostRequestId: v.optional(v.string()),
    /** Native platform post id (e.g. TikTok video id) — the durable analytics key. */
    platformPostId: v.optional(v.string()),
    /** Live view count from upload-post analytics (GET /uploadposts/post-analytics),
     *  synced by /api/analytics/refresh-views. Written directly onto the clip
     *  itself — NOT every posted clip has a `submissions` row (that table is
     *  campaign-participation only, campaignId is required there), so this is
     *  the only view-count path for a plain organic auto-post. Never decreases. */
    viewCount: v.optional(v.number()),
    // When the clip actually posted (epoch ms). Survives even if the originating
    // scheduledContent drip row is later cancelled — drives the Posting-history view.
    postedAt: v.optional(v.number()),
    submissionId: v.optional(v.string()),
    // Per-moment VARIATION provenance: when the requested clip count exceeds the
    // number of distinct strong moments, each moment is reused as several variations
    // (rotated hook/caption/length/crop). variationIndex 0 = the pristine cut; >0 =
    // a variation. variationLabel is the UI string ("Moment 3 · v2"). Both optional
    // so every pre-existing clip row (one-per-moment) stays valid without backfill.
    variationIndex: v.optional(v.number()),
    variationLabel: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_mint", ["mintAddress"])
    // Admin analytics: "videos posted per platform per day" reads posted clips in a
    // time window straight off this index (status="posted", postedAt >= start).
    .index("by_status_postedAt", ["status", "postedAt"]),

  // ─── Replay protection (JOB-85) ────────────────────────────────────────────
  // Every on-chain payment proof (txSignature) is single-use across the WHOLE
  // system. Before any path credits a balance / mints / invests / tops-up a
  // budget, it must `consumeSignature()` (see convex/lib/payments.ts), which
  // inserts a row here. A second attempt to consume the same signature throws,
  // so a replayed proof can never credit twice. The `by_signature` index gives
  // an O(1) pre-check; Convex's serializable mutations make the check-then-
  // insert race-safe (concurrent dupes conflict and one retry sees the row).
  processedSignatures: defineTable({
    txSignature: v.string(),
    // What the signature was spent on: "trader_deposit" | "nft_mint" |
    // "invest" | "campaign_topup". Audit/debug only — uniqueness is global.
    purpose: v.string(),
    // Optional reference back to the credited entity (mint address / campaign id).
    ref: v.optional(v.string()),
    // The on-chain-verified amount that was credited (USDC), for the audit trail.
    amount: v.optional(v.number()),
    consumedAt: v.number(),
  }).index("by_signature", ["txSignature"]),

  /**
   * Scheduled content — the Schedule tab. The operator (or the agent, via the
   * copilot) queues a video/post for a future time; a per-minute cron fires the
   * create_video → render → auto-post chain when it's due. Powers the monthly
   * calendar + time views and "the AI posts multiple videos a day".
   */
  /** Taste-signal events (idea ratings, edits, view performance), consumed in
   *  batches by the pipeline's taste updater which rewrites
   *  influencers.tasteProfile.prose. */
  tasteEvents: defineTable({
    mintAddress: v.string(),
    kind: v.string(),
    detail: v.string(),
    weight: v.number(),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index("by_mint_consumed", ["mintAddress", "consumed"]),

  /** Content Ideas — the agent's idea queue. Written by the heartbeat's ideation
   *  stage (and by the copilot's [SAVE_IDEA]); the planner produces the top
   *  fresh idea; the operator steers via feedback on the Ideas tab. */
  contentIdeas: defineTable({
    mintAddress: v.string(),
    headline: v.string(),
    angle: v.string(),
    whyNow: v.optional(v.string()),
    source: v.string(),                          // "news" | "evergreen" | "series" | "user"
    sourceRefs: v.optional(v.array(v.string())),
    /** Plain-text grounded fact bullets for the SCRIPT stage — distinct from
     *  sourceRefs (real URLs, for UI citation). See lib/server/ideation.ts. */
    newsFacts: v.optional(v.array(v.string())),
    /** A real photo the research step found — burned as the video's on-screen
     *  reference-image overlay so viewers see what's being discussed. */
    referenceImageUrl: v.optional(v.string()),
    format: v.string(),
    /** The bible video style this idea is FOR (showBible.videoStyles[].id) —
     *  production resolves this style's recipe so the feed keeps each style's
     *  kind of content on its weighted cadence. */
    styleId: v.optional(v.string()),
    suggestedDurationSec: v.number(),
    score: v.number(),                           // 0-100
    /** Influencer balance: "entertain" | "value" | "promo" — ideation matches the
     *  bible's contentMix; selection never produces two promos in a row. */
    intent: v.optional(v.string()),
    /** Set on campaign-native promo ideas — producing one runs the existing
     *  campaign machinery (context crawl → render → post → submission). */
    campaignId: v.optional(v.string()),
    campaignTitle: v.optional(v.string()),
    status: v.string(),                          // proposed|approved|rejected|producing|produced|expired
    expiresAt: v.optional(v.number()),           // news ideas: creation + 24h
    feedback: v.optional(v.string()),            // "up" | "down"
    editedByUser: v.optional(v.boolean()),
    producedTaskId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_mint_status", ["mintAddress", "status"])
    .index("by_mint_created", ["mintAddress", "createdAt"]),

  scheduledContent: defineTable({
    mintAddress: v.string(),
    sessionId: v.optional(v.string()),
    scheduledFor: v.number(),        // epoch ms — when to post
    status: v.string(),             // "scheduled" | "posting" | "posted" | "failed" | "cancelled"
    topic: v.string(),
    script: v.optional(v.string()),  // pre-written script (skips script gen if present)
    caption: v.optional(v.string()),
    platforms: v.array(v.string()),  // [] = all connected accounts
    campaignId: v.optional(v.string()),
    videoUrl: v.optional(v.string()),     // filled after render
    storyboardImageUrl: v.optional(v.string()),
    taskId: v.optional(v.id("agentTasks")),
    postedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** When the drip set this row to "posting" — the reaper reverts rows stuck
     *  here past a TTL (a cron tick that died mid-post). */
    postingStartedAt: v.optional(v.number()),
    /** Drip post attempts so far — transient failures retry with backoff up to a
     *  cap, then go terminal "failed". */
    retryCount: v.optional(v.number()),
    createdAt: v.number(),
    // Catalog format id (lib/builder/formatCatalog.ts) the source render was
    // templated from, when known. Optional — no backfill. Lets the feed expose
    // which rotation format produced this row so the feedback chip can target it.
    formatId: v.optional(v.string()),
    /** Queued by the automatic 3-a-day X schedule (see autoScheduleVideoToX), not by hand. */
    auto: v.optional(v.boolean()),
    /** Where it was published and how it is measured: set when the drip posts it, then the analytics sync fills viewCount. */
    postUrl: v.optional(v.string()),
    postPlatform: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    viewCount: v.optional(v.number()),
    viewsSyncedAt: v.optional(v.number()),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_status", ["status"])
    // Compound: drain due rows directly (eq status, lte scheduledFor) instead of
    // scanning a creation-ordered backlog of future rows.
    .index("by_status_scheduledFor", ["status", "scheduledFor"])
    // Dedup guard: one active drip row per (agent, clip url) — the schedule
    // mutation skips re-queuing a clip already scheduled/posting/posted.
    .index("by_mint_video", ["mintAddress", "videoUrl"]),

  /**
   * Durable state for the Vercel-safe chunked video render (see
   * docs/superpowers/specs/2026-06-03-vercel-safe-agentic-video-render-design.md).
   * The render runs as a chain of short Next route invocations, each doing one
   * bounded phase, persisting here so the chain is resumable and the task card can
   * show live progress.
   */
  /**
   * SERIES MODE — one row per episode an episodic agent has made.
   *
   * This IS the show's memory. The planner reads it to decide whether the next
   * episode continues a thread or starts fresh, and to reject a premise that
   * reruns one already made — which is what the old `pickRandom(topics)` topic
   * pick could not do.
   */
  seriesEpisodes: defineTable({
    mintAddress: v.string(),
    /** 1-based, monotonic per agent. */
    number: v.number(),
    /** The one-line premise that drove this episode (the novelty key). */
    premise: v.string(),
    /** "prompted" | "continue" | "fresh" — why the planner chose it. */
    intent: v.string(),
    /** How it ended — becomes the recap line when the next episode continues. */
    ending: v.optional(v.string()),
    /** Threads left unresolved, for the next episode to pay off. */
    openThreads: v.optional(v.array(v.string())),
    /** True when the episode deliberately ended unresolved. */
    cliffhanger: v.optional(v.boolean()),
    /** Cast names on screen, for the log + the operator's episode list. */
    cast: v.optional(v.array(v.string())),
    /** The task that rendered it, so the episode links to its video. */
    taskId: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_mint_number", ["mintAddress", "number"]),

  videoRenderJobs: defineTable({
    taskId: v.id("agentTasks"),     // the create_video task this render fulfils
    mintAddress: v.string(),
    sessionId: v.string(),
    // Unguessable per-job token — the render-step chain authenticates with this
    // instead of a shared env secret, so the chain works without a server restart.
    driveToken: v.string(),
    kieModel: v.string(),            // agent's selected video engine slug (veo3_fast / veo3 / seedance…)
    phase: v.string(),              // "storyboard" | "video" | "posting" | "done" | "failed"
    statusMessage: v.string(),       // human progress text for the card's viewing place
    // Render inputs (the full GenerateVideoArgs payload, JSON-encoded — passed
    // through to the pipeline on each phase invocation).
    renderArgs: v.string(),
    // Handoff produced by the storyboard phase, consumed by the video phase.
    storyboardImageUrl: v.optional(v.string()),
    storyboardPrompt: v.optional(v.string()),
    beats: v.optional(v.string()),   // JSON-encoded StoryBeat[]
    // Clip-level Veo chain state — lets the video render ONE clip per invocation
    // and resume the extend chain, so videos reach the full script length (≤60s).
    segmentPrompts: v.optional(v.string()),  // JSON string[] — one prompt per 8s clip
    // JSON string[] — scene-establishing GENERATE prompt per clip. Used only by the
    // stitch fallback (native /veo/extend blocked) so each fresh standalone clip
    // depicts its own window's scene instead of collapsing into a duplicate take.
    standalonePrompts: v.optional(v.string()),
    refImages: v.optional(v.string()),       // JSON string[] — character reference frames
    totalSegments: v.optional(v.number()),   // how many clips the finished video has
    clipIndex: v.optional(v.number()),       // next clip to render
    veoTaskId: v.optional(v.string()),       // parent task id to extend from
    // Seed of the SUCCESSFUL base clip (clip 0). Reused as the anchor seed on every
    // /veo/extend so the character's face stays consistent across the chain — the
    // extend endpoint takes no reference image, so a stable seed is the only identity
    // lever we control across clips. Absent on legacy jobs → extends fall back to a
    // fresh random seed (prior behavior).
    veoSeed: v.optional(v.number()),
    // Once a /veo/extend has failed after all retries (e.g. the prominent-public-figure
    // safety filter never clears), the chain switches to STITCH fallback: every
    // remaining clip is a fresh standalone generate from the avatar refs, concatenated
    // onto the accumulated video. This flag latches that mode across clip steps.
    stitchMode: v.optional(v.boolean()),
    // JSON string[] — fresh fallback clip URLs QUEUED during stitch mode. They are
    // concatenated onto the extend-chain cumulative video ONCE when the chain
    // finishes, so the growing video isn't re-encoded on every fallback.
    stitchClips: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    // Seedance per-clip resume state (JSON): { clipUrls, nextIndex, firstFrame,
    // keyframeUrl, pendingTaskId, pendingClipIndex }. Persisted after every
    // completed clip so a phase retry CONTINUES the chain instead of
    // regenerating keyframe + every clip from scratch (each Kie generation is
    // real money — a timed-out 3-clip render used to re-render everything on
    // all 4 attempts).
    seedanceState: v.optional(v.string()),
    // The RAW generated clip as it left the video phase — before any overlay
    // burn (hook text, captions, music, hook-video join, intro/CTA). The
    // Editor's "Original" download and un-burn re-edits read this; without it
    // the pre-burn file is unrecoverable once overlays bake in.
    rawVideoUrl: v.optional(v.string()),
    videoNote: v.optional(v.string()),
    // Auto-post / campaign submission (reuses the existing submission flow).
    autoPost: v.optional(v.object({
      platforms: v.array(v.string()),
      campaignId: v.optional(v.string()),
      submissionId: v.optional(v.string()),
      contentRewardId: v.optional(v.string()),
      ownerWallet: v.optional(v.string()),
      caption: v.optional(v.string()),
    })),
    attempts: v.number(),            // per-phase retry counter (caps runaway loops)
    error: v.optional(v.string()),
    updatedAt: v.number(),
    // Idempotency key tying this render to the thing that paid for it (e.g. a hire
    // payment tx signature). The hire modal retries the same request up to 3× and
    // the render is fire-and-forget INSIDE run-task, so a lost run-task response
    // would otherwise re-dispatch a fresh Kie render (wasted tokens, "3 of the same
    // video"). run-task short-circuits when a job with this key already exists.
    renderKey: v.optional(v.string()),
    // Catalog format id (lib/builder/formatCatalog.ts) this render was templated
    // from, when the idea pipeline pre-composed a formatPrompt. Optional — no
    // backfill for pre-existing rows. Lets the operator's 👍/👎 feedback control
    // (VideoFeedback) target the right showBible.videoStyles entry for the
    // rotation-weight nudge (tasteEvents.recordVideoFeedback).
    formatId: v.optional(v.string()),
    // Self-expiring lease: set when a render-step invocation starts real work on
    // this job's CURRENT phase, cleared when it finishes. render-step had no lock
    // at all — two invocations racing the same phase (a dropped response + a
    // retry, a duplicate fire, etc.) would BOTH call Kie and BOTH post, which is
    // how one request produced multiple finished videos. claimStep refuses a
    // second concurrent claim; the lease expires on its own (CLAIM_LEASE_MS in
    // route.ts) so a crashed invocation never wedges the job forever.
    processingStartedAt: v.optional(v.number()),
  })
    .index("by_task", ["taskId"])
    .index("by_mint", ["mintAddress"])
    .index("by_render_key", ["renderKey"]),

  // Job applications submitted through the public Hiring page (/hiring). The
  // résumé file lives in Convex storage; resumeStorageId resolves to a URL.
  jobApplications: defineTable({
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
    status: v.string(),            // "new" | "reviewing" | "rejected" | "hired"
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_role", ["role"])
    .index("by_status", ["status"]),

  // Marketing leads captured on the public landing page BEFORE registration:
  // a video link dropped into the hero input, or a website submitted through
  // the "Start free" lead-magnet modal (with the AI business summary the modal
  // generated). Anonymous by design — written via the secret-gated capture
  // mutation from Next API routes, read only by the admin Leads page.
  leads: defineTable({
    source: v.union(v.literal("hero_video_link"), v.literal("cta_website"), v.literal("hero_website")),
    url: v.string(),
    /** AI business summary (cta_website only). */
    businessName: v.optional(v.string()),
    summary: v.optional(v.string()),
    /** The 3 teaser video angles shown in the modal. */
    angles: v.optional(v.array(v.string())),
    userAgent: v.optional(v.string()),
    referer: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_url", ["url"]),

  // Applications to become a global content node, captured on the public /node
  // page ("Vello Operators Call" webinar sign-up). Written by the secret-gated
  // nodeApplications.submit mutation from /api/node/apply; read in the dashboard.
  nodeApplications: defineTable({
    fullName: v.string(),
    email: v.string(),
    emailLower: v.string(),
    phone: v.optional(v.string()),
    country: v.optional(v.string()),
    telegram: v.optional(v.string()),
    /** What they want a node for: "business" | "agents" | "both". */
    purpose: v.optional(v.string()),
    businessName: v.optional(v.string()),
    /** How many agents the applicant already runs: "none" | "1-5" | "6-20" | "20+". */
    experience: v.string(),
    /** Admin pipeline: "new" | "contacted" | "approved" | "declined". Missing = new. */
    status: v.optional(v.string()),
    referer: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_email", ["emailLower"]),

  // Internal /dev/team-schedule checklist — one row per checked cell (the
  // 4-week program's steps × 7 days are hardcoded in app code, not stored;
  // this table ONLY holds which cells are ticked, per staff member). No
  // auth — a low-stakes internal ops checklist, not user data.
  /** Which Stage campaigns a clipping agent is WORKING. Written by the agent's
   *  own fit decision (auto-clip scout, `decidedBy: "agent"`) and by the operator
   *  from the Work tab (`decidedBy: "operator"`, which the agent never overrides).
   *  The auto-clip scout only clips sources from ACTIVE memberships. Exactly one of
   *  campaignId (Convex on-chain rail) / contentRewardId (Supabase rail) is set. */
  campaignMemberships: defineTable({
    mintAddress: v.string(),
    campaignId: v.optional(v.string()),
    contentRewardId: v.optional(v.string()),
    /** Stable key: campaignId ?? contentRewardId. */
    key: v.string(),
    rail: v.string(),                       // "onchain" | "content_reward"
    title: v.string(),
    status: v.string(),                     // "active" | "skipped" | "left"
    decidedBy: v.string(),                  // "agent" | "operator"
    score: v.optional(v.number()),
    reasons: v.optional(v.array(v.string())),
    expectedViews: v.optional(v.number()),
    expectedPayoutUsdc: v.optional(v.number()),
    netUsdc: v.optional(v.number()),
    ratePerThousandViews: v.optional(v.number()),
    budgetRemainingUsdc: v.optional(v.number()),
    deadlineAt: v.optional(v.number()),
    lastEvaluatedAt: v.number(),
    joinedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_mint", ["mintAddress"])
    .index("by_mint_key", ["mintAddress", "key"])
    // Campaign page: live "agents working this campaign" (campaignId + status).
    .index("by_campaign_status", ["campaignId", "status"]),


  // Owner ops: intern clipping roster for the /admin/interns god-eye dashboard.
  // Each intern runs several clipping agents (mintAddresses). Meeting reviews
  // aggregate posts + views per intern / account for a chosen day range.
  opsInterns: defineTable({
    name: v.string(),
    note: v.optional(v.string()),
    /** Vello agent mint addresses this intern operates. */
    mintAddresses: v.array(v.string()),
    active: v.boolean(),
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active", "sortOrder"]),

  devTeamTaskChecks: defineTable({
    staffId: v.string(),   // e.g. "suhaimi"
    weekIdx: v.number(),   // 0..3
    dayIdx: v.number(),    // 0..6
    stepIdx: v.number(),   // index into that week's step list
    checked: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_staff_week", ["staffId", "weekIdx"])
    .index("by_cell", ["staffId", "weekIdx", "dayIdx", "stepIdx"]),
  // Platform-wide totals for the /agents hero stat row (views, volume, videos).
  // One row (key "global") = hourly baseline from platformStats.refresh (the
  // underlying tables are far past Convex's per-query read limit). The page
  // subscribes to platformStats.live = baseline + rows created since, so the
  // numbers still move in realtime.
  platformStats: defineTable({
    key: v.string(),
    totalViews: v.number(),
    totalVolumeUsdc: v.number(),
    videosGenerated: v.number(),
    /** Snapshot cutoff: the baseline covers rows created at or before this;
     *  platformStats.live adds everything created after it on the fly. */
    updatedAt: v.number(),
    /** View growth since the snapshot, bumped by the view-sync mutations so
     *  the counter ticks between hourly refreshes. Reset to 0 on refresh. */
    viewsDelta: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /** Per-wallet allowance for the create studio (portraits + shirt edits): 3 free images, then $0.50 each.
   *  Written only by internal-secret mutations in convex/studioGen.ts. */
  studioGenAccounts: defineTable({
    account: v.string(),
    freeUsed: v.number(),
    /** Images paid for whose generation failed. Spent before the next on-chain payment is asked for. */
    credits: v.number(),
    updatedAt: v.number(),
  }).index("by_account", ["account"]),

  /** One row per billed image. `source` records how it was covered so a failure refunds the right balance. */
  studioGenLedger: defineTable({
    account: v.string(),
    runId: v.string(),
    source: v.union(v.literal("free"), v.literal("credit"), v.literal("paid")),
    txSignature: v.optional(v.string()),
    amountUsd: v.number(),
    refunded: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_account", ["account", "createdAt"]),

  /** One row per weekly SOLCAMEO reward epoch (Monday 00:00 UTC). Money amounts are integer micro-USDC. Rows are
   *  immutable once planned; execution only stamps the status and the on-chain burn signature. */
  platformTokenLaunches: defineTable({
    network: v.string(), wallet: v.string(), name: v.string(), ticker: v.string(),
    description: v.string(), image: v.string(), optionsJson: v.string(),
    mint: v.optional(v.string()), config: v.optional(v.string()), pool: v.optional(v.string()),
    signature: v.optional(v.string()), state: v.union(v.literal("draft"), v.literal("reserved"), v.literal("live")),
  }).index("by_network", ["network"]),

  platformTokenEpochs: defineTable({
    epochStart: v.number(),
    epochEnd: v.number(),
    settledMicro: v.number(),
    revenueMicro: v.number(),
    buybackMicro: v.number(),
    opsMicro: v.number(),
    treasuryMicro: v.number(),
    truncated: v.boolean(),
    status: v.union(v.literal("planned"), v.literal("burned")),
    burnTokens: v.optional(v.string()),
    burnSig: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_epoch", ["epochStart"]),

  /** Server-synced mirror of a coin's on-chain market, so the terminal reads it reactively from Convex instead of polling RPC.
   *  Written only by internal-secret mutations in convex/solstarChain.ts. */
  ssChainState: defineTable({
    characterId: v.id("ssCharacters"), mint: v.string(), network: v.string(),
    priceSol: v.number(), supplyRaw: v.string(), decimals: v.number(), slot: v.number(),
    lastTime: v.number(), syncedAt: v.number(), error: v.optional(v.string()),
    /** Creator economics read from the pool, so the leaderboard needs no RPC. */
    creator: v.optional(v.string()), creatorSharePct: v.optional(v.number()),
    feesSol: v.optional(v.number()), claimableSol: v.optional(v.number()), migrated: v.optional(v.boolean()),
    /** Swaps at or after this time carry fee data; 0 when the whole history was captured. */
    feeTrackedSince: v.optional(v.number()),
    /** Market cap at launch and curve fill (0-1), so listings show change and progress without reading the pool. */
    launchCapSol: v.optional(v.number()), curveProgress: v.optional(v.number()),
    /** SOL held by the curve and the SOL it needs to graduate, so the market page shows progress without reading the pool. */
    reserveSol: v.optional(v.number()), targetSol: v.optional(v.number()),
    /** Rolling 24h trading activity, so the tokenomics page reads it live from Convex without scanning swaps. */
    volume24hSol: v.optional(v.number()), trades24h: v.optional(v.number()),
    /** False when the chain history could not be read in full, so cost bases cannot be trusted. */
    historyComplete: v.optional(v.boolean()),
  }).index("by_character", ["characterId"]),
  ssChainSwaps: defineTable({
    characterId: v.id("ssCharacters"), signature: v.string(), wallet: v.string(),
    side: v.union(v.literal("buy"), v.literal("sell")),
    units: v.number(), sol: v.number(), priceSol: v.number(), time: v.number(),
    /** Trading fee of this swap in SOL (before the creator share) and the network fee the trader paid. */
    feeSol: v.optional(v.number()), networkFeeSol: v.optional(v.number()),
  }).index("by_signature", ["signature"]).index("by_character_time", ["characterId", "time"]).index("by_character_wallet_time", ["characterId", "wallet", "time"]),
  /** Average-cost position per wallet, maintained as swaps are ingested in time order. */
  ssChainPositions: defineTable({
    characterId: v.id("ssCharacters"), wallet: v.string(),
    boughtTokens: v.number(), soldTokens: v.number(), spentSol: v.number(), receivedSol: v.number(),
    openTokens: v.number(), costBasisSol: v.number(), realizedSol: v.number(),
    trades: v.number(), firstAt: v.number(), lastAt: v.number(),
  }).index("by_character_wallet", ["characterId", "wallet"]),
  ssChainHolders: defineTable({
    characterId: v.id("ssCharacters"), wallet: v.string(), units: v.string(), supplyPct: v.number(), isPool: v.boolean(),
  }).index("by_character", ["characterId"]),

  // ── Referrals: share of Solcameo's margin, paid in USDC, only to wallets that hold SOLCAMEO ──────────────────────
  referralCodes: defineTable({
    wallet: v.string(), code: v.string(), createdAt: v.number(),
  }).index("by_wallet", ["wallet"]).index("by_code", ["code"]),
  // One row per referred wallet. Bound once, at its first sign-in, and never changed.
  referralBindings: defineTable({
    refereeWallet: v.string(), referrerWallet: v.string(), code: v.string(), boundAt: v.number(), expiresAt: v.number(),
  }).index("by_referee", ["refereeWallet"]).index("by_referrer", ["referrerWallet"]),
  // One row per settled payment of a referred user's spend. `missed` = the referrer held too little SOLCAMEO to earn it.
  referralAccruals: defineTable({
    settlementId: v.string(), referrerWallet: v.string(), refereeWallet: v.string(), mintAddress: v.string(),
    spendUsdc: v.number(), marginUsdc: v.number(), rate: v.number(), tier: v.number(), shareUsdc: v.number(),
    status: v.union(v.literal("pending"), v.literal("paid"), v.literal("missed")),
    paidSig: v.optional(v.string()), at: v.number(),
  }).index("by_referrer", ["referrerWallet", "at"]).index("by_settlement", ["settlementId"]).index("by_time", ["at"]),
  // Running totals, so the public counters never scan the ledger.
  referralStats: defineTable({
    key: v.string(), accruedUsdc: v.number(), missedUsdc: v.number(), events: v.number(), referrers: v.number(), referred: v.number(),
  }).index("by_key", ["key"]),
});
