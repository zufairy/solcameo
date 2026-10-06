"use client";
/* eslint-disable @next/next/no-img-element -- hosted character portrait */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Copy, Plus, Rocket, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import DepositModal from "@/components/builder/DepositModal";
import { SERVICE_PRICES } from "@/lib/economy/servicePrices";

const FIRST_VIDEO_USD = SERVICE_PRICES.render;
const GLASS = "border border-white/[0.16] bg-[linear-gradient(160deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04)_45%,rgba(255,255,255,0.08))] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.3),0_24px_60px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function readBalance(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
    const data = (await res.json()) as { ok?: boolean; usdc?: number };
    return data.ok ? data.usdc ?? 0 : null;
  } catch { return null; }
}

/** The "your coin is live" moment: celebrate, then steer the creator to fund the agent so it can make its first video. */
export function LaunchReady({ open, characterId, name, ticker, imageUrl, agentWalletHint, live, onClose, onNavigate }: {
  open: boolean;
  characterId: string;
  name: string;
  ticker: string;
  imageUrl?: string;
  agentWalletHint?: string | null;
  live: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const reduced = useReducedMotion();
  const agent = useQuery(api.influencers.getByMint, open && characterId ? { mintAddress: characterId } : "skip");
  const [ensured, setEnsured] = useState<string | null>(null);
  const wallet = agent?.agentWallet ?? agentWalletHint ?? ensured;
  const [balance, setBalance] = useState<number | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ensuring = useRef(false);

  // The wallet is normally created with the character; if that step was deferred, create it now.
  useEffect(() => {
    if (!open || !agent || wallet || ensuring.current) return;
    ensuring.current = true;
    void fetch("/api/agents/ensure-wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mintAddress: characterId }) })
      .then(r => r.json()).then(d => { if (typeof d.agentWallet === "string") setEnsured(d.agentWallet); })
      .catch(() => undefined).finally(() => { ensuring.current = false; });
  }, [open, agent, wallet, characterId]);

  // Watch the agent wallet so the card flips to "funded" the moment USDC lands.
  useEffect(() => {
    if (!open || !wallet) return;
    let active = true;
    const tick = async () => { const b = await readBalance(wallet); if (active && b !== null) setBalance(b); };
    void tick();
    const timer = setInterval(tick, 6000);
    return () => { active = false; clearInterval(timer); };
  }, [open, wallet]);

  const funded = (balance ?? 0) >= FIRST_VIDEO_USD;
  const copy = useCallback(async () => {
    if (!wallet) return;
    try { await navigator.clipboard.writeText(wallet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be blocked */ }
  }, [wallet]);
  const videosPerDollar = Math.max(1, Math.floor(1 / FIRST_VIDEO_USD));

  return <>
    <Dialog open={open && !depositOpen} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[460px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101215]/95 p-0 text-center text-white sm:max-w-[460px]">
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[120%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(215,255,0,0.22),transparent_65%)]" />
        <div className="relative px-7 pb-7 pt-9">
          <motion.div
            initial={{ scale: reduced ? 1 : 0.6, opacity: 0, rotate: reduced ? 0 : -6 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
            className="relative mx-auto mb-5 size-[92px]"
          >
            {!reduced && <span aria-hidden className="absolute -inset-1 animate-ping rounded-[30px] border border-[#d7ff00]/30 [animation-duration:2.6s]" />}
            {imageUrl
              ? <img src={imageUrl} alt="" className="size-full rounded-[28px] object-cover shadow-[0_0_60px_-8px_rgba(215,255,0,0.55)] ring-2 ring-[#d7ff00]/40" />
              : <div className="grid size-full place-items-center rounded-[28px] bg-white/10"><Rocket className="size-8 text-[#d7ff00]" /></div>}
            <span className="absolute -bottom-1.5 -right-1.5 grid size-8 place-items-center rounded-full bg-[#d7ff00] text-black shadow-[0_6px_18px_-4px_rgba(215,255,0,0.8)] ring-4 ring-[#101215]"><Check className="size-4" strokeWidth={3} /></span>
          </motion.div>

          <DialogTitle className="text-[26px] font-semibold tracking-tight">{name} is ready<span className="text-[#d7ff00]">.</span></DialogTitle>
          <DialogDescription className="mx-auto mt-2.5 max-w-[340px] text-[14.5px] leading-6 text-zinc-400">
            {live
              ? <>${ticker.toUpperCase()} is trading. One last step: fund {name}&apos;s wallet and it will make its first video.</>
              : <>Your preview coin is created. Fund {name}&apos;s wallet so it can make its first video.</>}
          </DialogDescription>

          <motion.div initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.45 }} className={`relative mt-6 overflow-hidden rounded-[18px] p-4 text-left ${GLASS}`}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.12] to-transparent" />
            <div className="relative flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Wallet className="size-[18px] text-white" strokeWidth={1.75} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Agent wallet</p>
                <button type="button" onClick={copy} disabled={!wallet} aria-label="Copy agent wallet address" className="mt-0.5 flex items-center gap-1.5 font-mono text-[13px] text-zinc-200 transition-colors hover:text-white disabled:opacity-60">
                  {wallet ? short(wallet) : "Preparing…"}{wallet && (copied ? <Check className="size-3 text-[#d7ff00]" /> : <Copy className="size-3 text-zinc-500" />)}
                </button>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Balance</p>
                <p className={`mt-0.5 text-[19px] font-semibold tabular-nums leading-none ${funded ? "text-[#d7ff00]" : "text-white"}`}>{balance === null ? "···" : usd(balance)}</p>
              </div>
            </div>

            {funded ? (
              <button type="button" onClick={() => onNavigate(`/control?agent=${characterId}`)} className="relative mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#d7ff00] text-[15px] font-semibold text-black shadow-[0_12px_30px_-10px_rgba(215,255,0,0.65)] transition hover:bg-[#e4ff59] active:scale-[0.98]">
                <Rocket className="size-4" /> Generate first video <ArrowRight className="size-4" />
              </button>
            ) : (
              <button type="button" onClick={() => setDepositOpen(true)} disabled={!wallet} className="group relative mt-4 flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-md border border-white/25 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.06)_55%,rgba(255,255,255,0.12))] text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(0,0,0,0.25),0_14px_30px_-14px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-200 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:bg-gradient-to-b before:from-white/[0.2] before:to-transparent hover:border-white/40 hover:bg-white/[0.14] active:scale-[0.98] disabled:opacity-50">
                <span className="grid size-6 place-items-center rounded-full bg-[#d7ff00] text-black shadow-[0_0_18px_rgba(215,255,0,0.55)] transition-transform duration-200 group-hover:rotate-90"><Plus className="size-4" strokeWidth={3} /></span>
                Add funds
              </button>
            )}
          </motion.div>

          <ul className="mt-4 grid grid-cols-3 gap-2 text-[11.5px] leading-4 text-zinc-400">
            {[["💸", `$1 covers ${videosPerDollar} videos`], ["⚡", "Funded agents start right away"], ["🔓", "Withdraw unused funds anytime"]].map(([icon, text]) => (
              <li key={text} className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2.5"><span aria-hidden className="block text-base leading-none">{icon}</span><span className="mt-1.5 block">{text}</span></li>
            ))}
          </ul>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => onNavigate(`/market/${characterId}`)} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-white/[0.14] bg-white/[0.04] text-[13.5px] font-semibold text-zinc-200 backdrop-blur-xl transition-colors hover:bg-white/[0.09] hover:text-white active:scale-[0.98]">
              View market
            </button>
            <button type="button" onClick={() => onNavigate(`/control?agent=${characterId}`)} className="relative inline-flex h-11 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,255,255,0.7)_55%,rgba(255,255,255,0.84))] text-[13.5px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_24px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-all before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:bg-gradient-to-b before:from-white/70 before:to-transparent hover:bg-white active:scale-[0.98]">
              Open your agent <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {wallet && <DepositModal open={depositOpen} agentName={name} agentWallet={wallet} onClose={() => setDepositOpen(false)} onFunded={b => setBalance(b.usdc)} />}
  </>;
}
