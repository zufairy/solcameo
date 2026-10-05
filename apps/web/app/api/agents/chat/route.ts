import { NextRequest, NextResponse } from "next/server";
import { extractActionBlock, extractAllActionBlocks, stripActionTags } from "@/lib/server/chatActionBlocks";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { isJoinableCampaign, isJoinableUgcCampaign, isUgcCampaign } from "@/lib/campaignLifecycle";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { resolveUsername, getProfile, PLATFORM_IDS } from "@/lib/server/uploadPost";
import { persistStandingDirective } from "@/lib/server/agentDirectives";
import { compileShowBible } from "@/lib/server/bibleCompiler";
import { normalizeShowBible, bibleVideoStyles, type ShowBible } from "@/lib/builder/showBible";
import { applyBiblePatch, type BiblePatchOp } from "@/lib/builder/biblePatch";
import { VIDEO_FORMATS } from "@/lib/builder/formatCatalog";
import { GEMINI_KEY, geminiChat, type GeminiMessage } from "@/lib/server/geminiFast";
import { buildAgentStatsLines, type StatVideo } from "@/lib/server/agentStats";
import { extractUrls } from "@/lib/server/campaignSources";
import { searchYoutubeLongVideos, type ChannelVideo } from "@/lib/server/youtubeChannel";

export const maxDuration = 120;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const KIE_KEY    = process.env.KIE_API_KEY ?? "";
// Kie's OpenAI-compatible route requires this exact 3.6 Flash slug.
// Unsupported slugs may return HTTP 200 with a body-level code 422.
const KIE_GEMINI_CHAT_MODEL = "gemini-3-6-flash-openai";
const KIE_GEMINI = `https://api.kie.ai/${KIE_GEMINI_CHAT_MODEL}/v1/chat/completions`;
// Conversation replies go to Google's Gemini API DIRECT (OpenAI-compatible
// endpoint), avoiding Kie's queue:
// measured 2026-09-23, Kie took 33-36s to answer "say hi" (streaming too),
// direct took ~2s with thinking off. Chat is short conversational turns, so
// minimal thinking keeps it snappy. Kie stays as the automatic fallback
// (any Gemini error/timeout/empty reply) and remains the path for generation.

type ChatRole = "user" | "assistant";

// ── Short-lived caches for the slowest per-turn context reads ─────────────────
// A chat turn re-read the whole campaign list and hit upload-post's API for
// connected accounts on EVERY message (~1-2s of the reply). Both change rarely
// within a conversation, so hold them briefly in memory.
const CAMPAIGNS_TTL_MS = 60_000;
const PROFILE_TTL_MS = 2 * 60_000;
let campaignsCache: { at: number; rows: Array<Record<string, unknown>> } | null = null;
async function cachedCampaigns(convex: ConvexHttpClient): Promise<Array<Record<string, unknown>>> {
  if (campaignsCache && Date.now() - campaignsCache.at < CAMPAIGNS_TTL_MS) return campaignsCache.rows;
  const rows = (await convex.query(api.campaigns.list, {})) as Array<Record<string, unknown>>;
  campaignsCache = { at: Date.now(), rows };
  return rows;
}
const profileCache = new Map<string, { at: number; prof: Awaited<ReturnType<typeof getProfile>> | null }>();
async function cachedProfile(username: string) {
  const hit = profileCache.get(username);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.prof;
  const prof = await getProfile(username).catch(() => null);
  // Only cache real answers — a failed lookup should be retried next turn.
  if (prof) profileCache.set(username, { at: Date.now(), prof });
  return prof;
}

/** A recent video of the agent's, with its date — lets the control-panel copilot
 *  answer "what did you post / when" from real data. */
interface RecentVideo { title: string; createdAt: number; status: string }

/** Builder workspace tabs the control-panel copilot may open for the operator. */
const OPENABLE_TABS = ["home", "director", "ideas", "editor", "videos", "schedule", "posting", "generations", "learn", "carousel"] as const;


/** An agent the control-panel operator can assign mission steps to. */
interface RosterMember { mint: string; name: string; kind: string }

/** A mission plan the agent proposes; nothing runs until the owner approves it. */
interface PlanStep {
  id: string;
  agentMint: string;
  agentName: string;
  kind: "create_video" | "clip_video";
  topic?: string;
  sourceUrl?: string;
  /** Hand-off: clip the finished video of this earlier step (0-based index). */
  sourceStep?: number;
  why?: string;
}

/** Control-panel group chat: the agent is one voice among teammates. */
interface TeamContext {
  name: string;
  members: Array<{ name: string; kind: string }>;
  brief?: string;
}

interface AgenticContext {
  bibleSummary?: string;
  topIdeas?: string[];
  tasteProse?: string;
  /** Set only when the chat runs on the /control panel (rich cards + builder handoff). */
  controlPanel?: { recentVideos: RecentVideo[]; stats?: string[]; schedule?: string[]; team?: TeamContext; roster?: RosterMember[]; youtubeCandidates?: ChannelVideo[]; youtubeSearchUrl?: string };
}

interface PersonaSource {
  name: string;
  handle?: string;
  niche?: string;
  audience?: string;
  language?: string;
  voiceArchetype?: string;
  backstory?: string;
  catchphrase?: string;
  traits?: string[];
  beliefs?: string[];
  contentPillars?: string[];
  avoidTopics?: string[];
  dreamCollab?: string;
  characterBible?: string;
  mintAddress?: string;
  /** "influencer" | "clipping" | "trader" | … — gates which campaigns are joinable
   *  (influencers → UGC only). Absent → treated as an influencer (the default kind). */
  agentType?: string;
  /** Social platforms this agent has CONNECTED (cache refreshed by /api/social/status).
   *  Drives the copilot's "post to your connected accounts" awareness + the POST action. */
  connectedPlatforms?: string[];
  /** Configured auto-post spacing (ms) — used to stagger a "post my content" action. */
  postIntervalMs?: number;
  /** Normalized Show Bible, when the agent has one — drives the BIBLE_PATCH
   *  system-prompt section (only rendered when this is set). */
  showBible?: ShowBible;
}

 
async function loadPersonaFromMint(
  convex: ConvexHttpClient,
  mintAddress: string,
  // Preloaded influencer doc — the route fetches it ONCE and shares it here, with
  // the owner check, and with the agentic-context block (this query used to run
  // 3 separate times per chat turn).
  preloadedInfluencer?: Awaited<ReturnType<typeof convex.query<typeof api.influencers.getByMint>>>,
): Promise<PersonaSource | null> {
  const influencer = preloadedInfluencer ?? (await convex.query(api.influencers.getByMint, { mintAddress }));
  if (!influencer) return null;
  const draft = await convex.query(api.nftAgents.getDraftByMint, { mintAddress });
  const q = draft?.questionnaire ?? {};
  return {
    name: influencer.name,
    handle: influencer.handle,
    niche: influencer.niche,
    audience: q.audience,
    language: influencer.language,
    voiceArchetype: influencer.archetype,
    backstory: q.backstory,
    catchphrase: q.catchphrase,
    traits: q.traits,
    beliefs: q.beliefs,
    contentPillars: q.contentPillars,
    avoidTopics: q.avoidTopics,
    dreamCollab: q.dreamCollab,
    characterBible: draft?.characterBible,
    mintAddress,
    agentType: (influencer as { agentType?: string }).agentType ?? (draft as { agentType?: string } | null | undefined)?.agentType,
    connectedPlatforms: (influencer as { connectedPlatforms?: string[] }).connectedPlatforms ?? [],
    postIntervalMs: (influencer as { clipConfig?: { postIntervalMs?: number } }).clipConfig?.postIntervalMs,
    showBible: normalizeShowBible((influencer as { showBible?: unknown }).showBible) ?? undefined,
  };
}

async function loadPersonaFromSession(convex: ConvexHttpClient, sessionId: string): Promise<PersonaSource | null> {
  const draft = await convex.query(api.nftAgents.getBySession, { sessionId });
  if (!draft) return null;
  const q = draft.questionnaire ?? {};
  return {
    name: draft.name,
    handle: draft.handle,
    niche: draft.niche,
    audience: q.audience,
    language: q.language,
    voiceArchetype: q.voiceArchetype,
    backstory: q.backstory,
    catchphrase: q.catchphrase,
    traits: q.traits,
    beliefs: q.beliefs,
    contentPillars: q.contentPillars,
    avoidTopics: q.avoidTopics,
    dreamCollab: q.dreamCollab,
    characterBible: draft.characterBible,
    mintAddress: draft.mintAddress,
  };
}

/** A funded, on-chain campaign the agent can actually join (real data injected
 *  into the prompt so the model never invents campaigns). */
interface JoinableCampaign {
  id: string;
  title: string;
  brandName: string;
  budget: number;
  rate: number;
  brief: string;
  requirements: string[];
  sourceUrls: string[];
  category: "ugc" | "clipping";
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", threads: "Threads",
  x: "X", twitter: "X", facebook: "Facebook",
};

function buildPersonaSystemPrompt(
  persona: PersonaSource,
  knowledgeSnippets: string[],
  fundedCampaigns: JoinableCampaign[] = [],
  canJoin = false,
  readyClips: { title: string }[] = [],
  generatedCount = 0,
  latestTitle = "",
  agentic: AgenticContext = {},
): string {
  const lines: string[] = [];
  lines.push(`You ARE ${persona.name}. You are not an assistant pretending to be ${persona.name} — you ARE ${persona.name}, an AI agent on the Vello protocol${persona.mintAddress ? ` (minted on Solana at ${persona.mintAddress.slice(0, 14)}…)` : ""}.`);
  lines.push("");
  lines.push("## Identity (this is YOU — never break character)");
  if (persona.handle) lines.push(`- Social handle: @${persona.handle.replace(/^@/, "")}`);
  if (persona.niche) lines.push(`- Niche: ${persona.niche}`);
  if (persona.audience) lines.push(`- Your audience: ${persona.audience}`);
  if (persona.voiceArchetype) lines.push(`- Your voice archetype: ${persona.voiceArchetype} — embody this in every reply`);
  if (persona.language) lines.push(`- Primary language: ${persona.language} (reply in this language by default unless the user writes in another)`);
  if (persona.traits?.length) lines.push(`- Core traits: ${persona.traits.join(", ")}`);
  if (persona.beliefs?.length) lines.push(`- Beliefs you hold: ${persona.beliefs.join("; ")}`);
  if (persona.catchphrase) lines.push(`- Your signature catchphrase: "${persona.catchphrase}" — drop it naturally when it fits, never forced`);
  if (persona.contentPillars?.length) lines.push(`- Content you create about: ${persona.contentPillars.join(", ")}`);
  if (persona.dreamCollab) lines.push(`- Your dream collaboration: ${persona.dreamCollab}`);
  if (persona.avoidTopics?.length) lines.push(`- NEVER discuss or promote: ${persona.avoidTopics.join(", ")}`);

  if (persona.backstory) {
    lines.push("");
    lines.push("## Your backstory");
    lines.push(persona.backstory);
  }
  if (persona.characterBible) {
    lines.push("");
    lines.push("## Your character bible (visual + tone)");
    lines.push(persona.characterBible);
  }

  if (knowledgeSnippets.length > 0) {
    lines.push("");
    lines.push("## Your knowledge base (you've studied these — reference them when relevant)");
    knowledgeSnippets.forEach((s, i) => {
      lines.push(`${i + 1}. ${s}`);
    });
  }

  lines.push("");
  lines.push("## How to respond");
  lines.push("- Speak in first person as " + persona.name + ". NEVER say \"As an AI\" or break character.");
  lines.push("- Match your voice archetype and language. Stay in character.");
  lines.push("- Keep replies SHORT (1-3 sentences) unless the user asks for more depth.");
  lines.push("- When asked about your work, content, or opinions, draw from your backstory, traits, and knowledge files.");
  lines.push("- When the user gives you a genuine content request (e.g., \"write me a hook about X\"), DO IT — produce the actual content, in your voice.");
  lines.push("- Be warm, specific, and authentic — not generic or robotic.");
  lines.push("- If the user asks about something in your avoid-topics list, gently decline and pivot.");

  lines.push("");
  lines.push("## Persona / memory talk is NOT a content or action request");
  lines.push("The operator often talks to you just to shape who you are or what you remember — this is config, not work. Examples: \"remember you're a fitness coach\", \"from now on always mention protein\", \"your tone should be more sarcastic\", \"you love hiking\", \"don't talk about crypto\". For these:");
  lines.push("- Acknowledge naturally in character (e.g., \"Got it, noted.\") and briefly reflect the new detail back.");
  lines.push("- Do NOT produce a script, post, video, or any deliverable.");
  lines.push("- Do NOT emit [TASK_OFFER], [JOIN_CAMPAIGN], or [POST_CONTENT] — those are ONLY for explicit requests to create/post/join something right now.");
  lines.push("- Only treat a message as a content or action request when the operator is clearly asking you to produce or do something in this turn, not describe/configure you.");

  lines.push("");
  if (agentic.controlPanel) {
    // The OWNER is talking to their own agent — never quote them a price.
    lines.push("## Requests from your operator");
    lines.push("The person chatting is your OWNER, running you from their control panel. Never quote prices or emit [TASK_OFFER]. When they ask for content, just do it: write it in your voice, or use the action blocks below (post, join a campaign, show videos, open the Builder, save an idea, update the show plan).");
  } else {
  lines.push("## Service Requests & Pricing");
  lines.push("When the user EXPLICITLY asks you to DO something right now (create content, make a video, write a post, manage a campaign, etc — not just describing your persona), you MUST:");
  lines.push("1. Agree enthusiastically in character");
  lines.push("2. Describe what you'll deliver");
  lines.push("3. End your message with this EXACT JSON block on its own line:");
  lines.push("[TASK_OFFER]{\"title\":\"<short task name>\",\"description\":\"<what you will deliver>\",\"deliverables\":[\"<item1>\",\"<item2>\"],\"price\":<number in USDC>,\"currency\":\"USDC\",\"estimatedHours\":<number>}[/TASK_OFFER]");
  lines.push("");
  lines.push("Price guidelines (USDC):");
  lines.push("- Short social post / tweet: 5-15");
  lines.push("- Instagram reel script: 20-40");
  lines.push("- Product video (30-60s): 50-150");
  lines.push("- Full campaign (week): 200-500");
  lines.push("- Custom: use judgment based on scope");
  }

  // ── Joining REAL brand campaigns ────────────────────────────────────────────
  // The model must NEVER invent a campaign, brand or budget. It may join ONLY the
  // funded, on-chain campaigns injected below, by emitting a machine-parsed block
  // that the server validates against this exact set and then executes for real
  // (joins the campaign + generates + posts the clip → shows in the Tasks page).
  lines.push("");
  lines.push("## Joining brand campaigns (REAL — never invent one)");
  if (!canJoin) {
    lines.push("- You are NOT minted yet, so you cannot join campaigns. If asked, tell the user their operator must mint you first — do NOT claim to join anything.");
  } else if (fundedCampaigns.length === 0) {
    lines.push("- There are NO funded on-chain campaigns available to join right now. If the user asks to join one, say so honestly — NEVER invent a campaign, brand, budget or rate, and NEVER claim you joined one.");
  } else {
    lines.push("- ONLY the funded on-chain campaigns listed below are joinable. Reference them ONLY by their exact title/brand/budget as given — never invent details.");
    if (agentic.controlPanel) {
      lines.push("- In Control, guide the operator from campaign goal to suitable source to an approval-first [PLAN]. Do not emit [JOIN_CAMPAIGN] here; it bypasses the review step.");
    } else if (persona.agentType === "clipping" || persona.agentType === "clipper") {
      lines.push("- A Clipper needs a clippable long-form source for a clipping campaign. Do not emit [JOIN_CAMPAIGN], which creates an original video. Ask for a permitted source when none is provided.");
    } else {
      lines.push("- When the user actually wants to join/proceed, END your reply with this EXACT block on its own line (choose ONE real id from the list):");
      lines.push("[JOIN_CAMPAIGN]{\"campaignId\":\"<id from the list>\",\"topic\":\"<what your video will be about>\"}[/JOIN_CAMPAIGN]");
      lines.push("The system creates your campaign video. Do NOT emit the block unless the user wants to proceed.");
    }
    lines.push("");
    lines.push("Funded on-chain campaigns you can join right now:");
    fundedCampaigns.forEach((c) => {
      lines.push(`- id=${c.id} · ${c.category} · "${c.title}" by ${c.brandName} · $${c.budget} budget · $${c.rate}/1K views · goal: ${c.brief}${c.requirements.length ? ` · requirements: ${c.requirements.join("; ")}` : ""}${c.sourceUrls.length ? ` · campaign sources: ${c.sourceUrls.join(", ")}` : " · no supplied video source"}`);
    });
  }

  // ── Posting your OWN generated content (agentic — you already know your state) ──
  // The copilot is given the agent's LIVE state here so it NEVER has to ask "post
  // where?": it knows how many ready clips exist and which accounts are connected.
  const connected = (persona.connectedPlatforms ?? []).filter(Boolean);
  const platLabel = (p: string) => PLATFORM_LABEL[p] ?? p;
  lines.push("");
  lines.push("## Posting your content (you ALREADY know your state — never ask \"post where?\")");
  lines.push(
    connected.length
      ? `- Your CONNECTED social accounts: ${connected.map(platLabel).join(", ")}. When the operator says "post" / "publish" / "post the content", you post to THESE accounts — do NOT ask where.`
      : "- You have NO social accounts connected yet. If the operator asks to post, tell them to connect an account first in the Posting tab (X, YouTube, TikTok, etc.). Do NOT claim you posted.",
  );
  // FACT: state how much content the agent already has. Never claim it has none
  // when clips exist — the operator can see them in the Generations tab / calendar.
  if (generatedCount > 0) {
    lines.push(`- FACT: You have ALREADY generated ${generatedCount} clip${generatedCount === 1 ? "" : "s"}${latestTitle ? ` (latest: "${latestTitle.slice(0, 50)}")` : ""}. NEVER say you "haven't clipped any videos" — you have. Do NOT ask for a video URL when the operator wants to post existing content.`);
  }
  if (readyClips.length > 0) {
    lines.push(`- ${readyClips.length} of them ${readyClips.length === 1 ? "is" : "are"} not yet posted and READY to publish${connected.length ? "" : " (once an account is connected)"}. Newest first: ${readyClips.slice(0, 5).map((c) => `"${(c.title || "Clip").slice(0, 40)}"`).join(", ")}.`);
  } else if (generatedCount > 0) {
    lines.push("- All your generated clips are already posted. If the operator wants to post more, tell them to run the pipeline to make fresh clips (or you can repost the latest if they insist).");
  } else {
    lines.push("- You have NO generated clips yet. If the operator asks to post, tell them to run the Clipping pipeline first with a video URL — do NOT claim you posted.");
  }
  if (connected.length && readyClips.length > 0) {
    lines.push("- When the operator asks you to post/publish (\"post now\", \"post the content\", \"post the latest\"), confirm in ONE short line (what + where) and END your reply with this EXACT block on its own line:");
    lines.push(`[POST_CONTENT]{"count":${readyClips.length},"platforms":[${connected.map((p) => `"${p}"`).join(",")}]}[/POST_CONTENT]`);
    lines.push("The clips are ordered NEWEST-FIRST, so count=1 posts the LATEST clip. The system schedules them to your connected accounts (each with its own best caption from the clip). Do NOT emit the block unless the operator actually wants to post; lower \"count\" (e.g. 1 for \"post the latest\") when they ask for fewer.");
  }

  // ── Show Bible + Ideas queue (agentic pipeline context) ─────────────────────
  // The copilot knows the SHOW it runs and what's queued, so "what are you
  // making next?" gets a real answer, a user pitch lands in the idea queue, and
  // a standing creative direction becomes a bible update — one source of truth.
  lines.push("");
  lines.push("## Your show + idea queue");
  if (agentic.bibleSummary) {
    lines.push(`- Your SHOW BIBLE (drives every video you make): ${agentic.bibleSummary}`);
  } else {
    lines.push("- You have no Show Bible yet. If the user describes what your show should be, suggest they set it up on the Director tab (or emit [UPDATE_BIBLE] with their concept to create it).");
  }
  if (agentic.topIdeas?.length) {
    lines.push(`- Your current top queued ideas (what you plan to make next): ${agentic.topIdeas.slice(0, 5).map((h) => `"${h}"`).join("; ")}.`);
  }
  if (agentic.tasteProse) {
    lines.push(`- What you've learned the operator likes: ${agentic.tasteProse.slice(0, 200)}`);
  }
  lines.push("- When the user PITCHES a video idea (\"you should do a video about X\", \"make one about Y sometime\"), acknowledge in character and END your reply with this EXACT block on its own line:");
  lines.push("[SAVE_IDEA]{\"headline\":\"<short idea title>\",\"angle\":\"<the specific take, 1-2 sentences>\",\"format\":\"<optional format>\"}[/SAVE_IDEA]");
  lines.push("- When the user gives a STANDING creative direction for your future videos that is a broad show-concept rewrite no BIBLE_PATCH op below can express (a new premise/arc direction, a cast change, a world redesign), acknowledge and END your reply with this EXACT block on its own line, putting their full directive in \"concept\":");
  lines.push("[UPDATE_BIBLE]{\"concept\":\"<the user's directive, in their words>\"}[/UPDATE_BIBLE]");
  lines.push("- Do NOT emit [SAVE_IDEA] or [UPDATE_BIBLE] for one-off content requests this turn (those are [TASK_OFFER]) or for plain questions.");

  // ── BIBLE_PATCH — targeted, allowlisted edits to the show plan ─────────────
  // Only rendered when a normalized bible actually exists (persona.showBible).
  // This is the fine-grained sibling of [UPDATE_BIBLE]: a small, validated set
  // of ops the server can apply deterministically (no LLM re-compile), so a
  // durable one-line preference ("shorter videos", "more Malay") lands exactly,
  // instead of drifting through a full bible rewrite.
  if (persona.showBible) {
    const formatIds = VIDEO_FORMATS.map((f) => `${f.id} (${f.name})`).join(", ");
    lines.push("");
    lines.push("## Durable preferences that edit your show plan (BIBLE_PATCH)");
    lines.push("The operator sometimes gives you a DURABLE instruction about how your show should run from now on — phrases like \"from now on\", \"always\", \"stop doing X\", \"more X\", \"change the plan\", \"switch to\", \"going forward\". This is different from a ONE-OFF content request (\"make a video about X today\") — a one-off never touches the show plan, only this turn's content.");
    lines.push("- When a durable preference MAPS to one of the ops below, acknowledge naturally in character, then END your reply with this EXACT block on its own line:");
    lines.push("[BIBLE_PATCH]{\"ops\":[{...}]}[/BIBLE_PATCH]");
    lines.push("  The 9 allowed ops (use ONLY these — anything else is rejected):");
    lines.push("  1. {\"op\":\"setTone\",\"value\":\"<short tone descriptor>\"}");
    lines.push("  2. {\"op\":\"setLanguage\",\"value\":\"<language>\"}");
    lines.push("  3. {\"op\":\"setPremise\",\"value\":\"<updated show premise, <=300 chars>\"}");
    lines.push("  4. {\"op\":\"setStyle\",\"value\":\"<visual style descriptor>\"}");
    lines.push(`  5. {"op":"addFormat","formatId":"<id>"} — valid ids: ${formatIds}`);
    lines.push(`  6. {"op":"removeFormat","formatId":"<id>"} — same id list; can't remove the last remaining format`);
    lines.push(`  7. {"op":"setFormatDuration","formatId":"<id>","seconds":<number>}`);
    lines.push("  8. {\"op\":\"setPostsPerDay\",\"seconds\":<1-6>} (yes, the field is named \"seconds\" for this op — it means the count)");
    lines.push("  9. {\"op\":\"addCatchphrase\",\"value\":\"<short phrase>\"}");
    lines.push("- You can include multiple ops in one block (e.g. \"shorter and in Malay from now on\" → setFormatDuration + setLanguage).");
    lines.push("- For a durable-sounding preference that does NOT map to any of these 9 ops (e.g. a whole new premise direction, a cast change, a scheduling rule outside posts-per-day), reply honestly: something like \"that's not something I can pin to the show plan yet — for now I'll treat it as a one-off.\" Do NOT emit [BIBLE_PATCH] in that case, and do NOT pretend you saved it.");
    lines.push("- NEVER emit [BIBLE_PATCH] for a one-off content request (\"make a video about X today\") — that stays a normal reply (or a [TASK_OFFER]), untouched show plan.");
    lines.push("- ROUTING: when a durable preference maps to one of the 9 ops above, ALWAYS use [BIBLE_PATCH] — never [UPDATE_BIBLE]. [UPDATE_BIBLE] is ONLY for broad show-concept rewrites that no op above covers (new premise arcs, cast changes, world redesign). Never emit both blocks in the same reply.");
  }

  // ── Control panel: rich video cards + builder handoff ──────────────────────
  // Only on the /control surface, which renders these blocks as cards/buttons.
  if (agentic.controlPanel) {
    const recent = agentic.controlPanel.recentVideos;
    lines.push("");
    if (agentic.controlPanel.stats?.length) {
      lines.push("## Your live stats (REAL numbers straight from the database, refreshed this message)");
      lines.push(...agentic.controlPanel.stats);
      lines.push("- You HAVE this data: never say you don't have views, virality scores, earnings or results. Quote the exact numbers above (views, scores, counts, dates) when asked, in the operator's language.");
      lines.push("- Don't just recite: interpret like a sharp manager — what's working (best score/views, platform, topic), what isn't, and ONE concrete next move. If the next move is production work, propose it as a [PLAN]; if they want to see the videos behind the numbers, add [SHOW_VIDEOS] sorted the right way.");
      lines.push("- If a number is 0 or missing, say so plainly and why (e.g. views not synced yet, nothing posted, no socials connected) and what fixes it.");
      lines.push("");
    }
    if (agentic.controlPanel.schedule?.length) {
      lines.push("## Actual upcoming schedule (local date/time)");
      lines.push(...agentic.controlPanel.schedule);
      lines.push("Use these records to answer schedule questions. Do not invent a posting time or claim that an unscheduled video is queued.");
    }
    lines.push("## Your videos (REAL data, with dates — never invent a video or a date)");
    if (recent.length === 0) {
      lines.push("- You have no videos yet.");
    } else {
      recent.forEach((v) => {
        lines.push(`- "${(v.title || "Untitled").slice(0, 60)}" · ${new Date(v.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC · ${v.status}`);
      });
    }
    lines.push("- When the operator wants to SEE your videos (\"show me\", \"send me\", \"what did you make\", \"latest video\"), answer briefly and END your reply with this EXACT block on its own line (the panel renders the real videos as playable cards):");
    lines.push("[SHOW_VIDEOS]{\"count\":<1-6>,\"filter\":\"all\"|\"posted\"|\"ready\",\"sort\":\"recent\"|\"views\"|\"viral\"}[/SHOW_VIDEOS]");
    lines.push("  sort: \"views\" for best-performing / most viewed, \"viral\" for virality scores, \"recent\" otherwise. The cards show views and the virality score.");
    lines.push("- You can operate your Builder workspace. When the operator wants to change something that lives there (edit a clip, tune your Director/show style, your idea queue, the posting schedule/calendar, connect socials, your generations), say what you're opening and END your reply with this EXACT block on its own line:");
    lines.push(`[OPEN_BUILDER]{"tab":"<one of: ${OPENABLE_TABS.join(", ")}>"}[/OPEN_BUILDER]`);
    lines.push("  Tab guide: director = show style/Veo video look; ideas = idea queue; editor = clip editor; videos = your generated videos; schedule/posting = posting calendar + connect socials; generations = everything you've produced; learn = learn from a reference video; home = overview.");
    lines.push("- ACT, don't just point at the Builder. You can do these RIGHT HERE in chat:");
    lines.push("  • Draft ideas: when the operator wants ideas (\"draft ideas\", \"give me 3 ideas\", \"what should we make\"), list them briefly AND end with one [SAVE_IDEA] block per idea (up to 5) — they go straight into your idea queue.");
    const roster = agentic.controlPanel.roster ?? [];
    lines.push("  • MISSIONS — real production work (make/film/clip videos, run a campaign push, \"handle X for me\"). You never start work on your own: propose a short plan, the operator approves it in chat, the system runs it, and EVERY finished video comes back to the operator for approval before anything is posted. Say it plainly in 1-2 sentences — what you'll make ONCE THEY APPROVE, and that you'll check back before posting. Never say you've already started (no \"on it\" or \"working on it\") — nothing runs until they tap Approve. Then END with this EXACT block:");
    lines.push("[PLAN]{\"title\":\"<short mission name>\",\"steps\":[{\"agent\":\"<exact Influencer name>\",\"kind\":\"create_video\",\"campaignId\":\"<matching UGC campaign id, if any>\",\"topic\":\"<short original video angle, hook and CTA serving campaign goal>\",\"why\":\"<one short line>\"},{\"agent\":\"<exact Clipper name>\",\"kind\":\"clip_video\",\"campaignId\":\"<matching clipping campaign id, if any>\",\"source\":\"<real long-form source URL>\",\"why\":\"<one short line>\"}]}[/PLAN]");
    lines.push("    Rules: 1-6 steps. Include only steps that have enough inputs; the example above does NOT require both roles. Influencers make ORIGINAL short-form videos for UGC campaigns. Clippers cut existing LONG-FORM video for clipping campaigns. NEVER hand an Influencer's generated short to a Clipper or use step:N. A Clipper source must be a real URL supplied by the campaign or operator; never invent URLs. If none is available, recommend a campaign or search for source candidates and ask the operator to choose one before proposing a clipping [PLAN]. A plain question is not a mission.");
    lines.push("    Funnel guidance: start with the operator's outcome and audience. Show the matching LIVE campaign and its actual brief/requirements, then explain the content angle and CTA. For clipping, check campaign-provided videos first. If there is no usable long-form source, ask whether the operator has permitted footage or wants YouTube research. A YouTube result is only a candidate; ask the operator to supply and confirm the source before creating a paid mission. After approval, create the clip, return it for review, and only then post toward the campaign.");
    if (agentic.controlPanel.youtubeCandidates?.length) {
      lines.push("  YouTube research candidates (not campaign-provided and not approved to clip):");
      for (const video of agentic.controlPanel.youtubeCandidates) lines.push(`  - ${video.name}: ${video.url}`);
      lines.push("  Share relevant candidates as links with a short reason tied to the campaign goal. Ask the operator to confirm a source they can use. Do not emit [PLAN] using these candidates until the operator supplies its URL.");
    } else if (agentic.controlPanel.youtubeSearchUrl) {
      lines.push(`  YouTube search could not verify a long-form result this turn. Offer this search link and ask the operator for a suitable permitted video URL: ${agentic.controlPanel.youtubeSearchUrl}. Do not claim a video was found.`);
    }
    if (roster.length) {
      lines.push(`    Roster: ${roster.map((m) => `${m.name} (${m.kind})`).join(", ")}.`);
    }
    lines.push("  • Only use [OPEN_BUILDER] when the operator needs a screen you can't operate from chat (editing a clip's timeline, connecting socials, tuning visual style).");
    lines.push("- Every action block MUST be written exactly as shown, including its closing tag, on its own line.");
    lines.push("- Format longer answers with short markdown (bold, bullet lists) — the panel renders it.");

    const team = agentic.controlPanel.team;
    if (team) {
      const mates = team.members.filter((m) => m.name !== persona.name);
      lines.push("");
      lines.push(`## Team chat: "${team.name}"`);
      lines.push(`- You are in a GROUP chat with the operator and your teammates: ${mates.map((m) => `${m.name} (${m.kind})`).join(", ")}. The operator talks to the whole team.`);
      lines.push("- Teammates' messages appear as \"[Name]: …\". Reply ONLY as yourself — never write lines for a teammate and never prefix your reply with your own name.");
      lines.push("- Build on a teammate's specific idea when they have spoken: improve the hook, source, CTA, or execution and name the tradeoff. Disagree constructively when the source, audience, or campaign fit is weak. Avoid repeating their answer. End with a concrete next step for the operator.");
      lines.push("- Work together around the campaign's intent and funnel: name the audience, message, desired action, matching campaign, and the next practical step. Influencers create original short-form UGC. Clippers find suitable existing long-form source material and cut it for a clipping campaign. An Influencer's generated short is never a Clipper source.");
      lines.push("- Keep it to 1-3 sentences unless the operator asks for depth. Action blocks act on YOUR OWN account only — except [PLAN], which assigns steps to teammates by name.");
      lines.push("- ONE plan per operator message: if a teammate already proposed a [PLAN] this turn (you'll see it as \"(proposed a plan …)\"), do NOT propose another — just react to your part in one line.");
      if (team.brief) lines.push(`- TEAM BRIEF (the operator's standing goal for this team — every plan should serve it): ${team.brief}`);
    }
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const timed = <T,>(name: string, p: Promise<T>): Promise<T> => p.finally(() => { timings[name] = Date.now() - t0; });
    const auth = await requireInternalOrUserAuth(req);
    timings.auth = Date.now() - t0;
    if (auth.error) return auth.error;

    if (!KIE_KEY && !GEMINI_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY / KIE_API_KEY not configured" }, { status: 500 });
    }
    if (!CONVEX_URL) {
      return NextResponse.json({ error: "Convex URL not configured" }, { status: 500 });
    }

    const body = await req.json() as {
      mintAddress?: string;
      sessionId?: string;
      messages: Array<{ role: ChatRole; content: string }>;
      personaSnapshot?: Partial<PersonaSource>; // client-side fallback for pre-mint / pre-draft agents
      /** "control" = the /control panel (enables SHOW_VIDEOS / OPEN_BUILDER). */
      surface?: string;
      /** Control-panel team chat context (only honoured with surface "control"). */
      team?: TeamContext;
      /** Control panel: agents the operator can assign mission steps to. */
      roster?: RosterMember[];
      /** Team chat: the operator's own latest message. Teammates' lines ride in
       *  `messages` as user turns, so intent/directive checks must use THIS. */
      operatorMessage?: string;
    };

    const { mintAddress, sessionId, messages, personaSnapshot } = body;
    const isControlPanel = body.surface === "control";
    const team = isControlPanel && body.team && Array.isArray(body.team.members)
      ? {
          name: String(body.team.name ?? "Team").slice(0, 60),
          members: body.team.members.slice(0, 8).map((m) => ({ name: String(m?.name ?? "").slice(0, 60), kind: String(m?.kind ?? "").slice(0, 20) })),
          ...(typeof body.team.brief === "string" && body.team.brief.trim() ? { brief: body.team.brief.trim().slice(0, 1200) } : {}),
        }
      : undefined;
    // What the OPERATOR actually typed — in a team chat the last "user" turn may
    // be a teammate's line, which must never trigger actions or standing orders.
    const operatorTurns = team
      ? [{ role: "user" as const, content: String(body.operatorMessage ?? "").slice(0, 4000) }]
      : messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    // Talking to the agent in-character ("speak Malay from now on") must steer
    // its NEXT generated video, not just this reply. Parse + persist this turn's
    // standing orders the same way the main builder copilot does (see
    // lib/server/agentDirectives.ts) so the creative director picks them up on
    // the next create_video run. Non-blocking: never delay or break the reply.
    void persistStandingDirective({
      messages: operatorTurns as Array<{ role?: unknown; content?: unknown }>,
      mintAddress,
      sessionId,
      source: "agent_chat",
    });

    const convex = new ConvexHttpClient(CONVEX_URL);

    // The influencer doc is needed by persona resolution, the owner check, AND
    // the agentic-context block — fetch it exactly once per turn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let agentDoc: any = null;
    if (mintAddress) {
      try { agentDoc = await convex.query(api.influencers.getByMint, { mintAddress }); } catch { /* best-effort */ }
    }

    // 3-tier persona resolution: mint → session-draft → client snapshot
    let persona: PersonaSource | null = null;
    if (mintAddress && agentDoc) {
      try { persona = await loadPersonaFromMint(convex, mintAddress, agentDoc); } catch { /* fall through */ }
    }
    if (!persona && sessionId) {
      try { persona = await loadPersonaFromSession(convex, sessionId); } catch { /* fall through */ }
    }
    if (!persona && personaSnapshot?.name) {
      persona = {
        name: personaSnapshot.name,
        handle: personaSnapshot.handle,
        niche: personaSnapshot.niche,
        audience: personaSnapshot.audience,
        language: personaSnapshot.language,
        voiceArchetype: personaSnapshot.voiceArchetype,
        backstory: personaSnapshot.backstory,
        catchphrase: personaSnapshot.catchphrase,
        traits: personaSnapshot.traits,
        beliefs: personaSnapshot.beliefs,
        contentPillars: personaSnapshot.contentPillars,
        avoidTopics: personaSnapshot.avoidTopics,
        dreamCollab: personaSnapshot.dreamCollab,
        characterBible: personaSnapshot.characterBible,
        mintAddress: personaSnapshot.mintAddress,
      };
    }
    // Last-resort: build from whatever snapshot fields exist
    if (!persona && personaSnapshot) {
      persona = { ...(personaSnapshot as PersonaSource), name: personaSnapshot.name ?? "Agent" };
    }
    if (!persona || !persona.name) {
      return NextResponse.json({ error: "Agent persona not found — set the name first" }, { status: 404 });
    }

    // Owned (minted) agents require the SIWS-proven owner; internal callers skip.
    // Uses the agentDoc fetched once above — no repeat query.
    if (!auth.internal && mintAddress) {
      const e = requireOwnerWithSiws(auth, agentDoc);
      if (e) return e;
    }

    const operatorLatest = team ? String(body.operatorMessage ?? "") : [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const casualTurn = /^(?:yo|hi|hello|hey|hey there|hiya|sup|what'?s up|good morning|good afternoon|good evening)[\s!?.]*$/i.test(operatorLatest.trim());

    // ── Context assembly ─────────────────────────────────────────────────────
    // All of these are independent reads; they used to run one-after-another
    // (7-9 serial round-trips, the biggest share of copilot reply latency
    // before the model even started). Fan them out in parallel instead.
    const knowledgePromise: Promise<string[]> = !casualTurn && (sessionId || persona.mintAddress)
      ? (sessionId
          ? convex.query(api.agentKnowledge.listBySession, { sessionId })
          : convex.query(api.agentKnowledge.listByMint, { mintAddress: persona.mintAddress! })).then((entries) =>
          entries.slice(0, 12).map((e: Doc<"agentKnowledge">) => {
            const snippet = (e.content ?? "").slice(0, 320).replace(/\s+/g, " ").trim();
            return `[${e.title}] ${snippet}`;
          }),
        ).catch(() => [] as string[])
      : Promise.resolve([] as string[]);

    // Real funded, on-chain campaigns this MINTED agent could join — injected into
    // the prompt so the model references real campaigns instead of hallucinating.
    // Funded = has a locked vault (pdaAddress) AND is on the on-chain rail
    // (onchainVersion >= 2), and still open. Best-effort; niche-affinity first.
    const canJoin = !!persona.mintAddress;
    const fundedCampaignsPromise: Promise<JoinableCampaign[]> = (async () => {
      if (casualTurn) return [];
      if (!canJoin) return [];
      try {
        const all = await cachedCampaigns(convex);
        const niche = (persona.niche ?? "").toLowerCase().trim();
        // Joinable = funded on-chain AND still LIVE (isJoinableCampaign derives the
        // real lifecycle since the stored `status` is frozen at "open"). An AI
        // INFLUENCER is further limited to UGC campaigns — a clipping campaign is a
        // clipper's job. Non-influencer agents keep the category-agnostic filter.
        const isInfluencer = (persona.agentType ?? "influencer") === "influencer";
        const isClipper = persona.agentType === "clipping" || persona.agentType === "clipper";
        const funded = all.filter((c) => team ? isJoinableCampaign(c) : isInfluencer ? isJoinableUgcCampaign(c) : isClipper ? isJoinableCampaign(c) && !isUgcCampaign(c) : isJoinableCampaign(c));
        if (niche) {
          const affinity = (c: Record<string, unknown>) =>
            `${c.title ?? ""} ${c.postingInstructions ?? ""} ${c.brandName ?? ""}`.toLowerCase().includes(niche) ? 0 : 1;
          funded.sort((a, b) => affinity(a) - affinity(b));
        }
        const relevant = team
          ? [...funded.filter(isUgcCampaign).slice(0, 3), ...funded.filter((c) => !isUgcCampaign(c)).slice(0, 3)]
          : funded.slice(0, 6);
        return relevant.map((c) => ({
          id: String(c._id),
          title: String(c.title ?? "Campaign"),
          brandName: String(c.brandName ?? ""),
          budget: Number(c.budget ?? 0),
          rate: Number(c.ratePerThousandViews ?? 0),
          brief: String(c.brief ?? "").slice(0, 220),
          requirements: (Array.isArray(c.requirements) ? c.requirements : []).filter((r): r is string => typeof r === "string").slice(0, 3).map((r) => r.slice(0, 120)),
          sourceUrls: extractUrls(c.contentLinks as string[] | undefined, c.contentFileUrls as string[] | undefined)
            .filter((url) => /(?:youtu(?:\.be|be\.com)|drive\.google\.com|\.(?:mp4|mov|webm)(?:[?#]|$))/i.test(url)).slice(0, 3),
          category: isUgcCampaign(c) ? "ugc" : "clipping",
        }));
      } catch {
        /* best-effort — on failure the prompt simply reports no campaigns available */
        return [];
      }
    })();

    // The agent's OWN generated clips — injected so the copilot KNOWS it has content
    // (and can post it) instead of asking "post what / where?". `listClipsByMint` is
    // sorted newest-first, so index 0 is the LATEST clip.
    //  - generatedCount = every clip that has a real video (any status) → "you have content".
    //  - readyClips      = the ones NOT yet posted → the postable set for a "post now".
    // Broad on purpose: a clip that's been scheduled or is mid-post is still real
    // content the copilot must acknowledge (the old `status === "ready"` gate wrongly
    // reported "no clips" once a clip moved to scheduled/posting/posted).
    type ReadyClip = { id: string; title: string; caption: string; clipUrl: string };
    const clipsPromise: Promise<{ readyClips: ReadyClip[]; generatedCount: number; latestTitle: string; recentVideos: RecentVideo[] }> = (async () => {
      if (casualTurn) return { readyClips: [], generatedCount: 0, latestTitle: "", recentVideos: [] };
      if (!persona.mintAddress) return { readyClips: [], generatedCount: 0, latestTitle: "", recentVideos: [] };
      try {
        // Clip list + scheduled queue fetched together (they're independent).
        const [clips, scheduledRows] = await Promise.all([
          convex.query(api.clipJobs.listClipsByMint, { mintAddress: persona.mintAddress }) as Promise<
            Array<{ _id: string; title: string; captionText?: string; clipUrl?: string; status: string; createdAt?: number }>>,
          (convex.query(api.scheduledContent.listByMint, { mintAddress: persona.mintAddress }) as Promise<
            Array<{ videoUrl?: string; status?: string }>>).catch(() => [] as Array<{ videoUrl?: string; status?: string }>),
        ]);
        const withVideo = clips.filter((c) => typeof c.clipUrl === "string" && /^https?:\/\//i.test(c.clipUrl));
        // Clips already QUEUED (an active scheduledContent row) must not be posted
        // again — that would double-schedule. Exclude their video URLs.
        const scheduledUrls = new Set<string>();
        for (const r of scheduledRows) {
          if (r.videoUrl && r.status && !["cancelled", "failed", "posted"].includes(r.status)) scheduledUrls.add(r.videoUrl);
        }
        return {
          generatedCount: withVideo.length,
          latestTitle: withVideo[0]?.title ?? "",
          recentVideos: withVideo.slice(0, 8).map((c) => ({ title: c.title, createdAt: c.createdAt ?? 0, status: c.status })),
          readyClips: withVideo
            .filter((c) => c.status !== "posted" && !scheduledUrls.has(c.clipUrl as string)) // unposted AND not already queued
            .slice(0, 20)
            .map((c) => ({ id: c._id, title: c.title, caption: c.captionText ?? c.title, clipUrl: c.clipUrl as string })),
        };
      } catch { return { readyClips: [], generatedCount: 0, latestTitle: "", recentVideos: [] }; /* best-effort */ }
    })();

    // LIVE connected accounts: persona.connectedPlatforms is a CACHE (refreshed by
    // /api/social/status) and goes stale — an account connected AFTER the last refresh
    // (e.g. X) is missing, so the copilot posts only to the cached platform (YouTube)
    // and silently skips the newly-connected one. Resolve the agent's REAL connected
    // set from upload-post and UNION it with the cache, so "post the latest content"
    // fans out to EVERY connected platform. Best-effort: on any failure we keep the
    // cache (never lose a platform we already knew about). Mirrors /api/social/post.
    const livePlatformsPromise: Promise<Set<string>> = (async () => {
      if (casualTurn) return new Set<string>();
      // Accounts may have been linked pre-mint (under the session id) or post-mint
      // (under the mint) — check BOTH profiles and union everything either one has,
      // exactly like /api/ai/chat's connection resolver. Profiles fetched in
      // parallel (they're independent external calls).
      const ids = [persona.mintAddress, sessionId].filter((v): v is string => typeof v === "string" && v.length > 0);
      const usernames = Array.from(new Set(ids.map((id) => resolveUsername(id)).filter(Boolean)));
      const live = new Set<string>();
      const profiles = await Promise.all(usernames.map((u) => cachedProfile(u)));
      for (const prof of profiles) {
        if (!prof) continue; /* keep going; fall back to the cache below */
        for (const [k, val] of Object.entries(prof.connected)) {
          if (val && PLATFORM_IDS.includes(k)) live.add(k);
        }
      }
      return live;
    })();

    // ── Agentic pipeline context: bible summary, top queued ideas, taste ──────
    // Best-effort; the chat works without any of it. Reuses the agentDoc loaded
    // once at the top of the handler instead of re-querying it.
    // The persona's own influencer doc — also consumed by the UPDATE_BIBLE
    // action block after the reply. Reuses the top-of-handler fetch when the
    // mints match; queried once otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatAgentDocPromise: Promise<any> = !persona.mintAddress
      ? Promise.resolve(null)
      : agentDoc && persona.mintAddress === mintAddress
        ? Promise.resolve(agentDoc)
        : convex.query(api.influencers.getByMint, { mintAddress: persona.mintAddress }).catch(() => null);
    const agenticPromise: Promise<AgenticContext> = (async () => {
      const out: AgenticContext = {};
      if (casualTurn) return out;
      if (!persona.mintAddress) return out;
      try {
        const chatAgentDoc = await chatAgentDocPromise;
        const bible = normalizeShowBible(chatAgentDoc?.showBible);
        if (bible) {
          const styles = bibleVideoStyles(bible).map((s) => `"${s.name}"`).join(", ");
          out.bibleSummary = `${bible.premise.slice(0, 220)} Video styles you rotate (the operator can request one by name): ${styles}.`;
        }
        const prose = String(chatAgentDoc?.tasteProfile?.prose ?? "").trim();
        if (prose) out.tasteProse = prose;
        const fresh = await convex.query(api.contentIdeas.listFreshProposed, { mintAddress: persona.mintAddress });
        out.topIdeas = (Array.isArray(fresh) ? fresh : []).slice(0, 5).map((i: { headline: string }) => i.headline);
      } catch { /* agentic context unavailable */ }
      return out;
    })();

    // One join point for the whole context fan-out.
    const [knowledgeSnippets, fundedCampaigns, { readyClips, generatedCount, latestTitle, recentVideos }, livePlatforms, agentic, chatAgentDoc] =
      await Promise.all([
        timed("knowledge", knowledgePromise), timed("campaigns", fundedCampaignsPromise), timed("clips", clipsPromise),
        timed("platforms", livePlatformsPromise), timed("agentic", agenticPromise), chatAgentDocPromise,
      ]);
    timings.context = Date.now() - t0;
    const isClipperAgent = persona.agentType === "clipping" || persona.agentType === "clipper";
    const wantsYoutubeResearch = /\b(search|find|look for|youtube|source videos?|footage)\b/i.test(operatorLatest)
      && /\b(video|youtube|source|footage|clip)\b/i.test(operatorLatest);
    const clippingCampaign = fundedCampaigns.find((c) => c.category === "clipping");
    const youtubeQuery = clippingCampaign ? `${clippingCampaign.brandName} ${clippingCampaign.title}` : `${persona.niche ?? ""} interview podcast`;
    const youtubeCandidates = isControlPanel && isClipperAgent && wantsYoutubeResearch
      ? await searchYoutubeLongVideos(youtubeQuery).catch(() => [] as ChannelVideo[])
      : [];

    // Live upload-post state is the SOURCE OF TRUTH — replace the cache with it
    // when we got a definitive answer (so a newly-connected platform appears AND a
    // disconnected one drops). Only fall back to the cache when every lookup failed.
    if (livePlatforms.size) {
      persona.connectedPlatforms = Array.from(livePlatforms);
    }

    if (isControlPanel && !casualTurn) {
      // The panel's cards come from videoFeedByMints (clips AND generated
      // influencer videos) — feed the model the same list so what it says
      // matches what it shows. Falls back to the clip list on failure.
      let feedVideos: RecentVideo[] = recentVideos;
      let statsLines: string[] = [];
      let scheduleLines: string[] = [];
      if (persona.mintAddress) {
        // Live stats from the database, fetched in parallel: every video with
        // its views / virality / platform, the credits balance and recent clip
        // runs. Lets the agent answer "total views?", "virality scores?",
        // "why did my clip fail?" with REAL numbers.
        const mint = persona.mintAddress;
        const [feed, credits, jobs, scheduled] = await Promise.all([
          (convex.query(api.clipJobs.videoFeedByMints, { mintAddresses: [mint] }) as Promise<{ items: StatVideo[] & Array<{ caption: string }> }>)
            .catch(() => ({ items: [] as Array<StatVideo & { caption: string }> })),
          (convex.query(api.userCredits.balanceForMint, { mintAddress: mint }) as Promise<number>).catch(() => null),
          (convex.query(api.clipJobs.listJobsByMint, { mintAddress: mint }) as Promise<Array<{ status: string; createdAt?: number; _creationTime: number; error?: string }>>)
            .catch(() => []),
          (convex.query(api.scheduledContent.listByMint, { mintAddress: mint, limit: 80 }) as Promise<Array<{ status: string; scheduledFor: number; topic: string; platforms: string[] }>>)
            .catch(() => []),
        ]);
        scheduleLines = scheduled
          .filter((row) => (row.status === "scheduled" || row.status === "posting") && row.scheduledFor >= Date.now() - 5 * 60_000)
          .sort((a, b) => a.scheduledFor - b.scheduledFor)
          .slice(0, 8)
          .map((row) => `- ${new Date(row.scheduledFor).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT: ${row.topic || "Post"} to ${row.platforms.join(", ") || "connected platforms"} (${row.status})`);
        if (feed.items.length) {
          feedVideos = [...feed.items]
            .sort((x, y) => y.createdAt - x.createdAt)
            .slice(0, 8)
            .map((v) => ({ title: v.caption, createdAt: v.createdAt, status: v.state }));
        }
        const doc = chatAgentDoc as { lifetimeEarningsUsdc?: number; monthlyEarnings?: number } | null;
        statsLines = buildAgentStatsLines(feed.items, {
          lifetimeEarningsUsdc: doc?.lifetimeEarningsUsdc,
          monthlyEarningsUsdc: doc?.monthlyEarnings,
          creditsBalance: credits,
          connectedPlatforms: persona.connectedPlatforms ?? [],
          recentJobs: [...jobs]
            .sort((a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime))
            .slice(0, 5)
            .map((j) => ({ status: j.status, createdAt: j.createdAt ?? j._creationTime, error: j.error })),
        });
      }
      const roster: RosterMember[] = Array.isArray(body.roster)
        ? body.roster.slice(0, 8).map((m) => ({ mint: String(m?.mint ?? ""), name: String(m?.name ?? "").slice(0, 60), kind: String(m?.kind ?? "").slice(0, 20) })).filter((m) => m.mint && m.name)
        : [];
      if (!roster.length && persona.mintAddress) roster.push({ mint: persona.mintAddress, name: persona.name, kind: persona.agentType === "clipping" ? "Clipper" : "Influencer" });
      agentic.controlPanel = { recentVideos: feedVideos, stats: statsLines, schedule: scheduleLines, ...(team ? { team } : {}), roster, youtubeCandidates,
        ...(wantsYoutubeResearch && isClipperAgent ? { youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(youtubeQuery)}` } : {}) };
    }

    const systemContent = casualTurn
      ? [
          `You are ${persona.name}, a Vello ${isClipperAgent ? "Clipper" : "Influencer"}. Reply as yourself, warmly and briefly, in ${persona.language || "the operator's language"}.`,
          persona.voiceArchetype ? `Your voice: ${persona.voiceArchetype}.` : "",
          persona.niche ? `Your niche: ${persona.niche}.` : "",
          persona.backstory ? `Backstory: ${persona.backstory.slice(0, 700)}` : "",
          persona.characterBible ? `Character: ${persona.characterBible.slice(0, 700)}` : "",
          persona.traits?.length ? `Traits: ${persona.traits.slice(0, 8).join(", ")}.` : "",
          team ? `You are in ${team.name} with ${team.members.filter((m) => m.name !== persona.name).map((m) => `${m.name} (${m.kind})`).join(", ")}. Teammate messages are prefixed with their names. Speak only for yourself.` : "",
          "This is a greeting, not permission to start a task. Keep the reply to one or two sentences; do not invent work or emit action blocks.",
        ].filter(Boolean).join("\n")
      : buildPersonaSystemPrompt(persona, knowledgeSnippets, fundedCampaigns, canJoin, readyClips, generatedCount, latestTitle, agentic);

    const chatMessages = [
      { role: "system", content: systemContent },
      // Cap what rides to the model: a long-lived chat used to re-send its
      // ENTIRE history every turn — unbounded input tokens and slower
      // replies for zero quality gain. The last 16 turns (clamped per
      // message) are all the model needs for conversational continuity;
      // durable facts already arrive via the system context above.
      // The control panel is a long-running conversation — give it a wider
      // window so the agent keeps the thread across many turns.
      ...messages.slice(casualTurn ? -8 : isControlPanel ? -20 : -16).map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 2500) })),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    const tModel = Date.now();
    // 1) Gemini direct — fast path (~2s). geminiChat walks a model chain and
    //    skips any model that's out of quota / overloaded (lib/server/geminiFast).
    const creativeTurn = /\b(brainstorm|ideat(?:e|ion|ions)|ideas?|draft|script|hooks?|caption|campaign strategy|content plan)\b/i.test(operatorLatest);
    const fast = await geminiChat(chatMessages as GeminiMessage[], {
      tag: creativeTurn ? "agents/ideation" : "agents/chat",
      timeoutMs: isControlPanel ? 9_000 : 15_000,
      firstModelTimeoutMs: isControlPanel ? 9_000 : creativeTurn ? 8_000 : undefined,
      // Try every candidate model (was capped at 2 of 3) and allow one retry
      // pass (was 1 — i.e. no retry at all) before giving up. Control panel
      // chat used to hard-error the user with "Gemini is unavailable" the
      // moment the first TWO models had a transient hiccup within a tight 6s
      // window; this gives a real transient failure more real chances to
      // clear before we ever consider the direct path exhausted.
      ...(isControlPanel ? { maxModels: 3, maxPasses: 2 } : {}),
      models: creativeTurn
        ? ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"]
        : ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.6-flash"],
      reasoningEffort: creativeTurn ? "low" : "minimal",
    });
    if (fast) {
      data = { choices: [{ message: { content: fast.text } }] };
      timings.gemini = 1;
    } else if (GEMINI_KEY) {
      console.warn(isControlPanel
        ? "[agents/chat] direct Gemini unavailable for control chat — falling back to Kie's Gemini route"
        : "[agents/chat] no Gemini model available — falling back to Kie");
    }
    // Direct Gemini exhausted every model/retry — fall through to the SAME
    // Kie fallback every other chat surface uses (Kie resells Gemini too, see
    // KIE_GEMINI_CHAT_MODEL below) instead of hard-erroring the operator with
    // "Gemini is unavailable". Slower (Kie queues), but the squad chat always
    // gets a real reply instead of an error bubble.
    if (!data) {
      if (!KIE_KEY) return NextResponse.json({ error: "Chat model unavailable" }, { status: 502 });
      const res = await fetch(KIE_GEMINI, {
        method: "POST",
        headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: KIE_GEMINI_CHAT_MODEL, stream: false, include_thoughts: false, messages: chatMessages }),
        signal: AbortSignal.timeout(45_000),
      }).catch((e) => new Response(String(e instanceof Error ? e.message : e), { status: 504 }));
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: res.status === 504 ? "Your agent took too long to answer — please try again." : `Chat model ${res.status}: ${text.slice(0, 200)}` },
          { status: 500 },
        );
      }
      data = await res.json().catch(() => null);
      if (data?.error || (typeof data?.code === "number" && data.code >= 400)) {
        console.warn("[agents/chat] Kie model error", data?.code ?? data?.error?.code, data?.msg ?? data?.error?.message);
        return NextResponse.json({ error: "Chat model unavailable. Please try again." }, { status: 502 });
      }
    }

    timings.model = Date.now() - tModel;
    console.log(`[agents/chat] timing ms ${JSON.stringify(timings)}`);
    const choiceContent = data?.choices?.[0]?.message?.content;
    const fromChoices = Array.isArray(choiceContent)
      ? choiceContent.map((part: { text?: string }) => part?.text ?? "").join("")
      : choiceContent;
    const fromCandidates = Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts.map((p: { text?: string }) => p?.text ?? "").join("")
      : "";
    const fromOutput = data?.output_text ?? data?.text;

    const message: string = [fromChoices, fromCandidates, fromOutput]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .find((s) => s.length > 0) ?? "";

    if (!message) {
      return NextResponse.json(
        { error: "The chat model did not return a reply. Please try again." },
        { status: 502 },
      );
    }

    // Real campaign-join action: the model may end its reply with a
    // [JOIN_CAMPAIGN]{campaignId,topic}[/JOIN_CAMPAIGN] block. Validate the id
    // against the funded set we injected (so it can only join a REAL funded
    // campaign, never a hallucinated one), strip the block from the visible text,
    // and EXECUTE the join server-side — we already verified the owner above. We
    // pre-create the task (so it shows in the Tasks page immediately) then fire
    // run-task, which generates the clip, auto-posts, and records the submission.
    // Defense-in-depth: the model alone decides whether to emit an action block,
    // and persona/memory chat ("remember you're a fitness coach") can be
    // misread as an instruction to act. Before executing anything real (join a
    // campaign, post content), require the triggering user message to actually
    // read like an action/confirmation, not persona config. This can't be
    // fooled by the model's own text — it checks what the OPERATOR typed.
    const lastUserMessage = operatorLatest;
    const looksLikeActionIntent = (re: RegExp) => re.test(lastUserMessage);

    let visibleMessage = message;
    let join: { campaignId: string; title: string; taskId: string } | null = null;
    const joinBlock = extractActionBlock(message, "JOIN_CAMPAIGN");
    if (joinBlock) {
      visibleMessage = message.replace(joinBlock[0], "").trim();
      const joinMint = persona.mintAddress;
      const confirmedAction = looksLikeActionIntent(/\b(join|proceed|go ahead|do it|do that|sounds good|let'?s do it|start|yes|confirm|sure)\b/i);
      if (confirmedAction && canJoin && joinMint && !isControlPanel && !isClipperAgent) {
        try {
          const parsed = JSON.parse(joinBlock[1]) as { campaignId?: string; topic?: string };
          const cid = (parsed.campaignId ?? "").trim();
          const matched = fundedCampaigns.find((c) => c.id === cid);
          if (matched) {
            const secret = process.env.INTERNAL_CRON_SECRET ?? "";
            const topic = (parsed.topic ?? matched.title).slice(0, 200);
            const taskId = await convex.mutation(api.agentTasks.create, {
              mintAddress: joinMint,
              sessionId: sessionId ?? joinMint,
              type: "create_video",
              title: `Campaign: ${matched.title}`,
              input: JSON.stringify({ campaignId: cid, topic }),
              triggeredBy: "user",
              authSecret: secret,
            });
            // Fire-and-forget: run-task claims the pre-created task and runs the
            // real create_video pipeline (campaign context → render → auto-post →
            // submitForCampaign). Internal secret → server-to-server, owner already
            // verified. The stale-task reaper is the backstop if this kick drops.
            void fetchSelf(
              "/api/agents/run-task",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(secret ? { "X-Internal-Secret": secret } : {}),
                },
                body: JSON.stringify({
                  mintAddress: joinMint,
                  taskType: "create_video",
                  taskId,
                  title: `Campaign: ${matched.title}`,
                  triggeredBy: "user",
                  input: { campaignId: cid, topic },
                }),
              },
              req,
            ).catch(() => { /* reaper backstop */ });
            join = { campaignId: cid, title: matched.title, taskId };
          }
        } catch {
          /* malformed block or dispatch failure → keep the text reply, no join */
        }
      }
    }

    // Real posting action: the model may end with a
    // [POST_CONTENT]{count,platforms}[/POST_CONTENT] block. We SCHEDULE that many
    // of the agent's ready clips to its CONNECTED accounts (each clip carries its
    // own best caption from the pipeline). Owner already verified above; the
    // schedule route is called server-to-server with the internal secret.
    let posted: { count: number; platforms: string[] } | null = null;
    let postProposal: { platforms: string[]; items: Array<{ title: string; caption: string; videoUrl: string }> } | null = null;
    const postBlock = extractActionBlock(message, "POST_CONTENT");
    if (postBlock) {
      visibleMessage = visibleMessage.replace(postBlock[0], "").trim();
      const postMint = persona.mintAddress;
      const connected = (persona.connectedPlatforms ?? []).filter(Boolean);
      const confirmedAction = looksLikeActionIntent(/\b(post|publish|share|proceed|go ahead|do it|do that|yes|confirm|sure)\b/i);
      if (isControlPanel && postMint && readyClips.length) {
        // Approval-first: hand the owner review cards (caption + platforms) and
        // schedule only what they approve — never post straight from a chat line.
        try {
          const parsed = JSON.parse(postBlock[1]) as { count?: number; platforms?: string[] };
          const picked = Array.isArray(parsed.platforms) ? parsed.platforms.filter((p) => connected.includes(p)) : [];
          const n = Math.min(readyClips.length, 6, Math.max(1, Math.round(parsed.count ?? 1)));
          postProposal = {
            platforms: picked.length ? picked : connected,
            items: readyClips.slice(0, n).map((c) => ({ title: (c.title || "Clip").slice(0, 200), caption: c.caption, videoUrl: c.clipUrl })),
          };
        } catch { /* malformed block → no proposal */ }
      } else if (confirmedAction && postMint && connected.length && readyClips.length) {
        try {
          const parsed = JSON.parse(postBlock[1]) as { count?: number; platforms?: string[] };
          // Intersect the model's platform pick with the REAL connected set (it can
          // only post where an account is actually connected); default to all connected.
          const picked = Array.isArray(parsed.platforms) ? parsed.platforms.filter((p) => connected.includes(p)) : [];
          const finalPlatforms = picked.length ? picked : connected;
          const n = Math.min(readyClips.length, Math.max(1, Math.round(parsed.count ?? readyClips.length)));
          const secret = process.env.INTERNAL_CRON_SECRET ?? "";
          // Stagger by the agent's configured spacing (default 2h) so it drips, not dumps.
          const intervalMs = typeof persona.postIntervalMs === "number" && persona.postIntervalMs > 0 ? persona.postIntervalMs : 2 * 60 * 60 * 1000;
          let scheduled = 0;
          for (let i = 0; i < n; i++) {
            const c = readyClips[i];
            const scheduledFor = Date.now() + 120_000 + i * intervalMs; // first ~2 min out
            try {
              const r = await fetchSelf("/api/schedule/create", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(secret ? { "X-Internal-Secret": secret } : {}) },
                body: JSON.stringify({
                  mintAddress: postMint,
                  sessionId: sessionId ?? postMint,
                  scheduledFor,
                  topic: (c.title || "Clip").slice(0, 200),
                  caption: c.caption,
                  platforms: finalPlatforms,
                  videoUrl: c.clipUrl,
                }),
              }, req);
              if (r.ok) scheduled++;
            } catch { /* skip this clip, continue */ }
          }
          if (scheduled > 0) posted = { count: scheduled, platforms: finalPlatforms };
        } catch { /* malformed block → no post */ }
      }
    }

    // Idea pitch → contentIdeas row (source "user" auto-approves in insertBatch,
    // so the pipeline produces it next). Stripped from the visible reply.
    let savedIdea: { headline: string } | null = null;
    const savedIdeas: string[] = [];
    // One reply may draft SEVERAL ideas ("give me 3 ideas") — save each block.
    const ideaBlocks = extractAllActionBlocks(message, "SAVE_IDEA", 5);
    for (const ideaBlock of ideaBlocks) {
      visibleMessage = visibleMessage.replace(ideaBlock[0], "").trim();
    }
    if (ideaBlocks.length && persona.mintAddress) {
      const ideas: { headline: string; angle: string; source: string; format: string; score: number }[] = [];
      for (const ideaBlock of ideaBlocks) {
        try {
          const parsed = JSON.parse(ideaBlock[1]) as { headline?: string; angle?: string; format?: string };
          if (parsed.headline?.trim() && parsed.angle?.trim()) {
            ideas.push({ headline: parsed.headline.trim(), angle: parsed.angle.trim(), source: "user", format: parsed.format ?? "", score: 90 });
          }
        } catch { /* malformed block — skip it */ }
      }
      if (ideas.length) {
        try {
          await convex.mutation(api.contentIdeas.insertBatch, {
            mintAddress: persona.mintAddress, ideas, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
          });
          savedIdeas.push(...ideas.map((x) => x.headline));
          savedIdea = { headline: ideas[0].headline };
        } catch (e) { console.warn("[agents/chat] SAVE_IDEA failed:", e instanceof Error ? e.message : e); }
      }
    }

    // Owner asked for a video NOW (control panel): queue a REAL create_video task
    // and kick run-task — the same pipeline the autonomous heartbeat uses
    // (script → storyboard → render → the agent's hook/captions/music skills).
    // Owner already verified; gated on an action-intent message like the others.
    const generated: { taskId: string; topic: string } | null = null;
    let planFromGenerate: { title: string; steps: Array<Record<string, unknown>> } | null = null;
    const genBlock = extractActionBlock(message, "GENERATE_VIDEO");
    if (genBlock) {
      visibleMessage = visibleMessage.replace(genBlock[0], "").trim();
      const genMint = persona.mintAddress;
      // Approval-first: on the control panel a direct render request becomes a
      // one-step PLAN the owner approves (and the finished video is approved again
      // before posting). Execution happens client-side after approval.
      if (isControlPanel && genMint && !planFromGenerate) {
        try {
          const parsed = JSON.parse(genBlock[1]) as { topic?: string; brief?: string };
          const topic = (parsed.topic ?? "").trim().slice(0, 200);
          if (topic) planFromGenerate = { title: topic, steps: [{ agent: persona.name, kind: "create_video", topic, why: (parsed.brief ?? "").slice(0, 200) }] };
        } catch { /* malformed */ }
      }
    }

    // Standing creative direction → bible recompile (merging over the existing
    // bible). Bible-less agents keep the legacy standing-directive path (already
    // persisted at the top of this handler).
    let bibleUpdated: { version: number } | null = null;
    const bibleBlock = extractActionBlock(message, "UPDATE_BIBLE");
    if (bibleBlock) {
      visibleMessage = visibleMessage.replace(bibleBlock[0], "").trim();
      const bibleMint = persona.mintAddress;
      const existing = normalizeShowBible(chatAgentDoc?.showBible);
      if (bibleMint && existing) {
        try {
          const parsed = JSON.parse(bibleBlock[1]) as { concept?: string };
          if (parsed.concept?.trim()) {
            const bible = await compileShowBible({
              concept: parsed.concept,
              existing,
              agent: {
                name: persona.name,
                niche: persona.niche ?? chatAgentDoc?.niche ?? "lifestyle",
                archetype: chatAgentDoc?.archetype,
                description: chatAgentDoc?.description,
                language: persona.language ?? chatAgentDoc?.language,
              },
            });
            if (bible) {
              const r = await convex.mutation(api.influencers.setShowBible, {
                mintAddress: bibleMint, showBible: bible, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
              });
              bibleUpdated = { version: Number(r?.version ?? 0) };
            }
          }
        } catch (e) { console.warn("[agents/chat] UPDATE_BIBLE failed:", e instanceof Error ? e.message : e); }
      }
    }

    // Durable preference → targeted, allowlisted bible edit. Unlike
    // [UPDATE_BIBLE] (full recompile), this applies a small validated op set
    // deterministically — no LLM round-trip, no drift. ALWAYS strip the block
    // from the visible reply, even when the guard below rejects it, so raw
    // block text never reaches the UI. Ops array is capped defensively — the
    // model is instructed to keep it small, but never trust it blindly.
    let biblePatchApplied: string[] = [];
    const biblePatchBlock = extractActionBlock(message, "BIBLE_PATCH");
    if (biblePatchBlock) {
      visibleMessage = visibleMessage.replace(biblePatchBlock[0], "").trim();
      // If UPDATE_BIBLE already recompiled and wrote the bible this turn, skip
      // applying the patch: existingBible below is a turn-start snapshot, so
      // applying it now would overwrite the fresh recompile with stale data.
      // (The prompt tells the model never to emit both blocks in one reply,
      // but this guard makes the server robust if it does anyway.)
      const confirmedDurable = bibleUpdated == null && looksLikeActionIntent(
        /\b(from now on|always|never|stop|no more|more|less|change|make it|instead|prefer|going forward|switch to|shorter|longer|add|remove)\b/i,
      );
      const patchMint = persona.mintAddress;
      const existingBible = normalizeShowBible(chatAgentDoc?.showBible) ?? persona.showBible ?? null;
      if (confirmedDurable && patchMint && existingBible) {
        try {
          const parsed = JSON.parse(biblePatchBlock[1]) as { ops?: BiblePatchOp[] };
          const ops = Array.isArray(parsed.ops) ? parsed.ops.slice(0, 10) : [];
          if (ops.length > 0) {
            const { bible, applied } = applyBiblePatch(existingBible, ops);
            if (applied.length > 0) {
              await convex.mutation(api.influencers.setShowBible, {
                mintAddress: patchMint, showBible: bible, authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
              });
              biblePatchApplied = applied;
            }
          }
        } catch (e) { console.warn("[agents/chat] BIBLE_PATCH failed:", e instanceof Error ? e.message : e); }
      }
    }

    // Control-panel UI actions: render the agent's real videos as cards / hand the
    // operator to a Builder tab. Pure UI hints — nothing executes server-side —
    // so they're validated and stripped, never trusted beyond the allowlist.
    // The owner never gets a price quote on the control panel — drop any
    // [TASK_OFFER] the model still emits so it can't leak as raw text.
    if (isControlPanel) visibleMessage = visibleMessage.replace(/\[TASK_OFFER\][\s\S]*?(\[\/TASK_OFFER\]|$)/g, "").trim();
    let showVideos: { count: number; filter: "all" | "posted" | "ready"; sort?: "recent" | "views" | "viral" } | null = null;
    const showBlock = extractActionBlock(visibleMessage, "SHOW_VIDEOS");
    if (showBlock) {
      visibleMessage = visibleMessage.replace(showBlock[0], "").trim();
      try {
        const parsed = JSON.parse(showBlock[1]) as { count?: number; filter?: string; sort?: string };
        const filter = parsed.filter === "posted" || parsed.filter === "ready" ? parsed.filter : "all";
        const sort = parsed.sort === "views" || parsed.sort === "viral" ? parsed.sort : "recent";
        showVideos = { count: Math.min(6, Math.max(1, Math.round(Number(parsed.count) || 3))), filter, sort };
      } catch { showVideos = { count: 3, filter: "all" }; }
    }
    let openBuilder: { tab: string; href: string } | null = null;
    const openBlock = extractActionBlock(visibleMessage, "OPEN_BUILDER");
    if (openBlock) {
      visibleMessage = visibleMessage.replace(openBlock[0], "").trim();
      try {
        const tab = String((JSON.parse(openBlock[1]) as { tab?: string }).tab ?? "").trim();
        if ((OPENABLE_TABS as readonly string[]).includes(tab) && persona.mintAddress) {
          openBuilder = { tab, href: `/builder?mint=${encodeURIComponent(persona.mintAddress)}&tab=${tab}` };
        }
      } catch { /* malformed block — just drop it */ }
    }

    // [PLAN] — a mission the owner must approve. Validated against the roster
    // the client sent (ownership is re-checked by run-task at execution), kinds
    // enforced per agent type, sources must be campaign-provided or operator URLs.
    let plan: { title: string; steps: PlanStep[] } | null = null;
    const planBlock = isControlPanel ? extractActionBlock(visibleMessage, "PLAN") : null;
    if (planBlock) visibleMessage = visibleMessage.replace(planBlock[0], "").trim();
    const rawPlan = (() => {
      if (planBlock) { try { return JSON.parse(planBlock[1]) as { title?: string; steps?: Array<Record<string, unknown>> }; } catch { return null; } }
      return planFromGenerate;
    })();
    if (isControlPanel && rawPlan && Array.isArray(rawPlan.steps)) {
      const roster = agentic.controlPanel?.roster ?? [];
      // Everything the OPERATOR typed (a link may have come a few turns back).
      const operatorText = team ? lastUserMessage : messages.filter((m) => m.role === "user").map((m) => String(m.content ?? "")).join("\n");
      const byName = new Map(roster.map((m) => [m.name.toLowerCase(), m]));
      const steps: PlanStep[] = [];
      for (const st of rawPlan.steps.slice(0, 6)) {
        const who = byName.get(String(st.agent ?? "").trim().toLowerCase().replace(/^@/, ""));
        if (!who) continue;
        const kind = st.kind === "clip_video" ? "clip_video" : st.kind === "create_video" ? "create_video" : null;
        if (!kind) continue;
        const isClipper = who.kind.toLowerCase() === "clipper";
        if (kind === "clip_video" && !isClipper) continue;
        if (kind === "create_video" && isClipper) continue;
        const requestedCampaignId = String(st.campaignId ?? "").trim();
        const campaign = requestedCampaignId ? fundedCampaigns.find((c) => c.id === requestedCampaignId) : undefined;
        if (requestedCampaignId && (!campaign || (kind === "clip_video" ? campaign.category !== "clipping" : campaign.category !== "ugc"))) continue;
        const step: PlanStep = {
          id: `s${steps.length + 1}`,
          agentMint: who.mint,
          agentName: who.name,
          kind,
          ...(campaign ? { campaignId: campaign.id } : {}),
          ...(typeof st.why === "string" && st.why.trim() ? { why: st.why.trim().slice(0, 200) } : {}),
        };
        if (kind === "create_video") {
          const topic = String(st.topic ?? "").trim().slice(0, 300);
          if (!topic) continue;
          step.topic = topic;
        } else {
          const src = String(st.source ?? "").trim();
          if (/^https?:\/\/\S+$/i.test(src) && !/\/shorts\//i.test(src)
            && (operatorText.includes(src) || campaign?.sourceUrls.includes(src))) {
            // A verified campaign source or a URL the operator supplied this turn.
            step.sourceUrl = src.slice(0, 500);
          } else continue;
          step.topic = typeof st.topic === "string" ? st.topic.trim().slice(0, 300) : undefined;
        }
        steps.push(step);
      }
      if (steps.length) plan = { title: String(rawPlan.title ?? steps[0].topic ?? "Mission").trim().slice(0, 80) || "Mission", steps };
    }

    visibleMessage = stripActionTags(visibleMessage);

    return NextResponse.json({
      ok: true,
      message: visibleMessage,
      ...(showVideos ? { showVideos } : {}),
      ...(openBuilder ? { openBuilder } : {}),
      ...(plan ? { plan } : {}),
      ...(postProposal ? { postProposal } : {}),
      join,
      posted,
      savedIdea,
      ...(savedIdeas.length ? { savedIdeas } : {}),
      ...(generated ? { generated } : {}),
      bibleUpdated,
      ...(biblePatchApplied.length > 0 ? { biblePatches: biblePatchApplied } : {}),
      agent: {
        name: persona.name,
        handle: persona.handle,
        mintAddress: persona.mintAddress,
      },
      knowledgeReferenced: knowledgeSnippets.length,
    });
  } catch (err) {
    console.error("[agents/chat]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500 },
    );
  }
}
