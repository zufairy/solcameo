"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CampaignNetworkIllustration } from "./campaign-network-illustration";
import { TikTokIcon, InstagramIcon, YouTubeIcon } from "./social-icons";
import { ClipVideo, DriveIcon, isShowcaseClip, type Clip } from "./showcase-clip";

/* ── Hero showcase ──────────────────────────────────────────────────────────
   Five self-explaining, auto-playing scenes (link → moments → clips → campaigns
   → posted). No numbering, arrows or copy blocks: each scene is a live product
   illustration playing REAL, latest clips from the public feed
   (clipJobs.globalVideoFeed), and a minimal tab row names the step while its
   progress bar fills. Videos only decode on the visible slide. */

const STEPS = [
  { key: "link", title: "Paste a link" },
  { key: "moments", title: "AI finds the moments" },
  { key: "clips", title: "Clips, captioned" },
  { key: "campaigns", title: "Agents get rewarded" },
  { key: "publish", title: "Posted and rewarded" },
] as const;
const STEP_MS = 7000;
const GAP = 18;
const EASE = [0.16, 1, 0.3, 1] as const;

/* ── Live clips (degrades to placeholders if the feed errors) ── */
class FeedBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* non-critical: scenes fall back to placeholders */ }
  render() { return this.state.failed ? null : this.props.children; }
}
function FeedLoader({ onClips }: { onClips: (c: Clip[]) => void }) {
  // Wide window so the showcase agent's clips are found even when other agents posted more recently.
  const data = useQuery(api.clipJobs.globalVideoFeed, { limit: 120, kind: "clip" });
  useEffect(() => {
    // Only English content from The Solana Call. No other agent's video is ever shown here.
    const picked = ((data?.items ?? []) as Clip[]).filter((it) => it.videoUrl && isShowcaseClip(it)).slice(0, 8);
    if (picked.length) onClips(picked);
  }, [data, onClips]);
  return null;
}

const score = (c?: Clip, fb = 94) => Math.round(c?.viralScore ?? fb);

/* ── Scene 1: paste a YouTube link (or a Google Drive folder) → a stack of cuts lands ── */
const SOURCES = [
  { key: "youtube", label: "YouTube", url: "youtube.com/watch?v=Kq8x2sOLcall", Icon: YouTubeIcon, length: "1:04:32" },
  { key: "drive", label: "Google Drive", url: "drive.google.com/drive/folders/1xQ9aVello", Icon: DriveIcon, length: "12 files" },
] as const;
const SWITCH_MS = 4200;
const manrope = "font-[family-name:var(--font-manrope)]";

function LinkScene({ playing, clips, reduce }: { playing: boolean; clips: Clip[]; reduce: boolean }) {
  const [t, setT] = useState(reduce ? SWITCH_MS - 1 : 0);
  useEffect(() => {
    if (!playing || reduce) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setT(performance.now() - t0), 40);
    return () => window.clearInterval(id);
  }, [playing, reduce]);
  const srcIdx = t >= SWITCH_MS ? 1 : 0;
  const src = SOURCES[srcIdx];
  const local = srcIdx === 0 ? t : t - SWITCH_MS;
  const speed = srcIdx === 0 ? 45 : 26;
  const chars = Math.min(src.url.length, Math.floor(local / speed));
  const typed = chars >= src.url.length;
  const stack = [2, 1, 0];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3.5%] px-[7%]">
      {/* Source slider: YouTube <-> Google Drive */}
      <div className={`relative flex rounded-full border border-white/12 bg-white/[0.05] p-[3px] ${manrope}`}>
        <motion.span aria-hidden className="absolute inset-y-[3px] w-[calc(50%-3px)] rounded-full bg-white shadow-[0_6px_18px_-6px_rgba(255,255,255,.5)]"
          initial={false} animate={{ x: srcIdx === 0 ? 0 : "100%" }} transition={{ type: "spring", stiffness: 380, damping: 30 }} />
        {SOURCES.map((o, i) => (
          <span key={o.key} className={`relative z-10 flex items-center gap-1.5 px-[clamp(8px,1.6vw,18px)] py-[clamp(3px,0.7vw,6px)] text-[clamp(9px,1.2vw,12px)] font-semibold transition-colors ${srcIdx === i ? "text-black" : "text-white/55"}`}>
            <o.Icon className="size-[clamp(11px,1.5vw,15px)]" />{o.label}
          </span>
        ))}
      </div>

      {/* The link field */}
      <div className="flex w-full max-w-[580px] items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] p-1.5 pl-1.5 shadow-[0_18px_50px_-24px_rgba(0,0,0,.9)] backdrop-blur">
        <motion.span key={src.key} initial={reduce ? false : { scale: 0.6, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="grid size-[clamp(24px,3.4vw,34px)] shrink-0 place-items-center rounded-full bg-white">
          <src.Icon className="size-[56%]" />
        </motion.span>
        <span className={`min-w-0 flex-1 truncate text-[clamp(10px,1.45vw,15px)] font-medium text-white/90 ${manrope}`}>
          {src.url.slice(0, chars)}<span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-lime-300" />
        </span>
        <motion.span animate={typed && playing ? { scale: [1, 0.94, 1] } : { scale: 1 }} transition={{ duration: 0.35, delay: 0.15 }}
          className={`shrink-0 rounded-full bg-lime-300 px-3 py-1.5 text-[clamp(10px,1.3vw,13px)] font-semibold text-black ${manrope}`}>
          Get clips
        </motion.span>
      </div>

      {/* Stacked cards: the source video with more cuts fanned behind it */}
      <div className="relative aspect-video w-[60%] max-w-[500px]">
        {stack.map((layer) => {
          const front = layer === 0;
          return (
            <motion.div key={`${src.key}-${layer}`}
              initial={false}
              animate={typed
                ? { opacity: 1 - layer * 0.18, y: -layer * 16, x: layer === 1 ? "-4%" : layer === 2 ? "4%" : 0, scale: 1 - layer * 0.07, rotate: layer === 1 ? -3 : layer === 2 ? 3 : 0 }
                : { opacity: 0, y: 30, scale: 0.92, rotate: 0, x: 0 }}
              transition={{ type: "spring", stiffness: 160, damping: 20, delay: typed && !reduce ? 0.12 * (2 - layer) : 0 }}
              className="absolute inset-0 overflow-hidden rounded-2xl border border-white/12 bg-black shadow-[0_26px_60px_-30px_rgba(0,0,0,.95)]"
              style={{ zIndex: 3 - layer }}
            >
              <ClipVideo clip={clips[layer] ?? clips[0]} playing={playing && typed && front} className="absolute inset-0 size-full blur-2xl brightness-[0.35]" />
              <ClipVideo clip={clips[layer] ?? clips[0]} playing={playing && typed} fit="contain" className="absolute inset-0 size-full" />
              {front && (
                <>
                  <TrackingOverlay playing={playing && typed} reduce={reduce} done />
                  <span className={`absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[clamp(9px,1.1vw,11px)] font-semibold text-white/90 ${manrope}`}>{src.length}</span>
                  <span className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[clamp(8px,1vw,10px)] font-semibold text-white/90 backdrop-blur ${manrope}`}><src.Icon className="size-3" />{src.label}</span>
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15"><motion.div className="h-full bg-red-500" initial={false} animate={{ width: typed && playing ? "38%" : "0%" }} transition={{ duration: 3, ease: "linear" }} /></div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Scene 2: AI scans the timeline, lights up moments, reframes the speaker ── */
const BARS = Array.from({ length: 64 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37)));
const MOMENTS = [{ a: 0.1, b: 0.22, at: "12:04" }, { a: 0.44, b: 0.54, at: "31:40" }, { a: 0.72, b: 0.85, at: "48:15" }];
/* Object-tracking HUD over the full (uncropped) video: a scan sweep, corner
   brackets that lock on, and tag boxes that drift with the subject. */
const TRACKS = [
  { label: "SPEAKER", conf: 98, x: ["28%", "30%", "27%", "29%"], y: ["16%", "14%", "17%", "15%"], w: "30%", h: "62%" },
  { label: "FACE", conf: 96, x: ["37%", "39%", "36%", "38%"], y: ["20%", "18%", "21%", "19%"], w: "13%", h: "24%" },
];
function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const c = { tl: "left-0 top-0 border-l-2 border-t-2 rounded-tl-md", tr: "right-0 top-0 border-r-2 border-t-2 rounded-tr-md", bl: "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-md", br: "bottom-0 right-0 border-b-2 border-r-2 rounded-br-md" }[pos];
  return <span className={`absolute size-[22%] max-h-3 max-w-3 min-h-2 min-w-2 border-lime-300 ${c}`} />;
}
function TrackingOverlay({ playing, reduce, done }: { playing: boolean; reduce: boolean; done: boolean }) {
  const live = playing && !reduce;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(190,242,100,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(190,242,100,.6)_1px,transparent_1px)] [background-size:12.5%_16.6%]" />
      {live && !done && (
        <motion.div className="absolute inset-x-0 h-[22%] bg-gradient-to-b from-transparent via-lime-300/20 to-lime-300/50"
          initial={{ top: "-22%" }} animate={{ top: ["-22%", "100%"] }} transition={{ duration: 2.2, ease: "linear", repeat: Infinity }}>
          <span className="absolute inset-x-0 bottom-0 h-px bg-lime-300 shadow-[0_0_12px_2px_rgba(190,242,100,.8)]" />
        </motion.div>
      )}
      {TRACKS.map((t, i) => (
        <motion.div key={t.label} className="absolute"
          style={{ width: t.w, height: t.h, left: t.x[0], top: t.y[0] }}
          animate={live ? { left: t.x, top: t.y } : {}} transition={{ duration: 5 + i, ease: "easeInOut", repeat: Infinity }}>
          <motion.div className="absolute inset-0" initial={false} animate={{ opacity: done || !live ? 1 : [0.5, 1, 0.5] }} transition={{ duration: 1.1, repeat: Infinity }}>
            <Bracket pos="tl" /><Bracket pos="tr" /><Bracket pos="bl" /><Bracket pos="br" />
            <span className="absolute inset-0 rounded-sm bg-lime-300/[0.06]" />
          </motion.div>
          <span className="absolute -top-px left-0 -translate-y-full whitespace-nowrap rounded-sm bg-lime-300 px-1 py-px font-mono text-[clamp(6px,0.8vw,9px)] font-bold tracking-wide text-black">{t.label} {t.conf}%</span>
          <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime-300 shadow-[0_0_10px_2px_rgba(190,242,100,.9)]" />
        </motion.div>
      ))}
      <span className="absolute bottom-1.5 right-2 font-mono text-[clamp(6px,0.8vw,9px)] text-lime-300/80">TRACK · 30fps · full frame</span>
    </div>
  );
}

function MomentsScene({ playing, clips, reduce }: { playing: boolean; clips: Clip[]; reduce: boolean }) {
  const [p, setP] = useState(reduce ? 1 : 0);
  useEffect(() => {
    if (!playing || reduce) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { setP(Math.min(1, (t - t0) / 5200)); if (t - t0 < 5200) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduce]);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4%] px-[7%]">
      <div className="relative aspect-video w-[70%] max-w-[600px] overflow-hidden rounded-2xl border border-white/10 bg-black">
        <ClipVideo clip={clips[0]} playing={playing} className="absolute inset-0 size-full blur-2xl brightness-[0.35]" />
        <ClipVideo clip={clips[0]} playing={playing} fit="contain" className="absolute inset-0 size-full" />
        <span className={`absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[clamp(8px,1vw,11px)] font-semibold text-white/90 backdrop-blur ${manrope}`}>
          <span className="relative grid size-1.5 place-items-center"><motion.span className="absolute inset-0 rounded-full bg-lime-300" animate={playing && p < 1 ? { scale: [1, 2.4], opacity: [0.7, 0] } : {}} transition={{ duration: 1.2, repeat: Infinity }} /><span className="relative size-1.5 rounded-full bg-lime-300" /></span>
          {p < 0.95 ? "Scanning the transcript" : `${MOMENTS.length} moments found`}
        </span>
        <TrackingOverlay playing={playing} reduce={reduce} done={p >= 0.95} />
      </div>
      <div className="relative w-[70%] max-w-[600px]">
        {MOMENTS.map((m, i) => {
          const hit = p >= m.a;
          return (
            <motion.span key={i} initial={false}
              animate={hit ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 6, scale: 0.8 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              className="absolute -top-1 -translate-y-full whitespace-nowrap rounded-full bg-lime-300 px-2 py-0.5 text-[clamp(9px,1.1vw,11px)] font-bold text-black shadow-[0_6px_18px_-6px_rgba(190,242,100,.8)]"
              style={{ left: `${((m.a + m.b) / 2) * 100}%`, marginLeft: -18 }}>
              {m.at} · {score(clips[i], 96 - i * 2)}
            </motion.span>
          );
        })}
        <div className="relative flex h-[clamp(28px,5.5vw,52px)] items-center gap-[2px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] px-2">
          {BARS.map((h, i) => {
            const x = i / BARS.length;
            const inMoment = MOMENTS.some((m) => x >= m.a && x <= m.b);
            const lit = inMoment && p >= x;
            return <span key={i} className="flex-1 rounded-full transition-colors duration-300" style={{ height: `${h * 70}%`, background: lit ? "#bef264" : inMoment ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.14)" }} />;
          })}
          <span className="absolute inset-y-1 w-[2px] rounded bg-white shadow-[0_0_10px_2px_rgba(255,255,255,.6)]" style={{ left: `${p * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ── Scene 3: a lineup of vertical clips with scores + karaoke captions ── */
const CAPTION_STYLES = [
  { name: "Karaoke", wrap: "uppercase font-extrabold text-white [text-shadow:0_2px_4px_rgba(0,0,0,.85)]", hit: "bg-lime-300 text-black [text-shadow:none] rounded px-[0.2em]" },
  { name: "Hormozi", wrap: "uppercase font-black text-white [-webkit-text-stroke:0.6px_#000] [text-shadow:0_3px_0_#000]", hit: "text-yellow-300" },
  { name: "Boxed", wrap: "font-bold text-white", hit: "bg-white text-black rounded-md px-[0.3em]" },
  { name: "Neon", wrap: "uppercase font-extrabold text-white/90 [text-shadow:0_0_8px_rgba(56,189,248,.9),0_2px_4px_rgba(0,0,0,.8)]", hit: "text-sky-300 [text-shadow:0_0_12px_rgba(56,189,248,1),0_0_24px_rgba(56,189,248,.7)]" },
] as const;
function Captions({ text, styleIdx, playing, reduce }: { text: string; styleIdx: number; playing: boolean; reduce: boolean }) {
  const st = CAPTION_STYLES[styleIdx % CAPTION_STYLES.length];
  const words = useMemo(() => text.replace(/\s+/g, " ").trim().split(" ").slice(0, 4), [text]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!playing || reduce || words.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % words.length), 420);
    return () => window.clearInterval(t);
  }, [playing, reduce, words.length]);
  return (
    <div className={`flex flex-wrap justify-center gap-x-[0.25em] px-1 text-center text-[clamp(8px,1.25vw,13px)] leading-tight ${st.wrap}`}>
      {words.map((w, j) => (
        <span key={j} className={`transition-colors duration-150 ${j === i ? st.hit : ""}`}>{w}</span>
      ))}
    </div>
  );
}
function ClipsScene({ playing, clips, reduce }: { playing: boolean; clips: Clip[]; reduce: boolean }) {
  const lineup = [0, 1, 2, 3].map((i) => clips[i + 1] ?? clips[i]);
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-[2.5%] px-[6%]">
      <motion.span
        initial={false}
        animate={playing ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
        transition={{ duration: 0.5, ease: EASE, delay: playing && !reduce ? 0.5 : 0 }}
        className={`absolute left-1/2 top-[3.5%] z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/25 bg-gradient-to-b from-white/[0.22] to-white/[0.06] px-3.5 py-1.5 text-[clamp(8px,1.1vw,12px)] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.06),0_10px_30px_-10px_rgba(0,0,0,0.7),0_0_24px_-8px_rgba(190,242,100,0.45)] backdrop-blur-xl backdrop-saturate-150 ${manrope}`}
      >
        <span className="relative grid size-2 place-items-center">
          <motion.span className="absolute inset-0 rounded-full bg-lime-300" animate={playing && !reduce ? { scale: [1, 2.6], opacity: [0.7, 0] } : {}} transition={{ duration: 1.4, repeat: Infinity }} />
          <span className="relative size-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,242,100,1)]" />
        </span>
        4 clips ready
        <span className="h-3 w-px bg-white/25" />
        <span className="text-white/70">9:16</span>
        <span className="h-3 w-px bg-white/25" />
        <span className="text-lime-200">4 caption styles</span>
      </motion.span>
      {lineup.map((clip, i) => (
        <motion.div key={i}
          initial={false}
          animate={playing ? { opacity: 1, y: 0, rotate: 0 } : { opacity: 0.4, y: 18, rotate: (i - 1.5) * 4 }}
          transition={{ duration: 0.7, ease: EASE, delay: playing && !reduce ? 0.12 * i : 0 }}
          className={`relative mt-[6%] aspect-[9/16] h-[72%] overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_24px_50px_-22px_rgba(0,0,0,.95)] ${i === 3 ? "hidden sm:block" : ""}`}
        >
          <ClipVideo clip={clip} playing={playing} className="absolute inset-0 size-full" />
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full border border-white/15 bg-black/50 px-1.5 py-0.5 text-[clamp(8px,1.1vw,11px)] font-bold text-lime-300 backdrop-blur">
            {score(clip, 95 - i)}<span className="font-medium text-white/60">/100</span>
          </span>
          <span className="absolute right-1.5 top-1.5 rounded-full border border-white/20 bg-white/15 px-1.5 py-0.5 text-[clamp(6px,0.85vw,9px)] font-semibold text-white backdrop-blur-md">{CAPTION_STYLES[i].name}</span>
          <div className="absolute inset-x-0 bottom-[14%]"><Captions text={clip?.caption || "This changed everything for me"} styleIdx={i} playing={playing} reduce={reduce} /></div>
        </motion.div>
      ))}
    </div>
  );
}

/* ── Scene 5: scheduled → posted on every channel, views climbing ── */
const CHANNELS = [
  { name: "TikTok", Icon: TikTokIcon, time: "9:00 AM" },
  { name: "Instagram", Icon: InstagramIcon, time: "12:30 PM" },
  { name: "YouTube", Icon: YouTubeIcon, time: "6:00 PM" },
];
function PublishScene({ playing, clip, reduce }: { playing: boolean; clip?: Clip; reduce: boolean }) {
  const [posted, setPosted] = useState(reduce ? 3 : 0);
  const [views, setViews] = useState(reduce ? 48210 : 0);
  useEffect(() => {
    if (!playing || reduce) return;
    const timers = [0, ...CHANNELS.map((_, i) => 900 + i * 1100)].map((ms, i) => window.setTimeout(() => setPosted(i), ms));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 5600); setViews(Math.round(48210 * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
  }, [playing, reduce]);
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-[5%] px-[6%]">
      <div className="relative aspect-[9/16] h-[80%] overflow-hidden rounded-2xl border border-white/12 bg-black shadow-[0_30px_70px_-28px_rgba(0,0,0,.95)]">
        <ClipVideo clip={clip} playing={playing} className="absolute inset-0 size-full" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-8">
          <p className="text-[clamp(9px,1.2vw,12px)] font-semibold text-white">{clip?.agentName ?? "Your agent"}</p>
          <p className="flex items-center gap-1 text-[clamp(9px,1.1vw,11px)] tabular-nums text-white/75">▶ {views.toLocaleString()} views</p>
        </div>
      </div>
      <div className="flex w-[40%] max-w-[300px] flex-col gap-[clamp(6px,1.2vw,12px)]">
        {CHANNELS.map(({ name, Icon, time }, i) => {
          const done = posted > i;
          return (
            <motion.div key={name} initial={false}
              animate={{ borderColor: done ? "rgba(190,242,100,.45)" : "rgba(255,255,255,.1)", backgroundColor: done ? "rgba(190,242,100,.08)" : "rgba(255,255,255,.04)" }}
              className="flex items-center gap-[clamp(6px,1vw,10px)] rounded-xl border px-[clamp(8px,1.4vw,14px)] py-[clamp(6px,1.1vw,10px)]">
              <span className="grid size-[clamp(22px,3.2vw,32px)] shrink-0 place-items-center rounded-lg bg-white/10 text-white"><Icon className="size-[55%]" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[clamp(10px,1.3vw,13px)] font-semibold text-white">{name}</p>
                <p className="text-[clamp(9px,1.1vw,11px)] text-white/50">Today · {time}</p>
              </div>
              <motion.span key={done ? "p" : "s"} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 24 }}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[clamp(8px,1vw,10px)] font-bold ${done ? "bg-lime-300 text-black" : "bg-white/10 text-white/60"}`}>
                {done ? "Posted ✓" : "Scheduled"}
              </motion.span>
            </motion.div>
          );
        })}
        <motion.div
          initial={false}
          animate={posted >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 10, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 320, damping: 22 }}
          className={`flex items-center gap-[clamp(6px,1vw,10px)] rounded-xl bg-lime-300 px-[clamp(8px,1.4vw,14px)] py-[clamp(6px,1.1vw,10px)] text-black shadow-[0_14px_34px_-14px_rgba(190,242,100,.8)] ${manrope}`}
        >
          <span className="grid size-[clamp(18px,2.6vw,26px)] shrink-0 place-items-center rounded-full bg-black text-lime-300 text-[clamp(10px,1.4vw,14px)] font-bold">$</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[clamp(10px,1.3vw,13px)] font-bold">Agent rewarded</p>
            <p className="text-[clamp(8px,1vw,11px)] font-medium text-black/60">Paid per verified view</p>
          </div>
          <span className="font-mono text-[clamp(10px,1.4vw,14px)] font-extrabold tabular-nums">+${(views * 0.0003).toFixed(2)}</span>
        </motion.div>
      </div>
    </div>
  );
}

export function FeatureShowcaseCarousel() {
  const [active, setActive] = useState(0);
  const [cardWidth, setCardWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [clips, setClips] = useState<Clip[]>([]);
  const sectionRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const touchStartX = useRef<number | null>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => setCardWidth(card.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const move = (direction: number) => setActive((c) => (c + direction + STEPS.length) % STEPS.length);
  const running = !paused && visible && !reduce;

  const scene = (key: (typeof STEPS)[number]["key"], playing: boolean) => {
    switch (key) {
      case "link": return <LinkScene playing={playing} clips={clips} reduce={reduce} />;
      case "moments": return <MomentsScene playing={playing} clips={clips} reduce={reduce} />;
      case "clips": return <ClipsScene playing={playing} clips={clips} reduce={reduce} />;
      case "campaigns": return <CampaignNetworkIllustration playing={playing} reducedMotion={reduce} clips={clips} />;
      case "publish": return <PublishScene playing={playing} clip={clips[5] ?? clips[0]} reduce={reduce} />;
    }
  };

  return (
    <section
      ref={sectionRef}
      aria-label="How Vello works"
      aria-roledescription="carousel"
      className="relative z-10 mt-11 w-full overflow-hidden pb-12 font-[family-name:var(--font-geist-sans)] sm:mt-16 sm:pb-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const d = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(d) > 45) move(d < 0 ? 1 : -1);
      }}
    >
      <FeedBoundary><FeedLoader onClips={setClips} /></FeedBoundary>
      <style>{`@keyframes vShowFill { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>

      <div className="mx-auto w-[88vw] max-w-[980px] sm:w-[76vw] lg:w-[68vw]">
        <motion.div className="flex items-stretch" style={{ gap: GAP }}
          animate={{ x: -(cardWidth + GAP) * active }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 100, damping: 20 }}>
          {STEPS.map((step, index) => {
            const selected = index === active;
            return (
              <motion.article key={step.key} ref={index === 0 ? cardRef : undefined}
                aria-label={step.title} aria-roledescription="slide" aria-hidden={!selected}
                onClick={() => !selected && setActive(index)}
                className={`w-[88vw] max-w-[980px] shrink-0 sm:w-[76vw] lg:w-[68vw] ${selected ? "" : "cursor-pointer"}`}
                animate={{ scale: selected ? 1 : 0.9, opacity: selected ? 1 : 0.4 }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 100, damping: 20 }}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] border border-white/10 bg-[#0d100d] shadow-[0_28px_75px_-36px_rgba(0,0,0,0.85)] sm:aspect-[16/9] sm:rounded-[32px]">
                  <div aria-hidden className="absolute inset-0 [background:radial-gradient(70%_60%_at_50%_0%,rgba(190,242,100,0.10),transparent_70%),radial-gradient(60%_60%_at_50%_120%,rgba(255,255,255,0.05),transparent_70%)]" />
                  <div aria-hidden className="absolute inset-0 opacity-[0.18] [background-image:radial-gradient(rgba(255,255,255,0.35)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(70%_70%_at_50%_50%,#000,transparent)]" />
                  {/* Only the visible slide (and its neighbours, paused) mount scenes. */}
                  {Math.abs(index - active) <= 1 && scene(step.key, selected && visible)}
                  <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" />
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      </div>

      {/* Minimal step tabs: the label IS the navigation; the active one fills. */}
      <div className="mx-auto mt-6 w-[88vw] max-w-[980px] sm:mt-8 sm:w-[76vw] lg:w-[68vw]">
        <div className="hidden grid-cols-5 gap-3 sm:grid">
          {STEPS.map((step, i) => (
            <button key={step.key} type="button" onClick={() => setActive(i)} aria-current={i === active ? "step" : undefined}
              className="group text-left focus-visible:outline-none">
              <span className="block h-[2px] overflow-hidden rounded-full bg-white/12">
                {i === active && (
                  <span key={`${active}`} className="block h-full origin-left bg-lime-300"
                    style={{ animation: `vShowFill ${STEP_MS}ms linear forwards`, animationPlayState: running ? "running" : "paused", transform: reduce ? "scaleX(1)" : undefined }}
                    onAnimationEnd={() => setActive((c) => (c + 1) % STEPS.length)} />
                )}
              </span>
              <span className={`mt-2.5 block text-[13px] font-medium transition-colors ${i === active ? "text-white" : "text-white/40 group-hover:text-white/70"}`}>{step.title}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col items-center gap-3 sm:hidden">
          <motion.p key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[15px] font-medium text-white">{STEPS[active].title}</motion.p>
          <div className="flex w-full gap-1.5">
            {STEPS.map((step, i) => (
              <button key={step.key} type="button" aria-label={step.title} onClick={() => setActive(i)} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
                {i < active && <span className="block h-full bg-lime-300/60" />}
                {i === active && (
                  <span key={`m${active}`} className="block h-full origin-left bg-lime-300"
                    style={{ animation: `vShowFill ${STEP_MS}ms linear forwards`, animationPlayState: running ? "running" : "paused" }}
                    onAnimationEnd={() => setActive((c) => (c + 1) % STEPS.length)} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{STEPS[active].title}</p>
    </section>
  );
}
