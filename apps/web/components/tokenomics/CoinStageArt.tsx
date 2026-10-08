"use client";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const LIME = "#d7ff00", BLUE = "#38bdf8", VIOLET = "#a78bfa", GREEN = "#34d399", ROSE = "#fb7185", ORANGE = "#fb923c";
const loop = (duration: number, delay = 0) => ({ duration, delay, repeat: Infinity, ease: "easeInOut" as const });

/** A flat, glowing coin with a symbol, used by every scene so the same object is followed from birth to burn. */
function Coin({ x, y, r = 22, color = LIME, symbol = "$" }: { x: number; y: number; r?: number; color?: string; symbol?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 8} fill={color} opacity="0.16" />
      <circle r={r} fill="#0d0f10" stroke={color} strokeWidth="3" />
      <circle r={r - 6} fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1.5" />
      <text y={r * 0.36} textAnchor="middle" fontSize={r * 1.1} fontWeight="800" fill={color}>{symbol}</text>
    </g>
  );
}
const Tag = ({ x, y, w, text, color = "#fff", filled }: { x: number; y: number; w: number; text: string; color?: string; filled?: boolean }) => (
  <g>
    <rect x={x} y={y} width={w} height="28" rx="14" fill={filled ? color : "rgba(11,12,14,0.85)"} stroke={color} strokeOpacity={filled ? 0 : 0.6} />
    <text x={x + w / 2} y={y + 19} textAnchor="middle" fontSize="13" fontWeight="700" fill={filled ? "#0b0c0e" : color}>{text}</text>
  </g>
);

/* 1. A coin is born: a character, a coin appears, the supply is fixed and locked. */
function Born({ reduced }: { reduced: boolean }) {
  return (
    <g>
      <rect x="90" y="70" width="170" height="210" rx="28" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.2)" />
      <circle cx="175" cy="150" r="38" fill="rgba(215,255,0,0.18)" stroke={LIME} strokeWidth="3" />
      <path d="M115 262 C115 210 235 210 235 262" fill="rgba(215,255,0,0.14)" stroke={LIME} strokeWidth="3" strokeLinecap="round" />
      <text x="175" y="92" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.55)" letterSpacing="2">AI CHARACTER</text>
      <motion.g animate={reduced ? undefined : { y: [0, -10, 0], scale: [1, 1.06, 1] }} transition={loop(2.4)} style={{ transformOrigin: "400px 170px" }}>
        <Coin x={400} y={170} r={52} />
      </motion.g>
      <path d="M262 170 L326 170" stroke={LIME} strokeWidth="3" strokeDasharray="6 7" strokeLinecap="round" />
      <path d="M314 158 L330 170 L314 182" fill="none" stroke={LIME} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {[0, 1, 2, 3].map((i) => <motion.circle key={i} cx={[345, 455, 360, 450][i]} cy={[105, 120, 240, 230][i]} r="4" fill={LIME} animate={reduced ? undefined : { opacity: [0, 1, 0], scale: [0.5, 1.4, 0.5] }} transition={loop(2 + i * 0.3, i * 0.4)} />)}
      <Tag x={330} y={250} w={150} text="1,000,000,000" color={LIME} />
      <g transform="translate(497 250)"><rect width="104" height="28" rx="14" fill="rgba(11,12,14,0.85)" stroke={GREEN} strokeOpacity="0.7" /><text x="52" y="19" textAnchor="middle" fontSize="12" fontWeight="700" fill={GREEN}>mint locked</text></g>
    </g>
  );
}

/* 2. Trading on the curve: a ball rides a rising line as people buy and sell. */
const CURVE = "M60 290 C 200 285, 300 250, 380 190 S 520 80, 590 60";
function Trade({ reduced }: { reduced: boolean }) {
  return (
    <g>
      <defs><linearGradient id="cs-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={LIME} stopOpacity="0.35" /><stop offset="1" stopColor={LIME} stopOpacity="0" /></linearGradient></defs>
      {[110, 170, 230, 290].map((y) => <line key={y} x1="60" x2="590" y1={y} y2={y} stroke="rgba(255,255,255,0.07)" />)}
      <path d={`${CURVE} L590 300 L60 300 Z`} fill="url(#cs-area)" opacity="0.5" />
      <path id="cs-curve" d={CURVE} fill="none" stroke={LIME} strokeWidth="5" strokeLinecap="round" />
      <g>
        <circle r="18" fill={LIME} opacity="0.25" /><circle r="10" fill={LIME} />
        {!reduced && <animateMotion dur="6s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0.45;0.3;0.8;0.6;1;0" keyTimes="0;0.2;0.32;0.55;0.68;0.88;1"><mpath href="#cs-curve" /></animateMotion>}
      </g>
      <text x="60" y="326" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.5)" letterSpacing="1.5">MORE PEOPLE BUY →</text>
      <text x="36" y="180" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.5)" letterSpacing="1.5" transform="rotate(-90 36 180)">PRICE →</text>
      <motion.g animate={reduced ? undefined : { opacity: [1, 1, 0, 0, 1] }} transition={loop(6)}><Tag x={150} y={120} w={74} text="BUY ↑" color={GREEN} filled /></motion.g>
      <motion.g animate={reduced ? undefined : { opacity: [0, 0, 1, 0, 0] }} transition={loop(6)}><Tag x={150} y={120} w={74} text="SELL ↓" color={ROSE} filled /></motion.g>
      <Tag x={380} y={300} w={210} text="always a price, always a buyer" color="#fff" />
    </g>
  );
}

/* 3. The fee: a trade coin goes through a gate and a thin slice splits into four colours. */
function Fee({ reduced }: { reduced: boolean }) {
  const parts = [[LIME, 330], [BLUE, 400], [VIOLET, 470], [GREEN, 540]] as const;
  return (
    <g>
      <motion.g animate={reduced ? undefined : { x: [0, 150, 150, 0] }} transition={{ duration: 4, repeat: Infinity, times: [0, 0.4, 0.7, 1], ease: "easeInOut" }}><Coin x={90} y={170} r={42} color="#fff" symbol="SOL" /></motion.g>
      <rect x="250" y="90" width="26" height="160" rx="13" fill="rgba(215,255,0,0.12)" stroke={LIME} strokeWidth="2" />
      <Tag x={218} y={52} w={90} text="1% fee" color={LIME} filled />
      {parts.map(([c, x], i) => (
        <g key={c}>
          <path d={`M276 170 C 300 170, ${x - 30} ${i % 2 ? 250 : 90}, ${x} ${i % 2 ? 262 : 78}`} stroke={c} strokeOpacity="0.5" strokeWidth="3" fill="none" strokeDasharray="5 6" />
          <motion.circle cx={x} cy={i % 2 ? 262 : 78} r="16" fill={c} animate={reduced ? undefined : { scale: [0.6, 1.15, 1, 0.6], opacity: [0.4, 1, 1, 0.4] }} transition={{ duration: 4, repeat: Infinity, delay: 0.5 + i * 0.15, times: [0, 0.4, 0.8, 1] }} style={{ transformOrigin: `${x}px ${i % 2 ? 262 : 78}px` }} />
        </g>
      ))}
      <text x="90" y="250" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.55)" letterSpacing="1.5">THE TRADE</text>
      <text x="470" y="172" textAnchor="middle" fontSize="13" fontWeight="700" fill="rgba(255,255,255,0.7)">split four ways</text>
      <text x="470" y="192" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.45)">creator · content · platform · Meteora</text>
    </g>
  );
}

/* 4. Creators get paid and the character keeps posting. */
function Creator({ reduced }: { reduced: boolean }) {
  return (
    <g>
      <rect x="70" y="150" width="150" height="120" rx="24" fill="rgba(215,255,0,0.1)" stroke={LIME} strokeWidth="2.5" />
      <path d="M95 150 L95 128 Q95 112 111 112 L179 112 Q195 112 195 128 L195 150" fill="none" stroke={LIME} strokeWidth="2.5" />
      <text x="145" y="218" textAnchor="middle" fontSize="15" fontWeight="800" fill={LIME}>creator</text>
      <text x="145" y="238" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.6)">claims in SOL</text>
      {[0, 1, 2].map((i) => <motion.circle key={i} cx={130 + i * 18} r="9" fill={LIME} animate={reduced ? undefined : { cy: [30, 130], opacity: [0, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.55, ease: "easeIn" }} />)}
      <Tag x={86} y={290} w={118} text="+ SOL paid" color={LIME} filled />
      {[0, 1, 2].map((i) => (
        <motion.g key={i} animate={reduced ? undefined : { y: [0, -8, 0], opacity: [0.6, 1, 0.6] }} transition={loop(2.4, i * 0.4)}>
          <rect x={330 + i * 92} y="130" width="78" height="118" rx="16" fill="rgba(56,189,248,0.1)" stroke={BLUE} strokeWidth="2" />
          <path d={`M${358 + i * 92} 168 L${382 + i * 92} 189 L${358 + i * 92} 210 Z`} fill={BLUE} />
        </motion.g>
      ))}
      <path d="M235 190 L318 190" stroke={BLUE} strokeWidth="3" strokeDasharray="6 7" strokeLinecap="round" />
      <Tag x={344} y={266} w={218} text="content budget → next videos" color={BLUE} />
    </g>
  );
}

/* 5. Graduation: the curve fills up, then the coin moves into a locked Meteora pool. */
function Graduate({ reduced, fill }: { reduced: boolean; fill: number }) {
  const pct = Math.max(0.04, Math.min(1, fill));
  return (
    <g>
      <rect x="70" y="80" width="140" height="230" rx="26" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.2)" />
      <motion.rect x="82" rx="16" width="116" fill={LIME} initial={false} animate={{ y: 298 - 206 * pct, height: 206 * pct }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} opacity="0.85" />
      <text x="140" y="68" textAnchor="middle" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.55)" letterSpacing="1.5">CURVE FILLS</text>
      <text x="140" y="205" textAnchor="middle" fontSize="26" fontWeight="800" fill="#fff" stroke="#0b0c0e" strokeWidth="5" paintOrder="stroke">{Math.round(pct * 100)}%</text>
      <path id="cs-jump" d="M225 190 C 300 40, 420 40, 480 150" fill="none" stroke={LIME} strokeOpacity="0.5" strokeDasharray="6 7" strokeWidth="3" />
      <g><circle r="18" fill={LIME} opacity="0.25" /><circle r="11" fill={LIME} />{!reduced && <animateMotion dur="3.4s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;0.15;0.75;1" calcMode="linear"><mpath href="#cs-jump" /></animateMotion>}</g>
      <path d="M480 150 C 480 120, 590 120, 590 150 L590 262 Q590 304 535 304 Q480 304 480 262 Z" fill="rgba(52,211,153,0.1)" stroke={GREEN} strokeWidth="3" />
      <motion.path d="M482 205 q26 -12 53 0 t53 0" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" animate={reduced ? undefined : { d: ["M482 205 q26 -12 53 0 t53 0", "M482 205 q26 12 53 0 t53 0"] }} transition={{ duration: 1.6, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }} />
      <text x="535" y="250" textAnchor="middle" fontSize="15" fontWeight="800" fill={GREEN}>Meteora pool</text>
      <text x="535" y="270" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.55)">liquidity locked</text>
    </g>
  );
}

/* 6. Burn: coins drop into a flame and the supply bar shrinks for good. */
function Burn({ reduced }: { reduced: boolean }) {
  return (
    <g>
      <text x="80" y="60" fontSize="12" fontWeight="700" fill="rgba(255,255,255,0.55)" letterSpacing="1.5">SUPPLY</text>
      <rect x="80" y="72" width="480" height="20" rx="10" fill="rgba(255,255,255,0.08)" />
      <motion.rect x="80" y="72" height="20" rx="10" fill={LIME} initial={{ width: 480 }} animate={reduced ? undefined : { width: [480, 480, 430, 430, 480] }} transition={{ duration: 5, repeat: Infinity, times: [0, 0.3, 0.6, 0.9, 1], ease: "easeInOut" }} />
      {[0, 1, 2].map((i) => <motion.g key={i} animate={reduced ? undefined : { y: [0, 130], opacity: [1, 1, 0], scale: [1, 1, 0.4] }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeIn" }} style={{ transformOrigin: `${250 + i * 70}px 120px` }}><Coin x={250 + i * 70} y={120} r={18} /></motion.g>)}
      <motion.g style={{ transformOrigin: "320px 300px" }} animate={reduced ? undefined : { scaleY: [1, 1.14, 0.96, 1.1, 1], scaleX: [1, 0.96, 1.04, 0.98, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}>
        <path d="M320 168 C 372 218, 382 262, 358 292 C 346 308, 294 308, 282 292 C 258 262, 268 218, 320 168 Z" fill={ORANGE} opacity="0.9" />
        <path d="M320 214 C 348 244, 352 268, 338 286 C 330 296, 310 296, 302 286 C 288 268, 292 244, 320 214 Z" fill={ROSE} />
        <path d="M320 246 C 334 262, 334 276, 326 284 C 322 288, 318 288, 314 284 C 306 276, 306 262, 320 246 Z" fill="#fde68a" />
      </motion.g>
      <Tag x={96} y={268} w={150} text="burned = gone forever" color={ORANGE} />
      <Tag x={414} y={268} w={150} text="supply only shrinks" color={LIME} />
    </g>
  );
}

const SCENES = [Born, Trade, Fee, Creator, Graduate, Burn] as const;

/** One animated picture per step of a coin's life. They share one coin and one palette, so the story reads as a single journey. */
export function CoinStageArt({ stage, fill = 0.35, className = "" }: { stage: number; fill?: number; className?: string }): ReactNode {
  const reduced = !!useReducedMotion();
  const Scene = SCENES[Math.max(0, Math.min(5, stage))];
  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg key={stage} viewBox="0 0 640 340" className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Step ${stage + 1} illustration`}
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.35, ease: "easeOut" }}>
          <Scene reduced={reduced} fill={fill} />
        </motion.svg>
      </AnimatePresence>
    </div>
  );
}
