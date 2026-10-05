"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelErrorBoundary } from "./feedShared";
function Content() {
  const episodes = useQuery(api.solstarDiscovery.latestVideos, {});
  const created = useQuery(api.clipJobs.globalVideoFeed, {
    limit: 200,
    kind: "ugc",
  });
  const all = [
    ...(episodes ?? [])
      .filter((e) => !e.sample)
      .map((e) => ({
        id: String(e.id),
        url: e.videoUrl,
        poster: e.posterUrl,
        name: e.name,
        characterId: String(e.characterId),
        at: e.createdAt,
      })),
    ...(created?.items ?? []).map((e) => ({
      id: e.id,
      url: e.videoUrl,
      poster: e.posterUrl,
      name: e.agentName ?? "AI creator",
      characterId: null,
      at: e.createdAt,
    })),
  ];
  const seen = new Set<string>();
  const videos = all
    .filter((v) => v.url && !seen.has(v.url) && !!seen.add(v.url))
    .sort((a, b) => b.at - a.at);
  return (
    <main className="min-h-full bg-[#181a1c] px-4 py-6 lg:px-8">
      <h1 className="mb-6 text-xl font-semibold text-zinc-100">Videos</h1>
      {episodes === undefined || created === undefined ? (
        <div className="columns-2 gap-4 md:columns-3 xl:columns-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="mb-4 aspect-[9/16] w-full rounded-xl bg-white/5"
            />
          ))}
        </div>
      ) : !videos.length ? (
        <p className="py-12 text-sm text-zinc-500">
          Created videos will appear here.
        </p>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
          {videos.map((v) => (
            <article key={v.id} className="mb-5 break-inside-avoid">
              <video
                src={v.url ?? undefined}
                poster={v.poster ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="max-h-[650px] w-full rounded-xl bg-[#202326]"
              />
              <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs">
                {v.characterId ? (
                  <Link href={`/market/${v.characterId}`} className="truncate font-medium text-zinc-200 hover:text-[#d7ff00]">{v.name}</Link>
                ) : (
                  <span className="truncate font-medium text-zinc-200">{v.name}</span>
                )}
                <time
                  dateTime={new Date(v.at).toISOString()}
                  className="shrink-0 text-[10px] text-zinc-500"
                >
                  {new Date(v.at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
export function MakeFeed() {
  return (
    <PanelErrorBoundary message="The video feed is unavailable. Refresh to reconnect.">
      <Content />
    </PanelErrorBoundary>
  );
}
