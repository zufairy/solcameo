/* Animated technical illustrations for the Vello landing page. Pure SVG/CSS —
   every piece has a perpetual micro-loop (orbit, broadcast wave, typing thread,
   self-drawing chart, verifying network). Lime (#A3E635) is the only accent. */
import { IconInfluencer, IconWorker, IconTrader } from "./icons";
import type { CSSProperties } from "react";

const LIME = "#A3E635";

/* ── Hero: an agent core with orbiting capability nodes + rising data ─────── */
export function HeroIllustration() {
  const nodes = [
    { Icon: IconInfluencer, deg: 0 },
    { Icon: IconWorker, deg: 120 },
    { Icon: IconTrader, deg: 240 },
  ];
  return (
    <div className="vello-float relative mx-auto aspect-square w-full max-w-[440px]">
      {/* soft lime wash */}
      <div className="absolute inset-[12%] rounded-full bg-lime-400/10 blur-3xl" />

      {/* orbit rings */}
      <div className="absolute inset-0 rounded-full border border-white/[0.07]" />
      <div className="absolute inset-[18%] rounded-full border border-white/[0.06]" />

      {/* outer rotating layer with 3 capability nodes */}
      <div className="vello-orbit absolute inset-0">
        {nodes.map(({ Icon, deg }, i) => (
          <div key={i} className="absolute inset-0" style={{ transform: `rotate(${deg}deg)` }}>
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
              {/* counter-rotate so the icon stays upright */}
              <div className="vello-orbit-rev grid h-12 w-12 place-items-center rounded-2xl vello-plate" style={{ animationDuration: "16s" }}>
                <Icon className="h-5 w-5 text-lime-300" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* inner counter-rotating tick ring */}
      <svg viewBox="0 0 100 100" className="vello-orbit-rev absolute inset-[18%]">
        {Array.from({ length: 24 }).map((_, i) => (
          <rect key={i} x="49.4" y="2" width="1.2" height="5" rx="0.6" fill="rgba(255,255,255,0.14)"
            transform={`rotate(${i * 15} 50 50)`} />
        ))}
      </svg>

      {/* center core — Vello app icon (HD, clean, rounded edges only) */}
      <div className="absolute left-1/2 top-1/2 h-[40%] w-[40%] -translate-x-1/2 -translate-y-1/2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/solcameo-mark.png"
          alt="Solcameo"
          decoding="async"
          className="h-full w-full rounded-[1.3rem] object-cover"
        />
      </div>

      {/* rising data particles */}
      {[20, 50, 80].map((left, i) => (
        <span key={i} className="vello-rise absolute bottom-[14%] h-1.5 w-1.5 rounded-full bg-lime-300"
          style={{ left: `${left}%`, animationDelay: `${i * 1.1}s` }} />
      ))}
    </div>
  );
}

/* ── Inline headline chip (signature inline-typography technique) ─────────── */
export function InlineWorkChip() {
  return (
    <span className="mx-1 inline-flex translate-y-[0.08em] items-center gap-1.5 rounded-full bg-lime-400/12 px-2.5 py-1 align-middle ring-1 ring-lime-400/30">
      <span className="relative flex h-1.5 w-1.5">
        <span className="vello-pulse-ring absolute inline-flex h-full w-full rounded-full bg-lime-300" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-300" />
      </span>
      <span className="flex items-end gap-[2px]">
        {[5, 9, 7, 12].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-lime-300/90" style={{ height: `${h}px` }} />
        ))}
      </span>
    </span>
  );
}

/* ── Influencers: a fan of three phones, each playing a different UGC reel ──── */
type Reel = { id: string; handle: string; badge: string };
// Real, embeddable UGC beauty creators (center is a vertical Short).
const FAN_LEFT: Reel = { id: "6kFhFMB-DQg", handle: "@aisha.glow", badge: "1.2M" };
const FAN_CENTER: Reel = { id: "rFn4hZ3J-Go", handle: "@vello.agent", badge: "Live" };
const FAN_RIGHT: Reel = { id: "Kvwn93VPcv0", handle: "@nadia.ai", badge: "480K" };

function ytSrc(id: string) {
  // Looping, muted, controls-free embed cropped to fill a 9:16 phone frame.
  return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&controls=0&playsinline=1&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&disablekb=1`;
}

function FanPhone({ reel, w, dim = false }: { reel: Reel; w: number; dim?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-[1.7rem] border-[3px] border-[#0b0d09] bg-black shadow-[0_30px_70px_-26px_rgba(0,0,0,0.9)] ring-1 ring-white/12"
      style={{ width: w, aspectRatio: "9 / 16" }}
    >
      <iframe
        src={ytSrc(reel.id)}
        title={`${reel.handle} reel`}
        allow="autoplay; encrypted-media; picture-in-picture"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2"
        style={{ border: 0 }}
      />
      {/* legibility gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
      {/* dynamic-island notch */}
      <div className="absolute left-1/2 top-1.5 h-1.5 w-8 -translate-x-1/2 rounded-full bg-black/70 ring-1 ring-white/10" />
      {/* badge pill (Live / view count) */}
      <div className="absolute left-2 top-2.5 flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 ring-1 ring-white/15 backdrop-blur-sm">
        <span className="size-1.5 rounded-full bg-lime-400 animate-pulse" />
        <span className="text-[8px] font-semibold uppercase tracking-wider text-white/90">{reel.badge}</span>
      </div>
      {/* right-rail engagement icons */}
      <div className="absolute bottom-8 right-1.5 flex flex-col items-center gap-1.5">
        {["♥", "💬", "↗"].map((g, i) => (
          <span key={i} className="grid h-5 w-5 place-items-center rounded-full bg-white/15 text-[9px] text-white/95 backdrop-blur-sm">{g}</span>
        ))}
      </div>
      {/* creator handle */}
      <div className="absolute inset-x-2 bottom-2.5">
        <p className="text-[9px] font-semibold text-white">{reel.handle}</p>
      </div>
      {/* depth dim for the back phones */}
      {dim && <div className="pointer-events-none absolute inset-0 bg-black/35" />}
    </div>
  );
}

export function BroadcastIllustration({ className = "" }: { className?: string }) {
  return (
    <div className={`relative mx-auto ${className}`}>
      {/* soft lime wash behind the fan */}
      <div className="pointer-events-none absolute inset-x-4 top-1/4 h-1/2 rounded-full bg-lime-400/12 blur-3xl" />
      <div className="vello-float relative grid place-items-center" style={{ minHeight: 232 }}>
        {/* left phone — rotated back into the fan */}
        <div className="absolute left-1/2 top-1/2 z-10 origin-bottom -translate-x-[calc(50%+52px)] -translate-y-[44%] -rotate-[12deg]">
          <FanPhone reel={FAN_LEFT} w={104} dim />
        </div>
        {/* right phone */}
        <div className="absolute left-1/2 top-1/2 z-10 origin-bottom translate-x-[calc(-50%+52px)] -translate-y-[44%] rotate-[12deg]">
          <FanPhone reel={FAN_RIGHT} w={104} dim />
        </div>
        {/* center phone — forward and upright */}
        <div className="relative z-20">
          <FanPhone reel={FAN_CENTER} w={122} />
        </div>
      </div>
    </div>
  );
}

/* ── Influencer reach: 4-platform spread + compounding audience + paid views ── */
export function InfluencerReachIllustration({ className = "" }: { className?: string }) {
  const PLATFORMS = [
    { name: "TikTok", v: 0.9 },
    { name: "Reels", v: 0.72 },
    { name: "Shorts", v: 0.84 },
    { name: "X", v: 0.5 },
  ];
  return (
    <div className={`w-full ${className}`}>
      {/* platforms she posts to daily */}
      <div className="grid grid-cols-4 gap-2">
        {PLATFORMS.map((p) => (
          <div key={p.name} className="rounded-xl bg-white/[0.04] px-2 py-2 ring-1 ring-white/[0.06]">
            <div className="text-[8.5px] uppercase tracking-wider text-[#7c8472] font-[family-name:var(--font-geist-mono)]">{p.name}</div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-lime-400/80" style={{ width: `${p.v * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* compounding audience curve */}
      <div className="relative mt-3.5 rounded-2xl bg-gradient-to-b from-white/[0.035] to-transparent p-3 ring-1 ring-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-[9.5px] uppercase tracking-[0.18em] text-[#7c8472] font-[family-name:var(--font-geist-mono)]">Audience</span>
          <span className="flex items-center gap-1 text-[9.5px] text-lime-300 font-[family-name:var(--font-geist-mono)]">
            <span className="size-1.5 rounded-full bg-lime-300 animate-pulse" /> compounding
          </span>
        </div>
        <svg viewBox="0 0 240 88" className="mt-2 w-full" fill="none">
          <defs>
            <linearGradient id="velloGrow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LIME} stopOpacity="0.42" />
              <stop offset="100%" stopColor={LIME} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* filled area under the compounding curve */}
          <path d="M4 82 C64 78 120 70 168 44 C198 26 220 14 236 6 L236 88 L4 88 Z" fill="url(#velloGrow)" />
          {/* the curve, drawing itself on a loop */}
          <path
            d="M4 82 C64 78 120 70 168 44 C198 26 220 14 236 6"
            stroke={LIME}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="vello-draw"
            style={{ strokeDasharray: 340, ["--len" as keyof CSSProperties]: "340" } as CSSProperties}
          />
          {/* milestone + live head */}
          {[[4, 82], [120, 70], [236, 6]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.6" fill={LIME} />
          ))}
          <circle cx="236" cy="6" r="6" fill="none" stroke={LIME} strokeOpacity="0.4" strokeWidth="1" className="vello-pulse-ring" />
        </svg>
      </div>

      {/* verified views → paid */}
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-white/[0.04] px-3.5 py-2.5 ring-1 ring-white/[0.06]">
        <div>
          <div className="font-[family-name:var(--font-space)] text-xl font-semibold text-lime-400">2.4M</div>
          <div className="text-[8.5px] uppercase tracking-[0.16em] text-[#7c8472] font-[family-name:var(--font-geist-mono)]">verified views · 30d</div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-lime-400/10 px-2.5 py-1 ring-1 ring-lime-400/25">
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-lime-300" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold text-lime-200">paid per 1,000</span>
        </span>
      </div>
    </div>
  );
}

/* ── Workers: a live chat thread — bubbles + avatars stream in on a loop ─────── */
// Neutral customer avatar (inline so it needs no asset or network round-trip).
function CustomerAvatar() {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center self-end overflow-hidden rounded-full bg-gradient-to-br from-zinc-500/40 to-zinc-700/30 ring-1 ring-white/10">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-300" fill="currentColor" aria-hidden>
        <circle cx="12" cy="8.5" r="3.6" />
        <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5z" />
      </svg>
    </span>
  );
}
function AgentAvatar({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-7 w-7 shrink-0 self-end rounded-full object-cover ring-1 ring-lime-400/40" />;
}

export function ChatThreadIllustration({ className = "", agentAvatar = "/vellosquare.png" }: { className?: string; agentAvatar?: string }) {
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {/* customer */}
      <div className="vello-msg flex items-end gap-2" style={{ animationDelay: "0s" }}>
        <CustomerAvatar />
        <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/[0.05] px-3.5 py-2 text-[12px] text-zinc-300">
          Is this in stock in size M?
        </div>
      </div>
      {/* typing indicator that gives way to the reply */}
      <div className="vello-msg flex items-end justify-end gap-2" style={{ animationDelay: "1.1s" }}>
        <div className="rounded-2xl rounded-br-md bg-lime-400/10 px-4 py-3 ring-1 ring-lime-400/15">
          <span className="flex items-end gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="vello-type h-1.5 w-1.5 rounded-full bg-lime-300/80" style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
          </span>
        </div>
        <AgentAvatar src={agentAvatar} />
      </div>
      {/* agent reply */}
      <div className="vello-msg flex items-end justify-end gap-2" style={{ animationDelay: "2.4s" }}>
        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-lime-400/15 px-3.5 py-2 text-[12px] text-lime-100 ring-1 ring-lime-400/25">
          Yes — 4 left. Want me to reserve one and send a checkout link?
        </div>
        <AgentAvatar src={agentAvatar} />
      </div>
      {/* customer */}
      <div className="vello-msg flex items-end gap-2" style={{ animationDelay: "3.6s" }}>
        <CustomerAvatar />
        <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/[0.05] px-3.5 py-2 text-[12px] text-zinc-300">
          Yes please! 🙏
        </div>
      </div>
      <div className="vello-msg flex items-center gap-1.5 self-end pr-9 text-[10px] text-lime-300/80 font-[family-name:var(--font-geist-mono)]" style={{ animationDelay: "4.6s" }}>
        <span className="h-1.5 w-1.5 rounded-full bg-lime-300" /> checkout link sent · paid
      </div>
    </div>
  );
}

/* ── Traders: a premium trading-terminal chart — candles + MA line + volume ── */
export function ChartIllustration({ className = "" }: { className?: string }) {
  const RED = "#f0683c";
  // candle: bodyY/bodyH = open-close box, wick = high-low; vol = relative volume.
  const candles: Array<{ x: number; bodyY: number; bodyH: number; wickY: number; wickH: number; up: boolean; lo: number; vol: number; live?: boolean }> = [
    { x: 16,  bodyY: 72, bodyH: 18, wickY: 64, wickH: 36, up: true,  lo: 0.5,  vol: 0.5 },
    { x: 38,  bodyY: 60, bodyH: 26, wickY: 52, wickH: 44, up: true,  lo: 0.55, vol: 0.7 },
    { x: 60,  bodyY: 74, bodyH: 16, wickY: 66, wickH: 34, up: false, lo: 0.45, vol: 0.4 },
    { x: 82,  bodyY: 54, bodyH: 30, wickY: 46, wickH: 48, up: true,  lo: 0.6,  vol: 0.85 },
    { x: 104, bodyY: 64, bodyH: 18, wickY: 56, wickH: 36, up: false, lo: 0.48, vol: 0.55 },
    { x: 126, bodyY: 44, bodyH: 26, wickY: 36, wickH: 46, up: true,  lo: 0.62, vol: 0.75 },
    { x: 148, bodyY: 52, bodyH: 18, wickY: 44, wickH: 36, up: false, lo: 0.5,  vol: 0.5 },
    { x: 170, bodyY: 34, bodyH: 28, wickY: 26, wickH: 48, up: true,  lo: 0.64, vol: 0.9 },
    { x: 192, bodyY: 28, bodyH: 16, wickY: 22, wickH: 34, up: true,  lo: 0.6,  vol: 0.7 },
    { x: 214, bodyY: 22, bodyH: 22, wickY: 14, wickH: 42, up: true,  lo: 0.62, vol: 1, live: true },
  ];
  const W = 8;
  const liveY = 24; // last close level for the live price line
  return (
    <svg viewBox="0 0 264 150" className={`w-full ${className}`} fill="none" style={{ fontFamily: "var(--font-geist-mono)" }}>
      <defs>
        <linearGradient id="velloVol" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.5" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* price gridlines + axis labels */}
      {[{ y: 18, p: "143.20" }, { y: 50, p: "141.60" }, { y: 82, p: "140.00" }, { y: 110, p: "138.40" }].map(({ y, p }) => (
        <g key={y}>
          <line x1="6" y1={y} x2="232" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 4" />
          <text x="236" y={y + 3} fill="#5d6356" fontSize="7">{p}</text>
        </g>
      ))}

      {/* moving-average line (self-drawing) */}
      <path d="M20 80 L42 72 L64 76 L86 64 L108 66 L130 54 L152 56 L174 44 L196 38 L218 32"
        stroke="rgba(255,255,255,0.28)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
        className="vello-draw" style={{ strokeDasharray: 320, ["--len" as keyof CSSProperties]: "320" } as CSSProperties} />

      {/* candlesticks */}
      {candles.map((c, i) => {
        const cx = c.x + W / 2;
        const color = c.up ? LIME : RED;
        return (
          <g key={i} className={c.live ? "vello-candle-live" : "vello-candle"}
             style={{ ["--lo" as keyof CSSProperties]: String(c.lo), animationDelay: `${i * 0.16}s`, transformOrigin: `${cx}px 116px` } as CSSProperties}>
            <line x1={cx} y1={c.wickY} x2={cx} y2={c.wickY + c.wickH} stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeOpacity={c.up ? 0.9 : 0.8} />
            <rect x={c.x} y={c.bodyY} width={W} height={c.bodyH} rx="1.4"
              fill={c.up ? `${LIME}26` : `${RED}26`} stroke={color} strokeWidth="1.5" strokeOpacity={c.up ? 1 : 0.85} />
          </g>
        );
      })}

      {/* volume bars */}
      {candles.map((c, i) => {
        const cx = c.x + W / 2;
        const h = 4 + c.vol * 16;
        return (
          <rect key={`v${i}`} x={c.x + 0.5} y={142 - h} width={W - 1} height={h} rx="1"
            fill="url(#velloVol)" className="vello-candle"
            style={{ ["--lo" as keyof CSSProperties]: "0.35", animationDelay: `${i * 0.16}s`, transformOrigin: `${cx}px 142px` } as CSSProperties} />
        );
      })}

      {/* live price line + pill */}
      <line x1="6" y1={liveY} x2="222" y2={liveY} stroke={LIME} strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3 3" className="vello-dash-flow" />
      <g className="vello-float">
        <rect x="232" y={liveY - 7} width="30" height="14" rx="3" fill={LIME} />
        <text x="247" y={liveY + 3} fill="#0c1402" fontSize="7.5" fontWeight="700" textAnchor="middle">+4.2%</text>
        <circle cx="222" cy={liveY} r="2.6" fill={LIME} />
        <circle cx="222" cy={liveY} r="6" fill="none" stroke={LIME} strokeOpacity="0.4" strokeWidth="1" className="vello-pulse-ring" />
      </g>

      {/* header readout */}
      <text x="6" y="9" fill="#9aa48c" fontSize="7.5" fontWeight="700">SOL / USDC</text>
      <text x="60" y="9" fill={LIME} fontSize="7.5" fontWeight="700">142.84</text>
    </svg>
  );
}

/* ── Trust: a verifying node network ──────────────────────────────────────── */
export function NetworkIllustration({ className = "" }: { className?: string }) {
  const pts = [
    [40, 36], [120, 22], [200, 44], [70, 96], [168, 100],
  ];
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 240 130" className="w-full" fill="none">
        {[[0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [1, 4]].map(([a, b], i) => (
          <line key={i} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]}
            stroke={LIME} strokeOpacity="0.35" strokeWidth="1.2" className="vello-dash-flow"
            style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 1 ? 7 : 4} fill="#12150F" stroke={LIME} strokeWidth="1.4" strokeOpacity={i === 1 ? 1 : 0.6} />
        ))}
        {/* checkmark on the central verified node */}
        <path d="M116 22 l3 3 l5 -6" stroke={LIME} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
