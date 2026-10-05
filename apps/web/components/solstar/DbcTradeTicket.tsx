"use client";
import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { parseUnits } from "@/lib/solstar/terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MarketRow } from "./MarketTable";
async function call(body: unknown) {
  const res = await fetch("/api/meteora/trade",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data = await res.json(); if(!res.ok) throw new Error(data.error); return data;
}
export function DbcTradeTicket({characterId,ticker,network}:{characterId:MarketRow["characterId"];ticker:string;network:string}) {
  const {publicKey,signTransaction} = useUnifiedSolanaWallet();
  const [side,setSide] = useState<"buy"|"sell">("buy"), [amount,setAmount] = useState(""), [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  async function trade() {
    if(!publicKey || !signTransaction) {setMessage("Connect your Solana wallet first.");return;}
    setBusy(true);setMessage("");
    const storage = `solcameo-dbc-trade-${characterId}-${publicKey.toBase58()}`;
    try {
      if(!await ensureSiwsViaRegistered()) throw new Error("Verify your wallet to trade.");
      let pending = JSON.parse(sessionStorage.getItem(storage) ?? "null");
      if(!pending) {
        const units = parseUnits(amount,side === "buy" ? 9 : 6);
        if(!units || units<=0n) throw new Error("Enter a valid amount.");
        setMessage("Reading the actual devnet pool and preparing your quote…");
        const prepared = await call({action:"prepare",characterId,side,amount:units.toString(),slippageBps:100});
        const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(prepared.transaction),(c)=>c.charCodeAt(0)));
        const signed = await signTransaction(tx);
        pending = {receipt:prepared.receipt,transaction:btoa(String.fromCharCode(...signed.serialize())),signature:bs58.encode(signed.signatures[0])};
        sessionStorage.setItem(storage,JSON.stringify(pending));
        await call({action:"submit",...pending});
      }
      setMessage("Waiting for devnet confirmation. Your signed trade is saved.");
      let result;
      for(let i=0;i<30;i++) {
        try { result = await call({action:"confirm",...pending});break; }
        catch(e) {if(!(e instanceof Error) || !e.message.includes("not confirmed") || i===29)throw e; if (i === 0 || i === 10) { try { await call({action:"submit",...pending}); } catch { /* Re-send only this exact signed packet; continue checking its signature. */ } } await new Promise(r=>setTimeout(r,2000));}
      }
      if(result?.expired || result?.failed) {
        sessionStorage.removeItem(storage);
        throw new Error(result.failed ? "The on-chain swap failed. No purchase completed; Solana may have charged its transaction fee. You can try again." : "The signed swap expired without landing. It is safe to request a fresh quote.");
      }
      if(result?.confirmed) {
        sessionStorage.removeItem(storage);setAmount("");
        setMessage(`Confirmed on devnet. Wallet change: ${result.walletSolChange?.toFixed(6) ?? "—"} SOL (including fees/rent). ${result.historyWarning ?? ""}`);
        window.dispatchEvent(new Event("solcameo:trade-confirmed"));
      }
    } catch(e) {setMessage(e instanceof Error ? e.message : "Trade failed. Signed progress is preserved.");}
    finally {setBusy(false);}
  }
  return <div className="space-y-4 border-b border-white/10 p-4"><p className="text-xs text-[#ec7352]">On-chain devnet trade · real test-wallet balance</p><div className="flex gap-2">{(["buy","sell"] as const).map(s=><Button key={s} disabled={busy} variant={side===s?"secondary":"outline"} onClick={()=>setSide(s)} className="flex-1 capitalize">{s}</Button>)}</div><label className="block text-xs text-zinc-400">Amount · {side==="buy"?"devnet SOL":ticker}<Input value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy} placeholder="0.00" inputMode="decimal" className="mt-2 border-white/10" /></label><p className="text-xs leading-5 text-zinc-500">1% slippage limit. Swaps settle in SOL and the minted token. Pool trading fees, network fees and account rent are deducted on chain. USD market values are estimates.</p><Button disabled={busy || network!=="devnet"} onClick={()=>void trade()} className="w-full">{busy?"Confirming…":`Approve ${side} in wallet / resume`}</Button>{message&&<p role="status" className="text-xs leading-5 text-zinc-300">{message}</p>}</div>;
}
