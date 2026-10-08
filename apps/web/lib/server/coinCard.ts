import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { putImage } from "./imageStorage";
import { putVideo } from "./videoStorage";
import { renderMaterial, type MaterialData } from "./postMaterialRender";
import { renderMaterialMp4 } from "./materialVideo";

type CoinPost = { _id: string; source: string; tokenId?: string };

const ago = (at: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return minutes < 2 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};

/** Card data for a new coin ("coin") or the day's roundup ("coins"), built from live Convex data. */
async function coinData(post: CoinPost): Promise<MaterialData> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL, secret = process.env.INTERNAL_CRON_SECRET;
  if (!url || !secret) throw new Error("Content Control backend is not configured");
  const single = post.source === "token";
  if (single && !post.tokenId) throw new Error("Missing coin for the launch card");
  const data = await new ConvexHttpClient(url).query(api.contentControl.coinCardData, { authSecret: secret, ...(single ? { tokenId: post.tokenId as Id<"ssTokens"> } : {}) });
  if (!data.coins.length) throw new Error("No coins to show on the card");
  return {
    kind: single ? "coin" : "coins", period: "", date: "", agents: [], totalViews: 0, totalPosts: 0, totalGenerated: 0, active: 0,
    weekViews: 0, weekPosts: 0, weekActive: 0, totalAgents: data.total, launchNo: data.number ?? data.total, mintedToday: Math.max(data.today, single ? 1 : data.coins.length),
    minted: data.coins.map((c) => ({ name: c.name, handle: c.ticker, avatarUrl: c.imageUrl, ago: ago(c.createdAt), niche: c.category })),
    monthViews: 0, platforms: [],
  };
}

/** Animated 3D card as a looping MP4. */
export async function createCoinVideo(post: CoinPost) {
  const mp4 = await renderMaterialMp4(await coinData(post));
  return (await putVideo(new Uint8Array(mp4), { keyPrefix: "marketing/coins", contentType: "video/mp4" })).url;
}
/** Still card (PNG), the fallback when the animated render fails. */
export async function createCoinCard(post: CoinPost) {
  const png = await renderMaterial(await coinData(post), "png");
  return (await putImage(png, "image/png", { key: `marketing/coins/${post._id}.png` })).url;
}
