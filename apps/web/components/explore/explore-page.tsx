"use client";
/* eslint-disable @next/next/no-img-element -- public reference thumbnails */
import { CameoPrompt, type CameoMember } from "./CameoPrompt";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useInView, useReducedMotion } from "framer-motion";
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
  CalendarClock,
  Upload,
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
import promptReferences from "@/lib/explore/prompt-references.json";
import { VideoStackIcon } from "./video-stack-icon";
import { AgentOption } from "./AgentOption";
import { ScheduleDialog, type GenMode } from "./ScheduleDialog";
import { ExploreSelect } from "./ExploreSelect";
import { ReferencePlayer } from "./ReferencePlayer";
import { castToken } from "@/lib/explore/castKey";
import { cameoReferencePrompt, modelForReference, referenceEstimate, engineSeconds, estimateModelUsd, type ExploreModel } from "@/lib/explore/models";
import {
  formatGenerationUsd,
  type GenjutsuResolution,
} from "@/lib/explore/generationPrice";
import { useMotionRuns } from "@/components/builder/character/motion";
import type { Id } from "@/convex/_generated/dataModel";

type Short = { items: Array<ReferenceVideo & { rank?: number }> };
type Feed = {
  items: ReferenceVideo[];
  next: number | null;
  total: number;
  refreshedAt?: string;
};
const PROMPT_REFERENCES: ReferenceVideo[] = promptReferences.items;
const GREEN =
  "rounded-lg bg-[#d7ff00] text-black shadow-none hover:bg-[#e4ff59]";

function ReferenceCard({
  item,
  saved,
  onSave,
  onOpen,
  onSchedule,
  estimate,
}: {
  item: ReferenceVideo;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  /** Only Genjutsu renders can be scheduled, so this is absent for the other models. */
  onSchedule?: () => void;
  estimate: number | null;
}) {
  const card = useRef<HTMLElement>(null);
  const visible = useInView(card, { once: true, amount: 0.08 });
  const [imageReady, setImageReady] = useState(!item.thumbUrl);
  const video = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState(false);
  const reduced = useReducedMotion();
  const stop = () => {
    video.current?.pause();
    setPreview(false);
  };
  return (
    <motion.article
      ref={card}
      initial={{ opacity: 0, y: reduced ? 0 : 24, filter: reduced ? "blur(0px)" : "blur(10px)" }}
      animate={visible && imageReady
        ? { opacity: 1, y: 0, filter: "blur(0px)" }
        : { opacity: 0, y: reduced ? 0 : 24, filter: reduced ? "blur(0px)" : "blur(10px)" }}
      transition={{ duration: reduced ? 0 : 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border border-white/10 bg-white/5"
    >
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
        aria-label={`Use ${item.title} as reference`}
      >
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setImageReady(true)}
            onError={() => setImageReady(true)}
            ref={image => { if (image?.complete) setImageReady(true); }}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Film className="size-10 text-zinc-600" />
          </span>
        )}
        {(preview || (visible && !item.thumbUrl)) && (
          <video
            ref={video}
            src={item.videoUrl}
            autoPlay={preview}
            muted
            loop
            playsInline
            preload={preview ? "none" : "metadata"}
            onLoadedData={event => { if (!preview) event.currentTarget.currentTime = 0.01; }}
            onError={stop}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-md border border-white/30 bg-white/20 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur-xl">
          {item.category}
        </span>
        <span aria-hidden className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-white/25 bg-black/20 text-white backdrop-blur-xl transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:bg-white/20 motion-reduce:transform-none">
          <ArrowUpRight className="size-4" />
        </span>
        <span className="absolute inset-x-3 bottom-3">
          <span className="mb-2 flex items-center gap-1 text-[11px] text-white/70">
            <Play className="size-3 fill-current" />
            {Math.round(item.duration)}s
          </span>
          <span className="block text-sm font-semibold leading-snug text-white">
            {item.title}
          </span>
          {item.sourceName && <span className="mt-1 block text-[10px] text-white/60">{item.sourceName}</span>}
          <span className="mt-3 flex items-center justify-between gap-2 text-xs font-medium text-[#d7ff00]">
            {estimate !== null && (
              <span className="shrink-0 text-[10px] tabular-nums text-white/70">
                Est. {formatGenerationUsd(estimate)}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="absolute right-2 top-14 flex items-center gap-1.5">
      {onSchedule && (
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
      )}
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
    </motion.article>
  );
}

function Generator({
  mint,
  primaryName,
  item,
  resolution,
  mode,
  model,
  xConnected,
  onBusy,
  uploadedFile,
}: {
  mint: string;
  primaryName: string;
  item: ReferenceVideo;
  resolution: string;
  mode: GenMode;
  model: ExploreModel;
  xConnected: boolean;
  onBusy: (busy: boolean) => void;
  uploadedFile?: File;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [portrait, setPortrait] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState(() => cameoReferencePrompt(item, primaryName));
  const [cast, setCast] = useState<CameoMember[]>([]);
  const [autoPost, setAutoPost] = useState(false);
  const estimate = estimateModelUsd(model, item.duration, resolution);
  const { runs, start } = useMotionRuns(mint);
  const run = runs[0];
  // Grok, Veo, Seedance and Gemini render through the agent's normal video path, paid from the same agent wallet.
  const [engineTask, setEngineTask] = useState<Id<"agentTasks"> | null>(null);
  const [engineError, setEngineError] = useState("");
  const [engineStarting, setEngineStarting] = useState(false);
  const engineStatus = useQuery(api.agentTasks.generationStatus, engineTask ? { ids: [engineTask] } : "skip") as
    | Record<string, { status: string; videoUrl?: string; error?: string }>
    | undefined;
  const engineState = engineTask ? engineStatus?.[engineTask] : undefined;
  const engineRunning = engineStarting || (!!engineTask && (!engineState || engineState.status === "pending" || engineState.status === "running"));
  const busy = uploading || (model.kind === "genjutsu" ? run?.status === "pending" : engineRunning);
  const resultUrl = model.kind === "genjutsu" ? run?.url : engineState?.status === "succeeded" ? engineState.videoUrl : undefined;
  const failure = model.kind === "genjutsu" ? (run?.status === "error" ? run.error : "") : engineError || (engineState?.status === "failed" ? engineState.error || "Generation failed" : "");
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  async function startMotion() {
    if (!portrait) return;
    setUploadError(""); setUploading(true);
    try {
      let videoUrl = item.videoUrl;
      if (uploadedFile) {
        const form = new FormData(); form.set("mintAddress", mint); form.set("file", uploadedFile);
        const response = await fetch("/api/character/motion-upload", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.error || "Could not upload your video");
        videoUrl = data.url;
      }
      await start({ mode, videoUrl, imageUrls: [portrait, ...cast.map(c => c.avatarUrl)].slice(0, 8), prompt, resolution: resolution as GenjutsuResolution, title: item.title,
        ...(uploadedFile ? {} : { poster: item.thumbUrl, explore: { referenceId: item.id, referencePage: item.page, castTokens: [castToken(primaryName), ...cast.map(c => c.token)], autoPost: xConnected && autoPost } }),
      });
    } catch (e) { setUploadError(e instanceof Error ? e.message : "Could not upload your video"); }
    finally { setUploading(false); }
  }
  async function startEngine() {
    if (!portrait || !model.engine) return;
    setEngineError("");
    setEngineStarting(true);
    setEngineTask(null);
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mint,
          taskType: "create_video",
          title: `Explore: ${item.title}`.slice(0, 80),
          input: {
            topic: (prompt.trim() || `${item.title}. ${item.description}`).slice(0, 900),
            referenceImageUrl: portrait,
            videoEngine: model.engine,
            videoResolution: resolution,
            durationSeconds: engineSeconds(model, item.duration),
            skipStoryboard: true,
            ...(cast.length ? { mentionRefImageUrls: cast.map((c) => c.avatarUrl).slice(0, 2) } : {}),
          },
          triggeredBy: "explore",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
      setEngineTask(data.taskId as Id<"agentTasks">);
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : "Could not start the render");
    } finally {
      setEngineStarting(false);
    }
  }
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
            <p className="text-xs text-zinc-500">{model.kind === "genjutsu" ? "Identity + reference motion" : "Identity + scene prompt"}</p>
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

      {portrait && !uploadedFile && xConnected && model.kind === "genjutsu" && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs transition-colors hover:bg-white/[0.07] has-[:checked]:border-[#d7ff00]/40 has-[:checked]:bg-[#d7ff00]/[0.06]">
          <input type="checkbox" checked={autoPost} disabled={busy} onChange={(e) => setAutoPost(e.target.checked)} className="peer sr-only" />
          <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border border-white/30 bg-black/30 text-transparent transition-colors peer-checked:border-[#d7ff00] peer-checked:bg-[#d7ff00] peer-checked:text-black peer-focus-visible:ring-2 peer-focus-visible:ring-[#d7ff00]/60"><Check className="size-3" strokeWidth={3.5} /></span>
          <span><span className="block text-sm font-semibold text-white">Auto-post to X when it&apos;s ready</span><span className="mt-0.5 block text-zinc-400">We write a viral caption in your influencer&apos;s voice and publish it to the connected X account.</span></span>
        </label>
      )}
      <Button
        className={`h-11 w-full ${GREEN}`}
        disabled={
          !portrait || loading || busy || estimate === null
        }
        onClick={() =>
          model.kind === "engine"
            ? void startEngine()
            : void startMotion()
        }
      >
        {busy ? (
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
        {estimate !== null ? `${formatGenerationUsd(estimate)} is charged from this agent's wallet and includes a 10% Solcameo fee. ` : ""}
        Keep this popup open while rendering. {model.kind === "genjutsu" ? "Finished videos are saved to your agent’s motion library." : "Track the render in your agent’s activity."}{autoPost && xConnected ? " It will be posted to X automatically." : ""}
      </p>
      {(failure || uploadError) && (
        <p role="alert" className="text-sm text-red-400">
          {failure || uploadError}
        </p>
      )}
      {resultUrl && (
        <div>
          <p className="mb-2 text-xs text-[#d7ff00]">Your latest generation</p>
          <video
            src={resultUrl}
            controls
            playsInline
            className="max-h-56 w-full rounded-lg bg-black"
          />
          <a
            href={resultUrl}
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

/** Short, popular references (4 to 6 seconds) indexed from the public feed, folded in ahead of the paged list. */
function withShort(initial: Feed, short?: Short): ReferenceVideo[] {
  const seen = new Set([...PROMPT_REFERENCES, ...initial.items].map((i) => i.id));
  return [...PROMPT_REFERENCES, ...initial.items, ...(short?.items ?? []).filter((i) => !seen.has(i.id)).map(({ rank: _rank, ...item }) => (void _rank, item))];
}

const LENGTHS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "Any" },
  { value: "u5", label: "Under 5s" },
  { value: "5-10", label: "5 to 10s" },
  { value: "10-20", label: "10 to 20s" },
  { value: "o20", label: "20s+" },
];
const REVEAL = 24; // cards added to the grid each time the end comes into view

type Bounds = { min: number; max: number }; // seconds; max 0 = no upper bound
const LENGTH_BOUNDS: Record<string, Bounds> = { any: { min: 0, max: 0 }, u5: { min: 0, max: 5 }, "5-10": { min: 5, max: 10 }, "10-20": { min: 10, max: 20 }, o20: { min: 20, max: 0 } };
const SORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "trending", label: "Trending" },
  { value: "shortest", label: "Shortest first" },
  { value: "cheapest", label: "Cheapest first" },
];

export function ExplorePage({ initial, short }: { initial: Feed; short?: Short }) {
  const [items, setItems] = useState(() => withShort(initial, short));
  const [next, setNext] = useState(initial.next);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saved, setSaved] = useState<string[]>([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<ReferenceVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File>();
  const [uploadError, setUploadError] = useState("");
  const [selected, setSelected] = useState<ReferenceVideo | null>(null);
  const customVideo = selected?.id.startsWith("upload:") ?? false;
  useEffect(() => {
    const url = customVideo ? selected?.videoUrl : undefined;
    return () => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [customVideo, selected?.videoUrl]);
  const [mint, setMint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [price, setPrice] = useState<"any" | "u5" | "5-10" | "10-20" | "o20">("any");
  const [length, setLength] = useState("any");
  const [sort, setSort] = useState("trending");
  const model = modelForReference(selected);
  const resolution = model.defaultQuality;
  // Price is evaluated per card because each source uses its own generation model.
  const bounds = LENGTH_BOUNDS[length] ?? LENGTH_BOUNDS.any;
  const remote = !!query.trim() || category !== "All" || (!!bounds && (bounds.min > 0 || bounds.max > 0) && length !== "u5");
  const filterKey = `${query.trim().toLowerCase()}|${category}|${bounds ? `${bounds.min}-${bounds.max}` : "none"}|${length === "u5"}`;
  const [limit, setLimit] = useState(REVEAL);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const mode: GenMode = model.mode ?? "motion-transfer";
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
    const p = referenceEstimate(i);
    if (p === null) return false;
    return price === "u5" ? p < 5 : price === "5-10" ? p >= 5 && p < 10 : price === "10-20" ? p >= 10 && p < 20 : p >= 20;
  };
  const inLength = (i: ReferenceVideo) => {
    const d = i.duration;
    return length === "any" || (length === "u5" ? d < 5 : length === "5-10" ? d >= 5 && d < 10 : length === "10-20" ? d >= 10 && d < 20 : d >= 20);
  };
  const visible = items
    .filter(
      (i) =>
        inPrice(i) &&
        inLength(i) &&
        (category === "All" || i.category === category) &&
        `${i.title} ${i.description} ${i.sourceName ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    )
    // "Trending" keeps the feed's own order; the other two re-rank what is loaded.
    .sort((a, b) =>
      sort === "shortest"
        ? a.duration - b.duration
        : sort === "cheapest"
          ? (referenceEstimate(a) ?? Infinity) - (referenceEstimate(b) ?? Infinity)
          : 0,
    );
  const shown = visible.slice(0, limit);
  // Lazy loading: when the end of the grid nears the screen, reveal more of what is loaded; once all of it is shown,
  // fetch the next batch from the library. The observer is rebuilt as things change, so if the end is still in view
  // (a sparse filter) the walk keeps going until it finds matches or reaches the last page.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (limit < visible.length) setLimit((l) => l + REVEAL);
        else if (next && !loading && !error) loadMore();
      },
      { rootMargin: "1100px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, visible.length, next, loading, error, filterKey]);
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
    setUploadedFile(undefined); setUploadError("");
    setSelected(item);
    setMediaError(false);
    setCopied(false);
    setCopyError("");
  }
  /** Fetch the next batch of the library for the current filters; `reset` starts a fresh result list. */
  async function fetchBatch(cursor: number, reset: boolean) {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ cursor: String(cursor) });
      if (remote && bounds) {
        if (query.trim()) params.set("q", query.trim());
        if (category !== "All") params.set("category", category);
        if (bounds.min > 0) params.set("min", String(bounds.min));
        if (bounds.max > 0) params.set("max", String(bounds.max));
      }
      const res = await fetch(`/api/explore?${params}`);
      const d: Feed & { error?: string } = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (id !== request.current) return; // a newer filter change superseded this request
      setItems((prev) => {
        const base = reset ? PROMPT_REFERENCES : prev;
        const ids = new Set(base.map((i) => i.id));
        return [...base, ...d.items.filter((i) => !ids.has(i.id))];
      });
      setNext(d.next && d.next > cursor ? d.next : null);
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : "Unable to load references");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  function loadMore() {
    if (next && !loading) void fetchBatch(next, false);
  }
  // Any filter change restarts the walk through the library: back to the built-in index when nothing needs the
  // server, otherwise a fresh scan from page one (search is debounced while typing).
  useEffect(() => {
    request.current++;
    const timer = setTimeout(() => {
      setLimit(REVEAL);
      if (!remote || !bounds) {
        setItems(withShort(initial, short));
        setNext(initial.next);
        setError("");
        setLoading(false);
      } else {
        setItems(PROMPT_REFERENCES);
        setNext(null);
        void fetchBatch(1, true);
      }
    }, remote && query.trim() ? 350 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);
  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.prompt ? cameoReferencePrompt(selected, agents?.find(a => a.mintAddress === mint)?.name ?? "cameo") : selected.videoUrl);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Copy unavailable. Select and copy the text below.");
    }
  }
  const estimate = selected
    ? estimateModelUsd(model, selected.duration, resolution)
    : null;
  return (
    <main className="explore-library min-h-full bg-[#181a1c] px-4 py-4 text-white sm:px-7 lg:px-9">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-[1600px]"
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
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
          <Button className={`h-10 ${GREEN}`} onClick={() => {
            setUploadedFile(undefined); setUploadError(""); setMediaError(false);
            setSelected({ id: "upload:new", title: "Replicate a Video", description: "Upload your video, add a prompt, and bring your Cameo influencer into the scene.", videoUrl: "", previewUrl: "", duration: 0, category: "Other" });
          }}><VideoStackIcon className="size-4" /> Replicate a Video</Button>
        </div>
        <h1 className="sr-only">Explore video references</h1>
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
            <ExploreSelect label="Length" value={length} onChange={setLength} options={LENGTHS} />
            <ExploreSelect label="Price" value={price} onChange={(v) => setPrice(v as typeof price)} options={[{ value: "any", label: "Any" }, { value: "u5", label: "Under $5" }, { value: "5-10", label: "$5 to $10" }, { value: "10-20", label: "$10 to $20" }, { value: "o20", label: "$20 and up" }]} />
            <ExploreSelect label="Sort" value={sort} onChange={setSort} options={SORTS} />
          <p className="text-sm font-medium tracking-tight text-white/50">
            <span className="tabular-nums text-white/80">
              {(initial.total + PROMPT_REFERENCES.length).toLocaleString()}
            </span>{" "}
            videos available
          </p>
          </div>
        </div>
        <div className="columns-2 gap-3 md:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
          {shown.map((item) => (
            <ReferenceCard
              key={item.id}
              item={item}
              saved={saved.includes(item.id)}
              onSave={() => toggleSave(item)}
              onOpen={() => openReference(item)}
              onSchedule={modelForReference(item).kind === "genjutsu" ? () => setScheduleItem(item) : undefined}
              estimate={referenceEstimate(item)}
            />
          ))}
        </div>
        {!visible.length && !loading && !next && (
          <div className="py-20 text-center">
            <Film className="mx-auto mb-3 size-8 text-zinc-600" />
            <p className="text-zinc-400">No references match these filters in the whole library.</p>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setCategory("All");
                setLength("any");
                setPrice("any");
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
        {/* End-of-grid marker: reveals more cards, then pulls the next batch from the library. */}
        <div ref={sentinel} aria-hidden className="h-px" />
        <div className="flex flex-col items-center gap-3 py-8">
          {(loading || (!visible.length && next)) && (
            <p role="status" className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="size-4 animate-spin" />
              {!visible.length ? "Searching the whole library…" : "Loading more…"}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}{" "}
              <button type="button" onClick={() => { setError(""); loadMore(); }} className="underline underline-offset-2 hover:text-red-300">Retry</button>
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            Filters search the whole library, and more loads as you scroll. Public references via{" "}
            <a
              href="https://higgsfield.ai/ai/video?model=genjutsu"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Higgsfield
            </a>
            , <a href="https://www.seedance2.tv/showcase" target="_blank" rel="noreferrer" className="underline">Seedance showcase</a>, <a href="https://replicate.com/xai/grok-imagine-video/examples" target="_blank" rel="noreferrer" className="underline">Grok</a> and <a href="https://deepmind.google/models/veo/" target="_blank" rel="noreferrer" className="underline">Veo</a>. Scene prompts are adapted for your Cameo character.
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
                onSchedule={modelForReference(item).kind === "genjutsu" ? () => setScheduleItem(item) : undefined}
                estimate={referenceEstimate(item)}
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
                {model.kind === "genjutsu" ? "Use this motion with your influencer." : "Recreate this scene with your Cameo character."}
              </DialogDescription>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  {customVideo && <label className="mb-4 flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-white/20 bg-white/5 p-6 text-center hover:bg-white/10">
                    <Upload className="size-6 text-[#d7ff00]" />
                    <span className="text-sm">{uploadedFile?.name || "Upload your own video"}</span>
                    <span className="text-xs text-zinc-400">4–30 seconds · up to 150 MB</span>
                    <input type="file" accept="video/*" disabled={generating} className="sr-only" aria-label="Upload your own video" onChange={e => {
                      const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
                      if (!file.type.startsWith("video/") || file.size > 150 * 1024 * 1024) { setUploadError("Choose a video under 150 MB."); return; }
                      setUploadError(""); setMediaError(false); setUploadedFile(file);
                      setSelected(current => current ? { ...current, id: `upload:${Date.now()}`, videoUrl: URL.createObjectURL(file), duration: 0 } : current);
                    }} />
                  </label>}
                  {uploadError && <p role="alert" className="mb-3 text-xs text-red-400">{uploadError}</p>}
                  {selected.videoUrl && <ReferencePlayer
                    key={selected.id}
                    src={selected.videoUrl}
                    poster={selected.thumbUrl}
                    aspectRatio={selected.width && selected.height ? `${selected.width} / ${selected.height}` : "9 / 16"}
                    onError={() => setMediaError(true)}
                    onMetadata={(info) =>
                      setSelected((current) =>
                        current?.id === selected.id
                          ? { ...current, width: info.width, height: info.height, duration: Number.isFinite(info.duration) ? info.duration : current.duration }
                          : current,
                      )
                    }
                    className="max-h-[56dvh]"
                  />}
                  {mediaError && (
                    <p role="alert" className="mt-3 text-xs text-red-400">
                      This original is unavailable from the source. Choose
                      another reference.
                    </p>
                  )}
                  <p className="mt-3 text-[11px] text-zinc-500">
                    {selected.prompt ? "Showcase reference" : "Original reference"} · {Math.round(selected.duration)}s
                    {selected.width && selected.height
                      ? ` · ${selected.width} × ${selected.height}`
                      : ""}
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                    {selected.description}
                  </p>
                  {selected.sourceUrl && (
                    <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-[#d7ff00]">
                      {selected.sourceName} <ArrowUpRight className="size-3" />
                    </a>
                  )}
                  {!customVideo && <div className="mt-3 flex gap-2">
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
                      {copied ? "Copied" : selected.prompt ? "Copy Cameo prompt" : "Copy original URL"}
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
                  }
                  {copyError && (
                    <>
                      <p role="alert" className="mt-2 text-xs text-red-400">
                        {copyError}
                      </p>
                      <Input
                        readOnly
                        value={selected.prompt ? cameoReferencePrompt(selected, agents?.find(a => a.mintAddress === mint)?.name ?? "cameo") : selected.videoUrl}
                        onFocus={(e) => e.target.select()}
                        aria-label="Reference text"
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
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-zinc-400">{model.label}</span>
                      <span className="text-zinc-500">{resolution}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-zinc-400">
                        Estimated generation{" "}
                        <span className="text-zinc-500">
                          · {model.kind === "engine" ? engineSeconds(model, selected.duration) : Math.ceil(selected.duration)}s
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
                  {mint && !mediaError && (!customVideo || !!uploadedFile) ? (
                    <Generator
                      key={`${mint}:${selected.id}`}
                      mint={mint}
                      primaryName={agents?.find((a) => a.mintAddress === mint)?.name ?? "Character"}
                      item={selected}
                      resolution={resolution}
                      mode={mode}
                      model={model}
                      xConnected={!!agents?.find((a) => a.mintAddress === mint)?.connectedPlatforms?.includes("x")}
                      onBusy={setGenerating}
                      uploadedFile={customVideo ? uploadedFile : undefined}
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
        resolution={resolution as GenjutsuResolution}
        onClose={() => setScheduleItem(null)}
      />
    </main>
  );
}
