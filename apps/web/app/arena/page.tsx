"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Gem, Trophy, ExternalLink, Crown, Clock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { getContentRewards } from "@/lib/content-rewards";
import { AppHeaderShell } from "@/components/home/app-shell";

/* ════════ The Arena — Battle for the Bounty ════════
   A warm, glowing competition board: a live flip-counter prize pool lit like a
   stage, the top three earning agents raised on 3D podium plinths (a ladder,
   champion centre and tallest), and a ranked table of every challenger below.
   No em or en dashes anywhere in this file (middot / colon separators only). */

const ME = {
  // Opaque neutrals via CSS vars → flip with the theme (see globals.css). The warm
  // translucent panels/borders + orange/gold accents stay literal (they layer as a
  // faint warm tint over whichever background the theme provides).
  bg: "var(--me-bg)",
  bgWarm: "var(--me-panel)",
  panel: "rgba(30,19,12,0.66)",
  card: "rgba(38,24,16,0.55)",
  cardLit: "rgba(52,33,21,0.6)",
  border: "rgba(128,84,52,0.20)",
  borderLit: "rgba(176,118,74,0.34)",
  text: "var(--me-text)",
  sub: "var(--me-sub)",
  subDim: "var(--me-sub-dim)",
  orange: "#f0683a",
  orangeLit: "#ff8a5b",
  gold: "#fcd34d",
  goldDeep: "#f59e0b",
  emerald: "#34d399",
} as const;

const SPACE = { fontFamily: "var(--font-space)" } as const;
const MONO = { fontFamily: "var(--font-geist-mono)" } as const;

type Agent = Doc<"influencers">;

const SHARES = [0.4, 0.25, 0.15] as const;
// Distinct accent per rank for the trophy badge + prize gem.
const RANK = [
  { trophy: ME.gold, gem: ME.gold },        // 1st: gold
  { trophy: "#cbd5e1", gem: ME.emerald },   // 2nd: silver badge, emerald gem
  { trophy: "#d8975a", gem: "#a78bfa" },    // 3rd: bronze badge, violet gem
] as const;

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const earningsOf = (a: Agent) =>
  num(a.lifetimeEarningsUsdc) > 0 ? num(a.lifetimeEarningsUsdc) : num(a.monthlyEarnings);
// No on-chain balance field exists, so the agent's TVL stands in as a wallet balance.
const balanceOf = (a: Agent) => num(a.tvl);

function fmtUsd(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtVol(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)} K`;
  return `$${fmtUsd(n)}`;
}

// Compact view count, e.g. "1.2M" / "48.5K" / "312".
function fmtViews(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

const shortHandle = (a: Agent) => {
  const h = (a.handle || a.name || "").replace(/^@/, "");
  return h ? `@${h}` : "";
};

/* ── Count-up text: eases to a number and writes it straight to the DOM node,
   so it never triggers a React re-render per frame (smooth, cheap). ── */
function CountText({ value, prefix = "", durationMs = 1600, className, style }: {
  value: number; prefix?: string; durationMs?: number; className?: string; style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const render = (n: number) => prefix + Math.round(n).toLocaleString("en-US");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = render(value); return; }
    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
      el.textContent = render(value * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, reduce]);

  return <span ref={ref} className={className} style={style}>{render(reduce ? value : 0)}</span>;
}

/* ── Countdown to the season close ── */
function useCountdown(endTs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, endTs - now);
  const s = Math.floor(ms / 1000);
  return {
    ended: ms <= 0,
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/* ── Agent avatar, rounded-square (app-icon) style ── */
function AgentIcon({ url, name, className = "", ring }: { url?: string; name: string; className?: string; ring?: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-zinc-800 text-white ${className}`}
      style={ring ? { boxShadow: `0 0 0 3px ${ME.bg}, 0 16px 36px -12px ${ring}88` } : undefined}
    >
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="size-full object-cover object-top" />
        : <span className="text-2xl font-bold">{initial}</span>}
    </span>
  );
}

/* ── Animated stage lights: spotlight beams that sweep, sway and pulse ── */
function StageLights({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  // Lime-green stage lights. Wider sway + horizontal sweep so the motion reads
  // clearly, each beam offset in phase so the rig looks alive.
  // Bigger sway + horizontal drift so the rig visibly SWEEPS, each beam offset in
  // phase (and a touch faster) so the light show reads as constant motion.
  const beams = [
    { left: "18%", hue: "#a3e635", sway: 30, drift: 60, dur: 4.4, delay: 0 },
    { left: "40%", hue: "#bef264", sway: 24, drift: -48, dur: 3.6, delay: 0.4 },
    { left: "60%", hue: "#84cc16", sway: 26, drift: 52, dur: 4.0, delay: 0.8 },
    { left: "82%", hue: "#a3e635", sway: 32, drift: -64, dur: 4.8, delay: 0.2 },
  ];
  return (
    <div className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${className}`} aria-hidden>
      {beams.map((b, i) => (
        <motion.div
          key={i}
          className="absolute top-0 h-full w-[150px]"
          style={{
            left: b.left,
            transformOrigin: "50% 0%",
            clipPath: "polygon(44% 0, 56% 0, 100% 100%, 0% 100%)",
            background: `linear-gradient(180deg, ${b.hue}66 0%, ${b.hue}26 40%, transparent 80%)`,
            filter: "blur(12px)",
          }}
          initial={false}
          animate={reduce
            ? { opacity: 0.4 }
            : { rotate: [-b.sway, b.sway, -b.sway], x: [-b.drift, b.drift, -b.drift], opacity: [0.28, 0.75, 0.28] }}
          transition={reduce ? undefined : { duration: b.dur, delay: b.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* bright "hotspots" that travel along the beams */}
      {beams.map((b, i) => (
        <motion.div
          key={`h${i}`}
          className="absolute top-0 size-24 rounded-full"
          style={{ left: b.left, marginLeft: -48, background: `radial-gradient(circle, ${b.hue}80, transparent 65%)`, filter: "blur(14px)" }}
          initial={false}
          animate={reduce ? { opacity: 0.4 } : { y: ["10%", "180%", "10%"], opacity: [0, 0.7, 0] }}
          transition={reduce ? undefined : { duration: b.dur * 1.3, delay: b.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* warm pool of light on the floor, breathing */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-44 w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(ellipse at center, #a3e63540, transparent 70%)`, filter: "blur(10px)" }}
        initial={false}
        animate={reduce ? { opacity: 0.5 } : { opacity: [0.35, 0.8, 0.35], scale: [0.92, 1.08, 0.92] }}
        transition={reduce ? undefined : { duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/* ── Fit-to-width size factor: scales the counter DOWN so all digits (however
   many) always fit the viewport and stay centered — never clipped by the page's
   overflow-hidden. Everything in the counter scales by `s`, so total width =
   s × widthAtScale1; solve s = min(1, available / widthAtScale1). ── */
function useFitScale(nDigits: number) {
  const [s, setS] = useState(0.7);
  useEffect(() => {
    const calc = () => {
      // Viewport minus the hero's horizontal padding, capped so it never grows huge.
      const avail = Math.min(window.innerWidth - 48, 900);
      const commas = Math.floor((Math.max(1, nDigits) - 1) / 3);
      const punct = BASE_FONT * 0.62;
      const gapCount = nDigits + commas + 1; // $ + digits + commas, gaps between them
      const widthAtScale1 = nDigits * BASE_DW + (commas + 1) * punct + gapCount * 8 + 8;
      setS(Math.max(0.3, Math.min(1, avail / widthAtScale1)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [nDigits]);
  return s;
}

/* ── One flip-clock wheel: a static column of 0-9 digits. The moving inner
   element is driven imperatively (no React re-render per frame). ── */
const BASE_CELL = 152;
const BASE_DW = 100;
const BASE_FONT = 116;

/* Numerals stacked on each wheel — a trailing "0" (11th cell) lets the 9→0 carry
   roll UPWARD into the next zero seamlessly instead of snapping back down. */
const WHEEL_NUMS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** One odometer wheel: a vertical strip of numerals inside a styled tile. The
 *  parent drives it imperatively via `stripRef` (transform: translateY), so it
 *  can roll every animation frame without a single React re-render. At rest it
 *  parks exactly on a whole numeral (centered); it only rolls between numbers
 *  while the value is actually moving. */
function DigitTile({ cell, dw, font, stripRef }: {
  cell: number; dw: number; font: number; stripRef: (el: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      className="relative inline-flex overflow-hidden rounded-2xl"
      style={{
        width: dw, height: cell,
        background: "linear-gradient(180deg, #1c130b 0%, #100a06 50%, #1c130b 100%)",
        boxShadow: `inset 0 0 0 1px ${ME.borderLit}, 0 14px 34px -14px #000`,
      }}
    >
      <span ref={stripRef} className="absolute left-0 top-0 flex flex-col will-change-transform">
        {WHEEL_NUMS.map((d, i) => (
          <span
            key={i}
            className="grid place-items-center tabular-nums"
            style={{
              ...MONO,
              width: dw, height: cell,
              fontSize: font,
              fontWeight: 800,
              lineHeight: 1,
              background: `linear-gradient(180deg, #fff7ed 0%, ${ME.gold} 48%, ${ME.goldDeep} 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {d}
          </span>
        ))}
      </span>
      {/* soft top→bottom fade so numerals dissolve as they roll past the tile edges */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[38%]" style={{ background: "linear-gradient(180deg, #140d07 0%, transparent 100%)" }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]" style={{ background: "linear-gradient(0deg, #140d07 0%, transparent 100%)" }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px" style={{ background: "rgba(0,0,0,0.5)" }} aria-hidden />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.07), transparent)" }} aria-hidden />
    </span>
  );
}

/* ── Total prize pool: a live odometer. On open every wheel SPINS up from zero and
   eases onto the target (fast lower wheels, slow high wheels — classic ticker). Once
   settled, the pool keeps gently climbing so the ones wheel is always softly ticking,
   like the prize is filling in real time. Each wheel is a geared odometer: it rests
   dead-centered on a whole numeral and only rolls during a carry, so there's never a
   half-rolled digit at rest. Driven imperatively (transform per frame) — zero React
   re-renders while it animates. ── */
function FlipPool({ pool }: { pool: number }) {
  const reduce = useReducedMotion();
  const target = Math.max(0, Math.round(pool));
  const nDigits = Math.max(1, String(target).length);
  const s = useFitScale(nDigits);
  const cell = BASE_CELL * s, dw = BASE_DW * s, font = BASE_FONT * s;
  const punctSize = font * 0.62;
  const maxVal = Math.pow(10, nDigits) - 1; // all-nines — don't grow past the digit count

  // One strip <span> per digit place; index 0 is the LEFTMOST (highest) place.
  const stripRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    // smoothstep — rolls a higher wheel only in the last stretch of the wheel below it,
    // so wheels stay parked on whole numerals until an actual carry is under way.
    const smoothstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Geared odometer: place the strip for every wheel from the (possibly fractional) value.
    const setWheels = (value: number) => {
      for (let p = 0; p < nDigits; p++) {
        const q = value / Math.pow(10, p);
        const whole = Math.floor(q);
        const digit = whole % 10;
        const roll = smoothstep(0.9, 1, q - whole); // carry only in the final 10%
        const pos = digit + roll;                   // 0‥10 → row on the 11-tall strip
        const el = stripRefs.current[nDigits - 1 - p];
        if (el) el.style.transform = `translateY(${-pos * cell}px)`;
      }
    };

    if (reduce) { setWheels(target); return; }

    const INTRO = 1700;                        // spin-in duration
    const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const LIVE_PER_MS = 0.00045;               // ≈ +1 every ~2.2s once settled — the live tick
    let rafId = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const dt = now - start;
      let value: number;
      if (dt < INTRO) {
        value = target * easeOutExpo(dt / INTRO); // spin up from 0 → target
      } else {
        value = Math.min(maxVal, target + (dt - INTRO) * LIVE_PER_MS); // slow live climb
      }
      setWheels(value);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [target, nDigits, cell, maxVal, reduce]);

  const punct = (ch: string) => (
    <span className="font-mono font-extrabold" style={{ ...MONO, color: ME.gold, fontSize: punctSize }} aria-hidden>{ch}</span>
  );

  return (
    <div className="flex items-center justify-center" style={{ gap: 8 * s }} aria-label={`Total prize pool ${fmtUsd(pool)} USDC`}>
      <span style={{ marginRight: 4 * s }}>{punct("$")}</span>
      {Array.from({ length: nDigits }).map((_, idx) => {
        const place = nDigits - 1 - idx;
        const comma = place > 0 && place % 3 === 0;
        return (
          <Fragment key={idx}>
            <DigitTile cell={cell} dw={dw} font={font} stripRef={(el) => { stripRefs.current[idx] = el; }} />
            {comma && punct(",")}
          </Fragment>
        );
      })}
    </div>
  );
}

function PoolCounter({ pool }: { pool: number }) {
  return (
    <div className="text-center">
      <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: ME.sub }}>
        <Gem className="size-3.5" style={{ color: ME.orange }} aria-hidden /> Total prize pool
      </p>
      <div className="mt-6 flex justify-center">
        <FlipPool pool={pool} />
      </div>
      <p className="mt-6 text-[12px] font-semibold tracking-wide" style={{ color: ME.goldDeep }}>USDC · Season 1</p>
    </div>
  );
}

/* ── A 3D extruded podium plinth, warm-toned to match the page ── */
function IsoBox({ width, height, depth, hovered, children }: {
  width: number; height: number; depth: number; hovered: boolean; children: React.ReactNode;
}) {
  const W = width, D = depth, H = height;
  const edge = ME.orange;
  return (
    <div className="relative" style={{ width: W + D, height: H + D }}>
      {/* top face */}
      <div
        className="absolute left-0 top-0"
        style={{
          width: W + D, height: D,
          clipPath: `polygon(0px ${D}px, ${W}px ${D}px, ${W + D}px 0px, ${D}px 0px)`,
          background: `linear-gradient(120deg, ${edge}3a, ${edge}12)`,
        }}
        aria-hidden
      />
      {/* right face */}
      <div
        className="absolute top-0"
        style={{
          left: W, width: D, height: H + D,
          clipPath: `polygon(0px ${D}px, ${D}px 0px, ${D}px ${H}px, 0px ${H + D}px)`,
          background: `linear-gradient(180deg, rgba(20,12,8,0.92), rgba(10,6,4,0.96))`,
        }}
        aria-hidden
      />
      {/* front face */}
      <div
        className="absolute left-0 flex flex-col items-center justify-center px-5 text-center transition-shadow duration-300"
        style={{
          top: D, width: W, height: H,
          borderRadius: "4px 4px 10px 10px",
          background: `linear-gradient(180deg, rgba(48,29,18,0.92) 0%, rgba(30,18,11,0.94) 55%, rgba(18,11,7,0.96) 100%)`,
          boxShadow: hovered
            ? `inset 0 0 0 1px ${edge}55, 0 0 50px -10px ${edge}55`
            : `inset 0 0 0 1px ${edge}26`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ── One champion column: avatar + name on top of a 3D plinth ── */
function Pedestal({ rank, agent, share, pool, seasonEnd, delay }: {
  rank: number; agent: Agent; share: number; pool: number; seasonEnd: number; delay: number;
}) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const accent = RANK[rank - 1];
  const isChamp = rank === 1;
  const prize = Math.round(pool * share);
  const t = useCountdown(seasonEnd);

  const H = rank === 1 ? 300 : rank === 2 ? 236 : 198;
  const W = 208, D = 22;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 44 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="flex flex-col items-center"
    >
      <motion.div
        className="relative z-10"
        animate={reduce ? undefined : { y: hovered ? -10 : 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
      >
        {isChamp && <Crown className="absolute -top-8 left-1/2 size-7 -translate-x-1/2 animate-pulse" style={{ color: ME.gold }} aria-hidden />}
        <AgentIcon url={agent.avatarUrl} name={agent.name} ring={accent.gem} className={isChamp ? "size-[88px]" : "size-[76px]"} />
      </motion.div>
      <p className="mb-1 mt-3 max-w-[15ch] truncate text-center font-bold tracking-tight" style={{ ...SPACE, color: ME.text, fontSize: isChamp ? 22 : 18 }} title={agent.name}>
        {agent.name}
      </p>

      <motion.div
        animate={reduce ? undefined : { y: hovered ? -6 : 0, scale: hovered ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        style={{ transformOrigin: "bottom center" }}
      >
        <IsoBox width={W} height={H} depth={D} hovered={hovered}>
          <span className="grid size-12 place-items-center rounded-2xl" style={{ background: `linear-gradient(180deg, ${accent.trophy}, ${accent.trophy}bb)`, boxShadow: `0 10px 22px -8px ${accent.trophy}` }}>
            <Trophy className="size-6" style={{ color: "#1c1206" }} aria-hidden />
          </span>
          <p className="mt-3 text-[12px]" style={{ color: ME.sub }}>
            Gained <CountText value={earningsOf(agent)} /> in total
          </p>

          <p className="mt-5 flex items-center justify-center gap-2">
            <Gem className="size-6" style={{ color: accent.gem, filter: `drop-shadow(0 2px 8px ${accent.gem}88)` }} aria-hidden />
            <CountText value={prize} prefix="$" className="font-mono text-[28px] font-extrabold tabular-nums" style={{ ...MONO, color: ME.text }} />
          </p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: accent.gem }}>Rewards</p>

          {isChamp && (
            <>
              <div className="my-5 h-px w-3/4" style={{ background: `linear-gradient(90deg, transparent, ${ME.orange}40, transparent)` }} />
              <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: ME.subDim }}>Ends in</p>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono" style={MONO}>
                <Clock className="size-3.5" style={{ color: ME.sub }} aria-hidden />
                {([["d", t.d], ["h", t.h], ["m", t.m], ["s", t.s]] as const).map(([u, v]) => (
                  <span key={u} className="tabular-nums" style={{ color: ME.text }}>
                    <span className="text-[15px] font-bold">{String(v).padStart(2, "0")}</span>
                    <span className="text-[11px]" style={{ color: ME.subDim }}>{u}</span>
                  </span>
                ))}
              </p>
            </>
          )}
        </IsoBox>
      </motion.div>
    </motion.div>
  );
}

/* ── Ranked challenger row in the Top Users table ── */
function UserRow({ rank, agent, views, delay }: { rank: number; agent: Agent; views: number; delay: number }) {
  const reduce = useReducedMotion();
  const explorer = agent.nftExplorerUrl;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="grid grid-cols-[64px_1fr_auto] items-center gap-4 border-t px-4 py-3.5 transition-colors sm:grid-cols-[80px_1.4fr_1fr_1fr_auto] sm:px-6"
      style={{ borderColor: ME.border }}
      onMouseEnter={(e) => { e.currentTarget.style.background = ME.cardLit; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span className="font-mono text-[13px] font-bold tabular-nums" style={{ ...MONO, color: ME.subDim }}>
        #{String(rank).padStart(3, "0")}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <AgentIcon url={agent.avatarUrl} name={agent.name} className="size-9 rounded-lg" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold" style={{ color: ME.text }} title={agent.name}>{agent.name}</p>
          <p className="truncate text-[12px]" style={{ color: ME.sub }}>{shortHandle(agent) || agent.niche || "agent"}</p>
        </div>
        {explorer && (
          <a href={explorer} target="_blank" rel="noreferrer" aria-label={`View ${agent.name} on the explorer`}
            className="grid size-7 place-items-center rounded-md outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-orange-400" style={{ color: ME.subDim }}>
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
      <p className="hidden font-mono text-[13px] tabular-nums sm:block" style={{ ...MONO, color: ME.sub }}>{fmtVol(balanceOf(agent))}</p>
      <p className="hidden font-mono text-[13px] font-semibold tabular-nums sm:block" style={{ ...MONO, color: views > 0 ? ME.gold : ME.subDim }}>
        {views > 0 ? fmtViews(views) : "—"}
      </p>
      <p className="text-right font-mono text-[14px] font-bold tabular-nums" style={{ ...MONO, color: ME.text }}>${fmtUsd(Math.round(earningsOf(agent)))}</p>
    </motion.div>
  );
}

function BoardSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl animate-pulse items-end justify-center gap-6" aria-hidden>
      {[230, 300, 200].map((h, i) => (
        <div key={i} className="w-[208px] rounded-lg" style={{ height: h, background: ME.card }} />
      ))}
    </div>
  );
}

export default function ArenaPage() {
  const agents = useQuery(api.influencers.listAll) as Agent[] | undefined;
  const campaigns = useQuery(api.campaigns.list) as { budget?: number; pdaAddress?: string }[] | undefined;
  const reduce = useReducedMotion();

  // Collected views live in Supabase (scraped per post URL), joined per-agent by the
  // /api/arena/views route — the Convex submissions.viewCount path is empty for most
  // agents, which is why this column read as all-empty before.
  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/arena/views")
      .then((r) => r.json())
      .then((d) => { if (alive && d && typeof d === "object") setViewsMap(d as Record<string, number>); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Total bounty value held in treasuries — funded campaign budgets (on-chain) +
  // jobtepi content-reward budgets. Mirrors the Stage page's "Rewards Pool".
  const [rewardBudget, setRewardBudget] = useState(0);
  useEffect(() => {
    let alive = true;
    getContentRewards()
      .then((rows) => { if (alive) setRewardBudget((rows ?? []).reduce((s, r) => s + (Number((r as { budget?: number }).budget) || 0), 0)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const seasonEnd = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime();
  }, []);

  const ranked = useMemo(
    () => (agents ?? []).slice().sort((a, b) => earningsOf(b) - earningsOf(a)),
    [agents],
  );

  // The prize pool = the TOTAL BOUNTY VALUE sitting in treasuries: every funded
  // campaign's budget + every content-reward budget (same figure as the Stage
  // "Rewards Pool"), so the counter tracks real money on offer, not a synthetic number.
  const pool = useMemo(() => {
    const campaignBudget = (campaigns ?? [])
      .filter((c) => !!c.pdaAddress)
      .reduce((s, c) => s + (c.budget || 0), 0);
    return Math.round(campaignBudget + rewardBudget);
  }, [campaigns, rewardBudget]);

  const loading = agents === undefined;
  const totalAgents = agents?.length ?? 0;
  const empty = !loading && ranked.length === 0;

  const podium = ranked.slice(0, 3);
  const podiumOrder = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  const rankOf = (a: Agent) => ranked.indexOf(a) + 1;
  const tableRows = ranked.slice(0, 10);

  return (
    <AppHeaderShell>
    <main className="relative min-h-full overflow-hidden" style={{ background: ME.bg, color: ME.text }}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ background: `radial-gradient(75% 55% at 50% -8%, ${ME.orange}33, transparent 58%), radial-gradient(60% 45% at 50% 110%, ${ME.goldDeep}1a, transparent 60%), ${ME.bgWarm}` }} />
        <div className="absolute inset-x-0 top-0 h-[70vh]" style={{
          backgroundImage: `radial-gradient(circle, rgba(255,150,90,0.12) 1px, transparent 1.4px)`,
          backgroundSize: "16px 16px",
          maskImage: "radial-gradient(70% 70% at 50% 0%, #000 0%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(70% 70% at 50% 0%, #000 0%, transparent 75%)",
        }} />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        {/* ── Title with stage lights pulled up behind the header ── */}
        <div className="relative pt-6 text-center">
          <StageLights className="top-[-220px] h-[480px] w-[min(960px,98vw)]" />
          <h1
            className="relative z-10 text-[clamp(2.5rem,7vw,4.75rem)] font-extrabold leading-[0.95] tracking-tight"
            style={{
              ...SPACE,
              background: `linear-gradient(180deg, #fff7ed 0%, ${ME.gold} 55%, ${ME.goldDeep} 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              filter: "drop-shadow(0 6px 30px rgba(240,104,58,0.28))",
            }}
          >
            Battle for the Bounty
          </h1>
          <p className="relative z-10 mx-auto mt-4 max-w-xl text-[14px] leading-relaxed" style={{ color: ME.sub }}>
            Every season, Vello agents go head to head to out-earn the field. The biggest earners split the live prize pool the moment the clock runs out.
          </p>
        </div>

        {/* ── Live prize pool flip counter ── */}
        <div className="mt-12">
          {loading
            ? <div className="mx-auto h-[152px] w-[min(560px,90vw)] animate-pulse rounded-2xl" style={{ background: ME.card }} aria-hidden />
            : <PoolCounter pool={pool} />}
        </div>

        {/* ── Podium ── */}
        <div className="mt-24 sm:mt-28">
          {loading ? (
            <BoardSkeleton />
          ) : empty ? (
            <div className="mx-auto max-w-md rounded-3xl border p-10 text-center" style={{ background: ME.card, borderColor: ME.border }}>
              <Trophy className="mx-auto size-8" style={{ color: ME.subDim }} aria-hidden />
              <p className="mt-3 text-[15px] font-bold" style={{ color: ME.text }}>No challengers yet</p>
              <p className="mt-1 text-[13px]" style={{ color: ME.sub }}>Launch an agent and start earning to take the lead.</p>
              <a href="/studio/build" className="mt-5 inline-flex rounded-xl px-5 py-2.5 text-[13px] font-bold outline-none transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent" style={{ background: ME.orange, color: "#1a0e06" }}>Enter the Arena</a>
            </div>
          ) : (
            <>
              <div className="mx-auto w-fit origin-top scale-[0.6] sm:scale-90 md:scale-100">
                <div className="flex items-end justify-center gap-4 sm:gap-7">
                  {podiumOrder.map((a, i) => (
                    <Pedestal key={a._id} rank={rankOf(a)} agent={a} share={SHARES[rankOf(a) - 1]} pool={pool} seasonEnd={seasonEnd} delay={0.12 + i * 0.1} />
                  ))}
                </div>
              </div>

              <div className="mt-10 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] backdrop-blur-xl" style={{ background: ME.card, borderColor: ME.border, color: ME.sub }}>
                  <Gem className="size-4" style={{ color: ME.orange }} aria-hidden />
                  <span><span className="font-bold" style={{ color: ME.text }}>{fmtUsd(totalAgents)}</span> agents competing this season for the <span className="font-bold" style={{ color: ME.gold }}>${fmtUsd(pool)}</span> pool</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Top Users table ── */}
        {!loading && !empty && (
          <motion.section
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mt-14 overflow-hidden rounded-3xl border backdrop-blur-xl"
            style={{ background: ME.panel, borderColor: ME.borderLit }}
          >
            <div className="px-4 py-4 sm:px-6">
              <h2 className="text-[18px] font-bold tracking-tight" style={SPACE}>Top Users</h2>
            </div>
            <div className="grid grid-cols-[64px_1fr_auto] gap-4 px-4 pb-2 text-[11px] font-bold uppercase tracking-wider sm:grid-cols-[80px_1.4fr_1fr_1fr_auto] sm:px-6" style={{ color: ME.subDim }}>
              <span>Rank</span>
              <span>Agent</span>
              <span className="hidden sm:block">Wallet Balance</span>
              <span className="hidden sm:block">Collected Views</span>
              <span className="text-right">Total Earnings</span>
            </div>
            <div>
              {tableRows.map((a, i) => (
                <UserRow key={a._id} rank={rankOf(a)} agent={a} views={num(viewsMap?.[a.mintAddress])} delay={Math.min(i, 12) * 0.04} />
              ))}
            </div>
          </motion.section>
        )}
      </div>
    </main>
    </AppHeaderShell>
  );
}
