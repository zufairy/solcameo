"use client";

import { useState } from "react";
import type { SolamiReport } from "@/lib/server/solami";

type ResearchResult = { liveResearch?: SolamiReport; x402Receipt?: string; directPaymentUsdc?: number; findings?: { summary?: string; key_facts?: string[]; how_i_use_this?: string } };
export default function IntelligencePage() {
  const [agentMint, setAgentMint] = useState("");
  const [tokenMint, setTokenMint] = useState("So11111111111111111111111111111111111111112");
  const [dailyCents, setDailyCents] = useState(10);
  const [paymentNetwork, setPaymentNetwork] = useState("");
  const [wallet, setWallet] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ResearchResult | null>(null);
  async function request(path: string, body: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.message ?? json.error ?? "Request failed");
    return json;
  }
  async function policy(enable: boolean) {
    setBusy(true); setMessage("");
    try {
      const json = await request("/api/agents/x402-policy", { mintAddress: agentMint, enabled: enable, perRequestMicros: 10_000, dailyMicros: dailyCents * 10_000 });
      setWallet(json.walletAddress); setPaymentNetwork(json.paymentNetwork ?? ""); setEnabled(enable);
      setMessage(enable ? "Purchases enabled. Fund the dedicated wallet with USDC on the configured payment network before researching." : "New purchases disabled. Existing signed payments retain their recovery records.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Policy unavailable"); }
    finally { setBusy(false); }
  }
  async function research() {
    setBusy(true); setMessage(""); setResult(null);
    try {
      const json = await request("/api/agents/run-task", { mintAddress: agentMint, taskType: "research", title: "Live Solana research", input: { solanaMint: tokenMint, question: "What has changed in this token's trading activity? Explain the 5-minute, 1-hour and 24-hour windows using the observed data, and cite transaction evidence." } });
      setResult(json.output); setMessage("Research completed. The agent paid $0.01 USDC for its report through x402; the usual reasoning charge is separate.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Research unavailable"); }
    finally { setBusy(false); }
  }
  const inputClass = "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm";
  return <main className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
    <div className="mx-auto max-w-5xl space-y-8">
      <header><p className="text-sm text-emerald-400">Vello · Solami · x402</p><h1 className="mt-2 text-3xl font-semibold">Give your agent live Solana evidence</h1><p className="mt-3 max-w-2xl text-zinc-400">An agent buys a token report, checks recent activity, and explains what it observed with transaction sources. Each report costs $0.01 USDC. Sign in with the agent owner’s wallet to configure spending.</p></header>
      <section className="grid gap-6 rounded-xl border border-zinc-800 p-6 md:grid-cols-2">
        <div className="space-y-4"><h2 className="font-semibold">1. Set the agent’s budget</h2>
          <label className="block space-y-2"><span className="text-sm text-zinc-400">Your Vello agent mint address</span><input className={inputClass} value={agentMint} onChange={e => {setAgentMint(e.target.value.trim()); setWallet(""); setEnabled(false);}} /></label>
          <label className="block space-y-2"><span className="text-sm text-zinc-400">Daily maximum in US cents (1–100)</span><input className={inputClass} type="number" min={1} max={100} step={1} value={dailyCents} onChange={e => setDailyCents(Number(e.target.value))} /></label>
          <div className="flex gap-3"><button disabled={busy || !agentMint || !Number.isInteger(dailyCents) || dailyCents < 1 || dailyCents > 100} onClick={() => policy(true)} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">Enable $0.01 purchases</button><button disabled={busy || !agentMint} onClick={() => policy(false)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm disabled:opacity-40">Disable</button></div>
          {wallet && <div className="rounded-lg bg-zinc-900 p-3"><p className="text-xs text-zinc-400">Dedicated USDC spending wallet · {enabled ? "enabled" : "disabled"}</p><code className="mt-2 block break-all text-sm">{wallet}</code><p className="mt-2 text-xs text-zinc-400">Payment network: {paymentNetwork.includes("EtWTR") ? "Solana devnet" : paymentNetwork.includes("5eykt") ? "Solana mainnet" : "not configured"}. Fund it separately. Vello credits and investment funds do not fund x402 purchases.</p></div>}
        </div>
        <div className="space-y-4"><h2 className="font-semibold">2. Research a token</h2><label className="block space-y-2"><span className="text-sm text-zinc-400">Solana mainnet token mint</span><input className={inputClass} value={tokenMint} onChange={e => setTokenMint(e.target.value.trim())} /></label><p className="text-sm text-zinc-400">Solami supplies rolling activity and the latest 50 trades. Reports with no recent indexed trades are rejected.</p><button disabled={busy || !agentMint || !tokenMint} onClick={research} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">{busy ? "Working…" : "Research · $0.01 USDC + reasoning"}</button></div>
      </section>
      {message && <p role="status" className="rounded-lg border border-zinc-800 p-4 text-sm">{message}</p>}
      {result?.liveResearch && <section className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Live market evidence</h2><p className="text-sm text-zinc-400">Observed {new Date(result.liveResearch.observedAt).toLocaleString()} · Solami mainnet</p></div>
        <div className="grid gap-4 md:grid-cols-3">{[["300","5 minutes"],["3600","1 hour"],["86400","24 hours"]].map(([key,label]) => {const w=result.liveResearch!.windows[key];return <article key={key} className="space-y-2 rounded-xl border border-zinc-800 p-4"><h3 className="text-zinc-400">{label}</h3><p className="text-2xl font-semibold">${Number(w.volume_usd).toLocaleString(undefined,{maximumFractionDigits:2})}</p><p className="text-sm">{w.trades.toLocaleString()} trades · {w.traders.toLocaleString()} wallets</p><p className="text-sm">{w.buys} buys / {w.sells} sells</p><p className="text-sm">Price change: {Number(w.price_change_pct).toFixed(2)}%</p></article>;})}</div>
        {result.findings?.summary && <article className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">The agent’s interpretation</h3><p className="mt-3 whitespace-pre-wrap text-zinc-300">{result.findings.summary}</p></article>}
        <div className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">Transaction evidence</h3><ul className="mt-3 space-y-2">{result.liveResearch.evidence.map((e,i) => <li key={`${e.signature}-${i}`}><a href={e.url} target="_blank" rel="noreferrer" className="break-all text-sm text-emerald-400">Slot {e.slot} · {e.signature}</a></li>)}</ul></div>
        <details className="rounded-xl border border-zinc-800 p-5"><summary>Report and x402 receipt</summary><pre className="mt-4 overflow-auto text-xs">{JSON.stringify(result,null,2)}</pre></details>
        <p className="text-xs text-zinc-500">{result.liveResearch.limitations.join(" ")}</p>
      </section>}
    </div>
  </main>;
}
