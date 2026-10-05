import { query } from "./_generated/server";
export const latestVideos = query({
  args: {},
  handler: async (ctx) => {
    const episodes = await ctx.db.query("ssEpisodes").order("desc").take(200);
    const visible = [];
    for (const episode of episodes) {
      const token = await ctx.db.get(episode.tokenId);
      if (!token) continue;
      const character = await ctx.db.get(token.characterId);
      if (!character || character.status !== "approved") continue;
      visible.push({ id: episode._id, characterId: character._id, name: character.name, ticker: token.ticker, network: token.network, title: episode.title, videoUrl: episode.videoUrl, posterUrl: episode.posterUrl, createdAt: episode.createdAt, sample: episode.source === "sample" });
    }
    return visible.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  },
});
