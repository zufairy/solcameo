"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, Link as LinkIcon, ImagePlus, Loader2, X, ArrowRight, ChevronLeft } from "lucide-react";

/* ════════ Photo Carousel — Ideation ════════
   Same warm-dark glass language as the canvas below it and every other
   builder tab (Home/Editor/Posting) — this used to be a deliberately light
   "cream/Apple minimal" screen, the one place in the Carousel tab that broke
   theme. Now: near-black glass cards, lime accents, spring entrance +
   staggered idea-card reveals so it reads as one polished product instead of
   a plain form bolted onto a dark canvas. */

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};
const EASE = [0.16, 1, 0.3, 1] as const;

const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-lime-500 px-5 py-2.5 text-[13.5px] " +
  "font-bold text-white shadow-[0_4px_0_#4d7c0f] outline-none transition-[transform,box-shadow,filter] duration-100 " +
  "hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_#4d7c0f] " +
  "disabled:pointer-events-none disabled:opacity-40 disabled:shadow-[0_4px_0_#4d7c0f] " +
  "focus-visible:ring-2 focus-visible:ring-lime-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050506]";

const PILL =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 " +
  "bg-white/[0.04] backdrop-blur-xl px-3 py-1.5 text-[12.5px] font-medium text-zinc-300 " +
  "transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

const FIELD =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-3.5 py-3 text-[14px] " +
  "text-white placeholder:text-zinc-500 focus:border-white/20 focus:outline-none";

const STYLES = [
  { id: "ugc", label: "UGC review" },
  { id: "tutorial", label: "Tutorial / how-to" },
  { id: "listicle", label: "Listicle" },
  { id: "before_after", label: "Before / after" },
  { id: "quote", label: "Quote / motivational" },
  { id: "product_showcase", label: "Product showcase" },
] as const;

export interface IdeaSlide { prompt: string }
export interface Idea { title: string; hook: string; slides: IdeaSlide[] }

export function CarouselIdeationPanel({
  mintAddress,
  headers,
  onUseIdea,
  onSkip,
  uploadImage,
}: {
  mintAddress?: string;
  headers: () => Record<string, string>;
  /** Called with the picked idea's slide prompts, in order — caller populates the canvas. */
  onUseIdea: (idea: Idea) => void;
  /** Skip straight to the empty canvas. */
  onSkip: () => void;
  /** Uploads a File and returns a durable public URL, reusing the canvas's own storage pipeline. */
  uploadImage: (file: File) => Promise<string | null>;
}) {
  const reduceMotion = useReducedMotion();
  const [prompt, setPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]["id"]>("ugc");
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = Boolean(mintAddress) && prompt.trim().length > 0 && !generating;

  const handleRefUpload = useCallback(async (file: File) => {
    setRefUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file);
      if (url) setRefImageUrl(url);
      else setError("Could not upload reference image.");
    } finally {
      setRefUploading(false);
    }
  }, [uploadImage]);

  const generateIdeas = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setIdeas(null);
    setExpanded(null);
    try {
      const res = await fetch("/api/carousel/ideate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          username: mintAddress,
          prompt: prompt.trim(),
          websiteUrl: websiteUrl.trim() || undefined,
          referenceImageUrl: refImageUrl || undefined,
          style,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ideas?: Idea[] };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `Idea generation failed (HTTP ${res.status})`);
        return;
      }
      setIdeas(j.ideas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, headers, mintAddress, prompt, websiteUrl, refImageUrl, style]);

  return (
    <div className="min-h-full px-8 py-10" style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <motion.div
        className="mx-auto max-w-[860px]"
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <Sparkles className="size-5 text-lime-300" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="text-2xl font-semibold leading-none text-white">Ideate a carousel</h2>
              <p className="mt-1.5 text-[13.5px] text-zinc-400">Describe the idea, we&apos;ll propose a few concepts with slide-by-slide prompts.</p>
            </div>
          </div>
          <button type="button" onClick={onSkip} className={PILL}>
            Skip to blank canvas <ArrowRight className="size-3.5" />
          </button>
        </div>

        {/* ── Input card ────────────────────────────────────────────────────── */}
        <motion.div
          className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 shadow-[0_22px_50px_-30px_rgba(0,0,0,0.6)]"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. a 5-slide carousel about our new matcha protein powder, energetic and playful…"
            rows={3}
            className={`resize-none ${FIELD}`}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-3.5 py-2.5">
              <LinkIcon className="size-4 shrink-0 text-zinc-500" />
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="Website link (optional)"
                className="w-full min-w-0 bg-transparent text-[13.5px] text-white placeholder:text-zinc-500 focus:outline-none"
              />
            </div>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as typeof style)}
              className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-3.5 py-2.5 text-[13.5px] text-white focus:border-white/20 focus:outline-none"
            >
              {STYLES.map((s) => <option key={s.id} value={s.id} className="bg-[#0b0b0c]">{s.label}</option>)}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {refImageUrl ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl py-1 pl-1 pr-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={refImageUrl} alt="Reference" className="size-9 rounded-lg object-cover" />
                <span className="text-[12.5px] text-zinc-400">Reference attached</span>
                <button type="button" onClick={() => setRefImageUrl(null)} className="rounded p-0.5 text-zinc-500 hover:text-white">
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <label className={`${PILL} cursor-pointer`}>
                {refUploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                {refUploading ? "Uploading…" : "Upload reference image"}
                <input type="file" accept="image/*" className="hidden" disabled={refUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleRefUpload(f); e.target.value = ""; }} />
              </label>
            )}
            <button type="button" disabled={!canGenerate} onClick={() => void generateIdeas()} className={`${PRIMARY_BTN} ml-auto`}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {generating ? "Thinking…" : "Generate ideas"}
            </button>
          </div>
          {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}
        </motion.div>

        {/* ── Idea cards ────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {ideas && ideas.length > 0 && (
            <motion.div
              key={expanded === null ? "grid" : "detail"}
              className="mt-6 space-y-3"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {expanded === null ? (
                <div className="grid gap-3.5 sm:grid-cols-3">
                  {ideas.map((idea, i) => (
                    <motion.button
                      key={i}
                      type="button"
                      onClick={() => setExpanded(i)}
                      initial={reduceMotion ? false : { opacity: 0, y: 14, filter: "blur(6px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.4, ease: EASE, delay: i * 0.06 }}
                      whileHover={reduceMotion ? undefined : { y: -3 }}
                      className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      <span className="w-fit rounded-full bg-lime-400/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-lime-300">
                        {STYLES.find((s) => s.id === style)?.label ?? style}
                      </span>
                      <h4 className="mt-2.5 text-[15px] font-semibold leading-snug text-white">{idea.title}</h4>
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">{idea.hook}</p>
                      <span className="mt-3 text-[12px] font-medium text-zinc-500">{idea.slides.length} slides →</span>
                    </motion.button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setExpanded(null)} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white">
                      <ChevronLeft className="size-4" />
                    </button>
                    <h4 className="text-[16px] font-semibold text-white">{ideas[expanded].title}</h4>
                  </div>
                  <p className="mt-1 ml-9 text-[13px] text-zinc-400">{ideas[expanded].hook}</p>
                  <div className="mt-4 ml-9 grid gap-2.5 sm:grid-cols-2">
                    {ideas[expanded].slides.map((s, i) => (
                      <motion.div
                        key={i}
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EASE, delay: i * 0.04 }}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-zinc-500">Slide {i + 1}</span>
                        <textarea
                          value={s.prompt}
                          onChange={(e) => {
                            const next = [...ideas];
                            next[expanded] = { ...next[expanded], slides: next[expanded].slides.map((sl, j) => (j === i ? { prompt: e.target.value } : sl)) };
                            setIdeas(next);
                          }}
                          rows={3}
                          className="mt-1 w-full resize-none bg-transparent text-[12.5px] leading-snug text-zinc-200 focus:outline-none"
                        />
                      </motion.div>
                    ))}
                  </div>
                  <div className="mt-4 ml-9 flex items-center gap-3">
                    <button type="button" onClick={() => onUseIdea(ideas[expanded])} className={PRIMARY_BTN}>
                      Use this idea <ArrowRight className="size-4" />
                    </button>
                    <span className="text-[12px] text-zinc-500">Populates the canvas below, generate each slide with KIE from there.</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
