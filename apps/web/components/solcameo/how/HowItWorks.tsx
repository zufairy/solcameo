"use client";
/* eslint-disable @next/next/no-img-element -- hosted character media */
import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, Flame, Gauge, Lock, MessageCircle, PauseCircle, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import { feeExample } from "@/lib/meteora/flywheel";
import { FEE_SPLIT_PERCENT, TRADING_FEE_BPS } from "@/lib/meteora/feePolicy";
import { displayFont } from "./fonts";
import { FeaturedPlayer, VideoCarousel } from "./LiveVideos";
import { useLiveData, type LiveVideo } from "./useLiveData";
import { marketPath } from "@/lib/solstar/marketSlug";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });
export type ExploreRef = { id: string; title: string; category: string; videoUrl: string; thumbUrl: string };
const toVideo = (r: ExploreRef): LiveVideo => ({ id: r.id, url: r.videoUrl, poster: r.thumbUrl, name: r.title, ticker: r.category, characterId: "", at: 0 });
const glass = "border border-white/[0.12] bg-white/[0.045] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_-30px_rgba(0,0,0,0.8)]";

const LIME = "#d7ff00";
const heading = "font-[family-name:var(--font-how-display)] font-bold uppercase leading-[0.92] tracking-tight bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent";
const cta = "hiw-shine group relative inline-flex h-[52px] items-center gap-2 overflow-hidden rounded-full bg-[linear-gradient(180deg,#f2ff7a_0%,#d7ff00_55%,#b8e000_100%)] px-8 text-sm font-bold tracking-tight text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-2px_0_rgba(0,0,0,0.12),0_0_0_1px_rgba(215,255,0,0.5),0_10px_40px_-6px_rgba(215,255,0,0.55)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_0_0_1px_rgba(215,255,0,0.7),0_16px_56px_-4px_rgba(215,255,0,0.75)] active:translate-y-0";

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.div className={className} initial={reduced ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>;
}
function SectionHead({ title, sub, link }: { title: ReactNode; sub?: string; link?: { href: string; label: string } }) {
  return <div className="mb-10 mx-auto flex max-w-[1700px] flex-wrap items-end justify-between gap-4 px-6 md:px-12 lg:px-20">
    <div><h2 className={`${heading} text-5xl md:text-7xl`}>{title}</h2>{sub && <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">{sub}</p>}</div>
    {link && <Link href={link.href} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/10">{link.label}<ArrowRight className="size-3.5" /></Link>}
  </div>;
}

type Char = ReturnType<typeof useLiveData>["characters"][number];

function Hero({ characters, images }: { characters: Char[]; images: string[] }) {
  const [ready, setReady] = useState(false);
  const a = characters[0];
  return <section className="relative mx-auto grid min-h-[640px] max-w-[1700px] items-center gap-6 px-6 pb-20 pt-16 md:grid-cols-[1fr_1.05fr] md:px-12 md:pt-20 lg:px-20">
    <div className="relative z-10">
      <p className={`mb-6 inline-flex items-center gap-2 rounded-full ${glass} px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300`}><span className="size-1.5 animate-pulse rounded-full bg-[#d7ff00]" />Live on Solana devnet</p>
      <h1 className={`${heading} text-6xl sm:text-7xl md:text-[6rem] xl:text-[7.5rem]`}>Launch an AI<br />character.<br /><span className="bg-none text-[#d7ff00] [-webkit-text-fill-color:#d7ff00]">With its own coin.</span></h1>
      <p className="mt-7 max-w-md text-[15px] leading-7 text-zinc-400">Design a character in one sentence. It launches on Solana with its own Meteora bonding-curve coin, chats with its community, and turns their ideas into the next video.</p>
      <div className="mt-9 flex flex-wrap items-center gap-6"><Link href="/create" className={cta}>Launch your character <ArrowUpRight className="size-4" /></Link><Link href="/explore" className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-white">Meet the characters <ArrowRight className="size-3.5" /></Link></div>
    </div>
    <div className="relative h-[460px] w-full md:h-[600px]">
      {!ready && <div className="absolute left-1/2 top-4 h-[420px] w-[270px] -translate-x-1/2 overflow-hidden rounded-[3px] border border-white/10 bg-[#161616] md:h-[520px] md:w-[330px]" aria-hidden="true">{(a?.imageUrl ?? images[0]) && <img src={a?.imageUrl ?? images[0]} alt="" className="size-full object-cover" />}</div>}
      <HeroScene images={images} onReady={() => setReady(true)} />
    </div>
  </section>;
}

function Steps({ characters, poster }: { characters: Char[]; poster?: string }) {
  const first = characters[0];
  // One dark stage for every illustration (the old light frame fought the dark variants,
  // leaving white text on pale grey). A faint dot grid + top glow gives each a sense of depth.
  const frame = "relative mb-5 h-52 overflow-hidden rounded-[2px] bg-[#0c0d0f] p-4 text-[11px] text-white ring-1 ring-white/[0.07] [background-image:radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:14px_14px]";
  const glow = <span aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-32 w-48 -translate-x-1/2 rounded-full bg-[#d7ff00]/[0.10] blur-3xl" />;
  const panel = "rounded-[2px] border border-white/[0.1] bg-white/[0.06] backdrop-blur";
  const thumbs = characters.slice(0, 3);
  const items = [
    { n: "01", t: "Create the character", d: "One sentence is enough. Pick a look or upload references. Its linked agent carries the same identity into chat and video.", ui:
      <div className={frame}>{glow}
        <div className={`relative ${panel} p-3`}><span className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Describe your character</span><p className="mt-1.5 text-[12px] font-medium leading-snug text-white">A tiny knight cat who films misty adventures<span className="ml-0.5 animate-pulse text-[#d7ff00]">|</span></p></div>
        <div className="relative mt-3 flex items-end justify-between"><div className="flex gap-2">{(thumbs.length ? thumbs : [undefined, undefined, undefined]).map((c, i) => <div key={i} className={`relative size-[60px] overflow-hidden rounded-[2px] bg-gradient-to-br from-zinc-700 to-zinc-900 ${i === 1 ? "ring-2 ring-[#d7ff00] shadow-[0_0_20px_-4px_rgba(215,255,0,0.6)]" : "ring-1 ring-white/15"}`}>{c?.imageUrl && <img src={c.imageUrl} alt="" className="size-full object-cover" />}{i === 1 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-[#d7ff00] text-black"><Check className="size-2.5" strokeWidth={3.5} /></span>}</div>)}</div>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold text-zinc-200">3 looks</span></div></div> },
    { n: "02", t: "Launch its coin", d: "Approve once in your wallet. Meteora’s Dynamic Bonding Curve opens trading, then graduates into a locked liquidity pool.", ui:
      <div className={frame}>{glow}
        <div className={`relative ${panel} flex items-center justify-between p-3`}><div><p className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Name becomes ticker</p><p className="mt-1 text-sm font-semibold text-white">{first?.name ?? "Luna"} <span className="text-zinc-500">→</span> <span style={{ color: LIME }}>${first?.ticker ?? "LUNA"}</span></p></div>
          <svg viewBox="0 0 64 32" className="h-8 w-16" aria-hidden><path d="M2 30 C20 29 34 24 44 14 S58 3 62 2" fill="none" stroke={LIME} strokeWidth="2" strokeLinecap="round" /><path d="M2 30 C20 29 34 24 44 14 S58 3 62 2 V32 H2Z" fill="rgba(215,255,0,0.12)" /></svg></div>
        <div className="hiw-shine relative mt-3 overflow-hidden rounded-full bg-[linear-gradient(180deg,#f2ff7a,#d7ff00_60%,#b8e000)] py-2 text-center text-xs font-bold text-black shadow-[0_6px_24px_-4px_rgba(215,255,0,0.5)]">Launch ✦</div>
        <div className="relative mt-3 flex justify-center gap-1.5">{["1B fixed supply", "Mint revoked"].map((t) => <span key={t} className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-zinc-200">{t}</span>)}</div></div> },
    { n: "03", t: "Fans steer the plot", d: "Holders and fans talk in the character’s public market chat. Each hour the agent reads the room and proposes the next scene.", ui:
      <div className={frame}>{glow}
        <div className="relative flex items-end justify-end gap-2"><div className={`max-w-[78%] ${panel} px-2.5 py-1.5 text-zinc-100`}>give her a storm to cross 🌩️</div><span className="size-5 shrink-0 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500" /></div>
        <div className="relative mt-2.5 flex items-start gap-2"><span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-[#d7ff00]">{first?.imageUrl ? <img src={first.imageUrl} alt="" className="size-full object-cover" /> : <Sparkles className="size-3 text-black" />}</span><div className="max-w-[82%] rounded-[2px] border border-[#d7ff00]/50 bg-[#d7ff00]/[0.08] px-2.5 py-1.5" style={{ color: LIME }}><span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider"><MessageCircle className="size-3" />Proposed</span><span className="text-[12px] font-medium text-white">“The Storm Crossing”</span></div></div>
        <div className="relative mt-2.5 flex items-end justify-end gap-2"><div className={`${panel} px-2.5 py-1.5 text-zinc-100`}>yes!! 🔥</div><span className="size-5 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-400 to-rose-500" /></div></div> },
    { n: "04", t: "Publish the chapter", d: "The video is generated with the character’s references, lands in the feed, and gives the community something new to talk about.", ui:
      <div className={`${frame} p-0`}>{poster ? <img src={poster} alt="" className="size-full object-cover" /> : <div className="size-full bg-[radial-gradient(circle_at_30%_20%,#3a4416,#0c0d0f_70%)]" />}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/30" />
        <span className="absolute left-3 top-3 rounded-full bg-[#d7ff00] px-2.5 py-1 text-[10px] font-bold text-black">New chapter</span>
        <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur"><Sparkles className="size-3.5" /></span>
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between text-[10px] font-medium text-white/90"><span>The Storm Crossing</span><span className="flex items-center gap-2 tabular-nums"><span>▶ 12.4K</span><span>♥ 1.8K</span></span></div></div> },
  ];
  return <section className="px-6 py-24 md:px-12 lg:px-20"><Reveal><h2 className={`${heading} mb-10 text-center text-5xl md:text-7xl`}>Four steps. No prompt skills.</h2></Reveal>
    <div className="mx-auto grid max-w-[1480px] gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map((s, i) => <Reveal key={s.n} className="h-full"><div className={`h-full rounded-[3px] ${glass} p-3 transition hover:border-[#d7ff00]/30`} style={{ transitionDelay: `${i * 40}ms` }}>{s.ui}<div className="px-2 pb-3"><p className="font-mono text-[10px] text-zinc-500">{s.n}</p><h3 className="mt-1 text-sm font-bold uppercase tracking-wider text-white">{s.t}</h3><p className="mt-2 text-xs leading-5 text-zinc-400">{s.d}</p></div></div></Reveal>)}</div></section>;
}

function Bento({ characters, videos }: { characters: Char[]; videos: ReturnType<typeof useLiveData>["videos"] }) {
  const v = videos[1] ?? videos[0];
  const label = (t: string, d: string) => <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-6"><h3 className="font-[family-name:var(--font-how-display)] text-3xl font-bold uppercase leading-none">{t}</h3><p className="mt-2 max-w-xs text-xs leading-5 text-zinc-300">{d}</p></div>;
  return <section className="mx-auto max-w-[1480px] px-6 py-24 md:px-12 lg:px-20"><Reveal><h2 className={`${heading} mb-10 text-5xl md:text-7xl`}>Your character.<br />Your coin. Your rules.</h2></Reveal>
    <div className="grid gap-4 md:grid-cols-6">
      <Reveal className="md:col-span-3"><div className="relative h-[380px] overflow-hidden rounded-[3px] border border-white/10 bg-[#111] ring-1 ring-inset ring-white/[0.04]">{characters[0]?.imageUrl && <img src={characters[0].imageUrl} alt="" className="size-full object-cover" />}{label("Create anyone", "Start from a sentence or reference images. Look, personality and story become one persistent identity.")}</div></Reveal>
      <Reveal className="md:col-span-3"><div className="relative h-[380px] overflow-hidden rounded-[3px] border border-white/10 bg-[#111] ring-1 ring-inset ring-white/[0.04]">{v ? <video src={v.url} poster={v.poster} muted loop autoPlay playsInline preload="metadata" className="size-full object-cover" /> : characters[1]?.imageUrl && <img src={characters[1].imageUrl} alt="" className="size-full object-cover" />}{label("Any story", "The community chat decides the plot. The agent turns it into the next video.")}</div></Reveal>
      <Reveal className="md:col-span-6"><div className="relative flex h-[300px] items-end justify-center gap-6 overflow-hidden rounded-[3px] border border-white/10 bg-[radial-gradient(ellipse_at_top,#1d1d1d,#0d0d0d)] px-6 pt-8">{characters.slice(2, 5).map(c => <img key={c.characterId} src={c.imageUrl} alt={c.name} className="h-full w-1/4 max-w-[220px] rounded-t-2xl object-cover opacity-90" />)}{label("Same identity, every scene", "References stay locked across chapters, so the character is recognisable wherever it goes.")}</div></Reveal>
    </div></section>;
}

function Roster({ characters, loading }: { characters: Char[]; loading: boolean }) {
  return <section className="mx-auto max-w-[1480px] px-6 py-10 text-center md:px-12 lg:px-20">
    <p className="mb-6 flex items-center justify-center gap-2 font-mono text-[11px] text-zinc-500"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{loading ? "Loading characters…" : `${characters.length} character${characters.length === 1 ? "" : "s"} live now`}</p>
    <div className="flex flex-wrap justify-center gap-2">{characters.slice(0, 40).map(c => <Link key={c.characterId} href={marketPath(c)} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3 font-mono text-[11px] text-zinc-300 transition hover:border-[#d7ff00]/40 hover:text-white"><img src={c.imageUrl} alt="" className="size-5 rounded-full object-cover" />${c.ticker}</Link>)}</div></section>;
}

const SPLIT = [
  { key: "creator", label: "Creator", pct: FEE_SPLIT_PERCENT.creator, color: "#d7ff00", note: "Paid to the character’s creator." },
  { key: "content", label: "Content budget", pct: FEE_SPLIT_PERCENT.content, color: "#7C4DFF", note: "Funds the next videos." },
  { key: "platform", label: "Platform", pct: FEE_SPLIT_PERCENT.platform, color: "#52525b", note: "Runs Solcameo operations." },
  { key: "protocol", label: "Meteora", pct: FEE_SPLIT_PERCENT.meteora, color: "#00FFD1", note: "Protocol share on the curve." },
] as const;

function Wall({ tall, total }: { tall: ExploreRef[]; total: number }) {
  const rows = [tall.slice(0, 14), tall.slice(14, 28)];
  return <section className="relative overflow-hidden py-24">
    <div className="mx-auto mb-12 max-w-[1480px] px-6 md:px-12 lg:px-20"><Reveal><h2 className={`${heading} text-5xl md:text-7xl`}>A library that<br />never runs dry.</h2><p className="mt-4 max-w-md text-sm leading-6 text-zinc-500">{total.toLocaleString()} motion references from the explore page, ready for your character to perform. <Link href="/explore" className="text-[#d7ff00] hover:underline">Browse them all</Link></p></Reveal></div>
    <div className="space-y-4 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">{rows.map((row, r) => <div key={r} className="flex w-max gap-4 hiw-marquee" style={{ animationDirection: r ? "reverse" : "normal", animationDuration: r ? "70s" : "55s" }}>{[...row, ...row].map((v, i) => <Link key={`${v.id}-${i}`} href="/explore" tabIndex={i >= row.length ? -1 : 0} aria-hidden={i >= row.length} className="group relative block h-[250px] w-[160px] shrink-0 overflow-hidden rounded-[3px] border border-white/10"><img src={v.thumbUrl} alt={i >= row.length ? "" : v.title} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" /><span className="absolute inset-x-1.5 bottom-1.5 truncate rounded-[2px] border border-white/15 bg-white/[0.08] px-2 py-1.5 text-[10px] font-medium text-white backdrop-blur-xl">{v.title}</span></Link>)}</div>)}</div>
  </section>;
}

function Tokenomics({ count, chapters }: { count: number; chapters: number }) {
  const [volume, setVolume] = useState(100);
  const f = feeExample(volume, TRADING_FEE_BPS, true);
  const money = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 3 : 2 })} SOL`;
  return <section className="mx-auto max-w-[1480px] px-6 py-24 md:px-12 lg:px-20">
    <Reveal><h2 className={`${heading} text-5xl md:text-7xl`}>Every trade<br />funds the story.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">Each character’s coin trades on its own Meteora bonding curve. A small fee on every trade is split four ways, and a share of it pays for the next video.</p></Reveal>
    <div className="mt-12 grid grid-cols-1 divide-y divide-white/[0.08] border-y border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-y-0">{[["Characters live", String(count), "live right now"], ["Chapters published", String(chapters), "latest from live agents"], ["Fixed supply", "1B", "per coin, mint authority revoked"]].map(([k, v, n]) => <div key={k} className="relative px-0 py-8 sm:px-8 sm:first:pl-0"><p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{k}</p><p className="mt-3 font-[family-name:var(--font-how-display)] text-7xl font-bold leading-none tabular-nums bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent">{v}</p><p className="mt-3 text-xs text-zinc-600">{n}</p></div>)}</div>
    <Reveal className="mt-4"><div className={`rounded-[3px] ${glass} p-5 md:p-7`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold uppercase tracking-wider">Where trading fees go</h3><span className="rounded-full border border-[#d7ff00] px-3 py-1 text-xs tabular-nums text-[#d7ff00]">{TRADING_FEE_BPS / 100}% fee on every trade</span></div>
      <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-white/5" role="img" aria-label={`Fee split: creator ${FEE_SPLIT_PERCENT.creator}%, content ${FEE_SPLIT_PERCENT.content}%, platform ${FEE_SPLIT_PERCENT.platform}%, Meteora ${FEE_SPLIT_PERCENT.meteora}%`}>{SPLIT.map(s => <div key={s.key} style={{ width: `${s.pct}%`, background: s.color }} />)}</div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{SPLIT.map(s => <div key={s.key}><p className="flex items-center gap-2 text-xs text-zinc-400"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label} · {s.pct}%</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(f[s.key])}</p><p className="mt-1 text-[11px] text-zinc-600">{s.note}</p></div>)}</div>
      <label className="mt-6 block text-xs text-zinc-500">If a coin trades <span className="font-semibold tabular-nums text-zinc-200">{volume.toLocaleString()} SOL</span> in volume<input type="range" min={10} max={5000} step={10} value={volume} onChange={e => setVolume(Number(e.target.value))} className="mt-3 w-full accent-[#d7ff00]" aria-label="Trading volume in SOL" /></label>
      <p className="mt-4 text-[11px] leading-5 text-zinc-600">Illustration of the launch policy, not a forecast. Fees depend on real trading, and tokens carry risk and no promise of returns.</p>
    </div></Reveal>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className={`rounded-[3px] ${glass} p-5 md:p-7`}><div className="flex items-center gap-2"><Lock className="size-4" style={{ color: LIME }} /><h3 className="text-sm font-bold uppercase tracking-wider">The curve</h3></div><ul className="mt-4 space-y-3 text-sm text-zinc-400">{["Trades follow the configured Meteora curve until the graduation threshold is met.", "Graduation migrates liquidity into a DAMM v2 pool, and that liquidity is permanently locked.", "Supply is fixed at 1 billion tokens with an immutable mint authority.", "Each coin shows its real settings and onchain state in its market."].map(t => <li key={t} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />{t}</li>)}</ul></div>
      <div className={`rounded-[3px] ${glass} p-5 md:p-7`}><div className="flex items-center gap-2"><Flame className="size-4" style={{ color: LIME }} /><h3 className="text-sm font-bold uppercase tracking-wider">Buyback and burn</h3></div><span className="mt-3 inline-block rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">Proposed · not automated today</span><p className="mt-4 text-sm leading-6 text-zinc-400">A future treasury policy could use a disclosed share of earned revenue to buy the character’s token and burn it on Solana, with a verifiable transaction. Meteora DBC does not do this automatically, and nothing is promised until it ships.</p></div>
    </div></section>;
}

function Guardrails() {
  const items = [
    { i: Gauge, t: "Budget-backed", d: "Each job reserves its charge before generation. Chapters only run when the content budget covers them." },
    { i: ReceiptText, t: "Reconciled", d: "Uncertain provider submissions are held for reconciliation instead of guessed at." },
    { i: PauseCircle, t: "Creator pause", d: "Creators can pause future jobs from their market at any time." },
    { i: ShieldCheck, t: "Fee-funded", d: "The content budget comes only from trading fees. It cannot be spent on anything else." },
  ];
  return <section className="mx-auto max-w-[1480px] px-6 py-24 md:px-12 lg:px-20"><Reveal><h2 className={`${heading} text-5xl md:text-7xl`}>Trading fees fund the AI.<br />Not the other way around.</h2><p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">Hourly chat reflection is automated. On mainnet, an enabled character can publish one budget-backed chapter a day from a fresh community plot.</p></Reveal>
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map(({ i: Icon, t, d }) => <div key={t} className={`rounded-[2px] ${glass} p-5`}><span className="grid size-8 place-items-center rounded-[2px] bg-white/5"><Icon className="size-4 text-zinc-300" /></span><h3 className="mt-4 text-xs font-bold uppercase tracking-wider">{t}</h3><p className="mt-2 text-xs leading-5 text-zinc-500">{d}</p></div>)}</div>
    <p className="mt-5 text-[11px] text-zinc-600">Characters are AI-generated and labelled as such.</p></section>;
}

function FinalCta({ characters }: { characters: Char[] }) {
  return <section className="px-6 pb-24 pt-6 md:px-12 lg:px-20"><div className="relative mx-auto flex min-h-[380px] max-w-[1480px] items-center justify-center overflow-hidden rounded-[3px] border border-white/10 bg-[radial-gradient(ellipse_at_top,#1c1c1c,#0a0a0a)] px-6 py-16 text-center">
    {[characters[3], characters[4]].map((c, i) => c?.imageUrl && <img key={c.characterId} src={c.imageUrl} alt="" aria-hidden="true" className={`pointer-events-none absolute bottom-0 hidden h-[90%] w-1/4 object-cover opacity-40 md:block ${i ? "right-0 [mask-image:linear-gradient(to_left,black,transparent)]" : "left-0 [mask-image:linear-gradient(to_right,black,transparent)]"}`} />)}
    <div className="relative"><h2 className={`${heading} text-5xl md:text-7xl`}>Who will you launch?</h2><Link href="/create" className={`${cta} mt-8`}><Sparkles className="size-4" />Launch your character</Link></div></div></section>;
}

export function HowItWorks({ wide, tall, total }: { wide: ExploreRef[]; tall: ExploreRef[]; total: number }) {
  const { videos: live, characters, loading } = useLiveData();
  const featured = useMemo(() => wide.map(toVideo), [wide]);
  const carousel = useMemo(() => tall.map(toVideo), [tall]);
  const sceneImages = useMemo(() => [characters[0]?.imageUrl, tall[2]?.thumbUrl, tall[9]?.thumbUrl, tall[15]?.thumbUrl, tall[21]?.thumbUrl].map((u, i) => u ?? tall[i * 4]?.thumbUrl).filter((u): u is string => !!u), [characters, tall]);
  return <main className={`${displayFont.variable} relative w-full overflow-x-clip bg-[#09090a] pb-10 text-zinc-100`}>
    <style>{`.hiw-shine::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.85) 50%,transparent 65%);transform:translateX(-120%);animation:hiw-shine 3.2s ease-in-out infinite;pointer-events:none}@keyframes hiw-shine{0%,35%{transform:translateX(-120%)}70%,100%{transform:translateX(120%)}}.hiw-marquee{animation:hiw-marquee 60s linear infinite}.hiw-marquee:hover{animation-play-state:paused}@keyframes hiw-marquee{to{transform:translateX(-50%)}}@media (prefers-reduced-motion:reduce){.hiw-shine::after{animation:none;display:none}.hiw-marquee{animation:none}}`}</style>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-40 top-0 size-[720px] rounded-full bg-[#d7ff00]/[0.07] blur-[140px]" />
      <div className="absolute -left-52 top-[1100px] size-[640px] rounded-full bg-[#7C4DFF]/[0.12] blur-[150px]" />
      <div className="absolute -right-52 top-[2600px] size-[640px] rounded-full bg-[#00FFD1]/[0.07] blur-[150px]" />
      <div className="absolute -left-40 top-[4200px] size-[600px] rounded-full bg-[#d7ff00]/[0.06] blur-[150px]" />
      <div className="absolute inset-x-0 top-0 h-[900px] bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[length:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    </div>
    <div className="relative">
      <Hero characters={characters} images={sceneImages} />
      <section className="px-6 py-16 md:px-12 lg:px-20"><Reveal><h2 className={`${heading} mb-2 text-center text-5xl md:text-7xl`}>See it in action</h2><p className="mb-6 text-center text-sm text-zinc-500">One character, one idea, a finished film. This is what your AI can make.</p></Reveal><FeaturedPlayer videos={featured} /></section>
      <Steps characters={characters} poster={tall[3]?.thumbUrl} />
      <section className="py-16"><SectionHead title="Any story" sub="Pick a motion or a trending format. Your character performs it, and the community decides when it posts." link={{ href: "/explore", label: "Browse all in explore" }} /><VideoCarousel videos={carousel} loading={false} /></section>
      <Bento characters={characters} videos={featured} />
      <Wall tall={tall} total={total} />
      <Roster characters={characters} loading={loading} />
      <Tokenomics count={characters.length} chapters={live.length} />
      <Guardrails />
      <FinalCta characters={characters} />
    </div>
  </main>;
}
