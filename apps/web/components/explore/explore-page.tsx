"use client";
/* eslint-disable @next/next/no-img-element -- public reference thumbnails */
import { CameoPrompt, type CameoMember } from "./CameoPrompt";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Heart,
  Check,
  Copy,
  Film,
  Loader2,
  Play,
  Search,
  ChevronRight,
  ChevronDown,
  CalendarClock,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CATEGORIES, type ReferenceVideo } from "@/lib/explore/feed";
import { VideoStackIcon } from "./video-stack-icon";
import { AgentOption } from "./AgentOption";
import { ScheduleDialog, type GenMode } from "./ScheduleDialog";
import {
  estimateGenerationUsd,
  formatGenerationUsd,
  GENJUTSU_RESOLUTIONS,
  type GenjutsuResolution,
} from "@/lib/explore/generationPrice";
import { useMotionRuns } from "@/components/builder/character/motion";

type Feed = {
  items: ReferenceVideo[];
  next: number | null;
  total: number;
  refreshedAt?: string;
};
const GREEN =
  "rounded-lg bg-[#d7ff00] text-black shadow-none hover:bg-[#e4ff59]";

function ReferenceCard({
  item,
  saved,
  onSave,
  onOpen,
  onSchedule,
}: {
  item: ReferenceVideo;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  onSchedule: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState(false);
  const reduced = useReducedMotion();
  const estimate = estimateGenerationUsd(item.duration, "720p");
  const stop = () => {
    video.current?.pause();
    setPreview(false);
  };
  return (
    <article className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border border-white/10 bg-white/5">
      <button
        onClick={onOpen}
        onMouseEnter={() => !reduced && setPreview(true)}
        onMouseLeave={stop}
        onBlur={stop}
        onFocus={() => !reduced && setPreview(true)}
        style={{
          aspectRatio:
            item.width && item.height
              ? `${item.width} / ${item.height}`
              : "9 / 16",
        }}
        className="relative block w-full overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-[#d7ff00]"
        aria-label={`Preview ${item.title}`}
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Film className="size-10 text-zinc-600" />
          </span>
        )}
        {preview && (
          <video
            ref={video}
            src={item.videoUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            onError={stop}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-md border border-white/30 bg-white/20 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur-xl">
          {item.category}
        </span>
        <span className="absolute inset-x-3 bottom-3">
          <span className="mb-2 flex items-center gap-1 text-[11px] text-white/70">
            <Play className="size-3 fill-current" />
            {Math.round(item.duration)}s
          </span>
          <span className="block text-sm font-semibold leading-snug text-white">
            {item.title}
          </span>
          <span className="mt-3 flex items-center justify-between gap-2 text-xs font-medium text-[#d7ff00]">
            <span className="flex items-center gap-1.5">
              <VideoStackIcon className="size-4" /> Use reference{" "}
              <ArrowUpRight className="size-3" />
            </span>
            {estimate !== null && (
              <span className="shrink-0 text-[10px] tabular-nums text-white/70">
                Est. {formatGenerationUsd(estimate)}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Schedule ${item.title}`}
        title="Schedule for later"
        onClick={onSchedule}
        className="size-8 rounded-full border border-white/20 bg-black/20 backdrop-blur-xl hover:bg-white/20"
      >
        <CalendarClock className="size-4 text-white" />
      </Button>
      <motion.div
        animate={saved && !reduced ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={saved ? `Unsave ${item.title}` : `Save ${item.title}`}
          aria-pressed={saved}
          onClick={onSave}
          className="size-8 rounded-full border border-white/20 bg-black/20 backdrop-blur-xl hover:bg-white/20"
        >
          <Heart
            className={`size-4 ${saved ? "fill-red-500 text-red-500" : "text-white"}`}
          />
        </Button>
      </motion.div>
      </div>
    </article>
  );
}

function Generator({
  mint,
  primaryName,
  item,
  resolution,
  mode,
  onBusy,
}: {
  mint: string;
  primaryName: string;
  item: ReferenceVideo;
  resolution: GenjutsuResolution;
  mode: GenMode;
  onBusy: (busy: boolean) => void;
}) {
  const [portrait, setPortrait] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<CameoMember[]>([]);
  const estimate = estimateGenerationUsd(item.duration, resolution);
  const { runs, start } = useMotionRuns(mint);
  const run = runs[0];
  useEffect(() => {
    onBusy(run?.status === "pending");
  }, [run?.status, onBusy]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/character?mint=${encodeURIComponent(mint)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not load portrait");
        setPortrait(d.character?.image?.url);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mint]);
  return (
    <div className="space-y-4">
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="size-4 animate-spin" /> Loading character…
        </p>
      ) : portrait ? (
        <div className="flex items-center gap-3 rounded-lg border border-white/10 p-3">
          <img
            src={portrait}
            alt="Selected influencer portrait"
            className="size-12 rounded-md object-cover"
          />
          <div>
            <p className="text-sm text-white">Your saved character</p>
            <p className="text-xs text-zinc-500">Identity + reference motion</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          {error || "This influencer needs a saved character portrait."}{" "}
          <Link
            className="text-[#d7ff00] underline"
            href={`/builder?mint=${encodeURIComponent(mint)}&tab=character`}
          >
            Open character builder
          </Link>
        </p>
      )}
      {portrait && (
        <CameoPrompt mint={mint} primaryName={primaryName} primaryImage={portrait} item={item} mode={mode} value={prompt} onChange={setPrompt} onCast={setCast} />
      )}

      <Button
        className={`h-11 w-full ${GREEN}`}
        disabled={
          !portrait || loading || run?.status === "pending" || estimate === null
        }
        onClick={() =>
          void start({
            mode,
            videoUrl: item.videoUrl,
            imageUrls: [portrait!, ...cast.map((c) => c.avatarUrl)].slice(0, 8),
            prompt,
            resolution,
            title: item.title,
            poster: item.thumbUrl,
          })
        }
      >
        {run?.status === "pending" ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Generating…
          </>
        ) : (
          <>
            <VideoStackIcon className="size-4" /> Generate video{" "}
            <span className="ml-auto tabular-nums">
              {estimate !== null ? formatGenerationUsd(estimate) : ""}
            </span>
          </>
        )}
      </Button>
      <p className="text-[11px] text-zinc-500">
        Keep this popup open while rendering. Finished videos are saved to this
        agent&apos;s motion library.
      </p>
      {run?.status === "error" && (
        <p role="alert" className="text-sm text-red-400">
          {run.error}
        </p>
      )}
      {run?.url && (
        <div>
          <p className="mb-2 text-xs text-[#d7ff00]">Your latest generation</p>
          <video
            src={run.url}
            controls
            playsInline
            className="max-h-56 w-full rounded-lg bg-black"
          />
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-[#d7ff00] underline"
          >
            Open / download video
          </a>
        </div>
      )}
    </div>
  );
}

export function ExplorePage({ initial }: { initial: Feed }) {
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saved, setSaved] = useState<string[]>([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<ReferenceVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReferenceVideo | null>(null);
  const [mint, setMint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [resolution, setResolution] = useState<GenjutsuResolution>("720p");
  const [mode, setMode] = useState<GenMode>("motion-transfer");
  const [price, setPrice] = useState<"any" | "u5" | "5-10" | "10-20" | "o20">("any");
  const [scheduleItem, setScheduleItem] = useState<ReferenceVideo | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const { profile, login } = useSupabaseAuth();
  const wallets = useMemo(
    () => [
      ...new Set(
        [...(profile?.walletAddresses ?? []), profile?.walletAddress].filter(
          (w): w is string => !!w,
        ),
      ),
    ],
    [profile],
  );
  const agents = useQuery(
    api.influencers.listByCreators,
    wallets.length ? { creatorWallets: wallets } : "skip",
  );
  const reduced = useReducedMotion();
  // Favorites persist locally and synchronize across browser tabs.
  useEffect(() => {
    function restore() {
      try {
        const ids = JSON.parse(
          localStorage.getItem("solcameo.explore.saved") || "[]",
        );
        const videos = JSON.parse(
          localStorage.getItem("solcameo.explore.savedItems") || "[]",
        );
        setSaved(
          Array.isArray(ids)
            ? [
                ...new Set(
                  ids.filter((v): v is string => typeof v === "string"),
                ),
              ]
            : [],
        );
        setSavedItems(
          Array.isArray(videos)
            ? videos.filter(
                (v) =>
                  v &&
                  typeof v.id === "string" &&
                  typeof v.videoUrl === "string",
              )
            : [],
        );
      } catch {
        /* corrupt storage */
      }
    }
    restore();
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, []);
  const inPrice = (i: ReferenceVideo) => {
    if (price === "any") return true;
    const p = estimateGenerationUsd(i.duration, resolution);
    if (p === null) return false;
    return price === "u5" ? p < 5 : price === "5-10" ? p >= 5 && p < 10 : price === "10-20" ? p >= 10 && p < 20 : p >= 20;
  };
  const visible = items.filter(
    (i) =>
      inPrice(i) &&
      (category === "All" || i.category === category) &&
      `${i.title} ${i.description}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const favorites = [
    ...new Map(
      [...savedItems, ...items]
        .filter((i) => saved.includes(i.id))
        .map((i) => [i.id, i]),
    ).values(),
  ];
  function toggleSave(item: ReferenceVideo) {
    const updated = saved.includes(item.id)
      ? saved.filter((v) => v !== item.id)
      : [...saved, item.id];
    const videos = [
      ...new Map(
        [...savedItems, ...items, item]
          .filter((i) => updated.includes(i.id))
          .map((i) => [i.id, i]),
      ).values(),
    ];
    setSaved(updated);
    setSavedItems(videos);
    try {
      localStorage.setItem("solcameo.explore.saved", JSON.stringify(updated));
      localStorage.setItem(
        "solcameo.explore.savedItems",
        JSON.stringify(videos),
      );
    } catch {
      /* storage unavailable */
    }
  }
  function openReference(item: ReferenceVideo) {
    setFavoritesOpen(false);
    setSelected(item);
    setMediaError(false);
    setCopied(false);
    setCopyError("");
  }
  async function loadMore() {
    if (!next || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/explore?cursor=${next}`);
      const d: Feed & { error?: string } = await res.json();
      if (!res.ok) throw new Error(d.error);
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...d.items.filter((i) => !ids.has(i.id))];
      });
      setNext(d.next && d.next > next ? d.next : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load references");
    } finally {
      setLoading(false);
    }
  }
  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.videoUrl);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Copy unavailable. Select and copy the source URL below.");
    }
  }
  const estimate = selected
    ? estimateGenerationUsd(selected.duration, resolution)
    : null;
  return (
    <main className="explore-library min-h-full bg-[#181a1c] px-4 py-4 text-white sm:px-7 lg:px-9">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-[1600px]"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-white/40" />
            <Input
              aria-label="Search loaded references"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos…"
              className="h-10 rounded-lg border-white/10 bg-white/[0.04] pl-9 text-sm text-white shadow-none backdrop-blur-xl focus-visible:ring-white/20"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setFavoritesOpen(true)}
            className="h-10 rounded-lg border-white/10 bg-white/[0.04] text-white/80 backdrop-blur-xl hover:bg-white/10"
          >
            <Heart className="size-4 fill-red-500 text-red-500" /> Saved{" "}
            <motion.span
              key={saved.length}
              initial={reduced ? false : { scale: 1.25 }}
              animate={{ scale: 1 }}
              className="tabular-nums"
            >
              {saved.length}
            </motion.span>
          </Button>
        </div>
        <h1 className="sr-only">Explore motion references</h1>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <Button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={
                  category === c
                    ? GREEN
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                }
              >
                {c}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["Model", mode, (v: string) => setMode(v as GenMode), [["motion-transfer", "Genjutsu · Motion transfer"], ["object-swap", "Genjutsu · Object swap"]]],
              ["Quality", resolution, (v: string) => setResolution(v as GenjutsuResolution), GENJUTSU_RESOLUTIONS.map((r) => [r, r])],
              ["Price", price, (v: string) => setPrice(v as typeof price), [["any", "Any price"], ["u5", "Under $5"], ["5-10", "$5 to $10"], ["10-20", "$10 to $20"], ["o20", "$20 and up"]]],
            ] as Array<[string, string, (v: string) => void, string[][]]>).map(([label, value, set, opts]) => (
              <label key={label} className="relative">
                <span className="sr-only">{label}</span>
                <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="h-9 cursor-pointer appearance-none rounded-lg border border-white/10 bg-white/[0.05] py-0 pl-3 pr-8 text-xs font-medium text-zinc-200 outline-none backdrop-blur-xl transition-colors hover:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-[#d7ff00]/50 [color-scheme:dark]">
                  {opts.map(([v, l]) => <option key={v} value={v}>{label}: {l}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 size-3.5 text-zinc-500" />
              </label>
            ))}
          <p className="text-sm font-medium tracking-tight text-white/50">
            <span className="tabular-nums text-white/80">
              {initial.total.toLocaleString()}
            </span>{" "}
            videos available
          </p>
          </div>
        </div>
        <div className="columns-2 gap-3 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
          {visible.map((item) => (
            <ReferenceCard
              key={item.id}
              item={item}
              saved={saved.includes(item.id)}
              onSave={() => toggleSave(item)}
              onOpen={() => openReference(item)}
              onSchedule={() => setScheduleItem(item)}
            />
          ))}
        </div>
        {!visible.length && (
          <div className="py-20 text-center">
            <Film className="mx-auto mb-3 size-8 text-zinc-600" />
            <p className="text-zinc-400">
              No matching references in the loaded library.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
        <div className="flex flex-col items-center gap-3 py-8">
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {next && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void loadMore()}
              className="h-10 border-white/15 bg-transparent px-7 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </>
              ) : error ? (
                "Retry loading"
              ) : (
                "Load more references"
              )}
            </Button>
          )}
          <p className="text-[11px] text-zinc-500">
            Search and filters apply to loaded references. Public references via{" "}
            <a
              href="https://higgsfield.ai/ai/video?model=genjutsu"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Higgsfield
            </a>
            .
          </p>
        </div>
      </motion.div>
      <Dialog open={favoritesOpen} onOpenChange={setFavoritesOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-white/15 bg-[#181a1c]/95 text-white backdrop-blur-2xl sm:max-w-5xl">
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Heart className="size-5 fill-red-500 text-red-500" /> Your
            favorites{" "}
            <span className="text-sm font-normal text-white/40">
              {saved.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Your saved video references, ready for your next creation.
          </DialogDescription>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 columns-2 gap-3 md:columns-3 lg:columns-4"
          >
            {favorites.map((item) => (
              <ReferenceCard
                key={item.id}
                item={item}
                saved
                onSave={() => toggleSave(item)}
                onOpen={() => openReference(item)}
              onSchedule={() => setScheduleItem(item)}
              />
            ))}
          </motion.div>
          {!favorites.length && (
            <div className="py-12 text-center">
              <Heart className="mx-auto mb-3 size-8 text-white/25" />
              <p className="text-sm text-white/50">
                Tap a heart to save a video here.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !generating) setSelected(null);
        }}
      >
        <DialogContent
          showCloseButton={!generating}
          className="max-h-[90dvh] overflow-y-auto border border-white/10 bg-[#202326]/95 p-5 shadow-2xl backdrop-blur-2xl text-white sm:max-w-4xl"
        >
          {selected && (
            <>
              <DialogTitle className="pr-8 text-xl">
                {selected.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Use this motion with your influencer.
              </DialogDescription>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <video
                    key={selected.id}
                    src={selected.videoUrl}
                    onError={() => setMediaError(true)}
                    poster={selected.thumbUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const v = event.currentTarget;
                      if (v.videoWidth > 0 && v.videoHeight > 0)
                        setSelected((current) =>
                          current?.id === selected.id
                            ? {
                                ...current,
                                width: v.videoWidth,
                                height: v.videoHeight,
                                duration: Number.isFinite(v.duration)
                                  ? v.duration
                                  : current.duration,
                              }
                            : current,
                        );
                    }}
                    style={{
                      width: `min(100%, ${(selected.width && selected.height ? selected.width / selected.height : 9 / 16) * 50}dvh)`,
                      aspectRatio:
                        selected.width && selected.height
                          ? `${selected.width} / ${selected.height}`
                          : "9 / 16",
                    }}
                    className="mx-auto block h-auto max-h-[50dvh] rounded-lg"
                  />
                  {mediaError && (
                    <p role="alert" className="mt-3 text-xs text-red-400">
                      This original is unavailable from the source. Choose
                      another reference.
                    </p>
                  )}
                  <p className="mt-3 text-[11px] text-zinc-500">
                    Original reference · {Math.round(selected.duration)}s
                    {selected.width && selected.height
                      ? ` · ${selected.width} × ${selected.height}`
                      : ""}
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                    {selected.description}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void copy()}
                      className="border-white/10 bg-transparent text-white"
                    >
                      {copied ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied ? "Copied source" : "Copy original URL"}
                    </Button>
                    <a
                      href={selected.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open original reference"
                      className="grid size-8 place-items-center rounded-lg border border-white/10"
                    >
                      <ArrowUpRight className="size-4" />
                    </a>
                  </div>
                  {copyError && (
                    <>
                      <p role="alert" className="mt-2 text-xs text-red-400">
                        {copyError}
                      </p>
                      <Input
                        readOnly
                        value={selected.videoUrl}
                        onFocus={(e) => e.target.select()}
                        aria-label="Reference URL"
                      />
                    </>
                  )}
                </div>
                <div>
                  <div
                    aria-label="Creation steps"
                    className="mb-5 flex items-center gap-2 whitespace-nowrap border-b border-white/10 pb-4 text-[10px] font-medium tracking-tight text-zinc-400 sm:text-[11px]"
                  >
                    <span>Choose influencer</span>
                    <ChevronRight
                      aria-hidden
                      className="size-3 shrink-0 text-zinc-600"
                    />
                    <span>Generate video</span>
                    <ChevronRight
                      aria-hidden
                      className="size-3 shrink-0 text-zinc-600"
                    />
                    <span>Post to socials</span>
                  </div>
                  <div className="mb-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-400">Resolution</span>
                      <div className="flex gap-1">
                        {GENJUTSU_RESOLUTIONS.map((r) => (
                          <Button
                            key={r}
                            size="sm"
                            variant="outline"
                            disabled={generating}
                            aria-pressed={r === resolution}
                            onClick={() => setResolution(r)}
                            className={
                              r === resolution
                                ? `${GREEN} !border-[#d7ff00] !bg-[#d7ff00] !text-black font-semibold hover:!bg-[#e4ff59] aria-pressed:!bg-[#d7ff00] aria-pressed:!text-black`
                                : "border-white/10 bg-transparent text-zinc-400"
                            }
                          >
                            {r}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-zinc-400">
                        Estimated generation{" "}
                        <span className="text-zinc-500">
                          · {Math.ceil(selected.duration)}s
                        </span>
                      </span>
                      <span className="font-medium tabular-nums text-white">
                        {estimate !== null
                          ? `${formatGenerationUsd(estimate)} USD`
                          : "Unavailable"}
                      </span>
                    </div>
                    {estimate === null && (
                      <p role="status" className="text-xs text-amber-300">
                        Choose a reference between 4 and 30 seconds.
                      </p>
                    )}
                  </div>
                  <label className="mb-4 block text-xs text-zinc-400">
                    Your influencer
                    <Select
                      disabled={generating}
                      value={mint}
                      onValueChange={(value) => setMint(value ?? "")}
                    >
                      <SelectTrigger
                        aria-label="Your influencer"
                        className="mt-2 h-14 w-full border-white/10 bg-white/5 px-2.5 text-white"
                      >
                        <SelectValue placeholder="Choose an influencer">
                          {(value: string | null) => {
                            const a = agents?.find((x) => x.mintAddress === value);
                            return a ? <AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(22rem,var(--available-height))] border-white/10 bg-[#17191d] p-1.5 text-white">
                        {agents?.map((a) => (
                          <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-14 py-1.5 pl-2">
                            <AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {mint && !mediaError ? (
                    <Generator
                      key={mint}
                      mint={mint}
                      primaryName={agents?.find((a) => a.mintAddress === mint)?.name ?? "Character"}
                      item={selected}
                      resolution={resolution}
                      mode={mode}
                      onBusy={setGenerating}
                    />
                  ) : (
                    <p className="text-sm text-zinc-400">
                      {!profile ? (
                        <button type="button" onClick={() => void login()} className="underline underline-offset-4 hover:text-white">Sign in to use your influencers.</button>
                      ) : agents === undefined ? "Loading your influencers…" : agents.length ? null : (
                        <>No influencer yet? <Link href="/create" className="underline underline-offset-4 hover:text-white">Create one.</Link></>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ScheduleDialog
        item={scheduleItem}
        agents={agents}
        initialMint={mint}
        mode={mode}
        resolution={resolution}
        onClose={() => setScheduleItem(null)}
      />
    </main>
  );
}
