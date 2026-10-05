import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { isJoinableCampaign, isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { runIdeaPipeline } from "@/lib/server/ideaPipeline";
import { normalizeShowBible } from "@/lib/builder/showBible";

// Forwarded to the internal /api/agents/run-task calls so the auth gate accepts
// server-to-server execution (the heartbeat cron and this loop run unattended).
const INTERNAL_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.INTERNAL_CRON_SECRET ? { "X-Internal-Secret": process.env.INTERNAL_CRON_SECRET } : {}),
};

export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Task types the influencer/worker executor (run-task) can actually run.
const ALLOWED_TASK_TYPES = new Set([
  "create_video", "post_content", "analyze_trend", "research",
  "find_jobs", "campaign_submit", "check_wallet", "self_reflect",
  "reply_fan",
]);

/**
 * AGENTIC PLANNER — reads the agent's heartbeat OPERATING MANUAL (what the
 * operator told it to do each heartbeat) + persona + recent memory, and decides
 * the concrete tasks to run NOW. Inserts them as pending agentTasks. Returns the
 * count created. This is what makes the heartbeat actually DO what the manual says.
 */
async function planTasksFromHeartbeat(args: {
  convex: ConvexHttpClient;
  mintAddress: string;
  heartbeatMarkdown: string;
  installedSkills: string[];
  agent: { name: string; niche: string; archetype?: string; description?: string };
}): Promise<number> {
  const { convex, mintAddress, heartbeatMarkdown, installedSkills, agent } = args;
  const campaignsSkill = installedSkills.includes("vello.campaigns");
  const socialSkill = installedSkills.includes("social.uploadpost");

  const [memories, recent] = await Promise.all([
    convex.query(api.agentTasks.recallMemories, { mintAddress, limit: 8 }).catch(() => []),
    convex.query(api.agentTasks.listByMint, { mintAddress, limit: 15 }).catch(() => []),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memoriesBlock = (Array.isArray(memories) ? memories : []).map((m: any) => `- ${m.summary}`).join("\n");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentTitles = (Array.isArray(recent) ? recent : []).slice(0, 12).map((t: any) => `- [${t.status}] ${t.title}`).join("\n");

  const recentVideoTopics = (Array.isArray(recent) ? recent : [])
    .filter((t: any) => t?.type === "create_video")
    .slice(0, 6)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => String(t?.title ?? "").replace(/^Create video:\s*/i, "").trim())
    .filter(Boolean);

  // Surface matching open campaigns so the planner can create a UNIQUE video per
  // campaign and submit it. We do this even WITHOUT the Vello Campaigns skill —
  // an operator whose heartbeat says "join a campaign" must get a real campaignId,
  // not a no-op. The skill only unlocks the richer per-campaign video guidance.
  let campaignsBlock = "";
  let hasOpenCampaigns = false;
  try {
    const all = await convex.query(api.campaigns.list, {});
    // Only surface funded-on-chain + live campaigns (isJoinableCampaign derives the
    // real lifecycle since stored `status` is frozen at "open"). An AI INFLUENCER is
    // further limited to UGC campaigns — clipping campaigns are a clipper's job.
    const isInfluencer = ((agent as { agentType?: string }).agentType ?? "influencer") === "influencer";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const open = (Array.isArray(all) ? all : []).filter((c: any) =>
      (isInfluencer ? isJoinableUgcCampaign(c) : isJoinableCampaign(c)) &&
      (!Array.isArray(c.targetNiche) || c.targetNiche.includes(agent.niche) || c.targetNiche.includes("all"))
    ).slice(0, 6);
    hasOpenCampaigns = open.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    campaignsBlock = open.map((c: any) =>
      `- campaignId=${c._id} · "${c.title}" by ${c.brandName} · platforms=[${(c.platforms ?? []).join(", ")}] · angle: ${String(c.brief ?? c.angle ?? "").slice(0, 140)}`
    ).join("\n");
  } catch { /* ignore */ }
  // The planner gets campaign guidance whenever there are open campaigns to act on.
  const showCampaignGuidance = campaignsSkill || hasOpenCampaigns;
  // Daily brand-collab cap from the Video Director config (defaults to 1).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maxBrandsPerDay = Math.max(0, Number((agent as any).videoConfig?.maxBrandsPerDay ?? 1));

  const system = `You are the autonomy planner for an AI influencer agent on the Vello platform. Read the agent's OPERATING MANUAL (its heartbeat instructions) plus its persona, skills, and recent activity, then decide the concrete tasks it should run RIGHT NOW to carry out that manual. Reply with ONLY a JSON object — no prose, no code fences.`;
  const user = `AGENT: ${agent.name} — ${agent.archetype ?? "creator"} in the ${agent.niche} niche.${agent.description ? ` ${agent.description.slice(0, 300)}` : ""}
INSTALLED SKILLS: ${installedSkills.join(", ") || "(none)"}

OPERATING MANUAL (what ${agent.name} should do every heartbeat — follow this literally):
${heartbeatMarkdown.slice(0, 2000)}

RECENT MEMORIES:
${memoriesBlock || "(none yet)"}

ALREADY RAN RECENTLY (avoid repeating the same work):
${recentTitles || "(nothing yet)"}
${recentVideoTopics.length ? `\nRECENT VIDEO TOPICS (do not repeat these exact topics):\n${recentVideoTopics.map((t) => `- ${t}`).join("\n")}\n` : ""}
${showCampaignGuidance ? `\nOPEN CAMPAIGNS (you can make + submit content for these):\n${campaignsBlock || "(none matching right now)"}\n` : ""}
Pick 1-4 tasks that DIRECTLY execute the OPERATING MANUAL above. Allowed task types + input shapes:
- create_video  → { "topic": string, "campaignId"?: string, "autoPost"?: { "platforms": ["threads"|"tiktok"|"instagram"|"x"|"youtube"|"facebook"|"linkedin"], "campaignId"?: string } }  (NEVER set durationSeconds — the agent's Video Director config decides the length)
- post_content  → { "platforms": [...], "contentType": "text"|"video", "topic": string }
- analyze_trend → { "niche": string }
- research      → { "question": string }
- find_jobs     → { "niche": string }
- campaign_submit | check_wallet | self_reflect → {}

RULES:
- Map the manual's intent to these types. E.g. "make a daily ${agent.niche} video and post it to threads" → ONE create_video with autoPost { platforms:["threads"] }.
${recentVideoTopics.length ? `- UNIQUE VIDEO RULE: if you create a self-video (no campaignId), make it a NEW topic/angle that is clearly different from the most recent video topics above; do not repeat topic x as topic x again. Rotate the content to the next persona-fit pillar.` : ""}
${showCampaignGuidance ? `- CAMPAIGNS: when the manual is about brand deals/campaigns/earning/joining a campaign AND there are open campaigns above, pick the best-matching campaign(s) and emit a create_video that makes a UNIQUE video tailored to that brand's angle — put its campaignId in BOTH input.campaignId and input.autoPost.campaignId, and set autoPost.platforms to the campaign's platforms. If the manual just says "join a campaign" pick the single best match. Each campaign gets its OWN distinct video/topic — never reuse a topic across campaigns. CAP: emit AT MOST ${maxBrandsPerDay} campaign create_video task${maxBrandsPerDay === 1 ? "" : "s"} this cycle (the operator's max brand collabs/day)${maxBrandsPerDay === 0 ? " — i.e. do NOT join any campaigns" : ""}.` : ""}
${socialSkill ? `- POSTING: for any video that should be published, set "autoPost" so it posts automatically when rendered. To publish to ALL the agent's connected accounts (the default for a general post), use "autoPost": { "platforms": [] } — an empty list means every connected account. Only name specific platforms when the manual explicitly limits it (or for a campaign, use the campaign's platforms).` : `- The Social Auto-Post skill is NOT installed, so do not set autoPost; the operator will post manually.`}
- Ground topics in the manual + niche. Make titles specific.
Return ONLY: { "tasks": [ { "type": "create_video", "title": "short title", "input": {} } ] }`;

  let parsed: { tasks?: Array<{ type?: string; title?: string; input?: unknown }> };
  try {
    parsed = await callClaudeJSON<{ tasks?: Array<{ type?: string; title?: string; input?: unknown }> }>({ system, user, maxTokens: 900 });
  } catch (e) {
    console.warn("[autonomy-loop] heartbeat planner LLM failed:", e instanceof Error ? e.message : e);
    return 0;
  }

  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  let count = 0;
  for (const t of tasks.slice(0, 4)) {
    const type = String(t?.type ?? "").trim();
    if (!ALLOWED_TASK_TYPES.has(type)) continue;
    const title = String(t?.title ?? type).slice(0, 120);
    const input = t?.input && typeof t.input === "object" ? JSON.stringify(t.input) : "{}";
    try {
      await convex.mutation(api.agentTasks.create, {
        mintAddress, sessionId: mintAddress, type, title, input,
        triggeredBy: "user_heartbeat", status: "pending",
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      count++;
    } catch (e) {
      console.warn("[autonomy-loop] task insert failed:", e instanceof Error ? e.message : e);
    }
  }
  console.log(`[autonomy-loop] heartbeat planner created ${count} task(s) for ${agent.name}`);
  return count;
}

/**
 * POST /api/agents/autonomy-loop
 * Body: { mintAddress: string }
 *
 * Observe → Think → Act loop:
 * 1. generateTasksForAgent  — decide which tasks the agent should run (skips duplicates < 6h old)
 * 2. For each pending task  — execute via /api/agents/run-task (LLM-powered)
 * 3. Return results summary
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!CONVEX_URL) {
      return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
    }

    const body = await req.json() as { mintAddress: string; heartbeatMarkdown?: string; triggeredBy?: string };
    const { mintAddress, heartbeatMarkdown, triggeredBy } = body;
    if (!mintAddress) {
      return NextResponse.json({ error: "mintAddress required" }, { status: 400 });
    }

    const convex = new ConvexHttpClient(CONVEX_URL);
    const baseUrl = req.nextUrl.origin;

    // Reap any wedged tasks first — a task stuck on "generating" (a hung reasoning
    // call or a killed run-task process) would otherwise show forever AND block
    // new tasks of the same type via the in-flight dedup.
    await convex.mutation(api.agentTasks.failStaleTasks, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" }).catch(() => ({ failed: 0 }));

    // Detect agent type — traders bypass the 6h dedup and run a tight cycle
    const agent = await convex.query(api.influencers.getByMint, { mintAddress });

    // Ownership gate for user (Bearer) callers — internal heartbeat/cron callers
    // skip. The loop spends the agent's wallet (LLM + render + on-chain), so only
    // the SIWS-proven owner may trigger it.
    if (!auth.internal) {
      const ownershipError = requireOwnerWithSiws(auth, agent);
      if (ownershipError) return ownershipError;
    }

    const isTrader = ((agent?.agentType ?? "").toLowerCase() === "trader")
      || (agent?.niche === "finance");

    // The heartbeat OPERATING MANUAL: prefer the freshest value from the request,
    // but ALWAYS fall back to the persisted editor markdown on the agent record —
    // that's the source of truth the user edits in the Heartbeat editor.
    const effectiveHeartbeatMd =
      (heartbeatMarkdown && heartbeatMarkdown.trim().length > 0)
        ? heartbeatMarkdown
        : (agent?.heartbeatMarkdown ?? "");
    const installedSkills = (agent?.installedSkills ?? []) as string[];

    // ── TRADER PATH ─ run the 5-step cycle directly (no task table dedup) ──
    if (isTrader) {
      try {
        const r = await fetch(`${baseUrl}/api/trader/run-cycle`, {
          method: "POST",
          headers: INTERNAL_HEADERS,
          body: JSON.stringify({ mintAddress, triggeredBy: "autonomy-loop" }),
        });
        const cycle = await r.json() as {
          ok?: boolean; steps?: Array<{ step: string; ok: boolean; message: string; meta?: Record<string, unknown> }>;
          balance?: { usdc: number; sol: number }; settled?: { wins: number; losses: number; netPayout: number };
          placed?: number; summary?: string; aborted?: string; error?: string;
        };
        // Shape the response so the existing UI logger (which expects results[]) still works
        const results = (cycle.steps ?? []).map((s) => ({
          type: s.step,
          title: s.message,
          ok: s.ok,
          error: s.ok ? undefined : s.message,
          ...s.meta,
        }));
        return NextResponse.json({
          success: true,
          agent: agent?.name,
          isTrader: true,
          tasksRun: results.length,
          balance: cycle.balance,
          settled: cycle.settled,
          placed: cycle.placed,
          summary: cycle.summary,
          aborted: cycle.aborted,
          results,
        });
      } catch (err) {
        return NextResponse.json({
          success: false,
          isTrader: true,
          tasksRun: 0,
          error: err instanceof Error ? err.message : "Trader cycle failed",
        });
      }
    }

    // ── INFLUENCER / WORKER PATH ────────────────────────────────────────────
    // BIBLE PIPELINE first: agents with a Show Bible run the fixed
    // ideate→select→produce stages (lib/server/ideaPipeline). The free-form
    // heartbeat-manual planner + deterministic task pack remain the fallback
    // for bible-less agents (and as a safety net when the pipeline finds no
    // viable idea in full-auto mode).
    let generatedCount = 0;
    let ideated = 0;
    const hasBible = !!normalizeShowBible(agent?.showBible);
    if (hasBible && agent) {
      const pipe = await runIdeaPipeline({ convex, mintAddress, agent });
      generatedCount = pipe.queued;
      ideated = pipe.ideated;
      // In review-ideas mode with nothing approved, exit successfully — falling
      // through to the legacy planner would bypass the operator's review gate.
      if (pipe.queued === 0 && pipe.message === "waiting for idea approval") {
        return NextResponse.json({
          success: true, generated: 0, tasksRun: 0, ideated,
          message: "Waiting for idea approval — approve ideas on the Ideas tab (or switch autonomy to full-auto).",
          results: [],
        });
      }
    }
    if (!hasBible && generatedCount === 0 && effectiveHeartbeatMd && effectiveHeartbeatMd.trim().length > 4) {
      generatedCount = await planTasksFromHeartbeat({
        convex,
        mintAddress,
        heartbeatMarkdown: effectiveHeartbeatMd,
        installedSkills,
        agent: {
          name: agent?.name ?? "the agent",
          niche: agent?.niche ?? "lifestyle",
          archetype: agent?.archetype,
          description: agent?.description,
        },
      });
    }
    if (generatedCount === 0) {
      // A manual fire (the operator clicked Fire) forces past the 6h dedup so it
      // always produces a fresh batch instead of silently no-opping.
      const isManual = triggeredBy === "user_heartbeat";
      const generated = await convex.mutation(api.agentAutonomy.generateTasksForAgent, {
        mintAddress,
        force: isManual,
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      });
      generatedCount = generated.count;
    }
    if (generatedCount === 0) {
      // Nothing was created — distinguish "already busy" (tasks still in flight)
      // from "genuinely idle" so the UI can show an honest message.
      const inFlight = await convex.query(api.agentAutonomy.listPendingForMint, { mintAddress }).catch(() => []);
      const pendingCount = Array.isArray(inFlight) ? inFlight.length : 0;
      return NextResponse.json({
        success: true,
        generated: 0,
        tasksRun: 0,
        pending: pendingCount,
        message: pendingCount > 0
          ? `${pendingCount} task(s) already in flight — letting them finish before queuing more.`
          : "No new tasks needed — agent is up to date.",
        results: [],
      });
    }

    const pending = await convex.query(api.agentAutonomy.listPendingForMint, { mintAddress });
    const batch = pending.slice(0, 4);

    // Execute the batch CONCURRENTLY. Previously these ran one-at-a-time, so a
    // single slow task (e.g. a reasoning step retrying through its 45s timeout)
    // blocked every task behind it and the whole panel looked "stuck on
    // generating". Running them together means each task flips to running and
    // finishes independently — and because run-task persists every status change
    // to Convex (which the Tasks panel subscribes to), the operator sees all of
    // them progress in realtime. A per-task HTTP timeout guarantees one wedged
    // run-task can't hang the loop: the task is failed and the rest still finish.
    const TASK_HTTP_TIMEOUT_MS = 280_000; // safely under maxDuration (300s)

    const runOne = async (task: (typeof batch)[number]): Promise<Record<string, unknown>> => {
      const meta = { taskId: task._id, type: task.type, title: task.title };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TASK_HTTP_TIMEOUT_MS);
      try {
        const taskInput = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {};
        // Inject heartbeat MD into every task — agent uses it as its operating manual.
        const inputWithHeartbeat = effectiveHeartbeatMd
          ? { ...taskInput, _heartbeatMarkdown: effectiveHeartbeatMd }
          : taskInput;

        const res = await fetch(`${baseUrl}/api/agents/run-task`, {
          method: "POST",
          headers: INTERNAL_HEADERS,
          body: JSON.stringify({
            mintAddress,
            taskType: task.type,
            title: task.title,
            input: inputWithHeartbeat,
            triggeredBy: triggeredBy ?? "scheduler",
            // Execute THIS pending task in place — don't let run-task create a
            // duplicate and leave this one orphaned/stuck on "generating".
            taskId: task._id,
          }),
          signal: controller.signal,
        });
        const result = await res.json() as Record<string, unknown>;
        return { ...meta, ...result };
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        // Wedged task → mark it failed now so it doesn't linger on "generating"
        // (failStaleTasks would otherwise only reap it on the next heartbeat).
        if (aborted) {
          await convex.mutation(api.agentTasks.fail, {
            id: task._id,
            errorMessage: "Timed out — exceeded the per-task run budget.",
            authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
          }).catch(() => { /* best-effort */ });
        }
        return { ...meta, error: aborted ? "timed out" : String(err) };
      } finally {
        clearTimeout(timer);
      }
    };

    // Promise.all never rejects here — runOne catches per-task and returns a result.
    const results = await Promise.all(batch.map(runOne));

    return NextResponse.json({
      success: true,
      agent: agent?.name,
      generated: generatedCount,
      ideated,
      tasksRun: results.length,
      results,
    });
  } catch (err) {
    console.error("[autonomy-loop]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Loop failed" },
      { status: 500 }
    );
  }
}
