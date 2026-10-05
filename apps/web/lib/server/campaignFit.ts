/**
 * Campaign fit — how a clipping agent DECIDES whether a Stage campaign is worth
 * joining. Pure, deterministic, explainable: every verdict carries the reasons
 * the Work tab shows the operator, and the same function runs in the scout
 * (autonomous join) and in the Work tab's "Evaluate now".
 *
 * Money model: a clip earns views/1000 × rate (capped per clip and by what is
 * left in the treasury) and costs the agent its clip run (scout fee + wired
 * skills). The agent joins when the EXPECTED net per clip clears a floor, where
 * expected views = the agent's own median views on past posts (falls back to a
 * niche default until it has a track record).
 */

export type FitAgent = {
  niche: string;
  /** Languages the agent posts in (bible/persona); empty = unknown. */
  languages?: string[];
  /** Platforms with a live social connection; empty = unknown (no penalty). */
  connectedPlatforms?: string[];
  /** Median views per post from this agent's own posted submissions. */
  medianViews?: number;
  /** How many posts that median is based on (confidence). */
  sampleCount?: number;
  /** Estimated cost of ONE clip run (scout fee + skills), USDC. */
  estCostUsdc: number;
};

export type FitCampaign = {
  id: string;
  rail: "onchain" | "content_reward";
  title: string;
  /** USDC per 1000 views. */
  ratePerThousandViews: number;
  /** Per-clip payout cap, if any. */
  maxPayoutUsdc?: number;
  /** Treasury left to pay out (budget − spent). */
  budgetRemainingUsdc: number;
  budgetUsdc: number;
  targetNiche: string[];
  targetLanguage?: string[];
  platforms?: string[];
  /** ms epoch; undefined = no deadline. */
  deadlineAt?: number;
  /** Already known unusable (closed, unfunded, restricted). */
  blocked?: string;
  /** Source videos the agent could clip from. */
  sourceCount: number;
  requiresProfileCta?: boolean;
  /** Clippers need supplied footage; influencers create an original UGC deliverable. */
  workKind?: "clipping" | "ugc";
};

export type FitVerdict = {
  campaignId: string;
  verdict: "join" | "skip";
  score: number;
  reasons: string[];
  expectedViews: number;
  expectedPayoutUsdc: number;
  estCostUsdc: number;
  netUsdc: number;
};

export const DEFAULT_EXPECTED_VIEWS = 800;   // a new agent's prior until it has posts
export const MIN_SAMPLES_FOR_OWN_VIEWS = 3;
export const MIN_NET_USDC = 0.05;           // join floor per clip
export const MIN_HOURS_TO_DEADLINE = 12;

const norm = (s: string) => s.trim().toLowerCase();
const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** 1 = exact niche, 0.85 = word overlap, 0.7 = campaign open to all, 0 = no fit. */
export function nicheFit(agentNiche: string, targets: string[]): number {
  const a = norm(agentNiche);
  const t = targets.map(norm);
  if (!a) return t.includes("all") ? 0.7 : 0;
  if (t.includes(a)) return 1;
  const aw = words(a);
  for (const x of t) { for (const w of words(x)) if (aw.has(w)) return 0.85; }
  return t.includes("all") || t.length === 0 ? 0.7 : 0;
}

export function expectedViewsFor(agent: FitAgent): { views: number; basis: string } {
  if ((agent.sampleCount ?? 0) >= MIN_SAMPLES_FOR_OWN_VIEWS && (agent.medianViews ?? 0) > 0) {
    return { views: Math.round(agent.medianViews!), basis: `your median ${Math.round(agent.medianViews!)} views over ${agent.sampleCount} posts` };
  }
  return { views: DEFAULT_EXPECTED_VIEWS, basis: `no track record yet, assuming ${DEFAULT_EXPECTED_VIEWS} views` };
}

export function scoreCampaignFit(agent: FitAgent, c: FitCampaign, now = Date.now()): FitVerdict {
  const reasons: string[] = [];
  const skip = (why: string, extra: Partial<FitVerdict> = {}): FitVerdict => ({
    campaignId: c.id, verdict: "skip", score: 0, reasons: [...reasons, why],
    expectedViews: 0, expectedPayoutUsdc: 0, estCostUsdc: agent.estCostUsdc, netUsdc: -agent.estCostUsdc, ...extra,
  });
  if (c.blocked) return skip(c.blocked);
  if (c.workKind !== "ugc" && c.sourceCount <= 0) return skip("no source videos to clip");
  if (c.deadlineAt !== undefined) {
    const hours = (c.deadlineAt - now) / 3_600_000;
    if (hours <= 0) return skip("deadline passed");
    if (hours < MIN_HOURS_TO_DEADLINE) return skip(`deadline in ${Math.max(1, Math.round(hours))}h, too close to post and get measured`);
  }
  const fit = nicheFit(agent.niche, c.targetNiche);
  if (fit === 0) return skip(`niche mismatch (you: ${agent.niche || "unset"}, campaign: ${c.targetNiche.join(", ") || "unspecified"})`);
  reasons.push(fit === 1 ? "niche matches exactly" : fit === 0.85 ? "niche overlaps" : "campaign open to all niches");

  if (agent.connectedPlatforms?.length && c.platforms?.length) {
    const mine = new Set(agent.connectedPlatforms.map(norm));
    const ok = c.platforms.some((p) => mine.has(norm(p)));
    if (!ok) return skip(`needs ${c.platforms.join("/")}, none connected`);
    reasons.push(`can post on ${c.platforms.filter((p) => mine.has(norm(p))).join("/")}`);
  }
  let langMul = 1;
  if (agent.languages?.length && c.targetLanguage?.length) {
    const mine = new Set(agent.languages.map(norm));
    const match = c.targetLanguage.some((l) => mine.has(norm(l)) || norm(l) === "any" || norm(l) === "all");
    if (!match) return skip(`language mismatch (${c.targetLanguage.join("/")})`);
    langMul = 1.05;
  }

  const { views, basis } = expectedViewsFor(agent);
  let payout = (views / 1000) * c.ratePerThousandViews;
  if (c.maxPayoutUsdc && c.maxPayoutUsdc > 0) payout = Math.min(payout, c.maxPayoutUsdc);
  payout = Math.min(payout, Math.max(0, c.budgetRemainingUsdc));
  payout = +payout.toFixed(4);
  const net = +(payout - agent.estCostUsdc).toFixed(4);
  reasons.push(`$${c.ratePerThousandViews}/1k views × ${basis} ≈ $${payout.toFixed(2)} per ${c.workKind === "ugc" ? "video" : "clip"}, run costs $${agent.estCostUsdc.toFixed(2)}`);

  if (c.budgetRemainingUsdc < Math.max(payout, 1)) return skip(`treasury nearly empty ($${c.budgetRemainingUsdc.toFixed(2)} left)`, { expectedViews: views, expectedPayoutUsdc: payout, netUsdc: net });
  if (net < MIN_NET_USDC) return skip(`expected net $${net.toFixed(2)} per clip is below the $${MIN_NET_USDC.toFixed(2)} floor`, { expectedViews: views, expectedPayoutUsdc: payout, netUsdc: net });

  // Score = expected net, shaped by fit, language, urgency and treasury health.
  const health = c.budgetUsdc > 0 ? Math.min(1, c.budgetRemainingUsdc / c.budgetUsdc) : 1;
  const urgency = c.deadlineAt !== undefined && (c.deadlineAt - now) < 3 * 86_400_000 ? 1.15 : 1;
  const score = +(net * fit * langMul * (0.6 + 0.4 * health) * urgency).toFixed(4);
  if (health < 0.25) reasons.push(`treasury ${Math.round(health * 100)}% left, lower priority`);
  if (urgency > 1) reasons.push("deadline within 3 days, prioritised");
  reasons.push(`expected net $${net.toFixed(2)} per ${c.workKind === "ugc" ? "video" : "clip"}`);
  return { campaignId: c.id, verdict: "join", score, reasons, expectedViews: views, expectedPayoutUsdc: payout, estCostUsdc: agent.estCostUsdc, netUsdc: net };
}

/** Rank every campaign; "join" verdicts first by score, then skips. */
export function rankCampaigns(agent: FitAgent, campaigns: FitCampaign[], now = Date.now()): FitVerdict[] {
  return campaigns.map((c) => scoreCampaignFit(agent, c, now)).sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === "join" ? -1 : 1;
    return b.score - a.score;
  });
}

/** Median of a numeric list (0 for empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = xs.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
