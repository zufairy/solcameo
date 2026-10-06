"use client";
import { useCallback, useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { Coins, Loader2 } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useConnection } from "@solana/wallet-adapter-react";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { confirmSignature } from "@/lib/solana/fundWallet";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { useSolUsd } from "@/lib/client/useSolUsd";

type Fees = {
  available: boolean; migrated?: boolean; claimableLamports?: string;
  split?: { ops: string; buyback: string; treasury: string; opsWallet: string | null; treasuryWallet: string | null };
  error?: string;
};
const sol = (lamports: string | undefined) => (Number(lamports ?? "0") / 1e9).toFixed(4);
const short = (a: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "not set");
const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Platform trading fees: what has built up, how a claim is split, and the claim itself (platform wallet only). */
export function PlatformFeesPanel({ owner }: { owner: boolean }) {
  const { signTransaction } = useUnifiedSolanaWallet();
  const { connection } = useConnection();
  const solUsd = useSolUsd();
  const [fees, setFees] = useState<Fees | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; sig?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tokenomics/fees", { cache: "no-store" });
      setFees(await res.json());
    } catch { setFees({ available: false, error: "Could not load fees." }); }
  }, []);
  useEffect(() => {
    let active = true;
    const tick = () => { if (active && !document.hidden) void refresh(); };
    tick();
    const timer = setInterval(tick, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);

  async function claim() {
    if (!signTransaction) return;
    setBusy(true); setMessage(null);
    try {
      if (!await ensureSiwsViaRegistered()) throw new Error("Verify your platform wallet to claim.");
      const post = async (body: unknown) => {
        const res = await fetch("/api/tokenomics/fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Claim failed.");
        return data;
      };
      const prepared = await post({ action: "prepare" });
      const signed = await signTransaction(VersionedTransaction.deserialize(decode(prepared.transaction)));
      const { signature } = await post({ action: "submit", receipt: prepared.receipt, transaction: encode(signed.serialize()) });
      const status = await confirmSignature(connection, signature);
      setMessage({ tone: status === "confirmed" ? "ok" : "error", sig: signature, text: status === "confirmed" ? `Claimed ${sol(prepared.claimedLamports)} SOL${prepared.split ? " and sent the operations and treasury shares" : ""}.` : "Submitted, still confirming. Check the transaction." });
      void refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Claim failed.";
      if (!/user rejected|rejected the request/i.test(msg)) setMessage({ tone: "error", text: msg });
    } finally { setBusy(false); }
  }

  if (!fees?.available) return null;
  const claimable = BigInt(fees.claimableLamports ?? "0");
  const usd = solUsd != null ? ` ≈ $${(Number(fees.claimableLamports ?? "0") / 1e9 * solUsd).toFixed(2)}` : "";
  const split = fees.split;
  const rows: [string, string, string][] = split ? [
    ["Operations · 40%", sol(split.ops), short(split.opsWallet)],
    ["Treasury · 30%", sol(split.treasury), short(split.treasuryWallet)],
    ["Buyback budget · 30%", sol(split.buyback), "stays in the platform wallet"],
  ] : [];
  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl" aria-label="Platform fees">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Coins size={18} className="text-[#d7ff00]" />Platform fees</h2>
          <p className="mt-1 text-sm text-white/50">Trading fees on SOLCAMEO build up for the platform wallet{fees.migrated ? " from the graduated pool" : " on the bonding curve"}.</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-white/40">Claimable</p>
          <p className="text-2xl font-semibold tabular-nums">{sol(fees.claimableLamports)} <span className="text-sm text-white/50">SOL</span></p>
          <p className="text-xs text-white/40">{usd}</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-white/10 border-y border-white/10 text-sm">
        {rows.map(([label, amount, to]) => (
          <li key={label} className="flex items-center justify-between gap-3 py-2"><span className="text-white/70">{label}</span><span className="font-mono tabular-nums">{amount} SOL<span className="ml-3 text-xs text-white/40">{to}</span></span></li>
        ))}
      </ul>
      {split && (!split.opsWallet || !split.treasuryWallet) && <p className="mt-3 text-xs text-amber-300/90">Set SOLCAMEO_OPS_WALLET and SOLCAMEO_TREASURY_WALLET to send the operations and treasury shares automatically. Until then a claim keeps the whole amount in the platform wallet.</p>}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={claim} disabled={!owner || busy || claimable === 0n} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#d7ff00] px-4 text-sm font-semibold text-black transition-colors hover:bg-[#e4ff59] disabled:opacity-40">
          {busy && <Loader2 size={15} className="animate-spin" />}Claim fees
        </button>
        {!owner && <span className="text-xs text-white/40">Connect the platform wallet to claim.</span>}
        {owner && claimable === 0n && <span className="text-xs text-white/40">Nothing to claim yet.</span>}
      </div>
      {message && <p role="status" className={`mt-3 text-sm ${message.tone === "ok" ? "text-[#d7ff00]" : "text-red-300"}`}>{message.text}{message.sig && <> <a className="underline" href={getTxExplorerUrl(message.sig)} target="_blank" rel="noreferrer">View transaction</a></>}</p>}
    </section>
  );
}
