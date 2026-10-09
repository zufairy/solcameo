"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PlatformBadge } from "./platform-icons";
import { RepostVideoButton } from "./repost-video-button";

export type GenerationPost = { status?: string; url?: string; postUrl?: string; postPlatform?: string; platforms?: string[]; error?: string; note?: string };

export function GenerationPostActions({ mintAddress, videoUrl, title, post }: {
  mintAddress: string; videoUrl: string; title: string; post?: GenerationPost;
}) {
  const rows = useQuery(api.scheduledContent.listByMint, { mintAddress });
  const matches = (rows ?? []).filter(row => row.videoUrl === videoUrl);
  const current = matches.find(row => row.status === "posted") ?? matches[0];
  const status = current?.status ?? post?.status;
  const link = current?.postUrl ?? post?.postUrl ?? post?.url;
  const platform = current?.postPlatform ?? post?.postPlatform;
  const platforms = [...new Set(current?.platforms.length ? current.platforms : post?.platforms ?? (link ? ["x"] : []))];
  const pending = status === "scheduled" || status === "posting";
  const posted = status === "posted";
  const failed = status === "failed";
  const error = current?.error ?? post?.error ?? post?.note;
  const creditBlocked = /X API credits|credits depleted|credits exhausted/i.test(error ?? "");
  return <div className="mt-2 text-xs" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <p className={failed ? "text-rose-300" : posted ? "text-lime-300" : "text-zinc-300"} role="status">
      {creditBlocked && !posted ? "Waiting for X credits" : posted ? "Posted" : status === "posting" ? "Posting…" : pending ? "Scheduled" : failed ? "Post failed" : "Not posted"}
    </p>
    {posted && <div className="mt-1 flex items-center gap-2">
      {platforms.map(id => {
        const canonical = id === "twitter" ? "x" : id;
        const target = link && (platform ? canonical === (platform === "twitter" ? "x" : platform) : platforms.length === 1) ? link : undefined;
        return target ? <a key={id} href={target} target="_blank" rel="noopener noreferrer" aria-label={`Open ${canonical} post`} title={`Open ${canonical} post`}><PlatformBadge id={canonical} label={canonical} className="size-6" /></a>
          : <span key={id} title={`Posted to ${canonical}; post link unavailable`}><PlatformBadge id={canonical} label={canonical} className="size-6" /></span>;
      })}
    </div>}
    {(failed || creditBlocked) && error && <p className="mt-1 line-clamp-2 text-[11px] text-rose-300" title={error}>{error}</p>}
    {!posted && !pending && rows !== undefined && <RepostVideoButton key={`${videoUrl}:${status ?? "ready"}`} mintAddress={mintAddress} videoUrl={videoUrl} title={title} failed={failed} />}
  </div>;
}
