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
const fit = (text: string) => (text.length <= 275 ? text : `${text.slice(0, 271).replace(/\s+\S*$/, "")}...`);
/** One caption per new coin. Always names the $TICKER and ties it to what the agent does; the opener rotates by ticker so the feed never repeats. */
export function tokenLaunchCaption(coin: { name: string; ticker: string; bio?: string; category?: string; url: string }): string {
  const ticker = cleanMarketingText(coin.ticker).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  const name = cleanMarketingText(coin.name).slice(0, 50) || `$${ticker}`;
  const hook = bioHook(coin.bio ?? "");
  const lane = cleanMarketingText(coin.category ?? "").toLowerCase().slice(0, 30);
  const what = hook || (lane ? `an ai influencer in ${lane}` : "an ai influencer that makes content on its own");
  const openers = [
    `$${ticker} just went live on solana.`,
    `new coin alert: $${ticker}.`,
    `$${ticker} is now tradable.`,
    `fresh mint: $${ticker}.`,
    `say hi to $${ticker}.`,
  ];
  const closers = [
    "the agent posts, the coin moves. get in early.",
    "it creates content every day. the coin trades from block one.",
    "an ai influencer with its own coin. watch what it does next.",
    "first holders see every video first.",
    "ai creator, onchain coin. early is everything.",
  ];
  const seed = hash(ticker + name);
  const lines = [openers[seed % openers.length], `${name}: ${what}.`, closers[(seed >> 3) % closers.length], coin.url];
  return fit(lines.join("\n\n"));
}
/** Digest of the day's new coins: count, the tickers, and the live total. */
export function coinsDigestCaption(digest: { count: number; tickers: string[]; total: number; url: string }): string {
  const shown = digest.tickers.slice(0, 4).map((t) => `$${cleanMarketingText(t).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`).filter((t) => t.length > 1);
  const more = digest.count > shown.length ? ` and ${digest.count - shown.length} more` : "";
  const head = `${digest.count} new ${digest.count === 1 ? "coin" : "coins"} minted on solcameo in the last 24 hours.`;
  const body = shown.length ? `${shown.join(", ")}${more}. each one is an ai influencer with its own coin.` : "each one is an ai influencer with its own coin.";
  return fit(`${head}\n\n${body}\n\n${digest.total} live now. ${digest.url}`);
}

/** One caption per new video of a coin: names the $TICKER and the influencer, hooks on what the video is about, rotates by ticker. */
export function videoLaunchCaption(video: { name: string; ticker: string; bio?: string; topic?: string; url: string }): string {
  const ticker = cleanMarketingText(video.ticker).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10);
  const name = cleanMarketingText(video.name).slice(0, 50) || `$${ticker}`;
  const about = bioHook(video.topic ?? "", 110) || bioHook(video.bio ?? "", 110);
  const openers = [
    `new video from ${name}. $${ticker}`,
    `${name} just posted. $${ticker}`,
    `fresh drop from $${ticker}: ${name} is back on camera.`,
    `$${ticker} content is live. ${name} made this one.`,
    `watch what ${name} just made. $${ticker}`,
  ];
  const closers = [
    "an ai influencer that posts on its own. the coin trades live.",
    "the agent keeps creating, the coin keeps moving.",
    "every video is made by the agent. trade it on solana.",
    "ai creator, onchain coin. catch the next drop early.",
    "made by an ai influencer with its own coin.",
  ];
  const seed = hash(ticker + (video.topic ?? "") + name);
  const lines = [openers[seed % openers.length], ...(about ? [`${about}.`] : []), closers[(seed >> 3) % closers.length], video.url];
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
  return fit(`${lines.join("\n\n")}\n\nsolcameo.com`);
}
