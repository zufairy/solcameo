"use client";

import { useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { confirmSignature, fetchWalletBalances, sendFundingTransfer, type FundToken } from "@/lib/solana/fundWallet";
import { FUNDING_FEE_BPS, previewFundingSplit } from "@/lib/solana/fundingFee";
import { getAccountExplorerUrl, getTxExplorerUrl } from "@/lib/solana/network";

const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number, token: FundToken) => (token === "USDC" ? usd(n) : `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`);
const SOL_RESERVE = 0.006; // left in the sender's wallet for network fees and token-account rent

/**
 * Agent wallet: live balance and a one-step top-up. One signed transaction sends 97% to the agent and 3% to the
 * platform treasury (see sendFundingTransfer), so the fee is on chain for every deposit.
 */
export function AgentWalletPanel({ agentWallet, agentName, usdc, sol, unsettled, loading, onRefresh }: {
  agentWallet?: string;
  agentName: string;
  usdc: number | null;
  sol: number | null;
  /** Spend metered but not yet swept on chain. */
  unsettled: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const [token, setToken] = useState<FundToken>("USDC");
  const [amount, setAmount] = useState("");
  const [mine, setMine] = useState<{ sol: number; usdc: number } | null>(null);
  const [step, setStep] = useState<"idle" | "approving" | "confirming" | "done">("idle");
  const [error, setError] = useState("");
  const [sig, setSig] = useState("");
  const [sent, setSent] = useState<{ fee: number; net: number; token: FundToken } | null>(null);

  const busy = step === "approving" || step === "confirming";
  const num = Number.parseFloat(amount);
  const { fee, net } = previewFundingSplit(num);
  const spendable = Math.max(0, (usdc ?? 0) - unsettled);
  const presets = token === "USDC" ? [5, 10, 25, 50] : [0.05, 0.1, 0.25, 0.5];
  const pct = FUNDING_FEE_BPS / 100;
  const capOf = (b: { sol: number; usdc: number }, t: FundToken) => (t === "USDC" ? b.usdc : Math.max(0, b.sol - SOL_RESERVE));

  const loadMine = async () => {
    if (!publicKey) return null;
    try { const b = await fetchWalletBalances(connection, publicKey); setMine(b); return b; } catch { return null; }
  };
  const have = mine ? capOf(mine, token) : undefined;

  const fund = async () => {
    setError("");
    if (!publicKey || !signTransaction) return setError("Connect your wallet to fund this agent.");
    if (!agentWallet) return setError("The agent wallet is still being set up. Try again in a moment.");
    if (!(num > 0)) return setError("Enter an amount.");
    const bal = mine ?? (await loadMine());
    if (bal && num > capOf(bal, token)) return setError(`You have ${fmt(capOf(bal, token), token)} available.`);
    setStep("approving");
    try {
      const { sig: signature } = await sendFundingTransfer({ connection, publicKey, signTransaction, agentWallet, token, amount: num });
      setSig(signature); setStep("confirming");
      if ((await confirmSignature(connection, signature)) !== "confirmed") throw new Error("Sent, but not confirmed yet. Check the transaction, then refresh.");
      setSent({ fee, net, token });
      setStep("done");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      onRefresh(); void loadMine();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Transfer failed";
      setStep("idle");
      if (!/user rejected|user denied|rejected the request|request.*reject/i.test(m)) setError(m);
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-16 text-center">
      <p className="text-[13px] font-medium text-zinc-500">{agentName}’s wallet</p>
      <p className="mt-3 text-6xl font-semibold tracking-tight tabular-nums text-white sm:text-7xl">
        {loading && usdc == null ? <span className="text-zinc-700">$—</span> : usd(spendable)}
      </p>
      <p className="mt-3 text-[13px] text-zinc-500">
        available to spend{sol != null ? <> · {sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL for fees</> : null}
        {unsettled > 0 && <> · {usd(unsettled)} in use</>}
      </p>

      <div className="mt-14 w-full">
        {step === "done" && sent ? (
          <div className="flex flex-col items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-white text-black"><Check className="size-6" strokeWidth={2.5} /></span>
            <p className="text-lg font-semibold text-white">{agentName} is funded</p>
            <p className="text-[13px] text-zinc-500">{fmt(sent.net, sent.token)} sent · {fmt(sent.fee, sent.token)} platform fee</p>
            {sig && <a href={getTxExplorerUrl(sig)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-zinc-400 transition-colors hover:text-white">View transaction <ExternalLink className="size-3" /></a>}
            <button type="button" onClick={() => { setStep("idle"); setAmount(""); setSig(""); setSent(null); }} className="mt-2 rounded-full bg-white/[0.08] px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.14]">Add more</button>
          </div>
        ) : (
          <>
            <div className="mx-auto mb-6 inline-flex rounded-full bg-white/[0.06] p-0.5" role="tablist" aria-label="Token">
              {(["USDC", "SOL"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={token === t} disabled={busy} onClick={() => { setToken(t); setAmount(""); setError(""); }}
                  className={`rounded-full px-4 py-1 text-[12px] font-semibold transition-colors ${token === t ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>{t}</button>
              ))}
            </div>

            <div className="flex items-baseline justify-center gap-1">
              {token === "USDC" && <span className="text-4xl font-semibold text-zinc-600">$</span>}
              <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setError(""); }} onFocus={() => { if (!mine) void loadMine(); }}
                placeholder="0" inputMode="decimal" aria-label={`Amount in ${token}`} disabled={busy}
                className="w-40 bg-transparent text-center text-5xl font-semibold tabular-nums text-white outline-none placeholder:text-zinc-700" />
              {token === "SOL" && <span className="text-xl font-semibold text-zinc-600">SOL</span>}
            </div>

            <div className="mt-5 flex justify-center gap-2">
              {presets.map((p) => (
                <button key={p} type="button" disabled={busy} onClick={() => { setAmount(String(p)); if (!mine) void loadMine(); }}
                  className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] tabular-nums text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white">{token === "USDC" ? `$${p}` : p}</button>
              ))}
              <button type="button" disabled={busy || have == null} onClick={() => have != null && setAmount((Math.floor(have * 10000) / 10000).toString())}
                className="rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-40">Max</button>
            </div>

            <div className="mx-auto mt-8 h-12 max-w-xs space-y-1 text-[13px] tabular-nums text-zinc-500">
              {num > 0 && (
                <>
                  <p className="flex justify-between"><span>Platform fee · {pct}%</span><span>{fmt(fee, token)}</span></p>
                  <p className="flex justify-between text-zinc-300"><span>Agent receives</span><span>{fmt(net, token)}</span></p>
                </>
              )}
            </div>

            {error && <p role="alert" className="mt-2 text-[13px] text-red-400">{error}</p>}

            <button type="button" onClick={() => void fund()} disabled={busy || !(num > 0)}
              className="mt-4 inline-flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {step === "approving" ? "Approve in wallet…" : step === "confirming" ? "Confirming…" : "Fund agent"}
            </button>
            <p className="mt-4 text-[12px] text-zinc-600">One transaction on Solana. {pct}% goes to Solcameo, the rest goes straight to {agentName}.</p>
          </>
        )}
      </div>

      {agentWallet && (
        <a href={getAccountExplorerUrl(agentWallet)} target="_blank" rel="noreferrer" className="mt-12 font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-300">
          {agentWallet.slice(0, 6)}…{agentWallet.slice(-6)}
        </a>
      )}
    </section>
  );
}
