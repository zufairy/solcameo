"use client";
import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
async function call(body: unknown) {
  const response = await fetch("/api/pump/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Payout failed.");
  return data;
}
export function PumpFeePayout({ characterId, ownerWallet, mint }: { characterId: string; ownerWallet: string; mint: string }) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { authenticated, login } = useSupabaseAuth();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function distribute() {
    if (!authenticated) { login(); return; }
    if (!signTransaction || !publicKey || publicKey.toBase58() !== ownerWallet) { setMessage("Connect the creator's wallet to distribute fees."); return; }
    setBusy(true); setMessage("");
    try {
      if (!await ensureSiwsViaRegistered()) throw new Error("Approve the wallet sign-in message first.");
      const prepared = await call({ action: "prepare-payout", characterId });
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(prepared.transaction), c => c.charCodeAt(0)));
      const signed = await signTransaction(tx);
      const result = await call({ action: "submit", receipt: prepared.receipt, transaction: btoa(String.fromCharCode(...signed.serialize())) });
      setMessage(`Submitted payout: ${result.signature}. Pump distributes available creator fees to the configured wallets after confirmation.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not prepare payout."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border-b border-white/10 p-4"><a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer" className="text-sm text-emerald-300 underline">Open coin on pump.fun</a>{publicKey?.toBase58() === ownerWallet && <><Button variant="outline" disabled={busy} onClick={() => void distribute()} className="w-full">{busy && <Loader2 className="animate-spin" />}Distribute creator fees</Button><p className="text-xs leading-5 text-zinc-500">Pays all configured fee recipients. You approve network fees and, for USDC, missing recipient accounts. Holder-reward coins have no creator payout.</p></>}{message && <p role="status" className="break-all text-xs leading-5 text-zinc-400">{message}</p>}</div>;
}
