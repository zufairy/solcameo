"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpFromLine, CheckCircle2, ExternalLink, Loader2, Wallet, X, AlertTriangle,
} from "lucide-react";
import { getNetworkLabel, getTxExplorerUrl } from "@/lib/solana/network";

interface WithdrawModalProps {
  open: boolean;
  agentName: string;
  agentWallet: string;
  /** Destination — the owner's (creatorWallet) wallet. Display only; the server
   *  ALWAYS sends to agent.creatorWallet, never a client-supplied address. */
  ownerWallet?: string;
  mintAddress: string;
  /** Max the owner may withdraw = on-chain − tab − pending − reserved − share floor. */
  safeWithdrawable: number;
  onClose: () => void;
  /** Called after a confirmed withdraw so the parent can refresh its balance. */
  onWithdrawn?: (balance: { usdc: number; sol: number }) => void;
}

type Step = "idle" | "submitting" | "success" | "pending" | "error";

/** A live read of the agent wallet from the chain (NOT cached). */
async function fetchWalletBalance(wallet: string): Promise<{ usdc: number; sol: number } | null> {
  try {
    const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}`);
    const data = (await res.json()) as { ok?: boolean; usdc?: number; sol?: number };
    if (!data.ok) return null;
    return { usdc: data.usdc ?? 0, sol: data.sol ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Withdraw flow: send the agent's spendable USDC to the OWNER's wallet. Money-out,
 * so the request is idempotency-keyed (a FRESH key per attempt) and the server
 * gate + recovery keeper prevent any double-send. A network retry NEVER re-sends
 * (the same-key row is owned by the keeper).
 */
export default function WithdrawModal({
  open, agentName, agentWallet, ownerWallet, mintAddress, safeWithdrawable, onClose, onWithdrawn,
}: WithdrawModalProps) {
  const [step, setStep] = useState<Step>("idle");
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  // The live safe cap can shrink after a 400 (server recomputes authoritatively).
  const [maxAmount, setMaxAmount] = useState(safeWithdrawable);

  const networkLabel = getNetworkLabel();

  // Reset when (re)opened; seed the cap from the parent's estimate.
  useEffect(() => {
    if (!open) return;
    setStep("idle");
    setError(null);
    setTxSignature(null);
    setAmountStr("");
    setMaxAmount(safeWithdrawable);
  }, [open, safeWithdrawable]);

  const amount = useMemo(() => {
    const n = Number.parseFloat(amountStr);
    return Number.isFinite(n) ? n : 0;
  }, [amountStr]);

  const overCap = amount > maxAmount + 1e-6;
  const canSubmit = amount > 0 && !overCap && maxAmount > 0 && step !== "submitting";

  const submit = async () => {
    if (!canSubmit) return;
    setStep("submitting");
    setError(null);
    // A FRESH idempotency key per attempt (a network retry of THIS attempt reuses
    // it via the browser; a NEW user attempt gets a new key).
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `wd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const res = await fetch("/api/agents/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, amountUsdc: amount, idempotencyKey }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        txSignature?: string | null;
        pending?: boolean;
        retriable?: boolean;
        safeWithdrawable?: number;
        alreadyPaid?: boolean;
      };

      if (res.ok && data.ok) {
        setTxSignature(data.txSignature ?? null);
        setStep("success");
        // Refresh the parent's balance from chain.
        const bal = await fetchWalletBalance(agentWallet);
        if (bal) onWithdrawn?.(bal);
        return;
      }

      // 202 / 502-pending: the transfer is in flight; the keeper will confirm it.
      if (res.status === 202 || data.pending) {
        setTxSignature(data.txSignature ?? null);
        setStep("pending");
        return;
      }

      // 400 with a recomputed cap → tighten the max and let the user adjust.
      if (typeof data.safeWithdrawable === "number") {
        setMaxAmount(data.safeWithdrawable);
      }
      setError(data.error ?? `Withdraw failed (${res.status})`);
      setStep("error");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error, please retry");
      setStep("error");
    }
  };

  // Portal to <body> so the fixed backdrop escapes any ancestor stacking context.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  if (!portalReady) return null;

  const destShort = ownerWallet ? `${ownerWallet.slice(0, 6)}…${ownerWallet.slice(-6)}` : "your wallet";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", fontFamily: "var(--font-inter)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-[480px] rounded-3xl shadow-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-black text-white px-6 py-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="size-11 rounded-2xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center">
                  {step === "success"
                    ? <CheckCircle2 className="size-5 text-sky-300" strokeWidth={2.2} />
                    : <Wallet className="size-5 text-sky-300" strokeWidth={2.2} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    {step === "success" ? "Withdrawal sent" : step === "pending" ? "Withdrawal processing" : `Withdraw from ${agentName}`}
                  </h2>
                  <p className="text-[12.5px] text-zinc-400 mt-0.5">
                    {step === "success"
                      ? "USDC is on the way to your wallet."
                      : `To your wallet on ${networkLabel}.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="size-8 shrink-0 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* ── IDLE / SUBMITTING / ERROR (the input form) ── */}
            {(step === "idle" || step === "submitting" || step === "error") && (
              <div className="p-6 space-y-4">
                {/* Safe withdrawable */}
                <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-3.5">
                  <p className="text-[10.5px] text-zinc-500 font-semibold uppercase tracking-wide">Available to withdraw</p>
                  <p className="text-2xl font-bold text-zinc-900 tabular-nums tracking-tight">
                    ${maxAmount.toFixed(2)} <span className="text-sm font-semibold text-zinc-400">USDC</span>
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                    Only your compute-free, non-investor balance can be withdrawn (the unsettled service tab, pending fees, and any share-backed capital are held back).
                  </p>
                </div>

                {/* Amount input */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Amount (USDC)</label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className={`flex-1 flex items-center rounded-xl border px-3 py-2.5 ${overCap ? "border-rose-400 bg-rose-50" : "border-zinc-300 bg-white"}`}>
                      <span className="text-zinc-400 text-[15px] font-semibold mr-1">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={maxAmount}
                        step="0.01"
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        placeholder="0.00"
                        disabled={step === "submitting" || maxAmount <= 0}
                        className="flex-1 bg-transparent outline-none text-[15px] font-semibold tabular-nums text-zinc-900 placeholder:text-zinc-300"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAmountStr(maxAmount > 0 ? String(Math.floor(maxAmount * 100) / 100) : "")}
                      disabled={maxAmount <= 0 || step === "submitting"}
                      className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[12px] font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                    >
                      Max
                    </button>
                  </div>
                  {overCap && (
                    <p className="text-[11px] text-rose-600 mt-1">Amount exceeds the available balance.</p>
                  )}
                </div>

                {/* Destination */}
                <div className="rounded-2xl bg-zinc-900 border border-zinc-700 p-3.5">
                  <p className="text-[10.5px] text-zinc-400 font-semibold uppercase tracking-wide mb-1">Destination (your wallet)</p>
                  <p className="font-mono text-[12px] text-white break-all leading-relaxed">{ownerWallet ?? "your connected wallet"}</p>
                  <p className="text-[10.5px] text-zinc-400 mt-1.5 leading-snug">
                    Funds always go to the wallet that owns this agent, you can&apos;t send elsewhere.
                  </p>
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2">
                    <AlertTriangle className="size-4 text-rose-600 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-rose-700 leading-snug">{error}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[13px] font-bold py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {step === "submitting"
                    ? <><Loader2 className="size-4 animate-spin" /> Sending…</>
                    : <><ArrowUpFromLine className="size-4" /> Withdraw {amount > 0 ? `$${amount.toFixed(2)}` : ""}</>}
                </button>
              </div>
            )}

            {/* ── PENDING (in flight; keeper confirms) ── */}
            {step === "pending" && (
              <div className="p-6 space-y-4">
                <div className="flex flex-col items-center justify-center py-6 gap-3">
                  <Loader2 className="size-10 text-sky-600 animate-spin" />
                  <p className="text-[14px] font-semibold text-zinc-900">Processing withdrawal…</p>
                  <p className="text-[12px] text-zinc-500 text-center leading-snug max-w-[320px]">
                    Your transfer was broadcast and will confirm shortly. It&apos;s safe to close this, the withdrawal completes on its own and won&apos;t be sent twice.
                  </p>
                  {txSignature && (
                    <a
                      href={getTxExplorerUrl(txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 hover:underline"
                    >
                      View transaction <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl border border-zinc-300 bg-white text-zinc-700 text-[12.5px] font-semibold py-2.5 hover:bg-zinc-50 transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {/* ── SUCCESS ── */}
            {step === "success" && (
              <div className="p-6 space-y-4">
                <div className="flex flex-col items-center justify-center py-4 gap-3">
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="size-16 rounded-full bg-sky-100 flex items-center justify-center"
                  >
                    <CheckCircle2 className="size-9 text-sky-600" strokeWidth={2.2} />
                  </motion.div>
                  <p className="text-[16px] font-bold text-zinc-900">Sent to your wallet</p>
                  <div className="rounded-2xl bg-sky-50 border border-sky-200 px-5 py-3 text-center">
                    <p className="text-[15px] font-bold text-sky-700 tabular-nums">−${amount.toFixed(2)} USDC</p>
                    <p className="text-[11px] text-sky-600 mt-1">to {destShort}</p>
                  </div>
                  {txSignature && (
                    <a
                      href={getTxExplorerUrl(txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 hover:underline"
                    >
                      View transaction <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-[13px] font-bold py-3 transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
