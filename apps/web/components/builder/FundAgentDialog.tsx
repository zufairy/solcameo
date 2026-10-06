"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
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
export function FundAgentDialog({ open, onOpenChange, agentWallet, agentName, suggestedUsdc }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentWallet?: string;
  agentName?: string;
  /** Pre-fills the amount, e.g. the cost of the video about to be made. */
  suggestedUsdc?: number;
}) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const [token, setToken] = useState<FundToken>("USDC");
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

  const available = token === "USDC" ? mine?.usdc : mine ? Math.max(0, mine.sol - 0.005) : undefined;
  const presets = token === "USDC" ? [1, 5, 10, 25] : [0.05, 0.1, 0.25, 0.5];

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
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">{money(token === "USDC" ? mine?.usdc : mine?.sol, token)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{publicKey ? short(publicKey.toBase58()) : "Not connected"}</p>
          </div>
          <ArrowRight className="size-4 text-zinc-500" />
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Agent wallet</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-white">{money(token === "USDC" ? agent?.usdc : agent?.sol, token)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{agentWallet ? short(agentWallet) : "Setting up…"}</p>
          </div>
        </div>

        {step === "done" ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
            <span className="mx-auto grid size-9 place-items-center rounded-full bg-white text-black"><Check className="size-5" strokeWidth={3} /></span>
            <p className="mt-3 text-sm font-semibold text-white">Sent {amount} {token} to the agent wallet</p>
            {sig && <a href={getTxExplorerUrl(sig)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-zinc-400 underline underline-offset-2 hover:text-white">View transaction <ExternalLink className="size-3" /></a>}
            <button type="button" onClick={() => onOpenChange(false)} className={`${CONNECT_BUTTON_CLASS} mt-4 w-full justify-center !py-2`}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Token">
              {(["USDC", "SOL"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={token === t} disabled={busy} onClick={() => { setToken(t); setAmount(""); setStep("idle"); }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${token === t ? "bg-white/[0.1] text-white" : "text-zinc-500 hover:text-zinc-300"}`}>{t}</button>
              ))}
            </div>
            <div>
              <div className="relative">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" aria-label={`Amount in ${token}`} disabled={busy}
                  className="h-12 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 pr-28 text-lg tabular-nums text-white outline-none placeholder:text-zinc-600 focus:border-white/25" />
                <span className="absolute right-3 top-3.5 flex items-center gap-2 text-xs text-zinc-500">
                  <button type="button" disabled={busy || available == null} onClick={() => available != null && setAmount((Math.floor(available * 10000) / 10000).toString())} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-zinc-300 hover:text-white disabled:opacity-40">Max</button>
                  {token}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {presets.map((p) => (
                  <button key={p} type="button" disabled={busy} onClick={() => setAmount(String(p))} className="rounded-md border border-white/10 py-1.5 text-[11px] tabular-nums text-zinc-400 transition-colors hover:border-white/25 hover:text-white">{token === "USDC" ? `$${p}` : p}</button>
                ))}
              </div>
            </div>
            {faucet && mine && mine.usdc < 1 && (
              <p className="text-[11px] text-zinc-500">No devnet USDC yet? <a href={faucet} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">Get free test USDC</a>.</p>
            )}
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            <button type="button" onClick={() => void transfer()} disabled={busy || !agentWallet || !(num > 0)} className={`${CONNECT_BUTTON_CLASS} w-full justify-center !py-2.5 !text-[12.5px]`}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {step === "approving" ? "Approve in your wallet…" : step === "confirming" ? "Confirming on Solana…" : `Transfer ${num > 0 ? `${amount} ${token}` : ""} to the agent`}
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
