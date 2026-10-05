"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Sparkles, Link as LinkIcon, ImagePlus, Loader2, X, ArrowRight, ChevronLeft, ChevronRight,
  Copy, Check, RotateCcw, Download, Images, PenLine, LayoutGrid,
} from "lucide-react";
import { AppHeaderShell } from "@/components/home/app-shell";
import { unionWalletAddresses } from "@/lib/solana/activeWallet";
import { ConnectedPlatformStack } from "@/components/social/platform-icons";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

/* ════════ /carousel — standalone Photo Carousel app ════════
   One prompt → ideation → auto-generated carousel + caption. Not tied to any
   AI-influencer agent/mintAddress — a per-USER tool (Privy login only). Dark,
   premium-app theme (near-black canvas, soft glass cards, dashed upload well,
   label/value "field" rows with a trailing chevron) — same visual language as
   /recreate's RecreateApp.tsx and the /agents header (thin white title, no
   icon/subtitle) so the two standalone apps read as one system. */

const BG = "#08080a";
const INTER = { fontFamily: "var(--font-inter, var(--font-geist-sans, system-ui))" } as const;

const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-[13.5px] " +
  "font-semibold text-black outline-none transition-all duration-200 hover:bg-white/90 " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30";

const PILL =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 " +
  "bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-white/75 " +
  "transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30";

const CARD = "rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.9)]";

/** Engines offered for the carousel render — ids from lib/builder/imageEngines
 *  (the single list the server resolves against), so the picker can never offer
 *  a model the backend can't call. */
const ENGINES = [
  { id: "nano-banana-2", label: "Nano Banana 2" },
  { id: "nano-banana-2-lite", label: "Nano Banana 2 Lite" },
  { id: "gpt-image-2", label: "ChatGPT Image 2" },
] as const;
type EngineId = (typeof ENGINES)[number]["id"];

const STYLES = [
  { id: "ugc", label: "UGC review" },
  { id: "tutorial", label: "Tutorial / how-to" },
  { id: "listicle", label: "Listicle" },
  { id: "before_after", label: "Before / after" },
  { id: "quote", label: "Quote / motivational" },
  { id: "product_showcase", label: "Product showcase" },
] as const;
type StyleId = (typeof STYLES)[number]["id"];

const HOW_IT_WORKS = [
  { Icon: PenLine, title: "Describe your idea", body: "Type a prompt, drop a website link, or attach a reference image and style." },
  { Icon: LayoutGrid, title: "Pick a concept", body: "AI proposes 3 distinct carousel angles with slide-by-slide prompts. Pick one." },
  { Icon: Images, title: "Auto-generated for you", body: "Every slide renders and a caption is written, ready to post." },
] as const;

interface IdeaSlide { prompt: string }
interface Idea { title: string; hook: string; slides: IdeaSlide[] }
type ProjectSlide = { prompt: string; imageUrl?: string; status: "pending" | "generated" | "failed"; error?: string };
type Project = {
  _id: Id<"carouselProjects">;
  title: string;
  hook: string;
  caption?: string;
  slides: ProjectSlide[];
  status: "generating" | "ready" | "failed";
};

type Stage = "ideate" | "generating" | "result";

/** Label-on-top / value-below field with a trailing chevron — the "FPS / Resolution"
 *  picker look. Wraps a real <select> (appearance:none) so it's still a native,
 *  accessible dropdown — just skinned to match. */
function FieldSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { id: string; label: string }[];
}) {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full appearance-none bg-transparent pr-6 text-[15px] font-semibold text-white outline-none [&>option]:bg-neutral-900"
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ChevronRight className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-white/30" />
    </div>
  );
}

export function CarouselApp() {
  const { user, authenticated, login } = usePrivy();
  const ownerId = user?.id;

  // ── Agent to publish through (title-row dropdown) ─────────────────────────
  // The user's minted agents, keyed by every wallet linked to the account (the
  // same union /studio uses — a single-wallet lookup misses multi-wallet
  // owners). Posting goes through the SELECTED agent's upload-post profile.
  const { profile } = useSupabaseAuth();
  const creatorWallets = useMemo(() => unionWalletAddresses(profile?.walletAddresses, null), [profile?.walletAddresses]);
  const myAgents = useQuery(
    api.influencers.listByCreators,
    creatorWallets.length ? { creatorWallets } : "skip",
  ) as { mintAddress: string; name: string }[] | undefined;
  const [agentMint, setAgentMint] = useState<string>("");
  useEffect(() => {
    // Default to the first agent once loaded (keeps an explicit pick sticky).
    if (!agentMint && myAgents?.length) setAgentMint(myAgents[0].mintAddress);
  }, [myAgents, agentMint]);

  // ── Publish state (result view + history modal) ───────────────────────────
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  // Editable caption per project — publishing sends the EDITED text, not the
  // generated one. Keyed by project id so the result view and the history
  // modal each keep their own draft.
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const draftFor = (proj: Project | null | undefined): string =>
    proj ? (captionDrafts[proj._id] ?? proj.caption ?? "") : "";
  const setDraftFor = (proj: Project, text: string) =>
    setCaptionDrafts((d) => ({ ...d, [proj._id]: text }));

  // Connected accounts of the SELECTED agent — shown as platform chips beside
  // Publish and reused as the publish target list (live upload-post truth).
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  useEffect(() => {
    if (!agentMint) { setConnectedPlatforms([]); return; }
    let alive = true;
    fetch(`/api/social/status?username=${encodeURIComponent(agentMint)}`)
      .then((r) => r.json())
      .then((j: { connected?: Record<string, unknown | null> }) => {
        if (!alive) return;
        const PHOTO_CAPABLE = ["tiktok", "instagram", "threads", "facebook", "x", "linkedin", "bluesky", "pinterest"];
        setConnectedPlatforms(PHOTO_CAPABLE.filter((p) => j.connected?.[p]));
      })
      .catch(() => { if (alive) setConnectedPlatforms([]); });
    return () => { alive = false; };
  }, [agentMint]);

  // Download every rendered slide as ONE zip (client-side, fflate).
  const [zipping, setZipping] = useState(false);
  const downloadAllZip = useCallback(async (proj: Project | null | undefined) => {
    if (!proj || zipping) return;
    const imgs = proj.slides.filter((s) => s.imageUrl).map((s) => s.imageUrl!);
    if (imgs.length === 0) return;
    setZipping(true);
    try {
      const { zipSync } = await import("fflate");
      const entries: Record<string, Uint8Array> = {};
      await Promise.all(imgs.map(async (url, i) => {
        const buf = await (await fetch(url)).arrayBuffer();
        const ext = /png/i.test(url) ? "png" : "jpg";
        entries[`slide-${String(i + 1).padStart(2, "0")}.${ext}`] = new Uint8Array(buf);
      }));
      const zipped = zipSync(entries, { level: 0 }); // images are already compressed
      const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(proj.title || "carousel").replace(/[^\w-]+/g, "-").slice(0, 40)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      /* per-slide links below remain the fallback */
    } finally {
      setZipping(false);
    }
  }, [zipping]);
  const publishCarousel = useCallback(async (proj: Project | null | undefined) => {
    if (!proj || publishing) return;
    const imgs = proj.slides.filter((s) => s.imageUrl).map((s) => s.imageUrl!) ;
    if (!agentMint) { setPublishMsg("Pick an agent (top right) with connected socials first."); return; }
    if (imgs.length === 0) { setPublishMsg("No rendered slides to post."); return; }
    setPublishing(true);
    setPublishMsg(null);
    try {
      // The pre-fetched connected list drives the chips beside the button; a
      // fresh fetch here covers the "connected since page load" case.
      let platforms = connectedPlatforms;
      if (platforms.length === 0) {
        const st = await fetch(`/api/social/status?username=${encodeURIComponent(agentMint)}`);
        const sj = (await st.json().catch(() => ({}))) as { ok?: boolean; connected?: Record<string, unknown | null> };
        const PHOTO_CAPABLE = ["tiktok", "instagram", "threads", "facebook", "x", "linkedin", "bluesky", "pinterest"];
        platforms = PHOTO_CAPABLE.filter((p) => sj.connected?.[p]);
        setConnectedPlatforms(platforms);
      }
      if (platforms.length === 0) { setPublishMsg("This agent has no connected accounts. Connect socials in the builder first."); return; }
      // The EDITED caption wins — what's in the field is what gets posted.
      const caption = (captionDrafts[proj._id] ?? proj.caption ?? "").trim();
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: agentMint,
          platforms,
          type: "photo",
          title: proj.title || "New photo carousel",
          description: caption || undefined,
          mediaUrls: imgs,
          // DIRECT_POST publishes immediately; auto_add_music lets TikTok lay
          // its automatic sound under the photo carousel (same flag the builder
          // Carousel app uses — lib/server/uploadPost.ts forwards it).
          postMode: "DIRECT_POST",
          autoAddMusic: true,
          photoCoverIndex: 0,
          mediaType: "IMAGE",
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; posted?: string[]; error?: string };
      if (res.ok && j.ok) setPublishMsg(`✅ Posted to ${(j.posted ?? platforms).join(", ")}`);
      else setPublishMsg(`Post failed: ${j.error ?? `HTTP ${res.status}`}`);
    } catch (e) {
      setPublishMsg(`Post failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setPublishing(false);
    }
  }, [agentMint, publishing, connectedPlatforms, captionDrafts]);

  const [stage, setStage] = useState<Stage>("ideate");

  // ── Ideation inputs ──────────────────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteDevice, setWebsiteDevice] = useState<"web" | "app" | "product">("web");
  const [engineId, setEngineId] = useState<EngineId>("nano-banana-2");
  const [websiteScreenshotUrl, setWebsiteScreenshotUrl] = useState<string | null>(null);
  // Product mode: product photo the server crawled off the website (vision-picked)
  // — forwarded to generation as a KIE reference so slides show the real product.
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [style, setStyle] = useState<StyleId>("ugc");
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const canGenerate = authenticated && prompt.trim().length > 0 && !thinking;

  const uploadRefImage = useCallback(async (file: File) => {
    setRefUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (url) setRefImageUrl(url);
      else setError("Could not upload reference image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setRefUploading(false);
    }
  }, [generateUploadUrl, resolveStorageUrl]);

  const generateIdeas = useCallback(async () => {
    if (!canGenerate) return;
    setThinking(true);
    setError(null);
    setIdeas(null);
    setExpanded(null);
    setWebsiteScreenshotUrl(null);
    setProductImageUrl(null);
    try {
      const res = await fetch("/api/carousel-app/ideate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          websiteUrl: websiteUrl.trim() || undefined,
          websiteDevice,
          referenceImageUrl: refImageUrl || undefined,
          style,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ideas?: Idea[]; websiteScreenshotUrl?: string | null; productImageUrl?: string | null };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `Idea generation failed (HTTP ${res.status})`);
        return;
      }
      setIdeas(j.ideas ?? []);
      setWebsiteScreenshotUrl(j.websiteScreenshotUrl ?? null);
      setProductImageUrl(j.productImageUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setThinking(false);
    }
  }, [canGenerate, prompt, websiteUrl, websiteDevice, refImageUrl, style]);

  // ── Auto-generation ──────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState<Id<"carouselProjects"> | null>(null);
  const project = useQuery(api.carouselProjects.get, projectId ? { id: projectId } : "skip") as Project | null | undefined;

  const commitIdea = useCallback(async (idea: Idea) => {
    setStage("generating");
    setError(null);
    try {
      const res = await fetch("/api/carousel-app/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style,
          engineId,
          websiteUrl: websiteUrl.trim() || undefined,
          websiteDevice,
          referenceImageUrl: refImageUrl || undefined,
          websiteScreenshotUrl: websiteScreenshotUrl || undefined,
          productImageUrl: productImageUrl || undefined,
          title: idea.title,
          hook: idea.hook,
          slides: idea.slides,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; projectId?: string };
      if (!res.ok || !j.ok || !j.projectId) {
        setError(j.error ?? `Generation failed (HTTP ${res.status})`);
        setStage("ideate");
        return;
      }
      setProjectId(j.projectId as Id<"carouselProjects">);
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
      setStage("ideate");
    }
  }, [prompt, style, engineId, websiteUrl, websiteDevice, refImageUrl, websiteScreenshotUrl, productImageUrl]);

  const reset = useCallback(() => {
    setStage("ideate");
    setIdeas(null);
    setExpanded(null);
    setProjectId(null);
    setError(null);
    setWebsiteScreenshotUrl(null);
    setProductImageUrl(null);
  }, []);

  // ── History (past projects for this user) ───────────────────────────────
  const history = useQuery(
    api.carouselProjects.listByOwner,
    ownerId ? { ownerId } : "skip",
  ) as Project[] | undefined;

  // A history card opens IN A MODAL (not by swapping the whole page into the
  // result stage — that read as navigating away and lost the scroll position).
  const [historyId, setHistoryId] = useState<Id<"carouselProjects"> | null>(null);
  const historyProject = useQuery(api.carouselProjects.get, historyId ? { id: historyId } : "skip") as Project | null | undefined;
  useEffect(() => {
    if (!historyId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHistoryId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyId]);

  const [captionCopied, setCaptionCopied] = useState(false);
  const copyCaption = useCallback(() => {
    // Copy what's IN THE FIELD (the edited draft), not the original generation.
    const text = project ? (captionDrafts[project._id] ?? project.caption ?? "") : "";
    if (!text.trim()) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 1500);
    });
  }, [project, captionDrafts]);

  const doneCount = useMemo(() => project?.slides.filter((s) => s.status !== "pending").length ?? 0, [project]);
  const totalCount = project?.slides.length ?? 0;

  if (!authenticated) {
    return (
      <AppHeaderShell>
        <div className="grid min-h-full place-items-center px-8 py-10" style={{ background: BG, ...INTER }}>
          <div className={`${CARD} text-center`}>
            <h2 className="text-[26px] font-thin tracking-tight text-white">Photo Carousel</h2>
            <p className="mt-1.5 text-[13.5px] text-white/40">Sign in to ideate and generate a carousel.</p>
            <button type="button" onClick={login} className={`${PRIMARY_BTN} mt-4`}>Sign in</button>
          </div>
        </div>
      </AppHeaderShell>
    );
  }

  return (
    <AppHeaderShell>
    <div className="min-h-full px-8 py-10" style={{ background: BG, ...INTER }}>
      <div className="mx-auto max-w-[900px]">
        <div className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-2.5 text-[26px] font-thin tracking-tight text-white">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <Images className="size-4.5 text-white/80" strokeWidth={1.75} />
            </span>
            Photo Carousel
          </h1>
          <div className="flex items-center gap-2">
            {/* Which agent's connected socials publish this carousel */}
            {myAgents && myAgents.length > 0 && (
              <div className="relative inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05]">
                <select
                  value={agentMint}
                  onChange={(e) => setAgentMint(e.target.value)}
                  title="Agent whose connected accounts this carousel posts to"
                  className="appearance-none bg-transparent py-2 pl-3.5 pr-8 text-[12.5px] font-medium text-white/75 outline-none [&>option]:bg-neutral-900"
                >
                  {myAgents.map((a) => <option key={a.mintAddress} value={a.mintAddress}>{a.name}</option>)}
                </select>
                <ChevronRight className="pointer-events-none absolute right-2.5 size-3.5 rotate-90 text-white/30" />
              </div>
            )}
            {stage !== "ideate" && (
              <button type="button" onClick={reset} className={PILL}>
                <RotateCcw className="size-3.5" /> New idea
              </button>
            )}
          </div>
        </div>

        {/* ── Stage: ideate ────────────────────────────────────────────────── */}
        {stage === "ideate" && (
          <>
            <div className={`mt-6 ${CARD}`}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. a carousel about our new matcha protein powder, energetic and playful…"
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-[14px] text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
                  <LinkIcon className="size-4 shrink-0 text-white/30" />
                  <input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="Website link (optional)"
                    className="w-full min-w-0 bg-transparent text-[13.5px] text-white placeholder:text-white/30 focus:outline-none"
                  />
                  <div className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.04] p-0.5">
                    {(["web", "app", "product"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setWebsiteDevice(d)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${websiteDevice === d ? "bg-white text-black" : "text-white/45 hover:text-white/70"}`}
                      >
                        {websiteDevice === d && <Check className="size-3" />}
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <FieldSelect label="Style" value={style} onChange={(v) => setStyle(v as StyleId)} options={STYLES} />
              </div>
              {websiteScreenshotUrl && (
                <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1 pl-1 pr-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={websiteScreenshotUrl} alt="Website screenshot" className="size-9 rounded-lg object-cover" />
                  <span className="text-[12px] text-white/50">Screenshot captured, used as a reference image</span>
                  {productImageUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={productImageUrl} alt="Product" className="ml-2 size-9 rounded-lg object-cover ring-1 ring-emerald-400/40" />
                      <span className="text-[12px] text-emerald-300/80">Product photo found on the site. Slides will feature it</span>
                    </>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                {refImageUrl ? (
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1 pl-1 pr-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={refImageUrl} alt="Reference" className="size-9 rounded-lg object-cover" />
                    <span className="text-[12.5px] text-white/70">Reference attached</span>
                    <button type="button" onClick={() => setRefImageUrl(null)} className="rounded p-0.5 text-white/40 hover:text-white">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className={`${PILL} cursor-pointer`}>
                    {refUploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                    {refUploading ? "Uploading…" : websiteDevice === "product" ? "Upload product photo" : "Upload reference image"}
                    <input type="file" accept="image/*" className="hidden" disabled={refUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadRefImage(f); e.target.value = ""; }} />
                  </label>
                )}
                <button type="button" disabled={!canGenerate} onClick={() => void generateIdeas()} className={`${PRIMARY_BTN} ml-auto`}>
                  {thinking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {thinking ? "Thinking…" : "Generate ideas"}
                </button>
              </div>
              {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}
            </div>

            {ideas && ideas.length > 0 && (
              <div className="mt-6 space-y-3">
                {expanded === null ? (
                  <div className="grid gap-3.5 sm:grid-cols-3">
                    {ideas.map((idea, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setExpanded(i)}
                        className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
                      >
                        <span className="w-fit rounded-full bg-white/[0.08] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white/50">
                          {STYLES.find((s) => s.id === style)?.label ?? style}
                        </span>
                        <h4 className="mt-2.5 text-[15px] font-semibold leading-snug text-white">{idea.title}</h4>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">{idea.hook}</p>
                        <span className="mt-3 text-[12px] font-medium text-white/35">{idea.slides.length} slides →</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setExpanded(null)} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white">
                        <ChevronLeft className="size-4" />
                      </button>
                      <h4 className="text-[16px] font-semibold text-white">{ideas[expanded].title}</h4>
                    </div>
                    <p className="mt-1 ml-9 text-[13px] text-white/45">{ideas[expanded].hook}</p>
                    <div className="mt-4 ml-9 grid gap-2.5 sm:grid-cols-2">
                      {ideas[expanded].slides.map((s, i) => (
                        <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/35">Slide {i + 1}</span>
                          <textarea
                            value={s.prompt}
                            onChange={(e) => {
                              const next = [...ideas];
                              next[expanded] = { ...next[expanded], slides: next[expanded].slides.map((sl, j) => (j === i ? { prompt: e.target.value } : sl)) };
                              setIdeas(next);
                            }}
                            rows={3}
                            className="mt-1 w-full resize-none bg-transparent text-[12.5px] leading-snug text-white/80 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 ml-9 flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => void commitIdea(ideas[expanded])} className={PRIMARY_BTN}>
                        Generate this carousel <ArrowRight className="size-4" />
                      </button>
                      <div className="relative inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05]">
                        <select
                          value={engineId}
                          onChange={(e) => setEngineId(e.target.value as EngineId)}
                          title="Image engine used to render every slide"
                          className="appearance-none bg-transparent py-2.5 pl-3.5 pr-8 text-[12.5px] font-medium text-white/75 outline-none [&>option]:bg-neutral-900"
                        >
                          {ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                        <ChevronRight className="pointer-events-none absolute right-2.5 size-3.5 rotate-90 text-white/30" />
                      </div>
                      <span className="text-[12px] text-white/35">Renders every slide + suggests a caption automatically.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Stage: generating / result ──────────────────────────────────── */}
        {(stage === "generating" || stage === "result") && project && (
          <div className="mt-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold text-white">{project.title}</h3>
                  <p className="text-[13px] text-white/45">{project.hook}</p>
                </div>
                {project.status === "generating" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-[12px] font-medium text-white/60">
                    <Loader2 className="size-3.5 animate-spin" /> {doneCount}/{totalCount} slides
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {project.slides.map((s, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                    <div className="flex aspect-[9/16] items-center justify-center bg-white/[0.02]">
                      {s.status === "pending" ? (
                        <Loader2 className="size-5 animate-spin text-white/25" />
                      ) : s.status === "failed" ? (
                        <span className="px-3 text-center text-[11px] text-red-400">{s.error ?? "failed"}</span>
                      ) : s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt={s.prompt} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <span className="block px-2 py-1 text-[10.5px] text-white/35">Slide {i + 1}</span>
                  </div>
                ))}
              </div>

              {project.status === "ready" && project.caption && (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/35">Caption · edit before posting</span>
                    <button type="button" onClick={copyCaption} className={PILL}>
                      {captionCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {captionCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <textarea
                    value={draftFor(project)}
                    onChange={(e) => setDraftFor(project, e.target.value)}
                    rows={3}
                    className="mt-1.5 w-full resize-none rounded-lg border border-transparent bg-transparent text-[13px] leading-relaxed text-white/85 outline-none transition-colors focus:border-white/15 focus:bg-white/[0.03] focus:p-2"
                  />
                </div>
              )}

              {project.status === "ready" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void downloadAllZip(project)} disabled={zipping} className={`${PILL} disabled:opacity-50`}>
                    {zipping ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {zipping ? "Zipping…" : "Download all (.zip)"}
                  </button>
                  {project.slides.filter((s) => s.imageUrl).map((s, i) => (
                    <a key={i} href={s.imageUrl} download target="_blank" rel="noreferrer" className={PILL}>
                      <Download className="size-3.5" /> Slide {i + 1}
                    </a>
                  ))}
                </div>
              )}
              {project.status === "ready" && (
                <div className="mt-4 border-t border-white/10 pt-3.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void publishCarousel(project)} disabled={publishing} className={`${PRIMARY_BTN} disabled:opacity-50`}>
                      {publishing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                      {publishing ? "Publishing…" : "Publish to socials"}
                    </button>
                    {connectedPlatforms.length > 0 ? (
                      <span className="inline-flex items-center gap-2 text-[11.5px] text-white/50">
                        <ConnectedPlatformStack platforms={connectedPlatforms} badgeClassName="size-5" ringClassName="ring-[#101013]" />
                        {connectedPlatforms.length} connected
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-white/35">No connected accounts on this agent</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-white/40">Posts your edited caption to the accounts above. TikTok gets auto sound.</p>
                  {publishMsg && <p className="mt-1.5 text-[12px] text-white/70">{publishMsg}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── History ───────────────────────────────────────────────────────── */}
        {history && history.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-white/40">History</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {history.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => { setPublishMsg(null); setHistoryId(p._id); }}
                  className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition-transform hover:-translate-y-0.5"
                >
                  {p.slides[0]?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.slides[0].imageUrl} alt={p.title} className="aspect-[9/16] w-full object-cover" />
                  ) : (
                    <div className="grid aspect-[9/16] w-full place-items-center text-white/20"><Images className="size-4" /></div>
                  )}
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium text-white/60">{p.title}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── How it works ─────────────────────────────────────────────────── */}
        {stage === "ideate" && !ideas && (
          <div className="mt-10 grid gap-3.5 sm:grid-cols-3">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <span className="grid size-10 place-items-center rounded-full bg-gradient-to-b from-white/[0.09] to-white/[0.02] ring-1 ring-white/10">
                  <s.Icon className="size-[18px] text-white/60" />
                </span>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Step {i + 1}</p>
                <h4 className="mt-0.5 text-[14px] font-semibold text-white">{s.title}</h4>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/40">{s.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── History project modal — animated popup, page stays put ───────── */}
      <AnimatePresence>
        {historyId && (
          <motion.div
            key="history-modal"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setHistoryId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="max-h-[86vh] w-full max-w-[820px] overflow-y-auto rounded-2xl border border-white/12 bg-[#101013] p-5 shadow-[0_32px_80px_rgba(0,0,0,0.6)]"
              onClick={(e) => e.stopPropagation()}
            >
              {historyProject === undefined ? (
                <div className="grid h-40 place-items-center text-white/30"><Loader2 className="size-5 animate-spin" /></div>
              ) : historyProject === null ? (
                <p className="py-10 text-center text-[13px] text-white/40">Project not found.</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[17px] font-semibold text-white">{historyProject.title}</h3>
                      <p className="mt-0.5 text-[13px] text-white/45">{historyProject.hook}</p>
                    </div>
                    <button type="button" onClick={() => setHistoryId(null)} className="shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close">
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3">
                    {historyProject.slides.map((s, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 + i * 0.05, duration: 0.25 }}
                        className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
                      >
                        <div className="flex aspect-[9/16] items-center justify-center bg-white/[0.02]">
                          {s.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.imageUrl} alt={s.prompt} className="h-full w-full object-cover" />
                          ) : (
                            <span className="px-3 text-center text-[11px] text-white/30">{s.status === "failed" ? (s.error ?? "failed") : "pending"}</span>
                          )}
                        </div>
                        <span className="block px-2 py-1 text-[10.5px] text-white/35">Slide {i + 1}</span>
                      </motion.div>
                    ))}
                  </div>

                  {historyProject.caption && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/35">Caption · edit before posting</span>
                      <textarea
                        value={draftFor(historyProject)}
                        onChange={(e) => setDraftFor(historyProject, e.target.value)}
                        rows={3}
                        className="mt-1.5 w-full resize-none rounded-lg border border-transparent bg-transparent text-[13px] leading-relaxed text-white/85 outline-none transition-colors focus:border-white/15 focus:bg-white/[0.03] focus:p-2"
                      />
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void downloadAllZip(historyProject)} disabled={zipping} className={`${PILL} disabled:opacity-50`}>
                      {zipping ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                      {zipping ? "Zipping…" : "Download all (.zip)"}
                    </button>
                    {historyProject.slides.filter((s) => s.imageUrl).map((s, i) => (
                      <a key={i} href={s.imageUrl} download target="_blank" rel="noreferrer" className={PILL}>
                        <Download className="size-3.5" /> Slide {i + 1}
                      </a>
                    ))}
                  </div>

                  {/* Publish — posts this carousel via the selected agent's connected accounts */}
                  <div className="mt-4 border-t border-white/10 pt-3.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => void publishCarousel(historyProject)} disabled={publishing} className={`${PRIMARY_BTN} disabled:opacity-50`}>
                        {publishing ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                        {publishing ? "Publishing…" : "Publish to socials"}
                      </button>
                      {connectedPlatforms.length > 0 ? (
                        <span className="inline-flex items-center gap-2 text-[11.5px] text-white/50">
                          <ConnectedPlatformStack platforms={connectedPlatforms} badgeClassName="size-5" ringClassName="ring-[#101013]" />
                          {connectedPlatforms.length} connected
                        </span>
                      ) : (
                        <span className="text-[11.5px] text-white/35">No connected accounts on this agent</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-white/40">Posts your edited caption to the accounts above. TikTok gets auto sound.</p>
                    {publishMsg && <p className="mt-1.5 text-[12px] text-white/70">{publishMsg}</p>}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </AppHeaderShell>
  );
}
