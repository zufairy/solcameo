"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Scissors, X, Check } from "lucide-react";
import { useMyAgents } from "@/lib/client/useMyAgents";
import { CLIP_TEMPLATES, type ClipTemplate } from "@/components/builder/clipping-flow/data/templates";

const INTER = { fontFamily: "var(--font-inter)" } as const;

type VideoInfo = { title?: string; author?: string; thumbnailUrl?: string; durationSeconds?: number };

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Honest default clip count from the real duration (~1 clip per 90s),
 *  clamped to a sane slider range. Falls back to a middling default when the
 *  duration lookup failed (non-yt-dlp source). */
function defaultClipCount(durationSeconds: number | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return 6;
  return Math.max(2, Math.min(15, Math.round(durationSeconds / 90)));
}

// Three templates surfaced here, out of the full catalog in
// components/builder/clipping-flow/data/templates.ts — the best general-purpose
// starting points for "I have no idea, just clip it" (podcast/talking-head,
// punchy hook-driven, and faceless/story split-screen).
const PICKER_TEMPLATE_IDS: ClipTemplate["id"][] = ["podcast-clipper", "hormozi-bold", "brainrot-split"];
const PICKER_TEMPLATES = PICKER_TEMPLATE_IDS
  .map((id) => CLIP_TEMPLATES.find((t) => t.id === id))
  .filter((t): t is ClipTemplate => !!t);

/**
 * "Get clips" pre-flight modal — the /home Hero's "drop a link → Get clips in
 * 1 click" flow. Fetches the real source video's title/thumbnail/duration
 * (metadata-only, same /api/video/info the landing page uses), lets the
 * operator pick how many clips and which style, then hands off to the real
 * clipping-agent builder (/builder?type=clipping) with everything already
 * described in the opening message — see initialQuery in app/builder/page.tsx,
 * which auto-sends it as the first chat turn instead of making the operator
 * retype what they just chose here.
 */
export function GetClipsModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [phase, setPhase] = useState<"fetching" | "ready">("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [count, setCount] = useState(6);
  const [countTouched, setCountTouched] = useState(false);
  const [templateId, setTemplateId] = useState<ClipTemplate["id"]>(PICKER_TEMPLATES[0]?.id ?? "podcast-clipper");
  const [mounted, setMounted] = useState(false);
  const [launching, setLaunching] = useState(false);
  const router = useRouter();
  // Which agent runs this video. Existing clipping agents are offered first; "new"
  // opens the guided agent setup (the link rides along and is clipped once the
  // agent exists). Nobody starts a chat without an agent.
  const { agents } = useMyAgents();
  const clippers = (agents ?? []).filter((a) => a.type === "clipping");
  const [chosen, setChosen] = useState<string | null>(null);
  const target = chosen ?? clippers[0]?.mintAddress ?? "new";

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Small floor so the fetch animation always reads, even on a fast response.
      const [res] = await Promise.all([
        fetch(`/api/video/info?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => null),
        new Promise((r) => setTimeout(r, 1000)),
      ]);
      if (cancelled) return;
      const nextInfo: VideoInfo | null = res?.ok
        ? { title: res.title, author: res.author, thumbnailUrl: res.thumbnailUrl, durationSeconds: res.durationSeconds }
        : null;
      setInfo(nextInfo);
      if (!countTouched) setCount(defaultClipCount(nextInfo?.durationSeconds));
      setPhase("ready");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const template = PICKER_TEMPLATES.find((t) => t.id === templateId) ?? PICKER_TEMPLATES[0];

  const launch = () => {
    if (launching) return;
    setLaunching(true);
    const message = `Clip this video into ${count} viral clips: ${url}. Use the ${template.name} style — ${template.tagline}`;
    const existing = target !== "new" ? clippers.find((a) => a.mintAddress === target) : undefined;
    const params = new URLSearchParams(
      existing
        ? { mint: existing.mintAddress, type: "clipping", q: message }
        : { type: "clipping", q: message, walkthrough: "1" },
    );
    router.push(`/builder?${params.toString()}`);
  };

  if (!mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center px-4 py-8"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="max-h-full w-full max-w-[460px] overflow-y-auto rounded-3xl border border-white/15 bg-neutral-950 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
        style={INTER}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-neutral-950/95 px-5 pt-4 pb-2 backdrop-blur-sm">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            {phase === "fetching" && <Loader2 className="size-3 animate-spin" />}
            {phase === "fetching" ? "Fetching your video" : "Set up your clips"}
          </span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-2">
          <AnimatePresence mode="wait">
            {phase === "fetching" ? (
              <motion.div key="fetching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center gap-4 py-14">
                <div className="relative grid size-14 place-items-center rounded-full border border-white/15 bg-white/[0.04]">
                  <Scissors className="size-6 text-white/60" />
                  {[0, 0.5, 1].map((d) => (
                    <motion.span key={d} className="absolute inset-0 rounded-full border border-white/20"
                      animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: d }} />
                  ))}
                </div>
                <p className="max-w-[280px] truncate text-center text-[13px] text-white/50">{url}</p>
              </motion.div>
            ) : (
              <motion.div key="ready" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="flex gap-3">
                  <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-neutral-900">
                    {info?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={info.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-white/30"><Scissors className="size-5" /></div>
                    )}
                    {typeof info?.durationSeconds === "number" && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9.5px] font-medium text-white/85">
                        {fmtDuration(info.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13.5px] font-medium leading-snug text-white">
                      {info?.title || "Your video is ready to clip"}
                    </p>
                    {info?.author && <p className="mt-0.5 truncate text-[11.5px] text-white/40">{info.author}</p>}
                  </div>
                </div>

                {/* Clip-count slider */}
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold uppercase tracking-widest text-white/40">How many clips?</span>
                    <motion.span key={count} initial={{ scale: 1.2, color: "#bef264" }} animate={{ scale: 1, color: "#ffffff" }}
                      transition={{ type: "spring", stiffness: 400, damping: 22 }}
                      className="text-[19px] font-black tabular-nums">{count}</motion.span>
                  </div>
                  <input
                    type="range" min={1} max={15} value={count}
                    onChange={(e) => { setCount(Number(e.target.value)); setCountTouched(true); }}
                    style={{ background: `linear-gradient(90deg, #a3e635 ${(count / 15) * 100}%, rgba(255,255,255,0.08) ${(count / 15) * 100}%)` }}
                    className="mt-2.5 h-1 w-full cursor-pointer appearance-none rounded-full outline-none
                      [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                      [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(163,230,53,0.25)]
                      [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white"
                  />
                </div>

                {/* Template picker */}
                <div className="mt-4">
                  <span className="text-[10.5px] font-semibold uppercase tracking-widest text-white/40">Pick a clip style</span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {PICKER_TEMPLATES.map((t) => {
                      const selected = t.id === templateId;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTemplateId(t.id)}
                          className={`relative flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition-colors ${
                            selected ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
                          }`}
                        >
                          {selected && (
                            <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-lime-400 text-neutral-900">
                              <Check className="size-2.5" strokeWidth={3} />
                            </span>
                          )}
                          <span className="text-[22px] leading-none">{t.icon}</span>
                          <span className="text-[11px] font-semibold leading-tight text-white/85">{t.name}</span>
                          <span className="line-clamp-2 text-[9.5px] leading-snug text-white/40">{t.tagline}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Which agent? */}
                <div className="mt-4">
                  <span className="text-[10.5px] font-semibold uppercase tracking-widest text-white/40">Which agent clips this?</span>
                  <div className="mt-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto" role="radiogroup" aria-label="Agent">
                    {clippers.map((a) => {
                      const on = target === a.mintAddress;
                      return (
                        <button key={a.mintAddress} type="button" role="radio" aria-checked={on} onClick={() => setChosen(a.mintAddress)}
                          className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors ${on ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-bold text-white/60">{a.name.charAt(0)}</span>}
                          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-white">{a.name}</span><span className="block truncate text-[11px] text-white/40">{a.niche || "Clipping agent"}</span></span>
                          {on && <span className="grid size-4 place-items-center rounded-full bg-lime-400 text-neutral-900"><Check className="size-2.5" strokeWidth={3} /></span>}
                        </button>
                      );
                    })}
                    <button type="button" role="radio" aria-checked={target === "new"} onClick={() => setChosen("new")}
                      className={`flex items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5 text-left transition-colors ${target === "new" ? "border-lime-400/50 bg-lime-400/[0.08]" : "border-white/15 hover:border-white/30"}`}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-[16px] text-white/70">+</span>
                      <span className="text-[13px] font-semibold text-white/85">Create a new agent</span>
                      {target === "new" && <span className="ml-auto grid size-4 place-items-center rounded-full bg-lime-400 text-neutral-900"><Check className="size-2.5" strokeWidth={3} /></span>}
                    </button>
                  </div>
                </div>

                <button
                  onClick={launch}
                  disabled={launching}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#f6f4ec] px-5 py-3 text-[14px] font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-white disabled:opacity-70"
                >
                  {launching ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
                  {launching ? (target === "new" ? "Opening setup…" : "Opening your clipper…") : target === "new" ? "Set up agent and clip" : `Clip it — ${count} clips`}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
