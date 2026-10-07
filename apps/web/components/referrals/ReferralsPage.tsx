"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { AlertCircle, ArrowUpRight, Check, Copy, Link2, Loader2, Share2, Sparkles, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { useChainMarket } from "@/components/solstar/useChainMarket";
import { MARGIN_SHARE, PAYOUT_MIN_USDC, REFERRAL_MONTHS, REFERRAL_TIERS, referralShare } from "@/lib/referrals/program";
import { ReferralTicker, type TickerEvent } from "./ReferralTicker";

type Overview = { token: { mint: string; characterId: string | null; priceUsd: number } | null };
type Me = {
  wallet: string; code: string | null; referred: number; pendingUsdc: number; paidUsdc: number; missedUsdc: number; referredBy: string | null;
  recent: { at: number; referee: string; spendUsdc: number; shareUsdc: number; status: "pending" | "paid" | "missed"; tier: number }[];
  holding: { tokens: number; valueUsd: number; priceKnown: boolean; tier: { tier: number; name: string; rate: number } | null };
  nextTier: { tier: number; name: string; minUsd: number; rate: number } | null;
  token: { mint: string; characterId: string | null; priceUsd: number } | null;
};

const usd = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const STEPS = [
  { n: "01", title: "Link your wallet", body: "Sign in with your Solana wallet. Your referral link and your earnings are tied to that wallet, so nothing can be claimed by anyone else." },
  { n: "02", title: "Hold a little SOLCAMEO", body: "Buy a small amount of the platform token and keep it in the same wallet. We read your balance on-chain. Holding is what switches earning on, and a bigger holding raises your share." },
  { n: "03", title: "Share your link", body: "Friends who sign in with your link are tied to you for a year. Their wallet is linked once, at their first sign-in, and never changes." },
  { n: "04", title: "Earn on every video", body: "Every time their agent pays for a video, image or carousel, the payment settles on-chain. You get a share of Solcameo's margin on it, in USDC, for every one." },
];

export function ReferralsPage() {
  const { publicKey } = useUnifiedSolanaWallet();
  const { authenticated, login } = useSupabaseAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [videos, setVideos] = useState(40);
  const [price, setPrice] = useState(2.5);

  const stats = useQuery(api.referrals.publicStats, {});
  const leaders = useQuery(api.referrals.leaderboard, {});
  const characterId = overview?.token?.characterId ?? null;
  const { swaps } = useChainMarket((characterId ?? "") as Id<"ssCharacters">, !!characterId);

  useEffect(() => {
    let live = true;
    const load = async () => { try { const r = await fetch("/api/referrals/overview", { cache: "no-store" }); if (live && r.ok) setOverview(await r.json()); } catch { /* keep the last */ } };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  // A friend's link lands here too: remember the code so it is attached when they sign in.
  useEffect(() => {
    try { const ref = new URLSearchParams(window.location.search).get("ref"); if (ref && /^[A-Za-z0-9]{4,16}$/.test(ref)) window.localStorage.setItem("solcameo:ref", ref.toUpperCase()); } catch { /* storage blocked */ }
  }, []);

  const loadMe = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/referrals/me", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not load your referral account.");
      setMe(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your referral account."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!authenticated || !getCurrentSiwsToken()) return;
    void loadMe(); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setInterval(() => { if (!document.hidden) void loadMe(); }, 20_000);
    window.addEventListener("solcameo:trade-confirmed", loadMe);
    return () => { clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", loadMe); };
  }, [authenticated, publicKey, loadMe]);

  async function connect() {
    setError("");
    if (!authenticated) { login(); return; }
    setLoading(true);
    try { if (!(await ensureSiwsViaRegistered())) throw new Error("Approve the sign-in message in your wallet to continue."); await loadMe(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not sign in."); setLoading(false); }
  }

  const link = me?.code && typeof window !== "undefined" ? `${window.location.origin}/r/${me.code}` : "";
  const copy = async () => { if (!link) return; try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ } };
  const buyHref = overview?.token?.characterId ? `/market/${overview.token.characterId}` : "/tokenomics";
  const priceUsd = overview?.token?.priceUsd ?? null;

  // The live ticker: the coin's real on-chain swaps, plus what referrers have just earned (or missed).
  const events = useMemo<TickerEvent[]>(() => {
    const out: TickerEvent[] = [];
    for (const s of (swaps ?? []).slice(0, 14)) out.push({ id: s.signature, kind: s.side === "buy" ? "buy" : "sell", title: s.sol < 0.001 ? "<0.001 SOL" : `${s.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`, detail: short(s.wallet), at: s.time });
    for (const r of stats?.recent ?? []) out.push({ id: `earn-${r.at}-${r.referrer}`, kind: r.missed ? "missed" : "earn", title: `${r.missed ? "" : "+"}${usd(r.shareUsdc, 3)}`, detail: r.referrer, at: r.at });
    return out.sort((a, b) => b.at - a.at).slice(0, 16);
  }, [swaps, stats?.recent]);

  const holdPct = me?.nextTier ? Math.min(100, (me.holding.valueUsd / me.nextTier.minUsd) * 100) : 100;
  const needTokens = me?.nextTier && priceUsd ? Math.max(0, (me.nextTier.minUsd - me.holding.valueUsd) / priceUsd) : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 sm:px-6 sm:pt-12">
      {/* Hero */}
      <header>
        <p className="inline-flex items-center gap-2 border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-[#d7ff00]"><Share2 className="size-3" /> Referrals</p>
        <h1 className="mt-4 max-w-3xl text-[clamp(2rem,5vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-white">Get paid in USDC every time someone you refer makes a video</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-400">Share your link. When your friends make videos, images and carousels with their AI influencers, you earn a share of what Solcameo makes on each one. It is paid in real USDC and read straight from on-chain payments.</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void connect()} className="inline-flex h-11 items-center gap-2 bg-[#d7ff00] px-5 text-[14px] font-semibold text-black transition-colors hover:bg-[#e4ff59]">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}{me ? "Your referral account" : "Link wallet and get my link"}
          </button>
          <Link href={buyHref} className="inline-flex h-11 items-center gap-2 border border-white/20 bg-white/[0.05] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-white/10">Buy SOLCAMEO <ArrowUpRight className="size-4" /></Link>
        </div>
      </header>

      {/* Live on Solana */}
      <section className="mt-10 border border-white/10 bg-[#0b0c0e]" aria-label="Live activity">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/70"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>Live on Solana</p>
          <p className="text-[12px] text-zinc-500">SOLCAMEO trades and referral earnings as they happen</p>
        </div>
        <ReferralTicker events={events} className="h-[190px]" />
        <dl className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 text-center sm:grid-cols-4">
          {[
            ["Earned by referrers", stats ? usd(stats.accruedUsdc) : "···"],
            ["Active referrers", stats ? String(stats.referrers) : "···"],
            ["Wallets referred", stats ? String(stats.referred) : "···"],
            ["Missed for not holding", stats ? usd(stats.missedUsdc) : "···"],
          ].map(([k, v]) => (<div key={k} className="px-3 py-3"><dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500">{k}</dt><dd className="mt-1 text-[18px] font-semibold tabular-nums text-white">{v}</dd></div>))}
        </dl>
      </section>

      {/* How it works */}
      <section className="mt-14" aria-labelledby="how">
        <h2 id="how" className="text-[24px] font-semibold tracking-[-0.02em] text-white">How it works</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="border border-white/10 bg-white/[0.03] p-4">
              <p className="font-mono text-[11px] tracking-[0.2em] text-[#d7ff00]">{s.n}</p>
              <p className="mt-2 text-[15px] font-semibold text-white">{s.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-5 text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Your account */}
      <section className="mt-14 border border-[#d7ff00]/30 bg-[#d7ff00]/[0.04] p-5 sm:p-6" aria-label="Your referral account">
        <h2 className="text-[20px] font-semibold tracking-tight text-white">Your referral account</h2>
        {!me ? (
          <div className="mt-3">
            <p className="max-w-xl text-[13.5px] leading-6 text-zinc-300">Link your wallet to get your personal link and see your SOLCAMEO holding, your tier and your earnings. Signing in is free and only proves the wallet is yours.</p>
            <button type="button" onClick={() => void connect()} className="mt-4 inline-flex h-10 items-center gap-2 bg-[#d7ff00] px-4 text-[13.5px] font-semibold text-black hover:bg-[#e4ff59]">{loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}Link wallet</button>
            {error && <p role="alert" className="mt-3 flex items-start gap-2 text-[12.5px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* Eligibility checklist */}
            <ul className="grid gap-2 sm:grid-cols-3">
              {[
                { ok: true, title: "Wallet linked", sub: short(me.wallet) },
                { ok: !!me.holding.tier, title: me.holding.tier ? `${me.holding.tier.name} tier unlocked` : "Hold SOLCAMEO to earn", sub: `${me.holding.tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} SOLCAMEO · ${usd(me.holding.valueUsd)}` },
                { ok: me.referred > 0, title: `${me.referred} ${me.referred === 1 ? "friend" : "friends"} referred`, sub: me.referredBy ? `You were referred by ${me.referredBy}` : "Share your link below" },
              ].map((c) => (
                <li key={c.title} className={`flex items-start gap-3 border p-3 ${c.ok ? "border-[#d7ff00]/40 bg-black/30" : "border-white/10 bg-black/20"}`}>
                  <span className={`mt-0.5 grid size-5 shrink-0 place-items-center ${c.ok ? "bg-[#d7ff00] text-black" : "border border-white/25 text-transparent"}`}><Check className="size-3.5" strokeWidth={3} /></span>
                  <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-white">{c.title}</span><span className="block truncate text-[11.5px] tabular-nums text-zinc-400">{c.sub}</span></span>
                </li>
              ))}
            </ul>

            {!me.holding.tier && (
              <div className="border border-violet-400/40 bg-violet-400/[0.07] p-4">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-white"><Sparkles className="size-4 text-violet-300" />You are not earning yet</p>
                <p className="mt-1 text-[12.5px] leading-5 text-zinc-300">
                  {me.nextTier ? <>Hold at least <b className="text-white">{usd(me.nextTier.minUsd, 0)}</b> of SOLCAMEO{needTokens ? <> (about {Math.ceil(needTokens).toLocaleString("en-US")} more tokens)</> : null} to switch on the {me.nextTier.name} tier ({Math.round(me.nextTier.rate * 100)}% share).</> : null}
                  {me.missedUsdc > 0 ? <> Your referrals have already made <b className="text-violet-200">{usd(me.missedUsdc, 3)}</b> that you missed.</> : null}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden bg-white/10"><div className="h-full bg-violet-300 transition-[width] duration-700" style={{ width: `${holdPct}%` }} /></div>
                <Link href={buyHref} className="mt-3 inline-flex h-9 items-center gap-1.5 bg-white px-4 text-[13px] font-semibold text-black hover:bg-zinc-200">Buy SOLCAMEO <ArrowUpRight className="size-3.5" /></Link>
              </div>
            )}

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Your referral link</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate border border-white/15 bg-black/40 px-3 py-2.5 font-mono text-[12.5px] text-white">{link || "···"}</code>
                <button type="button" onClick={() => void copy()} className="inline-flex h-10 items-center gap-1.5 border border-white/20 bg-white/[0.06] px-4 text-[13px] font-semibold text-white hover:bg-white/10">{copied ? <Check className="size-4 text-[#d7ff00]" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</button>
                <a href={`https://x.com/intent/post?text=${encodeURIComponent("I make AI videos with my own influencer on Solana. Join with my link:")}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 bg-[#d7ff00] px-4 text-[13px] font-semibold text-black hover:bg-[#e4ff59]">Share on X</a>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-px overflow-hidden border border-white/15 bg-white/15 text-center">
              {([["Pending", me.pendingUsdc, "text-[#d7ff00]"], ["Paid", me.paidUsdc, "text-white"], ["Missed", me.missedUsdc, "text-violet-300"]] as const).map(([k, v, tone]) => (
                <div key={k} className="bg-black/50 px-3 py-3"><dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500">{k}</dt><dd className={`mt-1 text-[22px] font-semibold tabular-nums ${tone}`}>{usd(v, 3)}</dd></div>
              ))}
            </dl>
            <p className="text-[11.5px] leading-5 text-zinc-500">Pending earnings are paid weekly in USDC to your linked wallet once they reach {usd(PAYOUT_MIN_USDC, 0)}. Missed earnings are never paid: they show what you would have earned if you had held SOLCAMEO at the time.</p>

            {me.recent.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-[12.5px]">
                  <thead className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-500"><tr><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Referred wallet</th><th className="py-2 pr-3 text-right font-medium">Their spend</th><th className="py-2 pr-3 text-right font-medium">Your share</th><th className="py-2 text-right font-medium">Status</th></tr></thead>
                  <tbody className="divide-y divide-white/[0.07]">
                    {me.recent.map((r) => (
                      <tr key={`${r.at}-${r.shareUsdc}`} className="text-zinc-300"><td className="py-2 pr-3 tabular-nums">{new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td className="py-2 pr-3 font-mono">{r.referee}</td><td className="py-2 pr-3 text-right tabular-nums">{usd(r.spendUsdc)}</td><td className="py-2 pr-3 text-right font-semibold tabular-nums text-white">{usd(r.shareUsdc, 4)}</td><td className="py-2 text-right"><span className={`px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${r.status === "missed" ? "bg-violet-400/20 text-violet-200" : r.status === "paid" ? "bg-emerald-400/20 text-emerald-200" : "bg-[#d7ff00]/20 text-[#d7ff00]"}`}>{r.status}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {error && <p role="alert" className="flex items-start gap-2 text-[12.5px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </div>
        )}
      </section>

      {/* What you earn */}
      <section className="mt-14" aria-labelledby="earn">
        <h2 id="earn" className="text-[24px] font-semibold tracking-[-0.02em] text-white">What you earn per video</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-zinc-400">
          Every generation is sold at the provider&apos;s price plus 15%. That 15% is Solcameo&apos;s margin, about {(MARGIN_SHARE * 100).toFixed(1)}% of what a user pays. Your share is a percentage of that margin, set by your tier. On a $2.50 video a Builder earns {usd(referralShare(2.5, 0.25), 3)}.
        </p>
        <div className="mt-5 grid gap-px overflow-hidden border border-white/15 bg-white/15 md:grid-cols-[1.1fr_1fr]">
          <div className="space-y-5 bg-[#0b0c0e] p-5">
            <label className="block text-[12px] text-zinc-400">Videos your referrals make each month: <b className="text-white tabular-nums">{videos}</b>
              <input type="range" min={5} max={400} step={5} value={videos} onChange={(e) => setVideos(Number(e.target.value))} className="mt-2 w-full accent-[#d7ff00]" /></label>
            <label className="block text-[12px] text-zinc-400">Average price of a video: <b className="text-white tabular-nums">{usd(price)}</b>
              <input type="range" min={0.5} max={10} step={0.25} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-2 w-full accent-[#d7ff00]" /></label>
            <p className="text-[11.5px] leading-5 text-zinc-500">Their spend: {usd(videos * price)} a month. Solcameo&apos;s margin on it: {usd(videos * price * MARGIN_SHARE)}.</p>
          </div>
          <div className="bg-[#0b0c0e]">
            {REFERRAL_TIERS.map((t) => (
              <div key={t.tier} className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5 last:border-b-0">
                <div><p className="text-[14px] font-semibold text-white">{t.name} <span className="font-mono text-[11px] font-normal text-[#d7ff00]">{Math.round(t.rate * 100)}% of margin</span></p>
                  <p className="text-[11.5px] text-zinc-500">Hold {usd(t.minUsd, 0)}+ of SOLCAMEO{priceUsd ? ` (about ${Math.ceil(t.minUsd / priceUsd).toLocaleString("en-US")} tokens)` : ""}</p></div>
                <p className="text-right text-[20px] font-semibold tabular-nums text-white">{usd(referralShare(videos * price, t.rate))}<span className="block text-[10px] font-normal text-zinc-500">per month</span></p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why SOLCAMEO */}
      <section className="mt-14 border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-labelledby="why">
        <h2 id="why" className="text-[24px] font-semibold tracking-[-0.02em] text-white">Why holding SOLCAMEO is part of it</h2>
        <ul className="mt-4 grid gap-3 text-[13.5px] leading-6 text-zinc-300 md:grid-cols-2">
          <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 bg-[#d7ff00]" />Referrers earn real USDC from Solcameo&apos;s margin. No new tokens are minted to pay anyone, so there is nothing to inflate.</li>
          <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 bg-[#d7ff00]" />You must hold SOLCAMEO to earn, so referrers are real stakeholders in the platform they promote. The more you hold, the higher your share.</li>
          <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 bg-[#d7ff00]" />Platform revenue also funds the SOLCAMEO buyback (30%), so the same usage that pays you also supports the token. See the <Link href="/tokenomics" className="font-semibold text-white underline underline-offset-2">tokenomics</Link>.</li>
          <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 bg-[#d7ff00]" />It is only paid on real, settled spend. Signing up friends who never pay earns nothing, so there is nothing to farm.</li>
        </ul>
        <p className="mt-4 text-[11.5px] leading-5 text-zinc-500">SOLCAMEO is a volatile token and can lose value. Referral earnings depend on your referrals actually spending and are not guaranteed. This is not financial advice.</p>
      </section>

      {/* Leaderboard */}
      {leaders && leaders.length > 0 && (
        <section className="mt-14" aria-labelledby="top">
          <h2 id="top" className="text-[24px] font-semibold tracking-[-0.02em] text-white">Top referrers</h2>
          <ol className="mt-4 divide-y divide-white/10 border border-white/10">
            {leaders.map((l, i) => (<li key={l.wallet} className="flex items-center justify-between px-4 py-2.5 text-[13.5px]"><span className="flex items-center gap-3"><span className="w-5 text-right font-mono text-[11px] text-zinc-500">{i + 1}</span><span className="font-mono text-zinc-200">{l.wallet}</span></span><span className="font-semibold tabular-nums text-[#d7ff00]">{usd(l.usdc, 3)}</span></li>))}
          </ol>
        </section>
      )}

      {/* Rules */}
      <section className="mt-14" aria-labelledby="rules">
        <h2 id="rules" className="text-[24px] font-semibold tracking-[-0.02em] text-white">The rules, plainly</h2>
        <div className="mt-4 divide-y divide-white/10 border border-white/10">
          {[
            ["Who counts as a referral?", "A wallet that signs in with your link and has no referrer yet. It is attached once, to you, and cannot be changed. You cannot refer yourself, and loops between two wallets are refused."],
            ["How long do I earn?", `${REFERRAL_MONTHS} months from the day their wallet is attached. Only one level counts: you earn on the people you refer, not on who they refer.`],
            ["When am I paid?", `Weekly, in USDC, to the wallet you linked, once your pending earnings reach ${usd(PAYOUT_MIN_USDC, 0)}. Each payout is an on-chain transfer you can look up.`],
            ["What if I hold too little SOLCAMEO?", "Your share is recorded as missed and shown to you, but it is not paid. Your tier is read from your wallet at the moment each payment settles."],
            ["What stops abuse?", "Earnings come only from payments that settled on-chain, so fake accounts cost real money. Refunded or failed jobs earn nothing, and payouts can be withheld for self-dealing or abuse. The program can change, and any change applies to future earnings."],
          ].map(([q, a]) => (<details key={q} className="group px-4 py-3.5"><summary className="cursor-pointer list-none text-[14px] font-semibold text-white marker:hidden">{q}</summary><p className="mt-2 max-w-3xl text-[13px] leading-6 text-zinc-400">{a}</p></details>))}
        </div>
      </section>
    </div>
  );
}
