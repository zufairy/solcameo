"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check, Copy, Loader2, Sparkles, Wallet } from "lucide-react";
import type { FundingPlan } from "@/lib/explore/fundingPlan";

const usd = (n: number) => `$${n.toFixed(2)}`;
const BTN = "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d7ff00] px-3 py-2.5 text-[12.5px] font-semibold text-black transition hover:bg-[#e4ff59] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * "What do I do next?" for a wallet that cannot pay yet. It reads both wallets, picks the single easiest way to cover the
 * job and offers it as one button; when nothing covers it, it says exactly what to send and where, in plain steps.
 */
export function FundingGuide({ plan, agentWallet, mintAddress, onSend, onSwap, onSwapped }: {
  plan: FundingPlan;
  agentWallet?: string;
  mintAddress?: string;
  /** Switch the form to a USDC transfer of this amount. */
  onSend: (usd: number) => void;
  /** Switch the form to a SOL to USDC swap of this amount. */
  onSwap: (usd: number) => void;
  onSwapped: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const copy = () => { if (agentWallet) void navigator.clipboard.writeText(agentWallet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  async function swapInside(sol: number) {
    if (!mintAddress) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/agents/wallet-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "swap", mintAddress, direction: "sol_to_usdc", amount: sol }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "The swap did not complete.");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      onSwapped();
    } catch (e) { setError(e instanceof Error ? e.message : "The swap did not complete."); }
    finally { setBusy(false); }
  }

  if (plan.kind === "funded") return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] p-3 text-[12px] text-emerald-200">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-400 text-black"><Check className="size-3.5" strokeWidth={3} /></span>
      <span><b className="font-semibold text-white">The agent wallet is funded.</b> Close this and press Generate.</span>
    </motion.div>
  );

  let title = "", body: React.ReactNode = null, action: React.ReactNode = null;
  if (plan.kind === "agent_swap") {
    title = "Fastest: use the SOL already in the agent wallet";
    body = <>The agent holds enough SOL. One tap swaps about {plan.sol.toFixed(4)} SOL into {usd(plan.usd)} USDC inside its own wallet. Nothing is taken from your wallet and there is no Solcameo fee.</>;
    action = <button type="button" disabled={busy} onClick={() => void swapInside(plan.sol)} className={BTN}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{busy ? "Swapping in the agent wallet…" : `Swap ${plan.sol.toFixed(4)} SOL → ${usd(plan.usd)} USDC`}</button>;
  } else if (plan.kind === "send_usdc") {
    title = "Send the USDC you already have";
    body = <>Your wallet holds the USDC. Send {usd(plan.usd)} to the agent and you are done. You approve once in your wallet.</>;
    action = <button type="button" onClick={() => onSend(plan.usd)} className={BTN}>Use {usd(plan.usd)} USDC <ArrowRight className="size-3.5" /></button>;
  } else if (plan.kind === "swap_mine") {
    title = "Pay with your SOL";
    body = <>Your SOL covers it. We swap about {plan.sol.toFixed(4)} SOL into {usd(plan.usd)} USDC and deliver it straight to the agent, at the live Jupiter price.</>;
    action = <button type="button" onClick={() => onSwap(plan.usd)} className={BTN}>Swap my SOL → {usd(plan.usd)} <ArrowRight className="size-3.5" /></button>;
  } else if (plan.kind === "partial_swap") {
    title = "Your SOL covers part of it";
    body = <>This job needs {usd(plan.shortUsd)} more, but after network fees your wallet can swap up to {usd(plan.maxUsd)}. Swap that now, then add the rest by sending USDC or SOL to the address below.</>;
    action = <button type="button" onClick={() => onSwap(plan.maxUsd)} className={BTN}>Swap the most I can: {usd(plan.maxUsd)} <ArrowRight className="size-3.5" /></button>;
  } else {
    title = `Add ${usd(plan.shortUsd)} to continue`;
    body = (
      <>
        <p>Neither wallet has enough yet. Pick whichever is easier:</p>
        <ol className="mt-2 space-y-1.5">
          <li className="flex gap-2"><span className="grid size-4 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-bold text-white">1</span><span><b className="font-semibold text-white">Send USDC</b> (at least {usd(plan.shortUsd)}) to the agent address below, from any wallet or exchange. Solana network only.</span></li>
          {plan.sendSol != null && <li className="flex gap-2"><span className="grid size-4 shrink-0 place-items-center rounded-full bg-white/10 text-[9px] font-bold text-white">2</span><span><b className="font-semibold text-white">Or send about {plan.sendSol.toFixed(3)} SOL</b> to the same address. The agent swaps it to USDC by itself when you generate. Network fees are covered.</span></li>}
        </ol>
        <p className="mt-2 text-zinc-400">The balance above updates live. When it turns green, close this and press Generate.</p>
      </>
    );
    action = agentWallet ? <button type="button" onClick={copy} className={BTN}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Address copied" : "Copy agent address"}</button> : null;
  }
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2.5 rounded-xl border border-[#d7ff00]/25 bg-[#d7ff00]/[0.05] p-3.5">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-white"><Wallet className="size-3.5 text-[#d7ff00]" />{title}</p>
      <div className="text-[12px] leading-5 text-zinc-300">{body}</div>
      {action}
      {error && <p role="alert" className="text-[11.5px] text-red-300">{error} You can also send USDC or SOL to the agent address below.</p>}
    </motion.div>
  );
}
