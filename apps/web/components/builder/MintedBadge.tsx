"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Sparkles } from "lucide-react";

interface MintedBadgeProps {
  mintAddress: string;
  compact?: boolean;
}

export default function MintedBadge({ mintAddress, compact = false }: MintedBadgeProps) {
  const explorerUrl = `https://explorer.solana.com/address/${mintAddress}?cluster=devnet`;

  return (
    <motion.a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, scale: 0.85, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className="relative inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-gradient-to-r from-emerald-500/15 via-lime-400/20 to-emerald-500/15 px-2.5 py-1 overflow-hidden group cursor-pointer"
      title={`Minted on Solana, ${mintAddress.slice(0, 12)}…`}
    >
      {/* Sweeping shimmer overlay */}
      <motion.span
        aria-hidden
        className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/35 to-transparent"
        animate={{ x: ["0%", "300%"] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
      />

      {/* Pulsing outer glow ring */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full ring-2 ring-emerald-400/40"
        animate={{ opacity: [0.4, 0.9, 0.4], scale: [1, 1.06, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />

      <span className="relative flex items-center gap-1.5">
        <motion.span
          animate={{ rotate: [0, 8, -8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <CheckCircle2 className="size-3 text-emerald-300 drop-shadow-[0_0_4px_rgba(52,211,153,0.6)]" />
        </motion.span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 drop-shadow-[0_0_6px_rgba(52,211,153,0.55)]">
          {compact ? "Minted" : "Minted ✦ Solana"}
        </span>
        {!compact && (
          <Sparkles className="size-2.5 text-lime-300 animate-pulse" />
        )}
      </span>
    </motion.a>
  );
}
