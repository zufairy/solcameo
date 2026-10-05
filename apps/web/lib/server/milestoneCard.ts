import { loadShareAgent, renderShareCard, type ShareClip } from "./xShareCardRender";
import { videoFrames } from "./videoThumbnails";
import { putImage } from "./imageStorage";
import { assertPublicHttpUrl } from "./downloader";

type MilestonePost = { _id: string; agentMint?: string; milestoneViews?: number; videoUrl?: string; platform?: string };

/** The share-card data for one qualifying video (agent identity plus THAT video's stats only). */
export async function milestoneShareData(post: MilestonePost) {
  if (!post.agentMint || !post.milestoneViews || post.milestoneViews <= 10_000) throw new Error("Invalid video milestone");
  // Media on: the card shows the agent's OTHER recent videos beside the milestone video, so left and right are different clips.
  const data = await loadShareAgent(post.agentMint, { media: true });
  if (!data) throw new Error("The milestone agent no longer exists");
  // The qualifying video plays in the centre; the agent's other clips (never the same one again) surround it.
  const others = (data.clips ?? []).filter((c) => !c.url || c.url !== post.videoUrl);
  let clips: ShareClip[] = [];
  if (post.videoUrl) {
    await assertPublicHttpUrl(post.videoUrl);
    const frames = await videoFrames(post.videoUrl, 5);
    if (frames) clips = [{ frames, views: post.milestoneViews }];
  }
  clips = [...clips, ...(clips.length ? others : others.slice(1))].slice(0, 5);
  // These stats describe ONE video, never inflate agent totals or combine views.
  return { ...data, clips, look: "silver" as const, headline: `Video milestone · ${post.milestoneViews > 100_000 ? "100,000" : "10,000"}+ views`, eyebrow: "VIDEO MILESTONE", stats: { ...data.stats,
    views: post.milestoneViews, bestViews: post.milestoneViews, videos: 1, posted: 1,
    platforms: post.platform ? [post.platform] : [],
  } };
}

/** Same 1200x675 design as /dev/x-cards, scoped to the qualifying video. */
export async function createMilestoneCard(post: MilestonePost) {
  const card = await renderShareCard(await milestoneShareData(post), post._id);
  const bytes = Buffer.from(await card.arrayBuffer());
  return (await putImage(bytes, "image/png", { key: `marketing/milestones/${post._id}.png` })).url;
}
