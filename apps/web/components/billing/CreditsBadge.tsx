"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { TopUpModal } from "./TopUpModal";

/** Compact realtime credits readout for the builder top bar — the balance
 *  links to the Billing page for full history, and the "+" opens the same
 *  TopUpModal swarm's CreditsPill uses, so a mid-session top-up never has to
 *  leave the builder. Mirrors LowBalanceBanner's null-vs-loading handling:
 *  `undefined` = still loading, `null` (no userCredits row yet) = 0.
 *
 *  Live-deduction animation: the Convex subscription pushes every debit the
 *  moment it lands (video renders now bill credits-first), so when the
 *  balance DROPS the readout pulses and a floating "−N" chip rises off the
 *  number — the operator literally watches the render pay for itself. */
export function CreditsBadge({ ownerWallet }: { ownerWallet: string | null | undefined }) {
  const [topUpOpen, setTopUpOpen] = useState(false);
  const balance = useQuery(api.userCredits.getBalance, ownerWallet ? { ownerWallet } : "skip");
  const credits = balance === undefined ? null : (balance?.balanceCredits ?? 0);

  // Spend detection: compare against the previous live value. First load
  // (null → number) never animates; only a real decrease does.
  const prevRef = useRef<number | null>(null);
  const [spend, setSpend] = useState<{ amount: number; key: number } | null>(null);
  useEffect(() => {
    if (credits === null) return;
    const prev = prevRef.current;
    prevRef.current = credits;
    if (prev !== null && credits < prev) {
      setSpend({ amount: prev - credits, key: Date.now() });
    }
  }, [credits]);
  useEffect(() => {
    if (!spend) return;
    const t = setTimeout(() => setSpend(null), 1600);
    return () => clearTimeout(t);
  }, [spend]);

  if (!ownerWallet) return null;

  return (
    <div className="hidden sm:flex items-center gap-1 rounded-md border border-white/10 pl-2.5 pr-1 py-1 text-[12px] text-white/70 transition-colors hover:border-white/20">
      <Link
        href="/billing"
        title="Your credit balance — click to view spend history"
        className="relative flex items-center gap-1.5 hover:text-white"
      >
        <span aria-hidden>⚡</span>
        {credits === null ? (
          <span className="inline-block h-3 w-10 animate-pulse rounded bg-white/[0.12]" aria-hidden />
        ) : (
          <motion.span
            key={credits}
            initial={spend ? { scale: 1.18, color: "#f87171" } : false}
            animate={{ scale: 1, color: "rgba(255,255,255,0.85)" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="tabular-nums"
          >
            {credits.toLocaleString()}
          </motion.span>
        )}
        <span className="hidden md:inline text-white/40">Credits</span>
        <AnimatePresence>
          {spend && (
            <motion.span
              key={spend.key}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: -14 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
              className="pointer-events-none absolute -top-1 right-0 text-[11px] font-bold text-red-400"
            >
              −{spend.amount.toLocaleString()}
            </motion.span>
          )}
        </AnimatePresence>
      </Link>
      <button
        type="button"
        onClick={() => setTopUpOpen(true)}
        title="Add credits"
        className="grid size-5 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/15 hover:text-white"
      >
        <Plus className="size-3" strokeWidth={2.25} />
      </button>
      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </div>
  );
}
