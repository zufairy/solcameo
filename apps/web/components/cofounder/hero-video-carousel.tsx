"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";

/* ── Hero carousel ───────────────────────────────────────────────────────────
   A borderless, endlessly-scrolling rail of the platform's real clips (same
   feed as the marquee sections below), with a floating glass "start here"
   bar pinned over its lower third — echoing the reference's second input
   pinned over the demo card. Edge fades crop the outer cards so the strip
   reads as continuous, matching the reference's peeking side cards. */
type HeroClip = { id: string; posterUrl: string | null; videoUrl: string };

/** Mount-gate for offscreen media. The landing page used to keep ~21 muted
 *  looping <video> elements decoding at once (hero rail ×16 + style tiles ×5),
 *  which pegged low-end GPUs/CPUs. This reports whether the element is near
 *  the viewport so callers mount the <video> ONLY then — posters everywhere
 *  else. IO's rects include CSS transforms, so it tracks the moving marquee. */
function useNearViewport<T extends HTMLElement>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setNear(true));
      return () => cancelAnimationFrame(frame);
    }
    const obs = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);
  return { ref, near };
}

/** One card in the hero rail — poster-first; the muted looping video mounts
 *  only while the card is near the viewport and unmounts (freeing its decoder)
 *  the moment the marquee carries it away. */
function HeroClipCard({ item }: { item: HeroClip }) {
  const [ready, setReady] = useState(false);
  const { ref, near } = useNearViewport<HTMLDivElement>();
  // Re-show the poster whenever the video unmounts, so re-entering the viewport
  // never flashes a black frame while the source re-buffers.
  useEffect(() => {
    if (near) return;
    const frame = requestAnimationFrame(() => setReady(false));
    return () => cancelAnimationFrame(frame);
  }, [near]);
  return (
    <div ref={ref} className="group relative h-[220px] w-[380px] shrink-0 overflow-hidden rounded-3xl bg-neutral-900 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08] sm:h-[300px] sm:w-[500px]">
      {item.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt=""
          loading="lazy"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${near && ready ? "opacity-0" : "opacity-90"}`}
        />
      )}
      {near && (
        <video
          src={item.videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onCanPlay={() => setReady(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {/* Top highlight + bottom scrim so the card reads as a lit, premium pane. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/[0.06]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
    </div>
  );
}

/** ONE-SHOT feed read for the marketing page. A `useQuery` subscription here
 *  re-ran the whole 4-table feed scan on EVERY write to clips/scheduledContent/
 *  videoRenderJobs/submissions (renders patch statusMessage every few seconds),
 *  for every visitor parked on the landing page — the top bytes-read insight on
 *  the deployment. The wall doesn't need live updates; load once and hold. */
function useFeedOnce(limit: number) {
  const convex = useConvex();
  const [data, setData] = useState<{ items: unknown[] } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    convex.query(api.clipJobs.globalVideoFeed, { limit }).then((d) => { if (alive) setData(d as { items: unknown[] }); }).catch(() => { if (alive) setData({ items: [] }); });
    return () => { alive = false; };
  }, [convex, limit]);
  return data;
}

/** Curated, always-alive sample renders (durable R2) — the rail's floor. The
 *  live feed can serve rows whose URLs are on expiring hosts (tempfile.*), a
 *  dead old deployment, or half-gigabyte stitched sources that never start on
 *  a first visit — a wall of black panes as the visitor's first impression.
 *  Live rows that pass the durable-host check still lead; these backfill. */
const CURATED_HERO_CLIPS: HeroClip[] = [
  { id: "curated-review", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/2026-08-25/3423d5c3-374b-4bb9-9af3-acd2894504bb.mp4" },
  { id: "curated-reaction", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/2026-08-25/ee62332d-4530-4d9e-8948-f60aa9a57b4d.mp4" },
  { id: "curated-cartoon", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/rescued/2026-08-25/bcd1cff4-baff-4045-8e3f-3c5896fd292d.mp4" },
  { id: "curated-anime", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/rescued/2026-08-25/54df2e5a-1b49-4ca5-81c3-0afe1304b028.mp4" },
  { id: "curated-story", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/2026-08-25/683b3daf-b4f4-4e74-8dcd-56687c19703a.mp4" },
  { id: "curated-story-2", posterUrl: null, videoUrl: "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/renders/2026-08-25/0e5b7c18-62a6-4909-9ca5-24f721b45bd0.mp4" },
];

/** Only hosts that serve reliably to anonymous visitors belong in the hero. */
function isDurableClipUrl(url: string): boolean {
  return /^https:\/\/(pub-[a-z0-9]+\.r2\.dev|[a-z0-9]+\.supabase\.co)\//.test(url);
}

export function HeroCarousel() {
  const data = useFeedOnce(8);
  const items = useMemo(() => {
    const live = ((data?.items ?? []) as HeroClip[]).filter((c) => isDurableClipUrl(c.videoUrl));
    // Live rows lead; curated samples fill to a full rail (dedupe by URL).
    const seen = new Set(live.map((c) => c.videoUrl));
    const fill = CURATED_HERO_CLIPS.filter((c) => !seen.has(c.videoUrl));
    return [...live, ...fill].slice(0, 8);
  }, [data]);
  const loading = data === undefined;
  const track = items.length ? [...items, ...items] : [];

  return (
    <div className="relative z-10 mt-10 w-full pb-4 sm:mt-12 sm:pb-6">
      {loading ? (
        <div className="flex w-max gap-5 vello-marquee-slow">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-[220px] w-[380px] shrink-0 animate-pulse overflow-hidden rounded-3xl bg-neutral-900 ring-1 ring-white/[0.08] sm:h-[300px] sm:w-[500px]"
            />
          ))}
        </div>
      ) : (
        <div className="flex w-max gap-5 vello-marquee-slow">
          {track.map((it, i) => (
            <HeroClipCard key={`${it.id}-${i}`} item={it} />
          ))}
        </div>
      )}

      {/* Edge fades — crop the outer cards into darkness so the rail reads endless. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-black to-transparent sm:w-40" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-black to-transparent sm:w-40" />
    </div>
  );
}
