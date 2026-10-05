"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, X } from "lucide-react";

type Account = {
  escrowUsdc: number;
  unsettledTabUsdc: number;
  sharesOutstanding: number;
  navPerShare: number;
};

/** Credit/deduct an agent's escrow USDC with a required reason. Shows the NAV
 *  impact before confirming. Off-chain ledger only — no on-chain USDC moves. */
export function AdjustEscrowDialog({ mintAddress, account, onClose, onDone }: {
  mintAddress: string;
  account: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const { accessToken } = useSupabaseAuth();
  const adjustEscrow = useAction(api.adminEconomy.adjustEscrow);
  const [direction, setDirection] = useState<"credit" | "deduct">("deduct");
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amount = Number(amountStr);
  const validAmount = Number.isFinite(amount) && amount > 0;
  const delta = direction === "credit" ? amount : -amount;
  const escrowAfter = validAmount ? +(account.escrowUsdc + delta).toFixed(6) : account.escrowUsdc;
  const navAfter = account.sharesOutstanding > 0
    ? Math.max(0, escrowAfter - account.unsettledTabUsdc) / account.sharesOutstanding
    : account.navPerShare;
  const belowZero = validAmount && escrowAfter < 0;
  const belowTab = validAmount && !belowZero && escrowAfter < account.unsettledTabUsdc;
  const canSubmit = validAmount && !belowZero && reason.trim().length > 0 && !!accessToken && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      await adjustEscrow({ accessToken: accessToken!, mintAddress, deltaUsdc: delta, reason: reason.trim() });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Adjustment failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-white">Adjust escrow</h3>
          <button onClick={() => { if (!busy) onClose(); }} disabled={busy} className="text-zinc-600 hover:text-zinc-300 p-1 rounded-lg hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"><X className="size-4" /></button>
        </div>
        <p className="mt-1 text-[11.5px] text-zinc-600">
          Off-chain ledger adjustment — moves NAV for all shareholders. Logged with your account. Credits have no on-chain backing — redemptions above the real wallet balance will fail at payout.
        </p>

        <div className="mt-4 flex items-center gap-1 rounded-lg border border-[#1e1e24] p-0.5 w-fit">
          {(["deduct", "credit"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold capitalize transition-colors ${
                direction === d
                  ? d === "deduct" ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >{d}</button>
          ))}
        </div>

        <label className="block mt-4 text-[11px] text-zinc-500">
          Amount (USDC)
          <input
            type="number" min="0" step="0.01" value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="mt-1 w-full h-9 rounded-lg border border-[#1e1e24] bg-transparent px-3 text-[13px] text-white outline-none focus:border-zinc-600"
            placeholder="0.00"
          />
        </label>

        <label className="block mt-3 text-[11px] text-zinc-500">
          Reason (required, kept in the audit log)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-[#1e1e24] bg-transparent px-3 py-2 text-[13px] text-white outline-none focus:border-zinc-600 resize-none"
            placeholder="e.g. refund for failed video generation on 2026-06-09"
          />
        </label>

        <div className="mt-4 rounded-xl border border-[#1e1e24] bg-[#0a0a0d] px-4 py-3 text-[12px] font-mono space-y-1">
          <div className="flex justify-between text-zinc-500">
            <span>Escrow</span>
            <span>${account.escrowUsdc.toFixed(2)} → <span className={belowZero ? "text-red-400" : "text-white"}>${escrowAfter.toFixed(2)}</span></span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>NAV / share</span>
            <span>${account.navPerShare.toFixed(4)} → <span className="text-white">${navAfter.toFixed(4)}</span></span>
          </div>
        </div>

        {belowZero && <p className="mt-2 text-[11.5px] text-red-400">Deduction exceeds current escrow — not allowed.</p>}
        {belowTab && (
          <p className="mt-2 text-[11.5px] text-amber-400">
            Warning: result is below the unsettled tab (${account.unsettledTabUsdc.toFixed(2)}) — the agent will read needs_funding.
          </p>
        )}
        {err && <p className="mt-2 text-[11.5px] text-red-400">{err}</p>}

        <button
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`mt-4 w-full h-10 rounded-xl text-[13px] font-bold transition-colors ${
            canSubmit
              ? direction === "deduct" ? "bg-red-500/90 hover:bg-red-500 text-white" : "bg-emerald-500/90 hover:bg-emerald-500 text-white"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          }`}
        >
          {busy ? <Loader2 className="size-4 animate-spin mx-auto" /> : `Confirm ${direction === "deduct" ? "deduction" : "credit"}`}
        </button>
      </div>
    </div>
  );
}
