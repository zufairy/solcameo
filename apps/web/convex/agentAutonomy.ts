import { mutation, query, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { hasClipModule } from "../lib/builder/clipPhase";
import { appFetch } from "./lib/appFetch";

// Autonomous clipping step (convex/autoClip.ts). String ref so this file typechecks
// before `npx convex deploy` regenerates the api types for the NEW autoClip module
// (mirrors clipJobs.ts's CRM_UPSERT / USAGE_REFUND_RUN_FEES pattern). Resolved by
// name at runtime — valid in convexTest and after deploy alike.
const RUN_AUTO_CLIP = makeFunctionReference<"action">("autoClip:runAutoClipForMint");

// ─── Niche topic banks ────────────────────────────────────────────────────────

const NICHE_TOPICS: Record<string, string[]> = {
  finance:   ["DeFi yield strategies 2025", "Bitcoin ETF flows", "USDC on-chain velocity", "RWA tokenization growth", "L2 fee compression"],
  tech:      ["AI agent autonomy", "ZK-proof consumer apps", "Solana TPS milestone", "on-chain compute markets", "Claude API multimodal"],
  gaming:    ["Web3 game DAU recovery", "in-game asset liquidity", "GameFi reward redesign", "mobile-first crypto gaming", "avatar fashion market"],
  fitness:   ["VO2 max biohacking", "protein timing protocols", "zone 2 training science", "cold therapy ROI", "HRV sleep metrics"],
  lifestyle: ["digital nomad 2025 visa map", "slow travel vs hustle culture", "creator economy burnout", "AI work-life balance", "minimalist wealth"],
  travel:    ["crypto-friendly countries ranked", "Solana travel bookings", "hidden gems off-season", "remote work retreats", "tokenized travel rewards"],
  fashion:   ["digital wearables NFT floor", "AI fashion design tools", "sustainable luxury trends", "streetwear web3 collabs", "avatar fashion market"],
  food:      ["fermented food trend data", "protein-first meal prep", "AI recipe personalization", "urban vertical farming", "zero-waste cooking"],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeTopicKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function topicAlreadyUsed(topic: string, history: string[]): boolean {
  const key = normalizeTopicKey(topic);
  if (!key) return true;
  return history.some((text) => {
    const norm = normalizeTopicKey(text);
    if (!norm) return false;
    return norm === key || norm.includes(key) || key.includes(norm);
  });
}

function pickFreshTopic(topics: string[], history: string[], reserved: Set<string>): string {
  const available = topics.filter((topic) => {
    const key = normalizeTopicKey(topic);
    return key && !reserved.has(key) && !topicAlreadyUsed(topic, history);
  });
  const pool = available.length > 0 ? available : topics.filter(Boolean);
  const choice = pool.length > 0 ? pickRandom(pool) : "fresh creator content";
  reserved.add(normalizeTopicKey(choice));
  return choice;
}

/**
 * Generates a batch of pending tasks for an AI influencer agent.
 * Called by the autonomy loop before task execution.
 * Avoids creating duplicate task types for tasks started in the last 6 hours.
 */
export const generateTasksForAgent = mutation({
  // `force` (set when the operator manually fires the heartbeat) bypasses the
  // 6-hour time-based dedup so a manual fire ALWAYS produces work. It still skips
  // task types that are currently pending/running, so we never queue a literal
  // duplicate of something already in flight.
  args: { mintAddress: v.string(), force: v.optional(v.boolean()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, force, authSecret }) => {
    // SECRET-GATED (M1): the only callers are the /api/agents/autonomy-loop route
    // and fireHeartbeatForAgent below. Ungated, anyone with the public Convex URL
    // could queue paid tasks (create_video/post_content) the heartbeat then
    // executes — an unauthenticated agent-wallet drain.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) throw new Error("Influencer not found");

    // Avoid repeating task types done in the last 6 hours
    const recentTasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(30);

    const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
    const recentTypes = new Set(
      recentTasks
        .filter((t) => {
          // On a forced (manual) fire only block types still in flight — never
          // the time window — so the operator always gets a fresh batch.
          if (t.status === "running" || t.status === "pending") return true;
          if (force) return false;
          return (t.startedAt ?? t._creationTime) > sixHoursAgo;
        })
        .map((t) => t.type)
    );

    // Cadence for low-frequency task types must NOT derive from
    // `recentTasks.length`: that array is capped by `.take(30)`, so once an agent
    // has ≥30 tasks the count pins at 30 and a `% N` gate silently breaks
    // (`30 % 4` is never 0 → self_reflect never schedules again; `30 % 3` is
    // always 0 → research loses its throttle and fires every cycle). Gate on the
    // AGE of each type's most recent occurrence instead — independent of how many
    // rows the window holds.
    const lastRunOf = (type: string): number => {
      let latest = 0;
      for (const t of recentTasks) {
        if (t.type !== type) continue;
        const at = t.startedAt ?? t._creationTime;
        if (at > latest) latest = at;
      }
      return latest; // 0 ⇒ never run in the window ⇒ eligible
    };
    const SELF_REFLECT_MIN_GAP_MS = 24 * 3600 * 1000; // ≤ once/day (was "every 4th cycle")
    const RESEARCH_MIN_GAP_MS = 12 * 3600 * 1000;     // ≤ twice/day (was "every 3rd cycle")

    // Resolve sessionId from nft draft
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", influencer.creatorWallet))
      .first();
    const sessionId = draft?.sessionId ?? mintAddress;

    // Persona-FIRST topic bank. The builder defines each agent's CONTENT PILLARS
    // (its actual subjects) in the questionnaire — seed the agent's daily videos +
    // posts from those so the content follows the agent's persona. The hardcoded
    // niche bank (which made every tech agent keep posting "ZK-proof"/"Solana"
    // videos regardless of who it was) is only a fallback when no pillars are set.
    const personaPillars = ((draft?.questionnaire?.contentPillars ?? []) as string[])
      .map((s) => String(s).trim())
      .filter(Boolean);
    const topics = personaPillars.length > 0
      ? personaPillars
      : (NICHE_TOPICS[influencer.niche] ?? NICHE_TOPICS.tech);
    const memoryRows = await Promise.all([
      ctx.db.query("agentMemory")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
        .order("desc")
        .take(20),
      sessionId !== mintAddress
        ? ctx.db.query("agentMemory")
            .withIndex("by_session_importance", (q) => q.eq("sessionId", sessionId))
            .order("desc")
            .take(20)
        : Promise.resolve([] as Array<{ summary: string }>),
    ]);
    const memoryHistory = Array.from(new Set(
      memoryRows.flat().map((m) => String((m as { summary?: string }).summary ?? "")).filter(Boolean),
    ));
    const videoHistory = Array.from(new Set([
      ...memoryHistory,
      ...recentTasks.filter((t) => t.type === "create_video").map((t) => String(t.title ?? "")),
    ].filter(Boolean)));
    const contentHistory = Array.from(new Set([
      ...memoryHistory,
      ...recentTasks.map((t) => String(t.title ?? "")),
    ].filter(Boolean)));
    const toCreate: { type: string; title: string; input: object }[] = [];
    const reservedTopics = new Set<string>();

    // AI CLIPPERS never run the influencer pack: no generated videos, no text
    // posts, no UGC campaign submissions. Their campaign work is the auto-clip
    // cycle (fireHeartbeatForAgent → autoClip.runAutoClipForMint), which clips
    // a clipping campaign's SOURCE videos and posts per the agent's clip
    // settings. Falling through here is what made a clipper that had joined a
    // campaign produce an AI-influencer-style video.
    if ((influencer.agentType ?? "").toLowerCase() === "clipping") {
      return { created: [] as string[], count: 0, influencer: influencer.name };
    }

    // Decide the right task pack for this agent type
    const isTrader = (influencer.agentType ?? "").toLowerCase() === "trader"
      || influencer.niche === "finance";

    if (isTrader) {
      // ── TRADER TASK PACK ────────────────────────────────────────────────
      // These run real trading work via /api/trader/* endpoints. The executor
      // dispatches each `type` to the matching action.
      const time = new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });

      // Wallet check — always first so the agent knows its trading capital
      if (!recentTypes.has("check_wallet")) {
        toCreate.unshift({
          type: "check_wallet",
          title: `Trading wallet check · ${time}`,
          input: { agentWallet: influencer.agentWallet ?? "" },
        });
      }

      // Settle any expired binary bets — credits wins back to the wallet
      if (!recentTypes.has("settle_bets")) {
        toCreate.push({
          type: "settle_bets",
          title: `Settle expired positions · ${time}`,
          input: { mintAddress },
        });
      }

      // Run a full autonomy tick — scans installed signal skills, decides BUY/SELL/HOLD
      if (!recentTypes.has("trader_tick")) {
        toCreate.push({
          type: "trader_tick",
          title: `Run autonomy tick · scan markets, decide trade · ${time}`,
          input: { mintAddress, trigger: "scheduler" },
        });
      }

      // Scan binary markets for a high-confidence UP/DOWN edge — agentic micro bets
      if (!recentTypes.has("binary_scan")) {
        toCreate.push({
          type: "binary_scan",
          title: `Scan 5m BTC/ETH/SOL binaries for momentum edge`,
          input: { mintAddress },
        });
      }

      // Read X sentiment + news so the agent always has fresh signal data
      if (!recentTypes.has("analyze_trend")) {
        toCreate.push({
          type: "analyze_trend",
          title: `Sentiment scan · ${influencer.niche} · ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`,
          input: { niche: influencer.niche, topics, window: "1h" },
        });
      }

      // Memory consolidation — review recent wins/losses every few cycles
      if (!recentTypes.has("self_reflect") && Date.now() - lastRunOf("self_reflect") >= SELF_REFLECT_MIN_GAP_MS) {
        toCreate.push({
          type: "self_reflect",
          title: `Reflect on recent trades · extract lessons`,
          input: { mintAddress, lookbackHours: 6 },
        });
      }

    } else {
      // ── INFLUENCER / WORKER TASK PACK (original) ────────────────────────

      // Trend analysis — the agent's primary observe step
      if (!recentTypes.has("analyze_trend")) {
        toCreate.push({
          type: "analyze_trend",
          title: `Trend scan · ${influencer.niche} · ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}`,
          input: { niche: influencer.niche, topics, window: "24h" },
        });
      }

      // Video creation
      if (!recentTypes.has("create_video")) {
        const topic = pickFreshTopic(topics, videoHistory, reservedTopics);
        toCreate.push({
          type: "create_video",
          title: `Create video: ${topic}`,
          input: { topic, niche: influencer.niche, archetype: influencer.archetype, handle: influencer.handle },
        });
      }

      // Post content
      if (!recentTypes.has("post_content")) {
        const topic = pickFreshTopic(topics, contentHistory, reservedTopics);
        toCreate.push({
          type: "post_content",
          title: `Post: ${topic}`,
          input: { topic, platform: "twitter", niche: influencer.niche },
        });
      }

      // Campaign submission — find an active campaign that matches niche
      if (!recentTypes.has("campaign_submit")) {
        const campaigns = await ctx.db
          .query("campaigns")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .take(30);
        const matching = campaigns.filter(
          (c) => c.targetNiche.includes(influencer.niche) || c.targetNiche.includes("all")
        );
        if (matching.length > 0) {
          const campaign = pickRandom(matching);
          toCreate.push({
            type: "campaign_submit",
            title: `Submit to ${campaign.title} · ${campaign.brandName}`,
            input: { campaignId: campaign._id, campaignTitle: campaign.title, brandName: campaign.brandName },
          });
        }
      }

      // Research — every other cycle to avoid spamming
      if (!recentTypes.has("research") && Date.now() - lastRunOf("research") >= RESEARCH_MIN_GAP_MS) {
        toCreate.push({
          type: "research",
          title: `Research: top ${influencer.niche} content angles this week`,
          input: { question: `What content angles in the ${influencer.niche} space are driving the most engagement this week?`, niche: influencer.niche },
        });
      }

      // Wallet check — always run first so agent knows her economic state
      if (!recentTypes.has("check_wallet")) {
        toCreate.unshift({
          type: "check_wallet",
          title: `Wallet health check · ${new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`,
          input: { agentWallet: influencer.agentWallet ?? "" },
        });
      }

      // Job scan — find earning opportunities every cycle
      if (!recentTypes.has("find_jobs")) {
        toCreate.push({
          type: "find_jobs",
          title: `Job scan · ${influencer.niche} campaigns`,
          input: { niche: influencer.niche },
        });
      }
    }

    const created: string[] = [];
    for (const task of toCreate) {
      const id = await ctx.db.insert("agentTasks", {
        mintAddress,
        sessionId,
        type: task.type,
        title: task.title,
        input: JSON.stringify(task.input),
        triggeredBy: "scheduler",
        status: "pending",
      });
      created.push(id);
    }

    return { created, count: created.length, influencer: influencer.name };
  },
});

/** List pending tasks for an agent — used by the autonomy loop executor. */
export const listPendingForMint = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    return ctx.db
      .query("agentTasks")
      .withIndex("by_mint_status", (q) =>
        q.eq("mintAddress", mintAddress).eq("status", "pending")
      )
      .take(limit ?? 10);
  },
});

/**
 * Convex-native heartbeat fire. Runs the rule-based planner
 * (generateTasksForAgent) to create pending tasks, then schedules dispatch to
 * the Next executor. No Kie / LLM call here — planning is deterministic and runs
 * 24/7 in the Convex cloud, independent of whether the Next app is reachable.
 */
export const fireHeartbeatForAgent = internalAction({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<{ generated: number }> => {
    let generated = 0;
    // SHOW-BIBLE agents plan through the Next idea pipeline (LLM ideation +
    // selection live there, not in Convex). Best-effort: if the app is
    // unreachable this tick, the agent simply plans again next heartbeat —
    // falling through to the deterministic task pack would bypass the
    // operator's autonomy mode (review gates) and duplicate work.
    try {
      const bibleAgent = await ctx.runQuery(api.influencers.getByMint, { mintAddress });
      const bible = bibleAgent?.showBible as { premise?: unknown; format?: { kinds?: unknown[] } } | undefined;
      // Clippers don't make original videos — skip the show-bible idea pipeline.
      if (bibleAgent?.agentType !== "clipping" && typeof bible?.premise === "string" && bible.premise.trim() && Array.isArray(bible?.format?.kinds) && bible.format.kinds.length > 0) {
        await appFetch(`/api/agents/autonomy-loop`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
          },
          body: JSON.stringify({ mintAddress, triggeredBy: "cron_heartbeat" }),
        }).catch((e) => console.warn("[fireHeartbeatForAgent] bible pipeline fetch failed:", e instanceof Error ? e.message : e));
        return { generated: 0 };
      }
    } catch (e) {
      console.warn("[fireHeartbeatForAgent] bible check failed, using legacy planner:", e instanceof Error ? e.message : e);
    }
    try {
      const res = await ctx.runMutation(api.agentAutonomy.generateTasksForAgent, {
        mintAddress,
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      generated = res?.count ?? 0;
    } catch (e) {
      console.warn("[fireHeartbeatForAgent] planning failed:", e instanceof Error ? e.message : e);
    }
    if (generated > 0) {
      await ctx.scheduler.runAfter(0, internal.agentAutonomy.dispatchPendingTasks, { mintAddress });
    }

    // Autonomous clipping: the daily scout for a toggle-ON clip agent also runs ONE
    // auto-clip cycle — seek a fit-matched funded campaign, pick the next un-clipped
    // source, gate on funds + daily cap, charge the $0.10 scout fee, and enqueue one
    // clip (the existing pipeline then posts + submits). Gated cheaply here (one point
    // read) so the action is only scheduled for ARMED clip agents; runAutoClipForMint
    // re-checks the toggle, clip-agent-ness, dedup, and every money gate. Best-effort:
    // a failure here must never break the heartbeat's core planning/dispatch above.
    try {
      const agent = await ctx.runQuery(api.influencers.getByMint, { mintAddress });
      if (agent?.autoClipEnabled && agent.agentType === "clipping" && agent.campaignWorkConsent && hasClipModule(agent.agentType, agent.installedSkills)) {
        await ctx.scheduler.runAfter(0, RUN_AUTO_CLIP, { mintAddress });
      }
    } catch (e) {
      console.warn("[fireHeartbeatForAgent] auto-clip schedule skipped:", e instanceof Error ? e.message : e);
    }

    return { generated };
  },
});

/**
 * Best-effort execution: POST each pending task to the Next run-task executor
 * (which owns ffmpeg / posting — neither can run in Convex). Failures are
 * non-fatal; the task stays pending and is retried on the next heartbeat.
 * Reaches the dev server on localhost and the deployed domain in production.
 */
export const dispatchPendingTasks = internalAction({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<{ dispatched: number }> => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const secret = process.env.INTERNAL_CRON_SECRET;
    const pending = await ctx.runQuery(api.agentAutonomy.listPendingForMint, { mintAddress });
    const tasks = Array.isArray(pending) ? pending : [];
    await Promise.allSettled(
      tasks.map((t) => {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = t.input ? JSON.parse(t.input) : {}; } catch { parsedInput = {}; }
        return appFetch(`/api/agents/run-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "X-Internal-Secret": secret } : {}),
          },
          body: JSON.stringify({
            mintAddress,
            taskType: t.type,
            title: t.title,
            input: parsedInput,
            triggeredBy: "cron_heartbeat",
            taskId: t._id,
          }),
        }).catch(() => null);
      }),
    );
    return { dispatched: tasks.length };
  },
});
