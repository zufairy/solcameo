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
