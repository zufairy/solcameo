"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2, Copy, Droplet, ExternalLink, X,
} from "lucide-react";
import { getNetworkLabel, getUsdcFaucetUrl, getAccountExplorerUrl } from "@/lib/solana/network";

interface WalletReceiveModalProps {
  open: boolean;
  /** The user's OWN Privy Solana wallet address (custody stays with the user). */
  address: string;
  onClose: () => void;
  /** Called once a real on-chain increase over the open-time baseline is seen. */
  onFunded?: (balance: { usdc: number; sol: number }) => void;
}

type Balance = { usdc: number; sol: number };

/** A live read of the wallet from chain. NO server mutation — display only. */
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

const POLL_MS = 5000;
// A deposit counts when EITHER token rises past its open-time baseline by more
// than this (covers float noise from the RPC). USDC has 6dp, SOL 9dp on chain.
const EPS = 0.0001;

/**
 * Deposit / Receive modal for the user's OWN Vello wallet. Shows the address, a
 * scannable QR, a copy button, an explorer link, and (on devnet) the Circle
 * faucet. It watches the chain in the background: it snapshots the balance when
 * the modal opens and surfaces a "funds received" confirmation the moment a real
 * increase lands. This is a pure display + read flow — no money mutation.
 */
export default function WalletReceiveModal({ open, address, onClose, onFunded }: WalletReceiveModalProps) {
  const [copied, setCopied] = useState(false);
  const [baseline, setBaseline] = useState<Balance | null>(null);
  const [current, setCurrent] = useState<Balance | null>(null);
  const [received, setReceived] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFundedRef = useRef(onFunded);
  onFundedRef.current = onFunded;

  const faucet = getUsdcFaucetUrl();
  const networkLabel = getNetworkLabel();

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Snapshot the pre-deposit balance the moment the modal opens, then poll for an
  // increase over it. Retry the open-time snapshot a few times so a transient RPC
  // null doesn't leave baseline null (which would let an already-funded wallet
  // falsely read as a fresh deposit).
  useEffect(() => {
    if (!open || !address) return;
    setBaseline(null);
    setCurrent(null);
    setReceived(false);
    let cancelled = false;
    let startBaseline: Balance | null = null;

    const tick = async () => {
      const b = await fetchWalletBalance(address);
      if (cancelled || !b) return;
      if (!startBaseline) {
        startBaseline = b;
        setBaseline(b);
        setCurrent(b);
        return;
      }
      setCurrent(b);
      if (b.usdc > startBaseline.usdc + EPS || b.sol > startBaseline.sol + EPS) {
        setReceived(true);
        onFundedRef.current?.(b);
        stopPolling();
      }
    };

    void tick();
    pollRef.current = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; stopPolling(); };
  }, [open, address, stopPolling]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const gained = baseline && current
    ? { usdc: Math.max(0, current.usdc - baseline.usdc), sol: Math.max(0, current.sol - baseline.sol) }
    : { usdc: 0, sol: 0 };

  // Portal to <body> so the fixed backdrop escapes any ancestor stacking context.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  if (!portalReady) return null;

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
            className="w-full max-w-[440px] rounded-3xl shadow-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-black text-white px-6 py-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight">Deposit to your wallet</h2>
                <p className="text-[12.5px] text-zinc-400 mt-0.5">
                  Send USDC or SOL on {networkLabel} to this address.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="size-8 shrink-0 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Funds-received confirmation (chain poll) */}
              {received && (gained.usdc > EPS || gained.sol > EPS) && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2.5">
                  <CheckCircle2 className="size-5 text-emerald-600 shrink-0" strokeWidth={2.2} />
                  <div>
                    <p className="text-[13px] font-bold text-emerald-700">Funds received</p>
                    <p className="text-[12px] text-emerald-600 tabular-nums">
                      {gained.usdc > EPS && <>+${gained.usdc.toFixed(2)} USDC </>}
                      {gained.sol > EPS && <>+{gained.sol.toFixed(4)} SOL</>}
                    </p>
                  </div>
                </div>
              )}

              {/* QR */}
              <div className="flex justify-center">
                <div className="rounded-2xl bg-white border border-zinc-200 p-3">
                  <QRCodeSVG value={address} size={168} level="M" marginSize={0} />
                </div>
              </div>

              {faucet && (
                <div className="rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-900">📝 You&apos;re on {networkLabel}</p>
                  <p className="text-[12.5px] text-cyan-800 mt-1 leading-snug">
                    Mint free test USDC at Circle&apos;s faucet (paste the address below), or send SOL for gas.
                  </p>
                  <a
                    href={faucet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-md bg-cyan-600 hover:bg-cyan-700 text-white text-[11.5px] font-semibold transition-colors"
                  >
                    <Droplet className="size-3" /> Open Circle Faucet <ExternalLink className="size-2.5" />
                  </a>
                </div>
              )}

              {/* Address */}
              <div className="rounded-2xl bg-zinc-900 border border-zinc-700 p-3.5">
                <p className="text-[10.5px] text-zinc-400 font-semibold uppercase tracking-wide mb-1">Your wallet address ({networkLabel})</p>
                <p className="font-mono text-[12px] text-white break-all leading-relaxed">{address}</p>
                <div className="flex gap-2 mt-2.5">
                  <button
                    type="button"
                    onClick={copy}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${copied ? "bg-emerald-500 text-white" : "bg-white text-zinc-900 hover:bg-zinc-100"}`}
                  >
                    {copied ? <><CheckCircle2 className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy address</>}
                  </button>
                  <a
                    href={getAccountExplorerUrl(address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors"
                  >
                    <ExternalLink className="size-3.5" /> Explorer
                  </a>
                </div>
              </div>

              <p className="text-[11.5px] text-zinc-500 leading-snug">
                Only send assets on {networkLabel}. This is your own wallet — you keep full custody.
                This window updates automatically the moment a deposit lands.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
