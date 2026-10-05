"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useQuery } from "convex/react";
import { Film, Loader2, Play, Volume2, VolumeX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { TikTokIcon, InstagramIcon, YouTubeIcon, XIcon } from "./social-icons";

/* ── Stacked 3D video showcase ────────────────────────────────────────────────
   A cinematic stack of the portrait videos the platform's agents generate + post
   (api.clipJobs.globalVideoFeed). The centre clip sits flat and forward; the rest
   layer behind it — tilted, pushed back in Z, dimmed, glowing — so the row reads
   as depth-stacked cards, not a flat strip. Cards rise in with a staggered
   entrance when scrolled into view, then float gently. Every card autoplays
   muted; its speaker chip is minimal until you hover, when it lights red.
   Reduced-motion users get static poster frames + the speaker affordance.

   Section tone: the clipper showcase ("Handle end-to-end…") glows GREEN; the
   influencer showcase ("Created and posted by our AI influencers") glows RED.
   Loading: videos mount STAGGERED (centre first, then outwards) so the browser
   never fetches every MP4 at once — that was the "videos load forever / show a
   black box" report (clipper cards have no poster, so the card went black while
   buffering). Each card shows a buffering spinner until its first frame plays. */

type FeedItem = {
  id: string;
  videoUrl: string;
  posterUrl: string | null;
  caption: string;
  agentName: string;
  agentAvatar: string;
  postUrl: string | null;
  viewCount: number | null;
  state: string;
};

type Tone = "green" | "red";

// Per-section accent — every colourful touch derives from the tone so the two
// showcases read as one system in two moods. (Literal class strings below are
// picked up by Tailwind's scanner from this module-level object.)
const TONE: Record<Tone, { text: string; cardGlow: string; rim: string; playHover: string; bloom: string; railIcon: string; railShadow: string }> = {
  green: {
    text: "text-[#2fe08a]",
    cardGlow: "shadow-[0_18px_60px_-12px_rgba(34,224,138,0.55),0_0_28px_-6px_rgba(34,224,138,0.35)]",
    rim: "ring-[#2fe08a]/15",
    playHover: "group-hover/play:bg-[#2fe08a]/20 group-hover/play:ring-[#2fe08a]/50",
    bloom: "radial-gradient(60% 55% at 50% 46%, rgba(34,224,138,0.30), rgba(20,200,120,0.09) 42%, transparent 72%)",
    railIcon: "fill-[#2fe08a]",
    railShadow: "shadow-[0_0_24px_-6px_rgba(34,211,124,0.55)]",
  },
  red: {
    text: "text-[#ff3b30]",
    cardGlow: "shadow-[0_18px_60px_-12px_rgba(255,59,48,0.55),0_0_28px_-6px_rgba(255,59,48,0.35)]",
    rim: "ring-[#ff3b30]/15",
    playHover: "group-hover/play:bg-[#ff3b30]/20 group-hover/play:ring-[#ff3b30]/50",
    bloom: "radial-gradient(60% 55% at 50% 46%, rgba(255,59,48,0.30), rgba(200,40,30,0.09) 42%, transparent 72%)",
    railIcon: "fill-[#ff3b30]",
    railShadow: "shadow-[0_0_24px_-6px_rgba(255,59,48,0.55)]",
  },
} as const;

// Platform label from a resolved social permalink (feed has no explicit platform).
function platformOf(postUrl: string | null): string | null {
  if (!postUrl) return null;
  const u = postUrl.toLowerCase();
  if (u.includes("tiktok")) return "TIKTOK";
  if (u.includes("instagram")) return "REELS";
  if (u.includes("youtube") || u.includes("youtu.be")) return "SHORTS";
  if (u.includes("x.com") || u.includes("twitter")) return "X";
  return null;
}
const FALLBACK_PLATFORMS = ["TIKTOK", "REELS", "SHORTS", "X"];
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
// Vello trust badges shown under the off-centre clips (the centre reads LIVE).
const TRUST = ["MODERATED", "GEO NA-EU", "TOP 1%", "ANTI-BOT", "SETTLED", "QV-COUNTED"];

// The brand glyph replaces the old green status dot beside the platform label.
// White/black glyphs (TikTok, X) render white on the dark card; YouTube + Instagram
// keep their brand colour.
type IconCmp = ComponentType<{ className?: string }>;
const PLATFORM_META: Record<string, { Icon: IconCmp; cls: string }> = {
  TIKTOK: { Icon: TikTokIcon, cls: "fill-white" },
  REELS: { Icon: InstagramIcon, cls: "fill-[#E4405F]" },
  INSTAGRAM: { Icon: InstagramIcon, cls: "fill-[#E4405F]" },
  SHORTS: { Icon: YouTubeIcon, cls: "fill-[#FF0000]" },
  YOUTUBE: { Icon: YouTubeIcon, cls: "fill-[#FF0000]" },
  X: { Icon: XIcon, cls: "fill-white" },
};

// Per-offset 3D geometry — |offset| 0 (centre) … 3 (outermost). Sizes stay CLOSE
// (light scale falloff); depth comes from Z-push + tilt so cards layer/stack.
const GEO = [
  { ry: 0, sc: 1.0, ty: 0, tz: 0, br: 1.0 },
  { ry: 11, sc: 0.97, ty: 6, tz: -70, br: 0.9 },
  { ry: 17, sc: 0.94, ty: 13, tz: -140, br: 0.8 },
  { ry: 22, sc: 0.91, ty: 21, tz: -210, br: 0.72 },
] as const;
// Staggered mount delay per depth so the browser streams MP4s one-by-one from the
// centre out (all-at-once fetch is what made every card stall together).
const MOUNT_DELAY_MS = [0, 180, 420, 700] as const;
// Which offsets are visible per breakpoint (mobile shows 3, xl shows all 7).
const SHOW_CLASS: Record<number, string> = {
  0: "flex",
  1: "flex",
  2: "hidden md:flex",
  3: "hidden xl:flex",
};

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** The <video> — mounts STAGGERED after its card enters view, autoplays muted
 *  (unless the user unmuted THIS clip) and fades in over the poster once it can
 *  play. A buffering spinner covers the card until the first frame is ready, so
 *  clip cards (which have no poster) never sit as a plain black box. */
function VideoEl({
  item,
  soundOn,
  active,
  mountDelayMs,
  tone,
}: {
  item: FeedItem;
  soundOn: boolean;
  active: boolean;
  mountDelayMs: number;
  tone: Tone;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Staggered mount: centre (0ms) streams first, then ±1, then ±2 — the browser
  // downloads them one at a time instead of stalling on 5 simultaneous fetches.
  useEffect(() => {
    if (!active) {
      setMounted(false);
      return;
    }
    if (mountDelayMs <= 0) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(true), mountDelayMs);
    return () => clearTimeout(t);
  }, [active, mountDelayMs]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !soundOn; // React's `muted` prop is unreliable — set it imperatively
    if (soundOn) v.play().catch(() => {});
  }, [soundOn]);

  if (!mounted || failed) return null;

  return (
    <>
      <video
        ref={ref}
        src={item.videoUrl}
        loop
        playsInline
        muted
        preload="auto"
        onCanPlay={(e) => {
          setReady(true);
          e.currentTarget.muted = !soundOn;
          e.currentTarget.play().catch(() => {});
        }}
        onPlaying={() => setReady(true)}
        onError={() => setFailed(true)}
        className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {/* Buffering spinner — ensures a fast, obvious "loading" state instead of a
          black box while the MP4 streams (clipper cards have no poster). */}
      {!ready && (
        <div aria-hidden className="absolute inset-0 grid place-items-center bg-black/30">
          <Loader2 className={`size-5 animate-spin ${TONE[tone].text}`} />
        </div>
      )}
    </>
  );
}

/** Speaker chip — minimal + muted by default; lights RED with an un-muted speaker
 *  on hover/focus (and stays red while a clip is audible). Smooth all-round. */
function SpeakerChip({ soundOn, agentName, onToggle }: { soundOn: boolean; agentName: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={soundOn ? `Mute ${agentName}'s clip` : `Play sound for ${agentName}'s clip`}
      className={`group/spk absolute right-2 top-2 grid size-8 place-items-center rounded-full backdrop-blur-sm transition-all duration-300 ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3b30] ${
        soundOn
          ? "bg-black/55 text-[#ff3b30] shadow-[0_0_16px_rgba(255,59,48,0.55)] ring-1 ring-[#ff3b30]/50"
          : "bg-black/25 text-white/45 ring-1 ring-white/10 hover:bg-black/60 hover:text-[#ff3b30] hover:shadow-[0_0_16px_rgba(255,59,48,0.6)] hover:ring-[#ff3b30]/60"
      }`}
    >
      {soundOn ? (
        <Volume2 className="size-4" />
      ) : (
        <>
          <VolumeX className="size-4 transition-opacity duration-300 group-hover/spk:opacity-0" />
          <Volume2 className="absolute size-4 opacity-0 transition-opacity duration-300 group-hover/spk:opacity-100" />
        </>
      )}
    </button>
  );
}

function FanCard({
  item,
  offset,
  isCentre,
  category,
  platform,
  views,
  soundOn,
  onToggleSound,
  active,
  reduce,
  tone,
}: {
  item: FeedItem;
  offset: number;
  isCentre: boolean;
  category: string;
  platform: string;
  views: string | null;
  soundOn: boolean;
  onToggleSound: () => void;
  active: boolean;
  reduce: boolean;
  tone: Tone;
}) {
  const abs = Math.min(Math.abs(offset), 3);
  const g = GEO[abs];
  const dir = offset < 0 ? 1 : -1; // left cards face right, right cards face left
  // Autoplay the inner cards only. Browsers cap concurrent media (~6/host) and two
  // stacked showcases would blow past that with jank; the outermost pair (|offset|=3,
  // shown only on xl, small + dimmed) keep their poster frame instead.
  const showVideo = active && !reduce && abs <= 2;
  // Staggered rise-in from the centre outward once the section scrolls into view.
  const revealed = active || reduce;
  // Brand glyph instead of the old green status dot.
  const pmeta = PLATFORM_META[platform] ?? null;
  const PIcon = pmeta?.Icon;
  return (
    <div
      style={{
        zIndex: 40 - abs,
        opacity: revealed ? 1 : 0,
        transform: `translateY(${revealed ? 0 : 26}px)`,
        transition: reduce ? undefined : "opacity .6s ease, transform .6s cubic-bezier(.2,.7,.2,1)",
        transitionDelay: reduce ? undefined : `${abs * 80 + 40}ms`,
      }}
      className={`${SHOW_CLASS[abs]} -mx-5 shrink-0 flex-col items-center sm:-mx-6 lg:-mx-7`}
    >
      {/* Inner wrapper carries the vertical arc so the card AND its label dip together. */}
      <div style={{ transform: `translateY(${g.ty}px)` }} className="flex flex-col items-center">
        {/* CARD — the 3D rotate/scale/depth lives here; the float rides the `translate`
            property so it composes with (doesn't clobber) this transform. */}
        <div
          style={{
            transform: `perspective(1500px) translateZ(${g.tz}px) rotateY(${dir * g.ry}deg) scale(${g.sc})`,
            filter: `brightness(${g.br})`,
            animationDelay: `${abs * 0.5}s`,
          }}
          className={`relative aspect-[9/16] w-[128px] overflow-hidden rounded-xl bg-neutral-950 ring-1 ring-white/12 ${TONE[tone].cardGlow} sm:w-[150px] md:w-[164px] lg:w-[184px] ${!reduce && active ? "vello-cardfloat" : ""}`}
        >
          {/* Poster / avatar placeholder — always present under the video. */}
          {item.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-neutral-800 to-black">
              {item.agentAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.agentAvatar} alt="" className="size-12 rounded-full object-cover opacity-40 ring-1 ring-white/15" />
              ) : (
                <Film className="size-6 text-white/25" />
              )}
            </div>
          )}

          {showVideo && <VideoEl item={item} soundOn={soundOn} active={active} mountDelayMs={MOUNT_DELAY_MS[abs]} tone={tone} />}

          {/* Tinted rim + inner vignette so each card reads as a lit, layered pane. */}
          <div aria-hidden className={`pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ${TONE[tone].rim}`} />
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/40" />

          <SpeakerChip soundOn={soundOn} agentName={item.agentName} onToggle={onToggleSound} />

          {/* Centre clip: a play/sound affordance, matching the LIVE hero card. The
              real keyboard control is the speaker chip (same action), so this big hit
              area is mouse-only (tabIndex -1) to avoid a duplicate tab stop. */}
          {isCentre && (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={onToggleSound}
              className="group/play absolute inset-0 grid place-items-center focus-visible:outline-none"
            >
              <span className={`grid size-14 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/25 backdrop-blur-sm transition duration-300 group-hover/play:scale-110 ${TONE[tone].playHover}`}>
                <Play className="size-6 translate-x-0.5 fill-current" />
              </span>
            </button>
          )}
        </div>

        {/* LABEL — platform glyph + name · views, then the trust badge (LIVE for the centre). */}
        <div className="mt-4 flex flex-col items-center gap-1 text-center font-mono">
          <div className="flex items-center gap-1.5 text-[11px] tracking-[0.12em] text-white/80">
            {PIcon && pmeta && <PIcon className={`size-3 ${pmeta.cls}`} />}
            <span className="uppercase">{platform}</span>
            {views && <span className="text-white/55">· {views}</span>}
          </div>
          <div className={`text-[10.5px] uppercase tracking-[0.2em] ${isCentre ? TONE[tone].text : "text-white/55"}`}>
            {category}
          </div>
        </div>
      </div>
    </div>
  );
}

type MarqueeProps = {
  /** Source filter — "clip" (clipper output) or "ugc" (influencer-generated). */
  kind?: "clip" | "ugc";
  eyebrow: string;
  heading: string;
};

/** Public entry: isolates the feed query so a backend hiccup silently hides this
 *  section (fallback={null}) instead of white-screening the whole landing page. */
export function VideoMarquee(props: MarqueeProps) {
  return (
    <ErrorBoundary fallback={null}>
      <VideoMarqueeInner {...props} />
    </ErrorBoundary>
  );
}

function VideoMarqueeInner({ kind, eyebrow, heading }: MarqueeProps) {
  const data = useQuery(api.clipJobs.globalVideoFeed, { limit: 7, kind });
  const items = useMemo(() => (data?.items ?? []) as FeedItem[], [data]);
  const loading = data === undefined;
  const reduce = usePrefersReducedMotion();
  // Clipper showcase glows green; the influencer showcase glows red — only the
  // first ("Handle end-to-end…") stays green.
  const tone: Tone = kind === "ugc" ? "red" : "green";

  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false); // videos mount + cards reveal while on screen
  const [soundId, setSoundId] = useState<string | null>(null); // the one audible clip
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Nothing to show once we know the feed is empty — hide the whole section.
  if (!loading && items.length === 0) return null;

  const centre = items.length ? Math.floor((items.length - 1) / 2) : 0;

  return (
    <section
      ref={sectionRef}
      className={`relative overflow-hidden bg-black pt-24 text-white sm:pt-28 ${
        // The clip showcase sits directly above the influencer one — trim its bottom
        // padding so the two stacks read as one continuous rail.
        kind === "clip" ? "pb-0" : "pb-24 sm:pb-28"
      }`}
    >
      {/* Ambient bloom behind the stack, tinted to the section tone. */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: TONE[tone].bloom }} />

      <div className="relative mx-auto max-w-[1600px] px-6 text-center sm:px-10">
        <p className={`font-mono text-[12px] uppercase tracking-[0.24em] ${TONE[tone].text}`}>{eyebrow}</p>
        <h2 className="mx-auto mt-2 max-w-2xl text-[clamp(1.5rem,2.6vw,2.25rem)] font-light tracking-[-0.02em] text-white">
          {heading}
        </h2>
      </div>

      {/* The stack. */}
      <div className="relative mt-14 flex min-h-[420px] items-start justify-center px-4 sm:min-h-[500px]">
        {loading ? (
          <div className="flex items-start justify-center">
            {[2, 1, 0, 1, 2].map((abs, i) => {
              const g = GEO[abs];
              return (
                <div
                  key={i}
                  style={{ transform: `translateY(${g.ty}px) scale(${g.sc})` }}
                  className="-mx-5 aspect-[9/16] w-[128px] shrink-0 animate-pulse rounded-xl bg-white/[0.06] ring-1 ring-white/10 sm:w-[150px] md:w-[164px] lg:w-[184px]"
                />
              );
            })}
          </div>
        ) : (
          <div className="flex items-start justify-center" style={{ transformStyle: "preserve-3d" }}>
            {items.map((it, i) => {
              const offset = i - centre;
              const isCentre = i === centre;
              const platform = platformOf(it.postUrl) ?? FALLBACK_PLATFORMS[i % FALLBACK_PLATFORMS.length];
              const views = it.viewCount && it.viewCount > 0 ? compact(it.viewCount) : null;
              const category = isCentre ? "LIVE" : TRUST[(i > centre ? i - 1 : i) % TRUST.length];
              return (
                <FanCard
                  key={it.id}
                  item={it}
                  offset={offset}
                  isCentre={isCentre}
                  category={category}
                  platform={platform}
                  views={views}
                  soundOn={soundId === it.id}
                  onToggleSound={() => setSoundId((cur) => (cur === it.id ? null : it.id))}
                  active={active}
                  reduce={reduce}
                  tone={tone}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Distribution rail — rendered ONLY on the influencer (ugc) section so it sits
          ONCE, at the very bottom of the two stacked showcases. */}
      {kind === "ugc" && (
        <div className="relative mt-2 flex items-center justify-center gap-4">
          <span className="sr-only">Auto-posted to TikTok, Instagram, YouTube and X.</span>
          {[TikTokIcon, InstagramIcon, YouTubeIcon, XIcon].map((Icon, i) => (
            <span
              key={i}
              aria-hidden
              className={`grid size-11 place-items-center rounded-full bg-white/[0.04] ring-1 ring-white/10 ${TONE[tone].railShadow}`}
            >
              <Icon className={`size-4 ${TONE[tone].railIcon}`} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
