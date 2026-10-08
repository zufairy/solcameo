"use client";
import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Clapperboard, Droplets, Landmark, UserRound, type LucideIcon } from "lucide-react";
import type { SplitKey } from "@/lib/tokenomics/liveMath";
import { FLOW_NODES } from "./flowNodes";

const ICONS: Record<SplitKey, LucideIcon> = { creator: UserRound, content: Clapperboard, platform: Landmark, meteora: Droplets };
const PLAIN: Record<SplitKey, string> = {
  creator: "Goes to whoever made the character. They claim it in SOL.",
  content: "Pays for the character's next videos, so it keeps posting.",
  platform: "Keeps Solcameo running.",
  meteora: "The protocol's cut for running the curve.",
};
/** Where the four streams land: the centres of the four columns of cards underneath the drawing. */
const ANCHORS = [120, 360, 600, 840];

const W = 960, H = 250;
const hub = { x: 480, y: 108 };
const path = (i: number) => `M ${hub.x} ${hub.y + 26} C ${hub.x} ${hub.y + 90}, ${ANCHORS[i]} ${hub.y + 70}, ${ANCHORS[i]} ${H - 6}`;

/**
 * "Where does the fee go?" drawn in three beats: a trade happens, a small slice is taken as the fee, and that slice splits into
 * four streams that land on four cards. Stream width and the number of coins follow the real shares; hovering a card
 * highlights its stream. The same four cards double as the legend, so there is nothing to decode.
 */
export function FeeSplitDiagram({ shares, feeRate, highlight, onHighlight, exampleSol = 100 }: {
  shares: Record<SplitKey, number>; feeRate: number; highlight: SplitKey | null; onHighlight: (k: SplitKey | null) => void; exampleSol?: number;
}) {
  const reduced = useReducedMotion();
  const fee = exampleSol * feeRate;
  const coins = useMemo(() => FLOW_NODES.map((n) => Math.max(1, Math.round(shares[n.key] * 8))), [shares]);

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`A ${exampleSol} SOL trade pays a ${fee} SOL fee, which is split between the creator, the content budget, the platform and Meteora.`}>
          <defs>
            <linearGradient id="fsd-fee" x1="0" x2="1"><stop offset="0" stopColor="#d7ff00" /><stop offset="1" stopColor="#9bbf00" /></linearGradient>
            <filter id="fsd-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
          </defs>

          {/* 1. the trade, with the fee slice cut off its end */}
          <g>
            <text x="30" y="30" fill="rgba(255,255,255,0.45)" fontSize="13" fontFamily="var(--font-geist-mono)" letterSpacing="2">1 · A TRADE HAPPENS</text>
            <rect x="30" y="52" width="300" height="46" rx="14" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.18)" />
            <rect x="34" y="56" width="262" height="38" rx="11" fill="rgba(255,255,255,0.10)" />
            <text x="48" y="81" fill="#fff" fontSize="17" fontWeight="600">Someone buys {exampleSol} SOL of a coin</text>
            <motion.rect x="300" y="56" width="26" height="38" rx="9" fill="url(#fsd-fee)" animate={reduced ? undefined : { x: [300, 300, 330, 410], opacity: [1, 1, 1, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", times: [0, 0.3, 0.6, 1] }} />
          </g>

          {/* 2. the fee hub */}
          <g>
            <text x="380" y="30" fill="rgba(255,255,255,0.45)" fontSize="13" fontFamily="var(--font-geist-mono)" letterSpacing="2">2 · A SMALL FEE IS TAKEN</text>
            <circle cx={hub.x} cy={hub.y} r="44" fill="#d7ff00" opacity="0.18" filter="url(#fsd-glow)" />
            <rect x={hub.x - 78} y={hub.y - 26} width="156" height="52" rx="26" fill="rgba(215,255,0,0.12)" stroke="#d7ff00" strokeWidth="1.5" />
            <text x={hub.x} y={hub.y - 3} textAnchor="middle" fill="#d7ff00" fontSize="22" fontWeight="700">{+(feeRate * 100).toFixed(2)}% fee</text>
            <text x={hub.x} y={hub.y + 15} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="12">= {+fee.toFixed(2)} SOL here</text>
            <path d={`M 330 75 C 380 75, 400 ${hub.y}, ${hub.x - 82} ${hub.y}`} fill="none" stroke="rgba(215,255,0,0.35)" strokeWidth="2" strokeDasharray="5 6" />
          </g>

          {/* 3. four streams */}
          <text x="640" y="30" fill="rgba(255,255,255,0.45)" fontSize="13" fontFamily="var(--font-geist-mono)" letterSpacing="2">3 · IT SPLITS FOUR WAYS</text>
          {FLOW_NODES.map((n, i) => {
            const dim = highlight && highlight !== n.key;
            return (
              <g key={n.key} opacity={dim ? 0.18 : 1} style={{ transition: "opacity 200ms" }}>
                <path id={`fsd-p-${n.key}`} d={path(i)} fill="none" stroke={n.color} strokeOpacity="0.28" strokeWidth={3 + shares[n.key] * 16} strokeLinecap="round" />
                {!reduced && Array.from({ length: coins[i] }, (_, c) => (
                  <circle key={c} r={4 + shares[n.key] * 4} fill={n.color}>
                    <animateMotion dur={`${2.6 + i * 0.25}s`} begin={`${(c * (2.6 + i * 0.25)) / coins[i]}s`} repeatCount="indefinite"><mpath href={`#fsd-p-${n.key}`} /></animateMotion>
                  </circle>
                ))}
                <rect x={ANCHORS[i] - 30} y={hub.y + 62} width="60" height="26" rx="13" fill="#0b0c0e" stroke={n.color} strokeOpacity="0.7" />
                <text x={ANCHORS[i]} y={hub.y + 80} textAnchor="middle" fill={n.color} fontSize="14" fontWeight="700">{(shares[n.key] * 100).toFixed(0)}%</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {FLOW_NODES.map((n) => {
          const Icon = ICONS[n.key];
          const active = highlight === n.key;
          return (
            <button key={n.key} type="button" aria-pressed={active}
              onMouseEnter={() => onHighlight(n.key)} onMouseLeave={() => onHighlight(null)} onFocus={() => onHighlight(n.key)} onBlur={() => onHighlight(null)}
              className="group rounded-[18px] border bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015))] p-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none sm:p-4"
              style={{ borderColor: active ? n.color : "rgba(255,255,255,0.1)", boxShadow: active ? `0 18px 40px -22px ${n.color}` : undefined }}>
              <span className="grid size-8 place-items-center rounded-[10px] sm:size-10 sm:rounded-[12px]" style={{ background: `${n.color}22`, color: n.color }}><Icon className="size-4 sm:size-5" /></span>
              <p className="mt-2 text-[20px] font-semibold leading-none tabular-nums sm:mt-3 sm:text-[30px]" style={{ color: n.color }}>{(shares[n.key] * 100).toFixed(0)}%</p>
              <p className="mt-1 text-[11px] font-semibold text-white sm:text-[14px]">{n.label}</p>
              <p className="mt-1 hidden text-[12px] leading-[1.45] text-white/55 sm:block">{PLAIN[n.key]}</p>
              <p className="mt-2 hidden text-[11px] tabular-nums text-white/40 sm:block">{+(fee * shares[n.key]).toFixed(3)} SOL of every {+fee.toFixed(2)} SOL fee</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
