"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, ArrowDownToLine, CheckCircle2, ChevronDown, Copy, Droplet,
  ExternalLink, Loader2, Wallet, X,
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useWalletUsdc } from "@/lib/client/usdcClient";
import { sendFundingTransfer, confirmSignature } from "@/lib/solana/fundWallet";
import {
  getNetworkLabel, getUsdcFaucetUrl, getAccountExplorerUrl, getTxExplorerUrl, isMainnet,
} from "@/lib/solana/network";
import AddFundsButton from "@/components/wallet/AddFundsButton";

interface DepositModalProps {
  open: boolean;
  agentName: string;
  agentWallet: string;
  onClose: () => void;
  /** Called after a confirmed deposit (or a manual refresh) with the fresh
   *  on-chain agent balance so the Earnings card updates. */
  onFunded?: (balance: { usdc: number; sol: number }) => void;
}

type Step = "idle" | "submitting" | "success" | "error";
type Balance = { usdc: number; sol: number };

/** A live read of the agent wallet from the chain (NOT cached). */
async function fetchWalletBalance(wallet: string): Promise<Balance | null> {
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
 * Deposit flow for the agent wallet.
 *
 * LEAD PATH (this rewrite): a USER-SIGNED USDC transfer straight from the
 * connected Privy wallet to the agent wallet — the same campaign-funding model
 * (`sendFundingTransfer`), where the operator pays their own SOL gas and no
 * platform sponsorship is involved. A "Pay with card" secondary funds the agent
 * directly via the Privy on-ramp (mainnet only; devnet shows the Circle faucet).
 *
 * FALLBACK: the raw agent address (copy / explorer) is kept behind an
 * "or send manually" disclosure for anyone who prefers to send from elsewhere,
 * with a Refresh-balance button that re-reads the chain.
 *
 * Wallet context (publicKey / connection / signTransaction / connected-wallet
 * USDC) is sourced from the app's providers via hooks here — the modal is
 * portaled to <body> but React portals preserve provider context, so no
 * prop-drilling through the workspace is needed.
 */
export default function DepositModal({ open, agentName, agentWallet, onClose, onFunded }: DepositModalProps) {
  const [step, setStep] = useState<Step>("idle");
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const { usdc: walletUsdc, refresh: refreshWalletUsdc } = useWalletUsdc();

  // Ref the callback so a parent re-render doesn't stale-close over it.
  const onFundedRef = useRef(onFunded);
  onFundedRef.current = onFunded;

  const faucet = getUsdcFaucetUrl();
  const networkLabel = getNetworkLabel();
  const mainnet = isMainnet();

  // Reset each time the modal (re)opens; re-read the connected wallet USDC.
  useEffect(() => {
    if (!open) return;
    setStep("idle");
    setAmountStr("");
    setError(null);
    setTxSignature(null);
    setManualOpen(false);
    void refreshWalletUsdc();
  }, [open, refreshWalletUsdc]);

  const amount = useMemo(() => {
    const n = Number.parseFloat(amountStr);
    return Number.isFinite(n) ? n : 0;
  }, [amountStr]);

  const maxUsdc = walletUsdc ?? 0;
  // Only enforce the over-balance guard once the balance is known (null = still
  // loading / transient RPC error). sendFundingTransfer double-checks on-chain.
  const overBalance = walletUsdc != null && amount > walletUsdc + 1e-6;
  const walletReady = !!publicKey && !!signTransaction;
  const canDeposit = amount > 0 && !overBalance && walletReady && step !== "submitting";

  const refreshAgentBalance = useCallback(async () => {
    const bal = await fetchWalletBalance(agentWallet);
    if (bal) onFundedRef.current?.(bal);
  }, [agentWallet]);

  const deposit = async () => {
    const pk = publicKey;
    const sign = signTransaction;
    if (!pk || !sign) { setError("Connect your wallet first."); setStep("error"); return; }
    if (!(amount > 0)) { setError("Enter a positive amount."); setStep("error"); return; }
    if (overBalance) { setError("Amount exceeds your wallet balance."); setStep("error"); return; }
    setStep("submitting");
    setError(null);
    setTxSignature(null);
    try {
      const { sig } = await sendFundingTransfer({
        connection,
        publicKey: pk,
        signTransaction: sign,
        agentWallet,
        token: "USDC",
        amount,
      });
      setTxSignature(sig);
      // Poll the signature over HTTP (never hangs on a flaky websocket).
      const status = await confirmSignature(connection, sig);
      void refreshAgentBalance();
      if (status !== "confirmed") {
        setError("Deposit broadcast but not confirmed yet, open it on the explorer to check. Your balance updates the moment it lands.");
        setStep("error");
        return;
      }
      setStep("success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deposit failed";
      // A genuine wallet rejection resets quietly; a real failure (incl. the
      // SOL-floor pre-check) is surfaced verbatim so the operator can act on it.
      if (/user rejected|user denied|rejected the request|request.*reject/i.test(msg)) { setStep("idle"); return; }
      setError(msg);
      setStep("error");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(agentWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  // Portal to <body> so the fixed backdrop escapes any ancestor stacking context.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  if (!portalReady) return null;

  const showForm = step === "idle" || step === "submitting" || step === "error";
  const submitting = step === "submitting";

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
                <div className="size-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                  {step === "success"
                    ? <CheckCircle2 className="size-5 text-emerald-300" strokeWidth={2.2} />
                    : <Wallet className="size-5 text-emerald-300" strokeWidth={2.2} />}
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    {step === "success" ? "Deposit confirmed" : submitting ? "Depositing…" : `Fund ${agentName}`}
                  </h2>
                  <p className="text-[12.5px] text-zinc-400 mt-0.5">
                    {step === "success"
                      ? "On-chain balance increased."
                      : `From your wallet on ${networkLabel}.`}
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

            {/* ── IDLE / SUBMITTING / ERROR (the deposit form) ── */}
            {showForm && (
              <div className="p-6 space-y-4">
                {/* Connected wallet balance (source of the deposit) */}
                <div className="rounded-2xl bg-zinc-50 border border-zinc-200 p-3.5">
                  <p className="text-[10.5px] text-zinc-500 font-semibold uppercase tracking-wide">Your wallet balance</p>
                  <p className="text-2xl font-bold text-zinc-900 tabular-nums tracking-tight">
                    {walletUsdc == null
                      ? <span className="text-zinc-400 text-lg">Reading…</span>
                      : <>${maxUsdc.toFixed(2)} <span className="text-sm font-semibold text-zinc-400">USDC</span></>}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                    Funds go straight to {agentName}. You pay a small SOL network fee.
                  </p>
                </div>

                {/* Amount input + Max */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Amount (USDC)</label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className={`flex-1 flex items-center rounded-xl border px-3 py-2.5 ${overBalance ? "border-rose-400 bg-rose-50" : "border-zinc-300 bg-white"}`}>
                      <span className="text-zinc-400 text-[15px] font-semibold mr-1">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={amountStr}
                        onChange={(e) => setAmountStr(e.target.value)}
                        placeholder="0.00"
                        disabled={submitting}
                        className="flex-1 bg-transparent outline-none text-[15px] font-semibold tabular-nums text-zinc-900 placeholder:text-zinc-300"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAmountStr(maxUsdc > 0 ? String(Math.floor(maxUsdc * 100) / 100) : "")}
                      disabled={maxUsdc <= 0 || submitting}
                      className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-[12px] font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                    >
                      Max
                    </button>
                  </div>
                  {overBalance && (
                    <p className="text-[11px] text-rose-600 mt-1">Amount exceeds your wallet balance.</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2">
                    <AlertTriangle className="size-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[12px] text-rose-700 leading-snug break-words">{error}</p>
                      {txSignature && (
                        <a
                          href={getTxExplorerUrl(txSignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1 text-[11.5px] font-semibold text-rose-700 hover:underline"
                        >
                          View transaction <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Primary: user-signed deposit */}
                <button
                  type="button"
                  onClick={deposit}
                  disabled={!canDeposit}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? <><Loader2 className="size-4 animate-spin" /> Depositing…</>
                    : <><ArrowDownToLine className="size-4" /> Deposit {amount > 0 ? `$${amount.toFixed(2)}` : ""}</>}
                </button>
                {!walletReady && (
                  <p className="text-[11.5px] text-amber-600 text-center leading-snug">Connect your wallet to deposit.</p>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-zinc-200" />
                  <span className="text-[10.5px] text-zinc-400 font-semibold uppercase tracking-wide">or</span>
                  <div className="h-px flex-1 bg-zinc-200" />
                </div>

                {/* Secondary: card on-ramp (mainnet) → funds the AGENT directly.
                    Devnet has no real on-ramp, so surface the test-USDC faucet. */}
                {mainnet ? (
                  <AddFundsButton
                    address={agentWallet}
                    amount={amount > 0 ? String(amount) : undefined}
                    label="Pay with card"
                    onRefresh={() => void refreshAgentBalance()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 text-[13px] font-bold py-3 transition-colors disabled:opacity-60"
                  />
                ) : faucet ? (
                  <a
                    href={faucet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-300 bg-cyan-50 text-cyan-800 hover:bg-cyan-100 text-[12.5px] font-semibold py-2.5 transition-colors"
                  >
                    <Droplet className="size-3.5" /> Get test USDC at Circle Faucet <ExternalLink className="size-3" />
                  </a>
                ) : null}

                {/* Fallback: send manually to the agent address */}
                <div>
                  <button
                    type="button"
                    onClick={() => setManualOpen((v) => !v)}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-zinc-500 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronDown className={`size-3.5 transition-transform ${manualOpen ? "rotate-180" : ""}`} /> or send manually
                  </button>
                  {manualOpen && (
                    <div className="mt-2 rounded-2xl bg-zinc-900 border border-zinc-700 p-3.5">
                      <p className="text-[10.5px] text-zinc-400 font-semibold uppercase tracking-wide mb-1">Agent address ({networkLabel})</p>
                      <p className="font-mono text-[12px] text-white break-all leading-relaxed">{agentWallet}</p>
                      <div className="flex gap-2 mt-2.5">
                        <button
                          type="button"
                          onClick={copy}
                          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${copied ? "bg-emerald-500 text-white" : "bg-white text-zinc-900 hover:bg-zinc-100"}`}
                        >
                          {copied ? <><CheckCircle2 className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy address</>}
                        </button>
                        <a
                          href={getAccountExplorerUrl(agentWallet)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors"
                        >
                          <ExternalLink className="size-3.5" /> Explorer
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshAgentBalance()}
                        className="w-full mt-2.5 rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-200 text-[12px] font-semibold py-2 hover:bg-zinc-700 transition-colors"
                      >
                        I&apos;ve sent it, refresh balance
                      </button>
                    </div>
                  )}
                </div>
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
                    className="size-16 rounded-full bg-emerald-100 flex items-center justify-center"
                  >
                    <CheckCircle2 className="size-9 text-emerald-600" strokeWidth={2.2} />
                  </motion.div>
                  <p className="text-[16px] font-bold text-zinc-900">Funded!</p>
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-3 text-center">
                    <p className="text-[15px] font-bold text-emerald-700 tabular-nums">+${amount.toFixed(2)} USDC</p>
                    <p className="text-[11px] text-emerald-600 mt-1">to {agentName}</p>
                  </div>
                  {txSignature && (
                    <a
                      href={getTxExplorerUrl(txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:underline"
                    >
                      View transaction <ExternalLink className="size-3" />
                    </a>
                  )}
                  <p className="text-[12px] text-zinc-500 text-center leading-snug">
                    {agentName} is funded and ready to clip. You keep custody via the NFT, withdraw anytime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold py-3 transition-colors"
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
