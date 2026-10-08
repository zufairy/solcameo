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
  Wand2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { CATEGORIES, inCategory, type ReferenceVideo } from "@/lib/explore/feed";
import promptReferences from "@/lib/explore/prompt-references.json";
import { VideoStackIcon } from "./video-stack-icon";
import { AgentOption } from "./AgentOption";
import { payAndPost } from "@/lib/client/walletPaid";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ScheduleDialog, type GenMode } from "./ScheduleDialog";
import { BlurRevealVideo, RenderProgress } from "./RenderProgress";
import { DescribeVideoDialog } from "./DescribeVideoDialog";
import { ExploreSelect } from "./ExploreSelect";
import { ReferencePlayer } from "./ReferencePlayer";
import { referenceAffinity } from "@/lib/explore/recommendations";
import { castToken } from "@/lib/explore/castKey";
import { cameoReferencePrompt, modelForReference, referenceEstimate, engineSeconds, estimateModelUsd, EXPLORE_MODELS, type ExploreModel } from "@/lib/explore/models";
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
  priority = false,
}: {
  item: ReferenceVideo;
  saved: boolean;
  /** First cards on screen: load their image immediately. */
  priority?: boolean;
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
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={visible && imageReady ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 12 }}
      transition={{ duration: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
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
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
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
            preload={preview ? "auto" : "metadata"}
            onLoadedData={event => { if (!preview) event.currentTarget.currentTime = 0.01; }}
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
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
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
  onClose,
  uploadedFile,
  own = true,
  cameoPortrait,
}: {
  /** False for an influencer the viewer does not own: its public portrait is used and the viewer pays from their own wallet. */
  own?: boolean;
  cameoPortrait?: string;
  mint: string;
  primaryName: string;
  item: ReferenceVideo;
  resolution: string;
  mode: GenMode;
  model: ExploreModel;
  xConnected: boolean;
  onBusy: (busy: boolean) => void;
  onClose?: () => void;
  uploadedFile?: File;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [ownPortrait, setPortrait] = useState<string>();
  const [ownLoading, setLoading] = useState(true);
  const portrait = own ? ownPortrait : cameoPortrait;
  const loading = own ? ownLoading : false;
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const paidSig = useRef<string | undefined>(undefined);
  const [cameoRun, setCameoRun] = useState<{ status?: "pending" | "error"; url?: string; error?: string; paid?: boolean } | null>(null);
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
    | Record<string, { status: string; videoUrl?: string; error?: string; paid?: boolean }>
    | undefined;
  const engineState = engineTask ? engineStatus?.[engineTask] : undefined;
  const enginePaid = engineState?.paid === true;
  const engineRunning = engineStarting || (!!engineTask && (!engineState || engineState.status === "pending" || engineState.status === "running"));
  const genRun = own ? run : cameoRun ?? undefined;
  const busy = uploading || (model.kind === "genjutsu" ? genRun?.status === "pending" : engineRunning);
  const resultUrl = model.kind === "genjutsu" ? genRun?.url : engineState?.status === "succeeded" ? engineState.videoUrl : undefined;
  const failure = model.kind === "genjutsu" ? (genRun?.status === "error" ? genRun.error : "") : engineError || (engineState?.status === "failed" ? engineState.error || "Generation failed" : "");
  // The popup is locked only while the payment goes through. Once the render is queued it runs in the background, so the
  // popup can be closed and the video is waiting in My agents.
  // "Paying" lasts until the payment is on record. A render that carries no payment record (for example credit-funded)
  // is treated as under way after 25 seconds, so the popup never waits on a signal that will not come.
  const [payGaveUp, setPayGaveUp] = useState(false);
  const waitingOnPayment = model.kind === "genjutsu" ? genRun?.status === "pending" && !genRun?.paid : engineRunning && !enginePaid;
  useEffect(() => {
    if (!waitingOnPayment) { setPayGaveUp(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => setPayGaveUp(true), 25_000);
    return () => clearTimeout(timer);
  }, [waitingOnPayment]);
  const paying = uploading || engineStarting || (waitingOnPayment && !payGaveUp);
  const rendering = !paying && busy;
  useEffect(() => {
    onBusy(paying);
  }, [paying, onBusy]);
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
      // Not awaited: the charge and submission happen inside, and the run reports `paid` the moment they succeed, while this
      // function returns so the upload spinner does not outlive the payment.
      void start({ mode, videoUrl, imageUrls: [portrait, ...cast.map(c => c.avatarUrl)].slice(0, 8), prompt, resolution: resolution as GenjutsuResolution, title: item.title,
        ...(uploadedFile ? {} : { poster: item.thumbUrl, explore: { referenceId: item.id, referencePage: item.page, castTokens: [castToken(primaryName), ...cast.map(c => c.token)], autoPost: xConnected && autoPost } }),
      });
    } catch (e) { setUploadError(e instanceof Error ? e.message : "Could not upload your video"); }
    finally { setUploading(false); }
  }
  /** An influencer the viewer does not own: pay Solcameo from the viewer's wallet, then render with that influencer's portrait. */
  async function startCameo() {
    if (!portrait) return;
    setEngineError("");
    if (model.kind === "genjutsu") {
      setCameoRun({ status: "pending" });
      try {
        const { requestId } = await payAndPost<{ requestId: string }>({
          url: "/api/explore/cameo-motion", publicKey, signTransaction, pending: paidSig,
          payload: { cameoMint: mint, referenceId: item.id, referencePage: item.page, castTokens: [castToken(primaryName), ...cast.map((c) => c.token)], mode, resolution, prompt, extraImageUrls: cast.map((c) => c.avatarUrl) },
        });
        paidSig.current = undefined; // the render has started; this payment is spent
        setCameoRun({ status: "pending", paid: true });
        const t0 = Date.now();
        for (let delay = 2000; Date.now() - t0 < 15 * 60_000; delay = Math.min(delay + 500, 4000)) {
          await new Promise((r) => setTimeout(r, delay));
          const res = await fetch(`/api/explore/cameo-motion?id=${encodeURIComponent(requestId)}`);
          const r = (await res.json().catch(() => ({}))) as { status?: string; url?: string; error?: string };
          if (r.status === "completed" && r.url) { setCameoRun({ url: r.url }); return; }
          if (r.status && ["failed", "nsfw", "canceled"].includes(r.status)) { setCameoRun({ status: "error", error: r.status === "nsfw" ? "Blocked by content moderation" : r.error || "Generation failed. Click Generate to try again without paying again." }); return; }
        }
        setCameoRun({ status: "error", error: "Timed out. Click Generate to check again without paying again." });
      } catch (e) { setCameoRun({ status: "error", error: e instanceof Error ? e.message : "Generation failed" }); }
      return;
    }
    if (!model.engine) return;
    setEngineStarting(true); setEngineTask(null);
    try {
      const data = await payAndPost<{ taskId?: string }>({
        url: "/api/explore/describe", publicKey, signTransaction, pending: paidSig,
        payload: { cameoMint: mint, prompt: (prompt.trim() || `${item.title}. ${item.description}`).slice(0, 900), videoEngine: model.engine, quality: resolution, seconds: engineSeconds(model, item.duration), aspect: "9:16" },
      });
      if (!data.taskId) throw new Error("The video could not start.");
      paidSig.current = undefined;
      setEngineTask(data.taskId as Id<"agentTasks">);
    } catch (e) { setEngineError(e instanceof Error ? e.message : "Could not start the render"); }
    finally { setEngineStarting(false); }
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
            // Exactly what is in the prompt box and exactly the reference length: no script rewrite, no persona, no storyboard,
            // no burned overlays.
            skipStoryboard: true,
            noPersona: true,
            exactOutput: true,
            ...(cast.some((c) => !c.self) ? { mentionRefImageUrls: cast.filter((c) => !c.self).map((c) => c.avatarUrl).slice(0, 2), mentionCast: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}),
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
    if (!own) return; // someone else's influencer uses its public portrait, passed in
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
  }, [mint, own]);
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
            <p className="text-sm text-white">{own ? "Your saved character" : `${primaryName}, paid from your wallet`}</p>
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
      {(paying || rendering) && (
        <RenderProgress stage={paying ? "paying" : "rendering"} poster={item.thumbUrl} amount={estimate !== null ? formatGenerationUsd(estimate) : undefined} agentName={primaryName} onClose={onClose} />
      )}
      <Button
        className={`h-11 w-full ${GREEN}`}
        disabled={
          !portrait || loading || busy || estimate === null || (!own && !!uploadedFile)
        }
        onClick={() =>
          !own ? void startCameo() : model.kind === "engine"
            ? void startEngine()
            : void startMotion()
        }
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {paying ? "Paying…" : "Rendering…"}
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
        {own
          ? <>{estimate !== null ? `${formatGenerationUsd(estimate)} is charged from this agent's wallet and includes the Solcameo fee (15% or $1, whichever is higher). ` : ""}
            Once paid, the render runs in the background and the finished video appears in My agents. {model.kind === "genjutsu" ? "It is also saved to your agent’s motion library." : ""}{autoPost && xConnected ? " It will be posted to X automatically." : ""}</>
          : <>{estimate !== null ? `${formatGenerationUsd(estimate)} is paid in USDC from your own wallet to Solcameo, fee included. ` : ""}{primaryName} is not yours, so the video is made for you and shown here. Keep this window open until it finishes.</>}
      </p>
      {(failure || uploadError) && (
        <p role="alert" className="text-sm text-red-400">
          {failure || uploadError}
        </p>
      )}
      {resultUrl && (
        <div>
          <p className="mb-2 text-xs text-[#d7ff00]">Your latest generation</p>
          <BlurRevealVideo src={resultUrl} poster={item.thumbUrl} />
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

/** Which model a reference is for. "genjutsu" shows every Genjutsu reference (motion transfer and object swap). */
const MODEL_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "any", label: "Any" },
  { value: "genjutsu", label: "Genjutsu" },
  ...EXPLORE_MODELS.filter((m) => m.kind === "engine").map((m) => ({ value: m.id, label: m.label })),
];
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

export function ExplorePage({ initial, short, fixedMint, persona = "", embedded = false }: { initial: Feed; short?: Short; fixedMint?: string; persona?: string; embedded?: boolean }) {
  const [items, setItems] = useState(() => withShort(initial, short));
  // The bundled index records the next FEED PAGE; the indexed library is addressed by position (48 rows per page).
  const firstCursor = initial.next ? (initial.next - 1) * 48 + 1 : null;
  const [next, setNext] = useState(firstCursor);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saved, setSaved] = useState<string[]>([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<ReferenceVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  function chooseVideo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setUploadError("That file is not a video. Choose an MP4, MOV or WebM."); return; }
    if (file.size > 150 * 1024 * 1024) { setUploadError("Choose a video under 150 MB."); return; }
    setUploadError(""); setMediaError(false); setUploadedFile(file);
    setSelected(current => current ? { ...current, id: `upload:${Date.now()}`, videoUrl: URL.createObjectURL(file), duration: 0 } : current);
  }
  const [uploadError, setUploadError] = useState("");
  const [selected, setSelected] = useState<ReferenceVideo | null>(null);
  const customVideo = selected?.id.startsWith("upload:") ?? false;
  useEffect(() => {
    const url = customVideo ? selected?.videoUrl : undefined;
    return () => { if (url?.startsWith("blob:")) URL.revokeObjectURL(url); };
  }, [customVideo, selected?.videoUrl]);
  const [mint, setMint] = useState(fixedMint ?? "");
  const [generating, setGenerating] = useState(false);
  const [price, setPrice] = useState<"any" | "u5" | "5-10" | "10-20" | "o20">("any");
  const [length, setLength] = useState("any");
  const [modelFilter, setModelFilter] = useState("any");
  const [sort, setSort] = useState("trending");
  const model = modelForReference(selected);
  const resolution = model.defaultQuality;
  // Price is evaluated per card because each source uses its own generation model.
  const bounds = LENGTH_BOUNDS[length] ?? LENGTH_BOUNDS.any;
  // Everything the library can answer is filtered and sorted on the server over the whole library, so each page is full
  // of real matches instead of the client walking thousands of non-matching rows to fill the screen.
  const remote = !!query.trim() || category !== "All" || (!!bounds && (bounds.min > 0 || bounds.max > 0)) || price !== "any" || sort !== "trending";
  const filterKey = `${query.trim().toLowerCase()}|${category}|${bounds ? `${bounds.min}-${bounds.max}` : "none"}|${price}|${sort}`;
  // The downloaded library only holds Genjutsu references; other models live in the built-in prompt list, so do not keep walking it.
  const libraryIsGenjutsuOnly = modelFilter !== "any" && modelFilter !== "genjutsu";
  const [limit, setLimit] = useState(REVEAL);
  const sentinel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const batches = useRef(new Map<string, Promise<Feed & { error?: string }>>());
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
  const ownedAgents = useQuery(
    api.influencers.listByCreators,
    wallets.length ? { creatorWallets: wallets, liveNetwork: "mainnet" } : "skip",
  );
  const agents = fixedMint ? ownedAgents?.filter(a => a.mintAddress === fixedMint) : ownedAgents;
  // Anyone's influencer can be cameoed: yours bill the agent's wallet, anyone else's is paid for from the viewer's wallet.
  const everyone = useQuery(api.influencers.listSearchable, selected && !fixedMint ? { liveNetwork: "mainnet" } : "skip");
  const ownedMints = new Set((ownedAgents ?? []).map(a => a.mintAddress));
  const others = (everyone ?? []).filter(a => !ownedMints.has(a.mintAddress) && a.avatarUrl).slice(0, 300);
  const cameoAgent = mint && !ownedMints.has(mint) ? (everyone ?? []).find(a => a.mintAddress === mint) : undefined;
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
  const inModel = (i: ReferenceVideo) => {
    if (modelFilter === "any") return true;
    const m = modelForReference(i);
    return modelFilter === "genjutsu" ? m.kind === "genjutsu" : m.id === modelFilter;
  };
  const inLength = (i: ReferenceVideo) => {
    const d = i.duration;
    return length === "any" || (length === "u5" ? d < 5 : length === "5-10" ? d >= 5 && d < 10 : length === "10-20" ? d >= 10 && d < 20 : d >= 20);
  };
  const affinity = useMemo(() => new Map(items.map(item => [item.id, referenceAffinity(item, persona)])), [items, persona]);
  const visible = items
    .filter(
      (i) =>
        (!embedded || referenceEstimate(i) !== null) &&
        inPrice(i) &&
        inLength(i) &&
        inModel(i) &&
        (category === "Trending" || inCategory(i, category)) &&
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
          : (affinity.get(b.id) ?? 0) - (affinity.get(a.id) ?? 0),
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
        else if (next && !loading && !error && !libraryIsGenjutsuOnly) loadMore();
      },
      { rootMargin: "2400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, visible.length, next, loading, error, filterKey, libraryIsGenjutsuOnly]);
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
  /**
   * Batches are requested once and remembered, and the batch AFTER the one on screen is always fetched in the
   * background (with its first thumbnails decoded into the browser cache), so scrolling never waits on the network.
   */
  function loadBatch(cursor: number): Promise<Feed & { error?: string }> {
    const params = new URLSearchParams({ cursor: String(cursor) });
    if (remote && bounds) {
      if (price !== "any") params.set("price", price);
      if (sort !== "trending") params.set("sort", sort);
      if (query.trim()) params.set("q", query.trim());
      if (category !== "All") params.set("category", category);
      if (bounds.min > 0) params.set("min", String(bounds.min));
      if (bounds.max > 0) params.set("max", String(bounds.max));
    }
    const key = params.toString();
    let hit = batches.current.get(key);
    if (!hit) {
      if (batches.current.size > 24) batches.current.clear();
      hit = fetch(`/api/explore?${key}`).then(async (res) => {
        const d: Feed & { error?: string } = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Unable to load references");
        return d;
      });
      batches.current.set(key, hit);
      hit.catch(() => batches.current.delete(key));
    }
    return hit;
  }
  function prefetchAfter(d: Feed) {
    if (!d.next) return;
    void loadBatch(d.next).then((upcoming) => {
      for (const item of upcoming.items.slice(0, 16)) if (item.thumbUrl) { const img = new Image(); img.decoding = "async"; img.src = item.thumbUrl; }
    }).catch(() => undefined);
  }
  async function fetchBatch(cursor: number, reset: boolean) {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const d = await loadBatch(cursor);
      if (id !== request.current) return; // a newer filter change superseded this request
      setItems((prev) => {
        const base = reset ? PROMPT_REFERENCES : prev;
        const ids = new Set(base.map((i) => i.id));
        return [...base, ...d.items.filter((i) => !ids.has(i.id))];
      });
      setNext(d.next && d.next > cursor ? d.next : null);
      prefetchAfter(d);
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
  // Warm the first batch past the built-in index so the first long scroll never waits.
  useEffect(() => {
    if (firstCursor) prefetchAfter({ ...initial, next: firstCursor, items: [] } as Feed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    request.current++;
    const timer = setTimeout(() => {
      setLimit(REVEAL);
      if (!remote || !bounds) {
        setItems(withShort(initial, short));
        setNext(firstCursor);
        setError("");
        setLoading(false);
      } else {
        // Keep the current cards on screen until the first filtered page arrives, so changing a filter never blanks the grid.
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
    <main className={`explore-library min-h-full px-4 py-4 text-white sm:px-7 lg:px-9 ${embedded ? "bg-transparent" : "bg-[#181a1c]"}`}>
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
          <Button
            variant="outline"
            onClick={() => setDescribeOpen(true)}
            className="h-10 rounded-lg border-white/10 bg-white/[0.04] text-white/80 backdrop-blur-xl hover:bg-white/10"
          ><Wand2 className="size-4" /> Describe your video</Button>
        </div>
        <h1 className="sr-only">{embedded ? "Video suggestions for your influencer" : "Explore video references"}</h1>
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
            <ExploreSelect label="Model" value={modelFilter} onChange={setModelFilter} options={MODEL_FILTERS} />
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
          {shown.map((item, index) => (
            <ReferenceCard
              key={item.id}
              priority={index < 8}
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
                setModelFilter("any");
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
                  {customVideo && <label
                    onDragOver={e => { if (!generating && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={e => { e.preventDefault(); setDragging(false); if (!generating) chooseVideo(e.dataTransfer.files?.[0]); }}
                    className={`mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 text-left transition-colors ${dragging ? "border-[#d7ff00] bg-[#d7ff00]/10" : uploadedFile ? "border-white/15 bg-white/[0.04] hover:bg-white/[0.07]" : "flex-col border-white/20 bg-white/5 p-6 text-center hover:bg-white/10"} ${generating ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-white/15 bg-black/30 text-[#d7ff00]"><Upload className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{uploadedFile ? uploadedFile.name : dragging ? "Drop your video" : "Upload or drop your own video"}</span>
                      <span className="block text-xs text-zinc-400">{uploadedFile ? `${(uploadedFile.size / 1048576).toFixed(1)} MB · click to replace` : "MP4, MOV or WebM · 4–30 seconds · up to 150 MB"}</span>
                    </span>
                    <input type="file" accept="video/mp4,video/quicktime,video/webm,video/*" disabled={generating} className="sr-only" aria-label="Upload your own video" onChange={e => { chooseVideo(e.target.files?.[0]); e.target.value = ""; }} />
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
                      disabled={generating || !!fixedMint}
                      value={mint}
                      onValueChange={(value) => setMint(value ?? "")}
                    >
                      <SelectTrigger
                        aria-label="Your influencer"
                        className="mt-2 h-[68px] w-full border-white/10 bg-white/5 px-2.5 text-white"
                      >
                        <SelectValue placeholder="Choose an influencer">
                          {(value: string | null) => {
                            const o = others.find((x) => x.mintAddress === value);
                            if (o) return <AgentOption large name={o.name} ticker={o.ticker} avatarUrl={o.avatarUrl} />;
                            const a = agents?.find((x) => x.mintAddress === value);
                            return a ? <AgentOption large name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(22rem,var(--available-height))] border-white/10 bg-[#17191d] p-1.5 text-white">
                        {!!agents?.length && <SelectGroup><SelectLabel className="px-2 pt-1 text-[11px] text-zinc-500">Yours · paid from the agent&apos;s wallet</SelectLabel>
                          {agents.map((a) => (
                            <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[68px] py-2 pl-2">
                              <AgentOption large name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} />
                            </SelectItem>
                          ))}</SelectGroup>}
                        {!fixedMint && others.length > 0 && <SelectGroup><SelectLabel className="px-2 pt-2 text-[11px] text-zinc-500">Anyone else · you pay from your wallet</SelectLabel>
                          {others.map((a) => (
                            <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[68px] py-2 pl-2">
                              <AgentOption large name={a.name} ticker={a.ticker} avatarUrl={a.avatarUrl} />
                            </SelectItem>
                          ))}</SelectGroup>}
                      </SelectContent>
                    </Select>
                  </label>
                  {mint && !mediaError && (!customVideo || !!uploadedFile) ? (
                    <Generator
                      key={`${mint}:${selected.id}`}
                      mint={mint}
                      primaryName={agents?.find((a) => a.mintAddress === mint)?.name ?? cameoAgent?.name ?? "Character"}
                      own={!cameoAgent}
                      cameoPortrait={cameoAgent?.avatarUrl}
                      item={selected}
                      resolution={resolution}
                      mode={mode}
                      model={model}
                      xConnected={!!agents?.find((a) => a.mintAddress === mint)?.connectedPlatforms?.includes("x")}
                      onBusy={setGenerating}
                      onClose={() => setSelected(null)}
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
      <DescribeVideoDialog
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        agents={agents?.map((a) => ({ mintAddress: a.mintAddress, name: a.name, coinTicker: a.coinTicker, avatarUrl: a.avatarUrl, agentWallet: a.agentWallet, videoEngine: a.videoEngine, connectedPlatforms: a.connectedPlatforms }))}
        defaultMint={fixedMint}
      />
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
