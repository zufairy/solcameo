"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type LiveVideo = { id: string; url: string; poster?: string; name: string; ticker: string; characterId: string; title?: string; at: number };

/** Live published chapters and live devnet characters, shared by every section. */
export function useLiveData() {
  const episodes = useQuery(api.solstarDiscovery.latestVideos, {});
  const market = useQuery(api.solstarMarket.listMarket, { sort: "new", network: "devnet", liveOnly: true });
  const seen = new Set<string>();
  const real = (episodes ?? []).filter(e => !e.sample && e.videoUrl);
  const pool = real.length ? real : (episodes ?? []).filter(e => e.videoUrl);
  const videos: LiveVideo[] = pool
    .filter(e => !seen.has(e.videoUrl!) && !!seen.add(e.videoUrl!))
    .map(e => ({ id: String(e.id), url: e.videoUrl!, poster: e.posterUrl ?? undefined, name: e.name, ticker: e.ticker, characterId: String(e.characterId), title: e.title ?? undefined, at: e.createdAt }));
  return { videos, characters: market ?? [], loading: episodes === undefined || market === undefined };
}
