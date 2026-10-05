"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Sparkles, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";
import { toFeedView, type FeedRowInput, type FeedView } from "@/lib/solstar/feedView";
import { CharAvatar, PanelErrorBoundary, useCharacterMap, useNow } from "./feedShared";
import { FeedComposer } from "./FeedComposer";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { activityInUsd } from "@/lib/solstar/usdc";
import type { MarketRow } from "./MarketTable";

const FEED_LIMIT = 50;

function PaperChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
      Paper
    </span>
  );
}

function EventIcon({ view }: { view: FeedView }) {
  const base = "size-4";
  if (view.kind === "character_created") return <Sparkles className={`${base} text-lime-400`} aria-hidden />;
  if (view.kind === "follow") return <UserPlus className={`${base} text-sky-400`} aria-hidden />;
  if (view.kind === "trade" && view.side === "sell")
    return <ArrowDownRight className={`${base} text-red-400`} aria-hidden />;
  if (view.kind === "trade" && view.side === "buy")
    return <ArrowUpRight className={`${base} text-emerald-400`} aria-hidden />;
  return <ArrowLeftRight className={`${base} text-muted-foreground`} aria-hidden />;
}

function FeedItem({
  view,
  now,
  character,
  animate,
}: {
  view: FeedView;
  now: number;
  character?: MarketRow;
  animate: boolean;
}) {
  const reduce = useReducedMotion();
  const rate = useSolUsd();
  const time = (
    <time
      dateTime={new Date(view.createdAt).toISOString()}
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      {formatRelativeTime(now, view.createdAt)}
    </time>
  );
  const motionProps =
    animate && !reduce
      ? { initial: { opacity: 0, y: -10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } }
      : {};

  if (view.kind === "chat") {
    return (
      <motion.li {...motionProps} className="flex gap-3 px-4 py-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold"
        >
          {view.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-sm font-medium">{view.author}</span>
            {time}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">{view.body}</p>
        </div>
      </motion.li>
    );
  }

  const href = view.characterId ? `/market/${view.characterId}` : undefined;
  const text = <span className="min-w-0 break-words text-sm">{activityInUsd(view.body, rate)}</span>;
  return (
    <motion.li {...motionProps} className="px-4 py-2.5">
      <div className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background/60">
          <EventIcon view={view} />
        </span>
        {character ? <CharAvatar name={character.name} src={character.imageUrl} className="size-6" /> : null}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {href ? (
            <Link
              href={href}
              className="min-w-0 rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {text}
            </Link>
          ) : (
            text
          )}
          {view.kind === "trade" && view.simulated ? <PaperChip /> : null}
        </div>
        {time}
      </div>
    </motion.li>
  );
}

function FeedList() {
  const rows = useQuery(api.solstarFeed.listFeed, { limit: FEED_LIMIT }) as FeedRowInput[] | undefined;
  const chars = useCharacterMap();
  const now = useNow(30_000);
  // Ids present on first load do not animate; later arrivals do.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);

  if (rows && initialIds === null) setInitialIds(new Set(rows.map((r) => r.id)));

  const views = (rows ?? []).map(toFeedView).filter((v): v is FeedView => v !== null);
  const status = rows === undefined ? "Loading live feed" : `${views.length} items in the live feed`;

  return (
    <>
      <p role="status" className="sr-only">
        {status}
      </p>
      {rows === undefined ? (
        <div className="space-y-3 p-4" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : views.length === 0 ? (
        <div className="px-6 py-8 sm:px-8">
          <div className="mb-6 flex items-center gap-3 text-xs text-zinc-500"><span className="size-2 rounded-full bg-emerald-300" /> Welcome to Solcameo</div>
          <h2 className="max-w-sm text-2xl font-semibold leading-tight tracking-tight text-zinc-100">A character. A community.<br />A token with a story.</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">Create AI characters that keep making videos. Build their world, grow an audience, and explore the Solana launchpad.</p>
          <div className="mt-7 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
            <Link href="/create" className="flex items-center gap-4 border-b border-white/10 p-5 transition-colors hover:bg-white/[0.04]">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-300/10 text-emerald-300"><Sparkles className="size-5" /></span>
              <div className="flex-1"><h3 className="text-sm font-medium text-zinc-200">Create your character</h3><p className="mt-1 text-xs text-zinc-500">Identity, personality, and AI-native videos</p></div><ArrowUpRight className="size-4 text-zinc-500" />
            </Link>
            <Link href="/control" className="flex items-center gap-4 p-5 transition-colors hover:bg-white/[0.04]">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-400"><UserPlus className="size-5" /></span>
              <div className="flex-1"><h3 className="text-sm font-medium text-zinc-200">Your agents, one workspace</h3><p className="mt-1 text-xs text-zinc-500">Manage agents, content, and conversations</p></div><ArrowUpRight className="size-4 text-zinc-500" />
            </Link>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-zinc-600">No activity yet. Start the conversation.</p><Button nativeButton={false} render={<Link href="/market" />} variant="ghost" size="sm" className="text-xs text-emerald-300">Explore market <ArrowUpRight className="size-3" /></Button></div>
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {views.map((v) => (
            <FeedItem
              key={v.id}
              view={v}
              now={now}
              character={"characterId" in v && v.characterId ? chars?.get(v.characterId) : undefined}
              animate={!(initialIds?.has(v.id) ?? false)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** Body of the "Live feed" card: scrolling list + composer. */
export function FeedPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={compact ? "h-[240px] overflow-y-auto" : "min-h-[400px] flex-1 overflow-y-auto lg:max-h-[calc(100dvh-270px)]"}>
        <PanelErrorBoundary message="Live feed is unavailable right now.">
          <FeedList />
        </PanelErrorBoundary>
      </div>
      <FeedComposer />
    </div>
  );
}
