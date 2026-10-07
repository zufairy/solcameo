"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { ArrowRight, Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { AgentWalletSwap } from "./AgentWalletSwap";
import { QRCodeSVG } from "qrcode.react";
import { getNetwork } from "@/lib/solana/network";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { confirmSignature, fetchWalletBalances, sendFundingTransfer, type FundToken } from "@/lib/solana/fundWallet";
import { getTxExplorerUrl, getUsdcFaucetUrl } from "@/lib/solana/network";
import { CONNECT_BUTTON_CLASS } from "./connectButton";

type Funds = { sol: number; usdc: number };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const money = (v: number | undefined, token: FundToken) => v == null ? "···" : token === "USDC" ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${v.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;

/**
 * Move money from your own wallet into the agent's wallet. The agent pays for its generations from that wallet,
 * so this is the one place to top it up: pick USDC or SOL, an amount, sign once, and it lands on chain.
 */
export function FundAgentDialog({ open, onOpenChange, agentWallet, agentName, suggestedUsdc, mintAddress, initialMode }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentWallet?: string;
  agentName?: string;
  /** Pre-fills the amount, e.g. the cost of the video about to be made. */
  suggestedUsdc?: number;
  /** Enables the "Swap in wallet" tab (SOL and USDC inside the agent wallet itself). */
  mintAddress?: string;
  initialMode?: "USDC" | "SOL" | "SWAP" | "INSIDE";
}) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const [mode, setMode] = useState<"USDC" | "SOL" | "SWAP" | "INSIDE">(initialMode ?? "USDC");
  const token: FundToken = mode === "SOL" ? "SOL" : "USDC";
  const swap = mode === "SWAP";
  const [quote, setQuote] = useState<{ inSol: number; maxSol: number; solUsd: number; slippageBps: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [amount, setAmount] = useState("");
  const [mine, setMine] = useState<Funds | null>(null);
  const [agent, setAgent] = useState<Funds | null>(null);
  const [step, setStep] = useState<"idle" | "approving" | "confirming" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [sig, setSig] = useState("");
  const [copied, setCopied] = useState(false);
  const network = getNetwork();
  const scan = agentWallet ? `https://solscan.io/account/${agentWallet}${network === "mainnet-beta" ? "" : `?cluster=${network}`}` : "";
  const busy = step === "approving" || step === "confirming";
  const num = Number.parseFloat(amount);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the dialog opens
    setStep("idle"); setError(""); setSig("");
    if (suggestedUsdc && suggestedUsdc > 0) setAmount((prev) => prev || (Math.ceil(suggestedUsdc * 100) / 100).toFixed(2));
  }, [open, suggestedUsdc]);

  const loadBalances = async () => {
    try {
      if (publicKey) setMine(await fetchWalletBalances(connection, publicKey));
      if (agentWallet) setAgent(await fetchWalletBalances(connection, new PublicKey(agentWallet)));
    } catch { /* the dialog still works without the figures */ }
  };
  useEffect(() => {
    if (!open) return;
    void loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, publicKey, agentWallet]);

  const available = swap ? (mine && quote ? Math.max(0, mine.sol - 0.008) : undefined) : token === "USDC" ? mine?.usdc : mine ? Math.max(0, mine.sol - 0.005) : undefined;
  const presets = token === "USDC" ? [1, 5, 10, 25] : [0.05, 0.1, 0.25, 0.5];

  // Price the swap as the amount changes: how much SOL it costs to deliver exactly this much USDC.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the stale quote when the inputs change
    if (!open || !swap || !(num >= 0.5)) { setQuote(null); return; }
    let active = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      fetch("/api/agents/fund-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", usdc: num }) })
        .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Could not price this swap."); if (active) { setQuote(d); setError(""); } })
        .catch((e) => { if (active) { setQuote(null); setError(e instanceof Error ? e.message : "Could not price this swap."); } })
        .finally(() => { if (active) setQuoting(false); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [open, swap, num]);

  // When the wallet holds SOL but not enough USDC for the amount needed, start on the swap tab so it just works.
  useEffect(() => {
    if (!open || !mine || mode !== "USDC") return;
    const need = suggestedUsdc ?? 0;
    if (need > 0 && mine.usdc < need && mine.sol > 0.02) setMode("SWAP"); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mine?.usdc, mine?.sol]);

  const swapAndFund = async () => {
    if (!publicKey || !signTransaction) { setError("Connect your wallet first."); setStep("error"); return; }
    if (!agentWallet) { setError("The agent wallet is still being set up. Try again in a moment."); setStep("error"); return; }
    if (!(num >= 0.5)) { setError("The minimum swap is $0.50."); setStep("error"); return; }
    if (mine && quote && mine.sol < quote.maxSol + 0.008) { setError(`You need about ${(quote.maxSol + 0.008).toFixed(4)} SOL (the swap plus network fees); your wallet has ${mine.sol.toFixed(4)} SOL.`); setStep("error"); return; }
    setStep("approving"); setError("");
    try {
      const res = await fetch("/api/agents/fund-swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "build", usdc: num, payer: publicKey.toBase58(), agentWallet }) });
      const built = await res.json();
      if (!res.ok) throw new Error(built.error ?? "Could not prepare the swap.");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
      setSig(signature); setStep("confirming");
      const status = await confirmSignature(connection, signature);
      if (status !== "confirmed") throw new Error("The swap was sent but has not confirmed yet. Check it on the explorer, then refresh.");
      setStep("done");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      void loadBalances();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Swap failed";
      if (/user rejected|user denied|rejected the request|request.*reject/i.test(message)) { setStep("idle"); return; }
      setError(message); setStep("error");
    }
  };

  const transfer = async () => {
    if (!publicKey || !signTransaction) { setError("Connect your wallet first."); setStep("error"); return; }
    if (!agentWallet) { setError("The agent wallet is still being set up. Try again in a moment."); setStep("error"); return; }
    if (!(num > 0)) { setError("Enter an amount greater than 0."); setStep("error"); return; }
    if (available != null && num > available) { setError(token === "USDC" ? `You only have $${available.toFixed(2)} USDC.` : `You only have ${available.toFixed(4)} SOL spare after fees.`); setStep("error"); return; }
    setStep("approving"); setError("");
    try {
      const { sig: signature } = await sendFundingTransfer({ connection, publicKey, signTransaction, agentWallet, token, amount: num });
      setSig(signature); setStep("confirming");
      const status = await confirmSignature(connection, signature);
      if (status !== "confirmed") throw new Error("The transfer was sent but has not confirmed yet. Check it on the explorer, then refresh.");
      setStep("done");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      void loadBalances();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transfer failed";
      if (/user rejected|user denied|rejected the request|request.*reject/i.test(message)) { setStep("idle"); return; }
      setError(message); setStep("error");
    }
  };

  const tabsBar = (
            <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Token">
              {(mintAddress ? (["USDC", "SOL", "SWAP", "INSIDE"] as const) : (["USDC", "SOL", "SWAP"] as const)).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={mode === t} disabled={busy} onClick={() => { setMode(t); setAmount(""); setStep("idle"); setError(""); }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${mode === t ? "bg-white/[0.1] text-white" : "text-zinc-500 hover:text-zinc-300"}`}>{t === "SWAP" ? "SOL → USDC" : t === "INSIDE" ? "Swap in wallet" : t}</button>
              ))}
            </div>
  );
  const faucet = token === "USDC" ? getUsdcFaucetUrl() : null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="!max-w-md rounded-3xl border border-white/20 bg-[linear-gradient(145deg,rgba(40,43,48,0.92),rgba(15,18,22,0.9))] p-6 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-white">Deposit to {agentName || "your agent"}</DialogTitle>
          <DialogDescription className="text-zinc-500">Generations are paid from this agent’s USDC balance. Deposit from your connected wallet or send directly to its address.</DialogDescription>
        </DialogHeader>

        {suggestedUsdc != null && suggestedUsdc > 0 && <p role="alert" className="flex items-center gap-2 rounded-none border-2 border-black bg-white px-2.5 py-1.5 text-[12.5px] font-bold leading-tight text-black shadow-[3px_3px_0_0_#d7ff00,3px_3px_0_2px_#000]"><span aria-hidden className="text-sm leading-none">⚠️</span><span>This generation needs ${suggestedUsdc.toFixed(2)} USDC. Fund the agent, then try again.</span></p>}
        <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          {agentWallet && <div className="shrink-0 rounded-xl bg-white p-2"><QRCodeSVG value={agentWallet} size={76} /></div>}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-white/50">Solana · {network === "mainnet-beta" ? "Mainnet" : network}</p>
            <p className="mt-1 break-all text-xs leading-5 text-white/80">{agentWallet || "Preparing your agent wallet…"}</p>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-white/60">
              <button type="button" disabled={!agentWallet} onClick={() => { if (agentWallet) void navigator.clipboard.writeText(agentWallet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="inline-flex items-center gap-1 hover:text-white">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}</button>
              {scan && <a href={scan} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">Solscan <ExternalLink className="size-3" /></a>}
              <button type="button" onClick={() => { void loadBalances(); window.dispatchEvent(new Event("solcameo:trade-confirmed")); }} className="inline-flex items-center gap-1 hover:text-white"><RefreshCw className="size-3" />Refresh</button>
            </div>
          </div>
        </div>
        <p className="text-[11px] leading-5 text-zinc-400">USDC funds generation. SOL funds network transactions; depositing SOL does not automatically convert it to USDC.</p>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Your wallet</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">{money(swap || token === "SOL" ? mine?.sol : mine?.usdc, swap || token === "SOL" ? "SOL" : "USDC")}</p>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{publicKey ? short(publicKey.toBase58()) : "Not connected"}</p>
          </div>
          <ArrowRight className="size-4 text-zinc-500" />
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Agent wallet</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">{money(token === "USDC" ? agent?.usdc : agent?.sol, token)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{agentWallet ? short(agentWallet) : "Setting up…"}</p>
          </div>
        </div>

        {mode === "INSIDE" && mintAddress ? (
          <>
            {tabsBar}
            <AgentWalletSwap mintAddress={mintAddress} sol={agent?.sol} usdc={agent?.usdc} onDone={() => void loadBalances()} />
          </>
        ) : step === "done" ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
            <span className="mx-auto grid size-9 place-items-center rounded-full bg-white text-black"><Check className="size-5" strokeWidth={3} /></span>
            <p className="mt-3 text-sm font-semibold text-white">{swap ? `Swapped ${quote ? quote.inSol.toFixed(4) : ""} SOL and sent $${amount} USDC to the agent wallet` : `Sent ${amount} ${token} (3% platform fee, 97% to the agent wallet)`}</p>
            {sig && <a href={getTxExplorerUrl(sig)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-400 underline underline-offset-2 hover:text-white">View transaction <ExternalLink className="size-3" /></a>}
            <button type="button" onClick={() => onOpenChange(false)} className={`${CONNECT_BUTTON_CLASS} mt-4 w-full justify-center !py-2`}>Done</button>
          </div>
        ) : (
          <>
            {tabsBar}
            <div>
              <div className="relative">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" aria-label={swap ? "USDC to receive" : `Amount in ${token}`} disabled={busy}
                  className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 pr-28 text-lg tabular-nums text-white outline-none placeholder:text-zinc-600 focus:border-white/25" />
                <span className="absolute right-3 top-3.5 flex items-center gap-2 text-xs text-zinc-500">
                  {!swap && <button type="button" disabled={busy || available == null} onClick={() => available != null && setAmount((Math.floor(available * 10000) / 10000).toString())} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-zinc-300 hover:text-white disabled:opacity-40">Max</button>}
                  {token}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {presets.map((p) => (
                  <button key={p} type="button" disabled={busy} onClick={() => setAmount(String(p))} className="rounded-md border border-white/10 py-1.5 text-[11px] tabular-nums text-zinc-400 transition-colors hover:border-white/25 hover:text-white">{token === "USDC" ? `$${p}` : p}</button>
                ))}
              </div>
            </div>
            {swap && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] leading-5 text-zinc-300">
                {quote ? (
                  <>
                    <p>Swap <span className="font-semibold text-white">≈ {quote.inSol.toFixed(4)} SOL</span> (≈ ${(quote.inSol * quote.solUsd).toFixed(2)}) into <span className="font-semibold text-white">${num.toFixed(2)} USDC</span>, delivered straight to the agent wallet.</p>
                    <p className="text-zinc-500">Best Jupiter route · slippage {(quote.slippageBps / 100).toFixed(2)}% (at most {quote.maxSol.toFixed(4)} SOL) · no Solcameo fee</p>
                  </>
                ) : (
                  <p className="text-zinc-400">{quoting ? "Getting the best Jupiter price…" : num > 0 && num < 0.5 ? "The minimum swap is $0.50." : "Enter the USDC amount the agent needs. We work out the SOL for you."}</p>
                )}
              </div>
            )}
            {faucet && mine && mine.usdc < 1 && (
              <p className="text-[11px] text-zinc-500">No devnet USDC yet? <a href={faucet} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">Get free test USDC</a>.</p>
            )}
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            <button type="button" onClick={() => void (swap ? swapAndFund() : transfer())} disabled={busy || !agentWallet || !(num > 0) || (swap && (!quote || quoting))} className={`${CONNECT_BUTTON_CLASS} w-full justify-center !py-2.5 !text-[12.5px]`}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {step === "approving" ? "Approve in your wallet…" : step === "confirming" ? "Confirming on Solana…" : swap ? `Swap ${quote ? `${quote.inSol.toFixed(4)} SOL` : "SOL"} → $${num > 0 ? num.toFixed(2) : "0.00"} USDC` : `Transfer ${num > 0 ? `${amount} ${token}` : ""} to the agent`}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
