"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { FUNDING_FEE_BPS, previewFundingSplit } from "@/lib/solana/fundingFee";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { sendSolTopUp } from "@/lib/solstar/sendTopUp";
import { formatUsdEstimate } from "@/lib/solstar/usdc";

type Target = { available: boolean; network?: "devnet" | "mainnet"; treasury?: string; feeWallet?: string };
const PRESETS = [0.1, 0.5, 1];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Carousel page: the agent's wallet balance and a one-tap top-up. The SOL goes on chain in a single transaction
 * (97% agent treasury, 3% platform), then the server re-reads it from the cluster before crediting the balance.
 */
export function AgentFundSlide({ characterId, name }: { characterId: Id<"ssCharacters">; name: string }) {
  const wheel = useQuery(api.solstarFlywheel.status, { characterId });
  const rate = useSolUsd();
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "sign" | "confirm" | "done">("idle");
  const [error, setError] = useState("");
  const [sig, setSig] = useState("");
  const num = Number.parseFloat(amount);
  const { fee, net } = previewFundingSplit(num);
  const busy = step === "sign" || step === "confirm";
  const available = wheel?.available ?? "0";
  const enabled = !!wheel && wheel.network !== "paper" && !!wheel.treasury;

  async function fund() {
    setError("");
    if (!publicKey || !signTransaction) return setError("Connect your wallet first.");
    if (!(num >= 0.001)) return setError("Minimum is 0.001 SOL.");
    setStep("sign");
    try {
      const target = (await (await fetch(`/api/solstar/fund?characterId=${characterId}`, { cache: "no-store" })).json()) as Target;
      if (!target.available || !target.treasury || !target.feeWallet || !target.network) throw new Error("Funding is not available for this agent yet.");
      if (!(await ensureSiwsViaRegistered())) throw new Error("Verify your wallet first.");
      const { signature } = await sendSolTopUp({ payer: publicKey, signTransaction, treasury: target.treasury, feeWallet: target.feeWallet, sol: num, network: target.network });
      setSig(signature); setStep("confirm");
      for (let i = 0; i < 30; i++) {
        const res = await fetch("/api/solstar/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId, signature }) });
        if (res.ok) { setStep("done"); return; }
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status !== 202 && d.error !== "not_confirmed") throw new Error(d.error === "fee_missing" ? "The platform fee was missing from the transaction." : (d.error ?? "Could not credit the transfer."));
        await sleep(1500);
      }
      throw new Error("Sent, but not confirmed yet. It will be credited once it lands; reopen this page to retry.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Transfer failed";
      setStep("idle");
      if (!/user rejected|user denied|rejected the request|request.*reject/i.test(m)) setError(m);
    }
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-4 py-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] text-zinc-500">{name}’s wallet</p>
          <p className="font-sans text-[26px] font-semibold leading-none tracking-tight tabular-nums text-white">{wheel ? formatUsdEstimate(available, rate) : "—"}</p>
          <p className="mt-1 text-[10px] tabular-nums text-zinc-600">{(Number(available) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL to work with</p>
        </div>
        {step === "done" ? (
          <div className="flex items-center gap-1.5 pb-1 text-[12px] font-medium text-white">
            <span className="grid size-5 place-items-center rounded-full bg-[#d7ff00] text-black"><Check className="size-3" strokeWidth={3} /></span>
            Funded
            {sig && <a href={getTxExplorerUrl(sig)} target="_blank" rel="noreferrer" aria-label="View transaction" className="text-zinc-500 hover:text-white"><ExternalLink className="size-3" /></a>}
            <button type="button" onClick={() => { setStep("idle"); setAmount(""); setSig(""); }} className="ml-1 text-zinc-500 underline-offset-2 hover:text-white hover:underline">Add more</button>
          </div>
        ) : !enabled ? (
          <p className="max-w-[10rem] pb-1 text-right text-[11px] leading-snug text-zinc-600">{wheel ? "Funding opens once this coin is live on-chain." : "Loading…"}</p>
        ) : (
          <div className="flex items-center gap-1.5 pb-0.5">
            <label className="flex h-9 w-24 items-center rounded-full bg-white/[0.07] px-3 text-[13px] tabular-nums text-white focus-within:bg-white/[0.11]">
              <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setError(""); }} placeholder="0.0" inputMode="decimal" aria-label="Amount in SOL" disabled={busy}
                className="w-full min-w-0 bg-transparent outline-none placeholder:text-zinc-600" />
              <span className="ml-1 text-[10px] text-zinc-500">SOL</span>
            </label>
            <button type="button" onClick={() => void fund()} disabled={busy || !(num > 0)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-semibold text-black transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30">
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {step === "sign" ? "Approve…" : step === "confirm" ? "Confirming…" : "Fund"}
            </button>
          </div>
        )}
      </div>
      {enabled && step !== "done" && (
        <div className="flex items-center justify-between text-[10.5px] text-zinc-600">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button key={p} type="button" disabled={busy} onClick={() => { setAmount(String(p)); setError(""); }} className="rounded-full bg-white/[0.05] px-2 py-0.5 tabular-nums text-zinc-400 transition hover:bg-white/[0.1] hover:text-white">{p}</button>
            ))}
          </div>
          <span className="tabular-nums">{num > 0 ? `${FUNDING_FEE_BPS / 100}% fee ${fee.toFixed(4)} · agent gets ${net.toFixed(4)} SOL` : `${FUNDING_FEE_BPS / 100}% platform fee, on chain`}</span>
        </div>
      )}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
