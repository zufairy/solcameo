"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Gift, Loader2, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AddFundsButton from "@/components/wallet/AddFundsButton";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { sendUsdc, useWalletSol, useWalletUsdc } from "@/lib/client/usdcClient";
import { getNetworkLabel } from "@/lib/solana/network";
import { STUDIO_FREE_IMAGES, STUDIO_IMAGE_USD, studioCostUsd } from "@/lib/studio/pricing";
import { LIME, SPRING } from "./character-ui";

/** SOL a USDC transfer needs for its network fee. */
const MIN_SOL = 0.002;
const FLAG = "solcameo.studio.useFree";

type Quota = { freeTotal: number; freeLeft: number; credits: number; treasury: string };
export type StudioPayment = { paymentSignature?: string; payer?: string };

export type StudioBilling = {
  enabled: boolean;
  useFree: boolean;
  setUseFree: (on: boolean) => void;
  quota: Quota | null;
  /** Images of `images` that will cost USDC under the current switch / allowance. */
  owedImages: (images: number) => number;
  /** Settle `images` before a generation starts. Null = the user must top up or cancelled; the popup is already showing. */
  prepare: (images: number) => Promise<StudioPayment | null>;
  /** The server accepted the generation: forget the held payment and re-read the allowance. */
  settled: () => void;
  /** The server rejected the signature itself, so a retry must pay afresh. */
  discard: () => void;
  refresh: () => Promise<void>;
  error: string | null;
  usdc: number | null;
  topUp: { needUsd: number; reason: "usdc" | "sol" } | null;
  closeTopUp: () => void;
  paying: boolean;
};

export function useStudioBilling(enabled: boolean): StudioBilling {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { usdc, refresh: refreshUsdc } = useWalletUsdc();
  const { sol, refresh: refreshSol } = useWalletSol();
  const [quota, setQuota] = useState<Quota | null>(null);
  const [useFree, setUseFreeState] = useState(true);
  const [topUp, setTopUp] = useState<StudioBilling["topUp"]>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<{ signature: string; images: number; payer: string } | null>(null);

  // Restoring a per-viewer preference after hydration is the intended one-shot setState.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { if (localStorage.getItem(FLAG) === "0") setUseFreeState(false); } catch { /* private mode */ } }, []);
  const setUseFree = useCallback((on: boolean) => { setUseFreeState(on); try { localStorage.setItem(FLAG, on ? "1" : "0"); } catch { /* private mode */ } }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/character/studio-quota", { cache: "no-store" });
      if (res.ok) setQuota(await res.json() as Quota);
    } catch { /* keep the last known allowance */ }
  }, [enabled]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the allowance once the account is known
  useEffect(() => { void refresh(); }, [refresh]);

  const owedImages = useCallback((images: number) => {
    if (!enabled) return 0;
    const free = useFree ? quota?.freeLeft ?? 0 : 0;
    return Math.max(0, images - free - (quota?.credits ?? 0));
  }, [enabled, useFree, quota]);

  const prepare = useCallback(async (images: number): Promise<StudioPayment | null> => {
    setError(null);
    const owed = owedImages(images);
    if (owed === 0) return {};
    const treasury = quota?.treasury;
    if (!treasury) { setError("Payments are not available right now. Please try again shortly."); return null; }
    if (!publicKey || !signTransaction) { setError("Connect your wallet to pay for this generation."); return null; }
    const payer = publicKey.toBase58();
    // A payment that already landed but never reached a generation is reused instead of charged twice.
    if (held.current && held.current.images >= owed && held.current.payer === payer) return { paymentSignature: held.current.signature, payer };
    const need = studioCostUsd(owed);
    const [balance, gas] = await Promise.all([refreshUsdc(), refreshSol()]);
    if ((balance ?? usdc ?? 0) < need - 1e-6) { setTopUp({ needUsd: need, reason: "usdc" }); return null; }
    if ((gas ?? sol ?? 1) < MIN_SOL) { setTopUp({ needUsd: need, reason: "sol" }); return null; }
    setPaying(true);
    try {
      const sent = await sendUsdc({ publicKey, signTransaction, toPubkey: treasury, amountUsdc: need });
      if (!sent.ok) {
        if (sent.unconfirmed) { held.current = { signature: sent.signature, images: owed, payer }; return { paymentSignature: sent.signature, payer }; }
        if (/no USDC|Insufficient USDC/i.test(sent.error)) { setTopUp({ needUsd: need, reason: "usdc" }); return null; }
        setError(/reject|declin|cancel/i.test(sent.error) ? "Payment cancelled. Nothing was charged." : sent.error);
        return null;
      }
      held.current = { signature: sent.signature, images: owed, payer };
      void refreshUsdc();
      return { paymentSignature: sent.signature, payer };
    } finally { setPaying(false); }
  }, [owedImages, quota, publicKey, signTransaction, refreshUsdc, refreshSol, usdc, sol]);

  const settled = useCallback(() => { held.current = null; void refresh(); void refreshUsdc(); }, [refresh, refreshUsdc]);
  const discard = useCallback(() => { held.current = null; }, []);

  return { enabled, useFree, setUseFree, quota, owedImages, prepare, settled, discard, refresh, error, usdc, topUp, paying, closeTopUp: () => setTopUp(null) };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Box under the trait list: free generations switch, price and wallet balance. */
export function StudioWalletBox({ billing }: { billing: StudioBilling }) {
  const { quota, useFree, usdc } = billing;
  const left = quota?.freeLeft ?? 0;
  const free = useFree && left > 0;
  return (
    <div className="mx-0.5 mb-1 overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(135deg,rgba(215,255,0,0.08),rgba(255,255,255,0.02)_55%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-black/30" style={{ color: LIME }}><Gift className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white">Free generations</p>
          <p className="text-[11px] leading-4 text-zinc-400">{quota ? `${left} of ${quota.freeTotal || STUDIO_FREE_IMAGES} left on your wallet` : "Checking your wallet…"}</p>
        </div>
        <Switch aria-label="Use free generations" checked={useFree} onCheckedChange={billing.setUseFree} disabled={!quota} className="data-checked:!bg-[#d7ff00]" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-black/30 px-3 py-2 text-[11.5px]">
        <span className="text-zinc-400">{free ? <>Your next <b className="text-white">{left}</b> image{left === 1 ? " is" : "s are"} <b style={{ color: LIME }}>free</b>, then {money(STUDIO_IMAGE_USD)} each</> : <>{money(STUDIO_IMAGE_USD)} per image on any model, paid in USDC</>}</span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums text-zinc-300"><Wallet className="size-3.5 text-zinc-500" />{usdc == null ? "—" : money(usdc)}</span>
      </div>
      {billing.error && <p role="alert" className="mt-2 text-[11.5px] text-red-300">{billing.error}</p>}
    </div>
  );
}

/** What this run costs, for the generate button. */
export function priceLabel(billing: StudioBilling, images: number) {
  if (!billing.enabled) return null;
  const owed = billing.owedImages(images);
  return owed === 0 ? "Free" : money(studioCostUsd(owed));
}

/** Glass popup shown when the wallet cannot cover a generation. Spots the deposit by itself and lets the user carry on. */
export function TopUpDialog({ billing }: { billing: StudioBilling }) {
  const { publicKey } = useUnifiedSolanaWallet();
  const { usdc, refresh: refreshUsdc } = useWalletUsdc();
  const { sol, refresh: refreshSol } = useWalletSol();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const topUp = billing.topUp;
  const address = publicKey?.toBase58() ?? "";
  const ready = !!topUp && (topUp.reason === "usdc" ? (usdc ?? 0) >= topUp.needUsd - 1e-6 : (sol ?? 0) >= MIN_SOL);

  useEffect(() => {
    if (!topUp) return;
    const t = setInterval(() => { void refreshUsdc(); void refreshSol(); }, 5000);
    return () => clearInterval(t);
  }, [topUp, refreshUsdc, refreshSol]);

  const check = async () => { setChecking(true); await Promise.all([refreshUsdc(), refreshSol()]); setChecking(false); };
  const copy = async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ } };
  const have = usdc ?? 0;
  const gap = topUp ? Math.max(0, topUp.needUsd - have) : 0;
  const card = String(Math.max(Math.ceil(gap), 5));

  return (
    <Dialog open={!!topUp} onOpenChange={v => { if (!v) billing.closeTopUp(); }}>
      <DialogContent showCloseButton={false} className="w-[min(94vw,440px)] max-w-none gap-0 overflow-hidden rounded-[30px] border border-white/[0.16] bg-[linear-gradient(145deg,rgba(255,255,255,0.14),rgba(255,255,255,0.03)_42%,rgba(215,255,0,0.07))] bg-[#0b0d0f]/80 p-0 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_50px_140px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-none">
        <DialogTitle className="sr-only">Top up your wallet</DialogTitle>
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-[#d7ff00]/20 blur-3xl" />
        <button type="button" onClick={billing.closeTopUp} aria-label="Close" className="absolute right-3.5 top-3.5 z-10 grid size-8 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        {topUp && <div className="relative px-6 pb-6 pt-8 text-center">
          <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING} className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/25 bg-gradient-to-b from-white/[0.25] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_16px_40px_-14px_rgba(215,255,0,0.5)]" style={{ color: LIME }}><Wallet className="size-6" /></motion.span>
          <h3 className="mt-4 text-[22px] font-semibold tracking-tight">{topUp.reason === "usdc" ? "Top up to keep creating" : "Add a little SOL for the network fee"}</h3>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-5 text-zinc-400">
            {topUp.reason === "usdc" ? <>This generation costs <b className="text-white">{money(topUp.needUsd)}</b> USDC. Your wallet has <b className="text-white">{money(have)}</b>, so add at least <b style={{ color: LIME }}>{money(gap)}</b>.</> : <>Sending USDC needs about 0.002 SOL for the Solana network fee. Add a small amount and you are set.</>}
          </p>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/35 p-3 text-left">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-zinc-500">Your wallet · {getNetworkLabel()}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-200">{address || "Connect a wallet"}</code>
              <button type="button" onClick={() => void copy()} disabled={!address} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[12px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.12] disabled:opacity-40">
                {copied ? <><Check className="size-3.5" style={{ color: LIME }} />Copied</> : <><Copy className="size-3.5" />Copy</>}
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-[12px]">
              <span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-zinc-400">USDC <b className="ml-1 tabular-nums text-white">{usdc == null ? "—" : money(usdc)}</b></span>
              <span className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-zinc-400">SOL <b className="ml-1 tabular-nums text-white">{sol == null ? "—" : sol.toFixed(4)}</b></span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <AnimatePresence mode="wait" initial={false}>
              {ready
                ? <motion.button key="go" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} type="button" onClick={billing.closeTopUp} className="flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-black shadow-[0_12px_32px_-10px_rgba(215,255,0,0.6)] active:scale-[.985]" style={{ background: LIME }}><ShieldCheck className="size-4" />Funds received · press Generate</motion.button>
                : <motion.div key="fund" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
                  {address && <AddFundsButton address={address} amount={card} label={`Add $${card} with card`} onRefresh={() => void check()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-black shadow-[0_12px_32px_-10px_rgba(215,255,0,0.6)] transition-transform active:scale-[.985]" faucetClassName="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.12]" />}
                  <button type="button" onClick={() => void check()} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.09] hover:text-white">
                    {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}I sent funds, check my balance
                  </button>
                </motion.div>}
            </AnimatePresence>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">Send USDC on Solana to the address above. We spot it automatically.</p>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
