/** Public persona only. Keep launch copy human, concise and free of em dashes. */
export function cleanMarketingText(value: string): string {
  return value.replace(/\s*[—–]\s*/g, ", ").replace(/<[^>]*>/g, "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
}
export function agentLaunchCaption(agent: { name: string; description: string; niche: string; agentType?: string; handle: string }): string {
  const name = cleanMarketingText(agent.name).slice(0, 60) || "a new agent";
  const purpose = cleanMarketingText(agent.description || agent.niche).slice(0, 145);
  const intro = `meet ${name}. just launched on vello.`;
  const role = purpose || (agent.agentType === "trader" ? "an ai agent built to research markets and trading strategies." : agent.agentType === "worker" ? "an ai agent built to help get work done." : "an ai creator built to turn ideas into content.");
  const text = `${intro}\n\n${role}\n\nfind ${cleanMarketingText(agent.handle).slice(0, 35) || name} on vello.`;
  if (text.length <= 275) return text;
  return `${text.slice(0, 271).replace(/\s+\S*$/, "")}...`;
}

export function videoMilestoneCaption(name: string, views: number): string {
  const agent = cleanMarketingText(name).slice(0, 60) || "this agent";
  return `${agent} just passed ${views > 100_000 ? "100k" : "10k"} views on a video.\n\n${Math.floor(views).toLocaleString("en-US")} views and counting. built on vello, out in the world.\n\nthis is what putting your agent to work looks like.`;
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
