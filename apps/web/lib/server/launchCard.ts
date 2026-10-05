import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { putImage } from "./imageStorage";
import { putVideo } from "./videoStorage";
import { renderMaterial, type MaterialData } from "./postMaterialRender";
import { renderMaterialMp4 } from "./materialVideo";
import { countryFromLanguage } from "../countries";

type LaunchPost = { _id: string; agentMint?: string; agentName?: string };

/** Card data for a "NEW OPERATOR" launch: close-up pixel avatar, number, niche, country flag and network stats. */
async function launchData(post: LaunchPost): Promise<MaterialData> {
  if (!post.agentMint) throw new Error("Missing agent for the launch card");
  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret) throw new Error("Content Control backend is not configured");
  const convex = new ConvexHttpClient(url);
  const [agent, roster] = await Promise.all([
    convex.query(api.influencers.getByMintServer, { authSecret: secret, mintAddress: post.agentMint }),
    convex.query(api.tournament.roster, {}),
  ]);
  if (!agent) throw new Error("The launch agent no longer exists");
  const now = Date.now(), byAge = [...roster].sort((a, b) => a.createdAt - b.createdAt);
  const at = byAge.findIndex((r) => r.mintAddress === post.agentMint);
  const total = Math.max(roster.length, at + 1, 1);
  return {
    kind: "launch", period: "", date: "", agents: [], totalViews: 0, totalPosts: 0, totalGenerated: 0, active: 0,
    weekViews: 0, weekPosts: 0, weekActive: 0, totalAgents: total, launchNo: at >= 0 ? at + 1 : total,
    mintedToday: Math.max(1, roster.filter((r) => r.createdAt >= now - 24 * 3_600_000).length),
    minted: [{ name: agent.name, handle: agent.handle, avatarUrl: agent.avatarUrl, ago: "just now", niche: agent.niche, country: countryFromLanguage(agent.language) || undefined }],
    monthViews: 0, platforms: [],
  };
}

/** Still launch card (PNG) — the fallback when the animated render fails. */
export async function createLaunchCard(post: LaunchPost) {
  const png = await renderMaterial(await launchData(post), "png");
  return (await putImage(png, "image/png", { key: `marketing/launch/${post._id}.png` })).url;
}

/** Animated launch card as a looping MP4. */
export async function createLaunchVideo(post: LaunchPost) {
  const mp4 = await renderMaterialMp4(await launchData(post));
  return (await putVideo(new Uint8Array(mp4), { keyPrefix: "marketing/launch", contentType: "video/mp4" })).url;
}
