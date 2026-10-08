"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownUp, Check, ExternalLink, Loader2 } from "lucide-react";
import { getTxExplorerUrl } from "@/lib/solana/network";

type Direction = "sol_to_usdc" | "usdc_to_sol";
type Quote = { outAmount: number; minOut: number; priceImpactPct: number; slippageBps: number };
/** SOL the agent wallet always keeps for network fees; mirrors the server. */
const SOL_KEEP = 0.005;

/**
 * Swap between the agent wallet's own SOL and USDC (either way) without moving anything through your wallet. The server signs
 * with the agent key after checking you own the agent, at the best Jupiter price with tight slippage.
 */
export function AgentWalletSwap({ mintAddress, sol, usdc, onDone }: { mintAddress: string; sol?: number; usdc?: number; onDone: () => void }) {
  const [direction, setDirection] = useState<Direction>("sol_to_usdc");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ signature: string; received: number } | null>(null);
  const num = Number.parseFloat(amount);
  const fromSol = direction === "sol_to_usdc";
  const available = fromSol ? (sol == null ? undefined : Math.max(0, sol - SOL_KEEP)) : usdc;
  const minimum = fromSol ? 0.005 : 0.5;

  // Priced as the amount changes, then re-priced every 4 seconds so the quote on screen is always the live one.
  const [quotedAt, setQuotedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the stale quote when the inputs change
    setQuote(null);
    if (!(num >= minimum)) return;
    let active = true;
    const run = async (silent: boolean) => {
      if (!silent) setQuoting(true);
      try {
        const r = await fetch("/api/agents/wallet-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", mintAddress, direction, amount: num }), cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not price this swap.");
        if (active) { setQuote(d); setQuotedAt(Date.now()); if (!silent) setError(""); }
      } catch (e) { if (active && !silent) setError(e instanceof Error ? e.message : "Could not price this swap."); }
      finally { if (active && !silent) setQuoting(false); }
    };
    const first = setTimeout(() => void run(false), 350);
    const poll = setInterval(() => { if (!document.hidden && !busy) void run(true); }, 4000);
    return () => { active = false; clearTimeout(first); clearInterval(poll); };
  }, [mintAddress, direction, num, minimum, busy]);

  const overBalance = available != null && num > available + 1e-9;
  async function swap() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/agents/wallet-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "swap", mintAddress, direction, amount: num }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "The swap failed.");
      setDone({ signature: data.signature, received: data.received });
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "The swap failed."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
        <span className="mx-auto grid size-9 place-items-center rounded-full bg-white text-black"><Check className="size-5" strokeWidth={3} /></span>
        <p className="mt-3 text-sm font-semibold text-white">Swapped inside the agent wallet{done.received > 0 ? `: +${fromSol ? `$${done.received.toFixed(2)} USDC` : `${done.received.toFixed(4)} SOL`}` : ""}</p>
        <a href={getTxExplorerUrl(done.signature)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-400 underline underline-offset-2 hover:text-white">View transaction <ExternalLink className="size-3" /></a>
        <button type="button" onClick={() => { setDone(null); setAmount(""); }} className="mt-3 block w-full rounded-lg bg-white/10 py-2 text-xs font-semibold text-white hover:bg-white/15">Swap again</button>
      </div>
    );
  }
  const unit = fromSol ? "SOL" : "USDC";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">From</p>
          <p className="mt-1 text-sm font-semibold text-white">{unit}</p>
          <p className="text-[10px] tabular-nums text-zinc-500">{available == null ? "···" : fromSol ? `${available.toFixed(4)} swappable` : `$${available.toFixed(2)}`}</p>
        </div>
        <button type="button" disabled={busy} aria-label="Swap direction" onClick={() => { setDirection(fromSol ? "usdc_to_sol" : "sol_to_usdc"); setAmount(""); setError(""); }}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-zinc-200 transition hover:bg-white/15 active:scale-95"><ArrowDownUp className="size-4" /></button>
        <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">To</p>
          <p className="mt-1 text-sm font-semibold text-white">{fromSol ? "USDC" : "SOL"}</p>
          <p className="text-[10px] tabular-nums text-zinc-500">{fromSol ? (usdc == null ? "···" : `$${usdc.toFixed(2)} now`) : (sol == null ? "···" : `${sol.toFixed(4)} now`)}</p>
        </div>
      </div>
      <div className="relative">
        <input value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} placeholder="0.00" inputMode="decimal" aria-label={`Amount of ${unit} to swap`} disabled={busy}
          className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 pr-28 text-lg tabular-nums text-white outline-none placeholder:text-zinc-600 focus:border-white/25" />
        <span className="absolute right-3 top-3.5 flex items-center gap-2 text-xs text-zinc-500">
          <button type="button" disabled={busy || available == null} onClick={() => available != null && setAmount((Math.floor(available * 10000) / 10000).toString())} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-zinc-300 hover:text-white disabled:opacity-40">Max</button>
          {unit}
        </span>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] leading-5 text-zinc-300">
        {quote ? (
          <>
            <p>You get about <span className="inline-block font-semibold tabular-nums text-white">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={fromSol ? quote.outAmount.toFixed(2) : quote.outAmount.toFixed(4)} initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="inline-block">
                  {fromSol ? `$${quote.outAmount.toFixed(2)} USDC` : `${quote.outAmount.toFixed(4)} SOL`}
                </motion.span>
              </AnimatePresence>
            </span> (at least {fromSol ? `$${quote.minOut.toFixed(2)}` : `${quote.minOut.toFixed(4)} SOL`}).</p>
            <p className="mt-1 flex items-center gap-2 text-zinc-500">
              <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" /></span>
              Live Jupiter price · updated {Math.max(0, Math.round((now - quotedAt) / 1000))}s ago · slippage {(quote.slippageBps / 100).toFixed(2)}% · signed by the agent wallet, no Solcameo fee
            </p>
          </>
        ) : <p className="text-zinc-400">{quoting ? "Getting the best Jupiter price…" : num > 0 && num < minimum ? `The minimum is ${fromSol ? "0.005 SOL" : "$0.50"}.` : `Enter how much ${unit} to swap. The agent wallet keeps ${SOL_KEEP} SOL for network fees.`}</p>}
      </div>
      {overBalance && <p role="alert" className="text-xs text-red-300">More than the wallet can swap right now.</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <button type="button" onClick={() => void swap()} disabled={busy || !quote || quoting || overBalance}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-[12.5px] font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40">
        {busy && <Loader2 className="size-3.5 animate-spin" />}{busy ? "Swapping in the agent wallet…" : `Swap ${num > 0 ? amount : ""} ${unit} → ${fromSol ? "USDC" : "SOL"}`}
      </button>
    </div>
  );
}
