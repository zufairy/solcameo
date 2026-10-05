"use client";
import { useState } from "react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
type Pending = { transaction: string; receipt: string; stage: "launch" | "sharing"; signature?: string };
async function call(body: unknown) {
  const response = await fetch("/api/pump/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Pump request failed.");
  return data;
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
export function LivePumpLaunch({ characterId, onComplete }: { characterId: string; onComplete: () => void }) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  async function launch() {
    if (!publicKey || !signTransaction) { setError("Connect your Solana wallet to approve launch transactions."); return; }
    setBusy(true); setError("");
    const key = `solcameo-pump-${characterId}`;
    const save = (value: Pending) => sessionStorage.setItem(key, JSON.stringify(value));
    try {
      let pending: Pending | null = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (!pending) {
        setStatus("Preparing your Pump token…");
        const mint = Keypair.generate();
        const prepared = await call({ action: "prepare", characterId, mint: mint.publicKey.toBase58() });
        const tx = VersionedTransaction.deserialize(decode(prepared.transaction));
        tx.sign([mint]);
        setStatus("Approve token creation in your wallet.");
        const signed = await signTransaction(tx);
        pending = { transaction: encode(signed.serialize()), receipt: prepared.receipt, stage: "launch" };
        save(pending);
      }
      for (let phase = 0; phase < 2; phase++) {
        if (!pending.signature) {
          setStatus(pending.stage === "launch" ? "Submitting your token launch…" : "Submitting fee sharing and optional funding…");
          const result = await call({ action: "submit", receipt: pending.receipt, transaction: pending.transaction });
          pending.signature = result.signature; save(pending);
        }
        let result;
        setStatus("Waiting for confirmed transaction…");
        for (let attempt = 0; attempt < 24; attempt++) {
          try { result = await call({ action: pending.stage === "launch" ? "sharing" : "finalize", receipt: pending.receipt, signature: pending.signature }); break; }
          catch (e) {
            if (!(e instanceof Error) || !e.message.includes("not confirmed") || attempt === 23) throw e;
            await new Promise(resolve => setTimeout(resolve, 2500));
          }
        }
        if (result?.complete) { sessionStorage.removeItem(key); setStatus("Pump launch confirmed."); onComplete(); return; }
        if (!result?.transaction) throw new Error("Launch is saved. Retry to resume verification.");
        setStatus("Approve the permanent fee split and optional posting funds in your wallet.");
        const signed = await signTransaction(VersionedTransaction.deserialize(decode(result.transaction)));
        pending = { transaction: encode(signed.serialize()), receipt: result.receipt, stage: "sharing" }; save(pending);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Launch needs attention. Your progress is saved."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-emerald-300/20 p-4"><p className="text-sm leading-6 text-zinc-400">Approve token creation, then the permanent fee split and optional funding. You pay network fees and account rent from your own mainnet wallet. There is no initial token buy.</p><Button disabled={busy} onClick={() => void launch()} className="w-full">{busy ? <Loader2 className="animate-spin" /> : null}{busy ? "Launching…" : "Launch / resume on pump.fun"}</Button>{status && <p role="status" className="text-xs text-emerald-300">{status}</p>}{error && <p role="alert" className="text-sm text-red-300">{error} Your saved launch can be resumed here.</p>}</div>;
}
