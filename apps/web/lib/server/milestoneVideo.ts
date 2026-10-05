import { renderShareGif } from "./xShareCardRender";
import { milestoneShareData } from "./milestoneCard";
import { gifToMp4 } from "./gifToMp4";
import { putVideo } from "./videoStorage";

/** The animated milestone card (the real X share GIF) as a looping MP4,. */
export async function createMilestoneVideo(post: { _id: string; agentMint?: string; milestoneViews?: number; videoUrl?: string; platform?: string }) {
  const data = await milestoneShareData(post);
  const gif = await renderShareGif(data, post._id);
  const mp4 = await gifToMp4(gif);
  return (await putVideo(new Uint8Array(mp4), { keyPrefix: "marketing/milestones", contentType: "video/mp4" })).url;
}
