"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { VideoStack } from "./VideoStack3D";
import { ArrowRight, Film } from "lucide-react";

type Preview = { id: string; title: string; src: string; poster?: string };

/** Three stacked cards: the centre card sits in front, the others fan out behind it and spread on hover. */
const SLOTS = [
  { x: -64, rotate: -7, scale: 0.88, z: 0, spread: -96 },
  { x: 64, rotate: 7, scale: 0.88, z: 0, spread: 96 },
  { x: 0, rotate: 0, scale: 1, z: 10, spread: 0 },
] as const;


/** Plain-CSS version of the stack, used when WebGL isn't available. */
function CssStack({ videos, reduced }: { videos: Preview[]; reduced: boolean }) {
  const [hover, setHover] = useState(false);
  return (
      <div
        className="relative mx-auto h-[250px] w-full max-w-[420px]"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {SLOTS.map((slot, i) => {
          const video = videos[i];
          return (
            <motion.div
              key={i}
              initial={reduced ? false : { opacity: 0, y: 24, x: 0, rotate: 0, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, x: slot.x + (hover ? slot.spread * 0.45 : 0), rotate: hover ? slot.rotate * 1.4 : slot.rotate, scale: slot.scale }}
              transition={{ type: "spring", stiffness: 240, damping: 24, delay: reduced ? 0 : 0.08 * (2 - Math.abs(i - 2)) }}
              style={{ zIndex: slot.z }}
              className="absolute left-1/2 top-0 -ml-[67px] aspect-[9/16] w-[134px] overflow-hidden rounded-[3px] border border-white/15 bg-zinc-900 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.9)]"
            >
              {video ? (
                <video
                  src={video.src}
                  poster={video.poster}
                  muted loop playsInline preload="metadata"
                  autoPlay={!reduced}
                  aria-label={video.title}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.06] to-white/[0.02]" />
              )}
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-white/[0.04]" />
              {i !== 2 && <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/25" />}
            </motion.div>
          );
        })}
      </div>

  );
}

/** Shown in Recent videos before the agent has made anything: a taste of what's possible, and one clear next step. */
export default function EmptyVideoStack({ onGenerate }: { onGenerate: () => void }) {
  const reduced = useReducedMotion();
  const [videos, setVideos] = useState<Preview[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/explore?cursor=1", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: { id: string; title: string; previewUrl: string; demoUrl?: string; thumbUrl?: string }[] } | null) => {
        const items = (d?.items ?? []).filter((i) => i.demoUrl || i.previewUrl).slice(0, 3);
        setVideos(items.map((i) => ({ id: i.id, title: i.title, src: i.demoUrl ?? i.previewUrl, poster: i.thumbUrl })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <section
      aria-label="Generate your first video"
      className="relative overflow-hidden rounded-[4px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))] px-6 pb-8 pt-9 text-center"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <VideoStack videos={videos} reduced={!!reduced} fallback={<CssStack videos={videos} reduced={!!reduced} />} />

      <h3 className="mt-6 text-[19px] font-semibold tracking-tight text-white">Generate your first video</h3>
      <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-5 text-zinc-500">
        Set the look and the show plan in Director, and your agent starts making videos like these.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="group mt-5 inline-flex h-10 items-center gap-2 rounded-[3px] bg-[#d7ff00] px-5 text-[13px] font-semibold text-black shadow-[0_12px_28px_-12px_rgba(215,255,0,0.6)] transition-colors hover:bg-[#e4ff59] active:scale-[0.98]"
      >
        <Film className="size-4" strokeWidth={2} />
        Open Director
        <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </button>
    </section>
  );
}
