"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TopUpModal } from "./TopUpModal";

const LOW_BALANCE_THRESHOLD_CREDITS = 100; // $1.00

export function LowBalanceBanner({ ownerWallet }: { ownerWallet: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const balance = useQuery(api.userCredits.getBalance, ownerWallet ? { ownerWallet } : "skip");
  if (!ownerWallet) return null;
  // Convex distinguishes LOADING (undefined) from a confirmed answer. `null` is a
  // confirmed "no userCredits row" — a user who has never bought credits, i.e.
  // exactly the audience this banner exists for. Treating null as "hide" (the old
  // `!balance` check) meant the banner never fired for them.
  if (balance === undefined) return null;
  const balanceCredits = balance?.balanceCredits ?? 0;
  if (balanceCredits >= LOW_BALANCE_THRESHOLD_CREDITS) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm text-amber-200">
      <span>
        {balanceCredits > 0
          ? `Low balance: ${balanceCredits.toLocaleString()} credits left.`
          : "You have no credits left."}
      </span>
      <button onClick={() => setOpen(true)} className="font-medium underline hover:text-amber-100">
        Top up
      </button>
      <TopUpModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
