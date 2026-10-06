"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2, Rocket } from "lucide-react";
import { LiveDbcLaunch } from "@/components/solcameo/LiveDbcLaunch";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { PLATFORM_DBC, type DbcOptions } from "@/lib/meteora/options";
import { getAccountExplorerUrl, getTxExplorerUrl } from "@/lib/solana/network";

type State = { minimumLamports: number; recommendedLamports: number; graduationNetSol: number; error?: string; ready: boolean; reason: string; network: string; owner: string | null; mint: string | null; draft: null | { name: string; description: string; image: string; state: string; pool?: string; signature?: string; options: DbcOptions } };
const glass = "rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl";
const input = "mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none focus:border-[#d7ff00]/60";
export function PlatformTokenLaunch() {
  const { publicKey } = useUnifiedSolanaWallet();
  const { setVisible } = useWalletModal();
  const [state, setState] = useState<State | null>(null);
  const [name, setName] = useState("Solcameo");
  const [description, setDescription] = useState("The Solcameo platform token, supported by platform revenue buybacks.");
  const [image, setImage] = useState("https://solcameo.com/assets/solcameo-light.png");
  const [opening, setOpening] = useState(PLATFORM_DBC.initialCapSol);
  const [graduation, setGraduation] = useState(PLATFORM_DBC.graduationCapSol);
  const [options, setOptions] = useState<DbcOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/tokenomics/launch", { cache: "no-store" });
      const data: State = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load launch settings.");
      setState(data);
      if (data.draft) {
        setName(data.draft.name); setDescription(data.draft.description); setImage(data.draft.image);
        setOpening(data.draft.options.initialCapSol); setGraduation(data.draft.options.graduationCapSol);
        if (data.draft.state === "reserved") setOptions(data.draft.options);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load launch settings."); }
  }, []);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return refresh(); }); return () => { active = false; }; }, [refresh]);
  const owner = !!publicKey && publicKey.toBase58() === state?.owner;
  async function review() {
    setBusy(true); setError("");
    try {
      if (!await ensureSiwsViaRegistered()) throw new Error("Verify your platform wallet to continue.");
      const response = await fetch("/api/tokenomics/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", name, description, image, initialCapSol: opening, graduationCapSol: graduation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not prepare launch.");
      setOptions(data.options);
      setState(current => current ? { ...current, graduationNetSol: data.graduationNetSol } : current);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare launch."); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-5xl px-5 py-12 text-white">
    <Link href="/tokenomics" className="inline-flex items-center gap-2 text-sm text-white/60"><ArrowLeft size={15} />Tokenomics</Link>
    <div className="mb-8 mt-6 flex items-center gap-4"><span className="rounded-2xl border border-white/15 bg-white/5 p-3"><Rocket className="text-[#d7ff00]" /></span><div><h1 className="text-3xl font-semibold tracking-tight">Launch the platform token</h1><p className="mt-2 text-white/50">$SOLCAMEO · separate from mascot and influencer coins</p></div></div>
    {state?.mint ? <section className={glass}><h2 className="text-xl font-semibold">SOLCAMEO is configured</h2><a className="mt-4 flex items-center gap-2 break-all text-[#d7ff00]" href={getAccountExplorerUrl(state.mint)} target="_blank" rel="noreferrer">{state.mint}<ExternalLink size={16} /></a>{state.draft?.signature && <a className="mt-4 block text-white/60" href={getTxExplorerUrl(state.draft.signature)} target="_blank" rel="noreferrer">View launch transaction ↗</a>}{state.draft?.pool && <a className="mt-4 block text-[#d7ff00]" href={`https://www.meteora.ag/dbc/${encodeURIComponent(state.draft.pool)}`} target="_blank" rel="noreferrer">Open Meteora pool ↗</a>}<p className="mt-4 text-sm text-white/50">Holder balances and tokenomics use this mint automatically. Market purchases for buybacks remain operator-run.</p></section> : <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className={glass}><h2 className="text-lg font-semibold">Platform identity</h2><p className="mt-2 text-sm text-white/50">Ticker is fixed to SOLCAMEO. Supply is 1 billion. No influencer profile or agent wallet is created.</p>
        <fieldset disabled={!!options || busy} className="mt-5 space-y-4 disabled:opacity-60">
          <label className="block text-sm">Name<input className={input} value={name} onChange={e => setName(e.target.value)} maxLength={32} /></label>
          <label className="block text-sm">Artwork URL<input className={input} type="url" value={image} onChange={e => setImage(e.target.value)} /></label>
          <label className="block text-sm">Description<textarea className={input} value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} rows={3} /></label>
          <div className="grid grid-cols-2 gap-4"><label className="text-sm">Opening market cap · SOL<input className={input} type="number" min="0.1" step="0.1" value={opening} onChange={e => setOpening(Number(e.target.value))} /></label><label className="text-sm">Graduation market cap · SOL<input className={input} type="number" min="1" value={graduation} onChange={e => setGraduation(Number(e.target.value))} /></label></div>
        </fieldset>
        <div className="mt-6 border-t border-white/10 pt-5 text-sm leading-6 text-white/60"><p>Fair launch through Meteora DBC → DAMM v2. Mint authority is immutable; graduated liquidity is permanently locked. No initial token purchase required.</p><p className="mt-3">Platform preset: 1% base trading fee with dynamic fees, 2% graduated pool base fee with dynamic fees, SOL quote, immutable SPL mint, 6 decimals and 100% permanently locked graduated liquidity. No opening anti-sniper surcharge.</p><p className="mt-3">This option has no reserved team, treasury or reward allocation and no team vesting. The published 60/15/12/10/3 allocation is a separate planned model and is not applied by this launch.</p><p className="mt-3">Platform revenue: <span className="text-white">30% buybacks · 40% operations · 30% treasury.</span> Purchased tokens: 50% burn · 50% rewards budget. Holder reward payouts are planned.</p></div>
      </section>
      <div className="space-y-4">{!state ? <div className={glass}><Loader2 className="animate-spin" />Loading launch settings…</div> : <><div className={glass}><p className="text-sm text-white/60">{state.network} · platform wallet</p><p className="mt-2 break-all text-xs">{state.owner ?? "Platform wallet is not configured."}</p><p className="mt-3 text-sm text-white/60">Prepare {state.recommendedLamports / 1e9} SOL for rent and fees. Minimum launch balance: {state.minimumLamports / 1e9} SOL.</p><p className="mt-3 text-xs text-white/45">{state.graduationNetSol.toFixed(2)} SOL net trading reserves to graduate with the saved/default caps. This is contributed by trading, not required upfront from you.</p>{!state.ready && <p className="mt-3 text-sm text-amber-200">{state.reason}</p>}{publicKey && !owner && <p className="mt-3 text-sm text-amber-200">Switch to the platform wallet to continue.</p>}</div>{options && owner ? <LiveDbcLaunch characterId="platform" endpoint="/api/tokenomics/launch" platform options={options} onComplete={refresh} /> : <button className="h-12 w-full rounded-xl bg-[#d7ff00] font-semibold text-black disabled:opacity-40" disabled={busy || (!!publicKey && (!owner || !state.ready))} onClick={() => publicKey ? void review() : setVisible(true)}>{busy ? "Preparing…" : !publicKey ? "Connect platform wallet" : "Review launch"}</button>}</> }</div>
    </div>}
    {error && <div role="alert" className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}<button onClick={() => { setError(""); void refresh(); }} className="ml-3 underline">Retry</button></div>}
  </div>;
}
