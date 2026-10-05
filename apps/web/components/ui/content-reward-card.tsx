"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { FileStack } from "lucide-react";
import type { ContentReward } from "@/lib/content-rewards";
import { contentRewardAmountToUsdc, CLIPPING_REWARD_RATE_USDC } from "@/lib/clippingFr";

const FALLBACK_COVER =
  "https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1200&auto=format&fit=crop";

export function PlatformIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p === "instagram")
    return (
      <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-gradient-to-tr from-[#fd5949] via-[#d6249f] to-[#285AEB] text-white">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      </span>
    );
  if (p === "tiktok")
    return (
      <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-black text-white">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
        </svg>
      </span>
    );
  if (p === "x")
    return (
      <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-black text-white">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.682l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </span>
    );
  if (p === "youtube")
    return (
      <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-[#ff0000] text-white">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </span>
    );
  if (p === "facebook")
    return (
      <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-[#1877f2] text-white">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </span>
    );
  return (
    <span className="inline-grid place-items-center size-[18px] rounded-[5px] bg-zinc-700 text-white text-[7px] font-bold">
      {platform[0]?.toUpperCase()}
    </span>
  );
}

function fmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

interface Props {
  reward: ContentReward;
  onClick?: () => void;
  /** Restricted-to-owner campaign, viewed by a NON-allowed user: show a small
   *  "🔒 Exclusive" badge. Purely cosmetic — the real gates are server-side. */
  locked?: boolean;
}

export function ContentRewardCard({ reward, onClick, locked = false }: Props) {
  const [coverSrc, setCoverSrc] = useState(reward.thumbnail_url || FALLBACK_COVER);
  const [avatarSrc, setAvatarSrc] = useState(reward.communityImage || reward.ownerImage || "");
  const [hovered, setHovered] = useState(false);

  useEffect(() => { setCoverSrc(reward.thumbnail_url || FALLBACK_COVER); }, [reward.thumbnail_url]);
  useEffect(() => { setAvatarSrc(reward.communityImage || reward.ownerImage || ""); }, [reward.communityImage, reward.ownerImage]);

  const budget = Number(reward.budget) || 0;
  const paidOut = reward.paidOut ?? 0;
  const pct = budget > 0 ? Math.max(0, Math.min(100, (paidOut / budget) * 100)) : 0;
  // Ended = budget fully paid out (no more payout headroom), or a remaining-budget
  // field explicitly says so — jobtepi rewards have no deadline field to check.
  const isEnded = pct >= 100 || (reward.budget_remaining !== undefined && reward.budget_remaining !== null && reward.budget_remaining <= 0);
  // Present money in USDC (RM100 → 1 USDC); reward rate is Vello's flat $0.20/1K.
  // Display-only — the jobtepi content_reward's real currency is unchanged.
  const budgetUsdc = contentRewardAmountToUsdc(budget, reward.currency);
  const paidUsdc = contentRewardAmountToUsdc(paidOut, reward.currency);
  const platforms = Array.isArray(reward.platforms) ? reward.platforms : [];
  const displayName = reward.communityName || reward.ownerName || "Jobtepi";

  const requirements = (reward.content_requirements || []).filter(
    (r) => r?.trim() && !r.trim().startsWith("http") && r.trim().length > 2
  );

  // Short description shown under the title (max 2 rows). ContentReward has no
  // dedicated description field, so prefer the free-text `available_content`
  // brief and fall back to the first content requirement so the card always
  // reads like the web3 campaign cards.
  const description = (reward.available_content?.trim() || requirements[0] || "").trim();

  return (
    /*
     * Grid cell: self-start keeps the cell at its natural (collapsed) height.
     * The motion wrapper below is position:relative so the absolute requirements
     * panel is anchored to it — and moves together with the card lift transform.
     * Nothing in the grid flow ever changes size on hover.
     */
    <div
      className="self-start"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        onClick={() => onClick?.()}
        whileHover={{
          y: -14,
          scale: 1.035,
          zIndex: 50,
          transition: { type: "spring", stiffness: 340, damping: 24, mass: 0.75 },
        }}
        style={{ zIndex: hovered ? 50 : 1, position: "relative" }}
        className="cursor-pointer"
      >
        {/* ── Visible card (overflow:hidden to clip image + progress bar) ── */}
        <div
          className={`overflow-hidden border bg-[#161618] transition-[border-color,box-shadow] duration-300 ${
            hovered && requirements.length > 0
              ? isEnded
                ? "rounded-t-md border-x-red-400/45 border-t-red-400/45 border-b-transparent"
                : "rounded-t-md border-x-lime-300/45 border-t-lime-300/45 border-b-transparent"
              : "rounded-md"
          } ${
            isEnded
              ? "border-red-500/25"
              : hovered
              ? "shadow-[0_28px_70px_rgba(132,204,22,0.22)]"
              : "border-[#2e2e33]"
          }`}
        >
          {/* 16:9 cover */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#18181b]">
            <img
              src={coverSrc}
              alt={reward.campaign_name}
              loading="lazy"
              decoding="async"
              className={`h-full w-full object-cover object-center transition-transform duration-700 ${hovered ? "scale-105" : "scale-100"}`}
              onError={() => setCoverSrc(FALLBACK_COVER)}
            />
            <div className="absolute inset-x-0 bottom-0 h-[50%] bg-[linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.28)_50%,rgba(0,0,0,0.76)_100%)]" />
            {locked && (
              <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-amber-200 backdrop-blur-sm">
                🔒 Exclusive
              </span>
            )}
            {isEnded && (
              <>
                <div className="absolute inset-0 z-[1] bg-[linear-gradient(160deg,rgba(239,68,68,0.32)_0%,rgba(30,4,4,0.55)_55%,rgba(10,2,2,0.8)_100%)]" />
                <div className="absolute inset-0 z-[1] flex items-center justify-center">
                  <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-red-50 [text-shadow:0_2px_16px_rgba(0,0,0,0.85)]">
                    Campaign Ended
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Body */}
          <div className={`relative flex flex-col px-4 pt-3 ${requirements.length > 0 ? "pb-3" : "pb-5"}`}>
            {/* Author row */}
            <div className="flex min-w-0 items-center gap-1.5 mb-1.5">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={displayName}
                  className="h-[18px] w-[18px] shrink-0 rounded-full object-cover ring-1 ring-white/20"
                  onError={() => setAvatarSrc("")}
                />
              ) : (
                <div className="h-[18px] w-[18px] shrink-0 rounded-full bg-emerald-700/40 ring-1 ring-white/15 flex items-center justify-center">
                  <span className="text-[7px] font-bold text-emerald-300 uppercase leading-none">
                    {displayName.charAt(0)}
                  </span>
                </div>
              )}
              <span
                className="min-w-0 truncate text-[12.5px] font-medium leading-none tracking-[-0.01em] text-white/90"
                style={{ fontFamily: '-apple-system, "SF Pro Text", BlinkMacSystemFont, var(--font-inter, Inter), system-ui, sans-serif' }}
              >
                {displayName}
              </span>
              <Image src="/green-gem-reward.svg" alt="" width={13} height={13} className="shrink-0 [filter:drop-shadow(0_0_5px_rgba(52,211,153,0.5))]" unoptimized />
              <div className="ml-auto flex shrink-0 items-center -space-x-1">
                {platforms.slice(0, 3).map((p, i) => (
                  <div key={i} className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/10 bg-[#0e0e11] shadow-md" style={{ zIndex: 3 - i }}>
                    <PlatformIcon platform={p} />
                  </div>
                ))}
                {platforms.length > 3 && (
                  <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/10 bg-[#0e0e11] text-[9px] font-bold text-zinc-400">
                    +{platforms.length - 3}
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <h3 className="min-w-0 text-[14.5px] font-bold leading-snug tracking-[-0.01em] text-white truncate">
              {reward.campaign_name}
            </h3>

            {/* Description — max 2 rows, like the web3 campaign cards */}
            {description && (
              <p className="mt-1 text-[11.5px] leading-[1.5] text-white/55 line-clamp-2">
                {description}
              </p>
            )}

            {/* Budget + stats */}
            <div className="mt-3.5 flex items-end justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-[13px] font-bold text-white">${fmt(paidUsdc)}</span>
                <span className="text-[13px] font-bold text-[#9ca3af]">/ ${fmt(budgetUsdc)}</span>
              </div>
              <div className="flex shrink-0 items-center -space-x-2">
                <div className="relative z-[2] flex h-[24px] items-center gap-1 rounded-full border border-white/12 bg-[linear-gradient(145deg,rgba(255,255,255,0.15),rgba(255,255,255,0.04))] px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md">
                  <FileStack className="h-2.5 w-2.5 shrink-0 text-white/70" strokeWidth={2.2} />
                  <span className="text-[10px] font-bold tabular-nums leading-none text-white">
                    {(reward.total_submissions ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="relative z-[1] flex h-[24px] items-center rounded-full border border-[#93c5fd]/30 bg-[linear-gradient(145deg,rgba(59,130,246,0.28),rgba(30,64,175,0.12))] px-2 shadow-[inset_0_1px_0_rgba(191,219,254,0.3)] backdrop-blur-md">
                  <span className="text-[10px] font-bold leading-none text-[#bfdbfe]">
                    ${CLIPPING_REWARD_RATE_USDC.toFixed(2)}/1K
                  </span>
                </div>
              </div>
            </div>

            {/* Progress bar — only here when no requirements panel is shown */}
            {requirements.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[6px] bg-[#0c1a0d]">
                <div
                  className={`h-full rounded-r-full transition-all duration-700 ${
                    isEnded
                      ? "bg-[linear-gradient(90deg,#f87171_0%,#ef4444_55%,#dc2626_100%)] shadow-[0_0_10px_rgba(239,68,68,0.9),0_0_24px_rgba(248,113,113,0.5)]"
                      : "bg-[linear-gradient(90deg,#34d399_0%,#22c55e_55%,#4ade80_100%)] shadow-[0_0_10px_rgba(34,197,94,0.9),0_0_24px_rgba(74,222,128,0.5)]"
                  }`}
                  style={{ width: `${Math.max(5, pct)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Requirements panel ────────────────────────────────────────────
            absolute top-full so it sits flush under the card without ever
            entering the document flow — grid rows never shift.
            Moves with the card because it's a child of the motion.div.
        ──────────────────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {hovered && requirements.length > 0 && (
            <motion.div
              key="req-panel"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className={`absolute left-0 right-0 top-full z-10 overflow-hidden rounded-b-md border border-t-0 bg-[#161618] px-4 shadow-[0_28px_40px_rgba(0,0,0,0.55)] ${isEnded ? "border-red-400/45" : "border-lime-300/45"}`}
            >
              <ul className="pt-1.5 pb-5 space-y-1.5">
                {requirements.slice(0, 4).map((req, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.04, duration: 0.18 }}
                    className="flex items-start gap-2 text-[11px] leading-[1.5] text-white/60"
                  >
                    <span className="mt-[4px] h-[5px] w-[5px] shrink-0 rounded-full bg-emerald-500/60" />
                    {req}
                  </motion.li>
                ))}
              </ul>
              {/* Progress bar at the very bottom of the expanded panel */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[6px] bg-[#0c1a0d]">
                <div
                  className={`h-full rounded-r-full transition-all duration-700 ${
                    isEnded
                      ? "bg-[linear-gradient(90deg,#f87171_0%,#ef4444_55%,#dc2626_100%)] shadow-[0_0_10px_rgba(239,68,68,0.9),0_0_24px_rgba(248,113,113,0.5)]"
                      : "bg-[linear-gradient(90deg,#34d399_0%,#22c55e_55%,#4ade80_100%)] shadow-[0_0_10px_rgba(34,197,94,0.9),0_0_24px_rgba(74,222,128,0.5)]"
                  }`}
                  style={{ width: `${Math.max(5, pct)}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
