/** X captions stay link-free, including old queued copy and bare domains. */
export function withoutPostLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<>]*)?/gi, "")
    .split("\n").map(line => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const ALERT_CAPTION_INSTRUCTION = "Write an alert-style caption: lead with a brief VIDEO ALERT or a specific attention-grabbing hook, give one concrete detail explaining what the video is about, then use light reverse psychology or an open question that invites watching the whole video before judging. Keep the payoff for the video. No URLs, bare domains, link-in-bio, invented scarcity, fabricated facts, profit promises or price predictions. Keep the coin ticker if provided. Rotate hooks; do not repeat a stock phrase on every post.";

/** Public persona only. Keep launch copy human, concise and free of em dashes. */
export function cleanMarketingText(value: string): string {
  return value.replace(/\s*[—–]\s*/g, ", ").replace(/<[^>]*>/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
}
export function agentLaunchCaption(agent: { name: string; description: string; niche: string; agentType?: string; handle: string }): string {
  const name = cleanMarketingText(agent.name).slice(0, 60) || "a new agent";
  const purpose = cleanMarketingText(agent.description || agent.niche).slice(0, 145);
  const intro = `meet ${name}. just launched on solcameo.`;
  const role = purpose || (agent.agentType === "trader" ? "an ai agent built to research markets and trading strategies." : agent.agentType === "worker" ? "an ai agent built to help get work done." : "an ai creator built to turn ideas into content.");
  const text = `${intro}\n\n${role}\n\nfind ${cleanMarketingText(agent.handle).slice(0, 35) || name} on solcameo.`;
  if (text.length <= 275) return text;
  return `${text.slice(0, 271).replace(/\s+\S*$/, "")}...`;
}

export function videoMilestoneCaption(name: string, views: number): string {
  const agent = cleanMarketingText(name).slice(0, 60) || "this agent";
  return `${agent} just passed 100k views on a video.\n\n${Math.floor(views).toLocaleString("en-US")} views and counting. built on solcameo, out in the world.\n\nthis is what putting your agent to work looks like.`;
}

const hash = (value: string) => [...value].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** First sentence of an agent bio as a short, lowercase-leaning hook (no links, no hashtags). */
function bioHook(bio: string, max = 120): string {
  const text = cleanMarketingText(bio).replace(/https?:\/\/\S+/g, "").trim();
  const first = text.split(/(?<=[.!?])\s/)[0] ?? "";
  const hook = first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}...` : first;
  return hook.replace(/[.!]+$/, "");
}
const fit = (text: string) => { const clean = withoutPostLinks(text); return clean.length <= 275 ? clean : `${clean.slice(0, 271).replace(/\s+\S*$/, "")}...`; };
/** One caption per new coin. Always names the $TICKER and ties it to what the agent does; the opener rotates by ticker so the feed never repeats. */
export function tokenLaunchCaption(coin: { name: string; ticker: string; bio?: string; category?: string; url: string }): string {
  const ticker = cleanMarketingText(coin.ticker).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  const name = cleanMarketingText(coin.name).slice(0, 50) || `$${ticker}`;
  const hook = bioHook(coin.bio ?? "");
  const lane = cleanMarketingText(coin.category ?? "").toLowerCase().slice(0, 30);
  const what = hook || (lane ? `an ai influencer in ${lane}` : "an ai influencer that makes content on its own");
  const openers = [`COIN ALERT: $${ticker}`, `NEW LAUNCH: $${ticker}`, `$${ticker} just launched on Solcameo.`];
  const closers = ["Don't pick a side from the ticker alone. Meet the creator first.", "Another AI coin? Watch what its creator actually makes before deciding.", "Skip the hype. See the creator behind the ticker."];
  const seed = hash(ticker + name);
  const lines = [openers[seed % openers.length], `${name}: ${what}.`, closers[(seed >>> 3) % closers.length]];
  return fit(lines.join("\n\n"));
}
/** Digest of the day's new coins: count, the tickers, and the live total. */
export function coinsDigestCaption(digest: { count: number; tickers: string[]; total: number; url: string }): string {
  const shown = digest.tickers.slice(0, 4).map((t) => `$${cleanMarketingText(t).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`).filter((t) => t.length > 1);
  const more = digest.count > shown.length ? ` and ${digest.count - shown.length} more` : "";
  const head = `${digest.count} new ${digest.count === 1 ? "coin" : "coins"} minted on solcameo in the last 24 hours.`;
  const body = shown.length ? `${shown.join(", ")}${more}. each one is an ai influencer with its own coin.` : "each one is an ai influencer with its own coin.";
  return fit(`${head}\n\n${body}\n\n${digest.total} live now. Which creator deserves your attention?`);
}

/** One caption per new video of a coin: names the $TICKER and the influencer, hooks on what the video is about, rotates by ticker. */
export function videoLaunchCaption(video: { name: string; ticker: string; bio?: string; topic?: string; url: string }): string {
  const ticker = cleanMarketingText(video.ticker).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  const name = cleanMarketingText(video.name).slice(0, 50) || `$${ticker}`;
  const about = bioHook(video.topic ?? "", 110) || bioHook(video.bio ?? "", 110);
  const openers = [`VIDEO ALERT: $${ticker}`, `$${ticker} DROP: ${name}`, `Before you scroll past $${ticker}...`];
  const closers = ["Already made up your mind? Skip it. Otherwise watch the whole video first.", "Don't judge it from the first frame. Watch it through, then tell us your take.", "Another AI video? Watch this one before making that call."];
  const seed = hash(ticker + (video.topic ?? "") + name);
  const lines = [openers[seed % openers.length], ...(about ? [`${about}.`] : []), closers[(seed >>> 3) % closers.length]];
  return fit(lines.join("\n\n"));
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n)));
const pick = <T,>(items: T[], seed: string): T => items[hash(seed) % items.length];
export type StatCaptionData = {
  weekViews: number; weekPosts: number; weekActive: number; monthViews: number; totalAgents: number; mintedToday: number;
  totalPosts: number; totalGenerated: number;
  agents: { name: string; views: number }[]; platforms: { id: string; views: number }[]; minted: { name: string; handle: string }[];
};
/**
 * A caption for a network statistics card. Leads with the number (the thing people stop for), says what it means in one plain
 * line, and ends on a question or a dare, which is what earns replies. Always real numbers from the same data as the card,
 * no hashtags, no em dashes, under X's limit. The wording rotates by day so the feed never repeats itself.
 */
export function statCaption(kind: string, d: StatCaptionData, seed: string): string {
  const name = (n: string) => cleanMarketingText(n).slice(0, 30);
  const top = d.agents.slice(0, 3);
  const platforms = [...d.platforms].filter((p) => p.views > 0).sort((a, b) => b.views - a.views);
  const label: Record<string, string> = { youtube: "youtube", instagram: "instagram", tiktok: "tiktok", facebook: "facebook", x: "x" };
  let lines: string[];
  if (kind === "leaderboard" && top.length >= 2) {
    lines = [
      pick([`this week's top ai influencers on solcameo, by views:`, `the ai influencer leaderboard right now:`, `who is winning the feed this week?`], seed + "a"),
      top.map((a, i) => `${i + 1}. ${name(a.name)}  ${compact(a.views)} views`).join("\n"),
      pick([`think your influencer can beat that?`, `every one of them posts without being asked. who takes first place next?`, `make yours. climb the board.`], seed + "b"),
    ];
  } else if (kind === "social" && platforms.length) {
    const lead = platforms[0];
    lines = [
      pick([`${compact(d.monthViews)} views in 30 days, all from ai influencers.`, `ai influencers pulled ${compact(d.monthViews)} views this month.`], seed + "a"),
      `${label[lead.id] ?? lead.id} leads with ${compact(lead.views)}${platforms[1] ? `, then ${label[platforms[1].id] ?? platforms[1].id} at ${compact(platforms[1].views)}` : ""}.`,
      pick([`where is your audience?`, `which platform should your ai post to next?`], seed + "b"),
    ];
  } else if (kind === "engine" && d.totalGenerated > 0) {
    lines = [
      pick([`${compact(d.totalGenerated)} videos made, ${compact(d.totalPosts)} published.`, `${compact(d.totalGenerated)} clips created by ai influencers. ${compact(d.totalPosts)} are live.`], seed + "a"),
      `no editors. no schedule. the agents just keep going.`,
      pick([`what would you do with a creator that never sleeps?`, `how many would yours make this week?`], seed + "b"),
    ];
  } else if (kind === "minted") {
    const names = d.minted.slice(0, 3).map((m) => `$${cleanMarketingText(m.handle).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10)}`).filter((t) => t.length > 1);
    lines = [
      d.mintedToday > 0 ? pick([`${d.mintedToday} new ai influencer${d.mintedToday === 1 ? "" : "s"} joined in the last 24 hours.`, `${d.mintedToday} fresh mint${d.mintedToday === 1 ? "" : "s"} today. ${compact(d.totalAgents)} on the network.`], seed + "a") : `${compact(d.totalAgents)} ai influencers on the network and counting.`,
      names.length ? `newest: ${names.join(", ")}.` : `every one comes with its own coin.`,
      pick([`early is everything. who are you backing?`, `which one are you watching?`], seed + "b"),
    ];
  } else {
    lines = [
      pick([`${compact(d.weekViews)} views generated by ai influencers this week.`, `${compact(d.weekViews)} views in 7 days. all of it made by ai.`], seed + "a"),
      `${compact(d.weekPosts)} videos posted by ${compact(d.weekActive)} active creators on solcameo.`,
      pick([`the feed never sleeps. are you in it yet?`, `what would your numbers look like?`], seed + "b"),
    ];
  }
  return fit(`NETWORK ALERT\n\n${lines.join("\n\n")}`);
}

/** Makes sure a post names the coin: if the caption has no $TICKER yet, it is added without a link, trimming the caption to fit one post. */
export function withTicker(caption: string, coin: { ticker: string; url: string } | null | undefined): string {
  caption = withoutPostLinks(caption);
  if (!coin) return caption;
  const ticker = cleanMarketingText(coin.ticker).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  if (!ticker || new RegExp(`\\$${ticker}(?![A-Za-z0-9])`, "i").test(caption)) return caption;
  const tail = `\n\n$${ticker}`;
  const room = 275 - tail.length;
  const body = caption.trim();
  return `${body.length <= room ? body : `${body.slice(0, Math.max(0, room - 3)).replace(/\s+\S*$/, "")}...`}${tail}`;
}
