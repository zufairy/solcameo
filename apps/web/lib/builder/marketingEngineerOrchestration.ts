/**
 * Lightweight orchestration signals for the builder copilot (Marketing Engineer).
 * Encodes platform rules deterministically before the LLM runs.
 * Swap or extend this module with LangGraph / LangChain later without changing the API contract.
 */

export type BuilderChatMessage = { role: string; content: string };

const LONG_FORM_SIGNALS =
  /\b(podcast|vodcast|long[\s-]?form|youtube|webinar|twitch vod|vod|livestream|replay|episode|interview\s+series|course\s+videos|recorded\s+lectures?|hours?\s+of\s+footage)\b/i;

const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|correct|we do|we have|i have|they have|i do|already|confirmed)\b/i;

const CREATOR_SIGNALS =
  /\b(i'?m\s+a\s+creator|i\s+create|content creator|tiktok(er)?|youtube(r)?|instagram|ugc\s+creator|influencer|clipper|how do i clip|how to clip|get approved|submit content)\b/i;

const BRAND_SIGNALS =
  /\b(brand|company|startup|agency|we('?re|'re)\s+(launching|running)|marketing team|growth team|ceo|founder\s+of|promote\s+our|our\s+product|community|protocol|dao|token|nft|web3|crypto|defi|blockchain|campaign|bounty|build|create|launch|workspace|agentic|fund|reward|hire|operator)\b/i;

/** User clearly claims they have episodic / long archival media suitable for clipping. */
function userClaimsLongFormSource(messages: BuilderChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content !== "string") continue;
    if (LONG_FORM_SIGNALS.test(m.content)) return true;
  }
  return false;
}

function lastUserTurn(messages: BuilderChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      return m.content.trim();
    }
  }
  return "";
}

function inferRole(messages: BuilderChatMessage[]): "creator" | "brand" | "unknown" {
  const blob = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  if (CREATOR_SIGNALS.test(blob) && !BRAND_SIGNALS.test(blob)) return "creator";
  if (BRAND_SIGNALS.test(blob) && !CREATOR_SIGNALS.test(blob)) return "brand";
  if (CREATOR_SIGNALS.test(blob) && BRAND_SIGNALS.test(blob)) return "brand";
  return "unknown";
}

/**
 * clippingOfferAllowed === true only when we have evidence the user has (or will supply) clip-worthy archives.
 */
export function clippingOfferAllowed(messages: BuilderChatMessage[]): boolean {
  if (userClaimsLongFormSource(messages)) return true;
  const tail = lastUserTurn(messages);
  if (tail.length > 140) return false;
  if (!AFFIRMATIVE.test(tail)) return false;
  /** Look at the most recent assistant turn before that "yes". */
  let seenUser = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && seenUser) break;
    if (m.role === "user") {
      seenUser = true;
      continue;
    }
    if (m.role === "assistant" && typeof m.content === "string") {
      const a = m.content.toLowerCase();
      if (
        /\b(podcast|long[\s-]?form|youtube|webinar|footage|episodes?|replay|recording)\b/i.test(a) &&
        /\b(do you have|have any|already have)\b/i.test(a)
      ) {
        return true;
      }
      break;
    }
  }
  return false;
}

export function ugcOfferAllowed(): boolean {
  return true;
}

export function buildOrchestrationBlock(
  messages: BuilderChatMessage[],
  communityId: string | null,
): string {
  const role = inferRole(messages);
  const clipping = clippingOfferAllowed(messages);
  const longFormMentioned = userClaimsLongFormSource(messages);
  const transcript = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  const isWeb3Native =
    /\b(web3|crypto|token|solana|dao|nft|defi|on-chain|onchain|phantom|wallet|treasury)\b/i.test(
      transcript,
    );
  const interactionMode =
    role === "creator"
      ? "creator_answering"
      : role === "brand" || Boolean(communityId)
        ? "agency_agentic"
        : "role_detection";

  const payload = {
    agentLanes: ["brand_campaign_mapper", "creator_guide"] as const,
    inferredAudience: role,
    interactionMode,
    isWeb3Native,
    platformCaps: {
      ugc_campaign: ugcOfferAllowed(),
      clipping_campaign: clipping,
    },
    rules: [
      interactionMode === "role_detection"
        ? "First ask one decisive routing question before building: is this a creator asking for guidance, or a brand/community operator asking for a done-for-you build?"
        : interactionMode === "creator_answering"
          ? "Creator answering mode: answer directly with clipping / UGC / approval guidance first; avoid heavy build actions unless the user explicitly asks for done-for-you setup."
          : "Agency agentic mode: build toward a concrete community, virality plan, first campaign, and launch/funding path.",
      longFormMentioned
        ? "User mentioned long-form or episodic sources — clipping may appear on canvas."
        : clipping
          ? "User affirmed they have long-form / clip-worthy content — clipping allowed on canvas."
          : "Do NOT add clipping/repurposing campaign nodes until the user confirms podcast, long-form video, webinars, course library, or similar sources.",
      "Every brand-focused flow should end with a milestone: Create campaign on Vello with concrete checklist.",
    ],
    communityId: communityId || null,
  };

  return `ORCHESTRATION_JSON:\n${JSON.stringify(payload)}\n`;
}
