"use client";
/* eslint-disable @next/next/no-img-element -- public reference thumbnails */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Bookmark, Check, Copy, Film, Loader2, Play, Search, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CATEGORIES, type ReferenceVideo } from "@/lib/explore/feed";
import { useMotionRuns, type Resolution } from "@/components/builder/character/motion";

type Feed = { items: ReferenceVideo[]; next: number | null; total: number; refreshedAt?: string };
const GREEN = "rounded-lg bg-[#d7ff00] text-black shadow-none hover:bg-[#e4ff59]";

function ReferenceCard({ item, saved, onSave, onOpen }: { item: ReferenceVideo; saved: boolean; onSave: () => void; onOpen: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState(false);
  const reduced = useReducedMotion();
  const stop = () => { video.current?.pause(); setPreview(false); };
  return <article className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.045]">
    <button onClick={onOpen} onMouseEnter={() => !reduced && setPreview(true)} onMouseLeave={stop} onBlur={stop} onFocus={() => !reduced && setPreview(true)} className="relative block aspect-[3/4] w-full overflow-hidden bg-[#202329] text-left focus-visible:outline-2 focus-visible:outline-[#d7ff00]" aria-label={`Preview ${item.title}`}>
      {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none" /> : <span className="grid size-full place-items-center"><Film className="size-10 text-zinc-600" /></span>}
      {preview && <video ref={video} src={item.videoUrl} autoPlay muted loop playsInline preload="none" onError={stop} className="absolute inset-0 size-full object-cover" />}
      <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[10px] font-semibold text-[#e4ff59] backdrop-blur">{item.category}</span>
      <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs text-white"><Play className="size-3 fill-current" /> {Math.round(item.duration)}s</span>
      <span className="absolute bottom-3 right-3 rounded-md bg-white/10 px-2 py-1 backdrop-blur-xl text-[10px] font-medium text-white">ORIGINAL</span>
    </button>
    <div className="p-3"><h2 className="truncate text-sm font-semibold text-white" title={item.title}>{item.title}</h2><p className="mt-1 truncate text-xs text-zinc-500">{item.description || "Ready to use with your influencer"}</p>
      <div className="mt-3 flex gap-2"><Button onClick={onOpen} className={`flex-1 text-xs ${GREEN}`}><Sparkles className="size-3" /> Use reference</Button><Button variant="outline" size="icon" aria-label={saved ? `Unsave ${item.title}` : `Save ${item.title}`} aria-pressed={saved} onClick={onSave} className="border-white/10 bg-transparent text-zinc-400"><Bookmark className={`size-3.5 ${saved ? "fill-[#d7ff00] text-[#d7ff00]" : ""}`} /></Button></div>
    </div>
  </article>;
}

function Generator({ mint, item, onBusy }: { mint: string; item: ReferenceVideo; onBusy: (busy: boolean) => void }) {
  const [portrait, setPortrait] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const { runs, start } = useMotionRuns(mint);
  const run = runs[0];
  useEffect(() => { onBusy(run?.status === "pending"); }, [run?.status, onBusy]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/character?mint=${encodeURIComponent(mint)}`, { signal: controller.signal }).then(async res => { const d = await res.json(); if (!res.ok) throw new Error(d.error || "Could not load portrait"); setPortrait(d.character?.image?.url); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mint]);
  return <div className="space-y-4">
    {loading ? <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="size-4 animate-spin" /> Loading character…</p> : portrait ? <div className="flex items-center gap-3 rounded-lg border border-white/10 p-3"><img src={portrait} alt="Selected influencer portrait" className="size-12 rounded-md object-cover" /><div><p className="text-sm text-white">Your saved character</p><p className="text-xs text-zinc-500">Identity + reference motion</p></div></div> : <p className="text-sm text-zinc-400">{error || "This influencer needs a saved character portrait."} <Link className="text-[#d7ff00] underline" href={`/builder?mint=${encodeURIComponent(mint)}&tab=character`}>Open character builder</Link></p>}
    <label className="block text-xs text-zinc-400">Scene direction <span className="text-zinc-600">(optional)</span><Textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} placeholder="Describe the setting, lighting, or style…" rows={3} className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-[#d7ff00]" /></label>
    <div className="flex items-center justify-between"><span className="text-xs text-zinc-400">Resolution</span><div className="flex gap-1">{(["480p", "720p", "1080p"] as Resolution[]).map(r => <Button key={r} size="sm" variant="outline" aria-pressed={r === resolution} onClick={() => setResolution(r)} className={r === resolution ? GREEN : "border-white/10 bg-transparent text-zinc-400"}>{r}</Button>)}</div></div>
    <Button className={`h-11 w-full ${GREEN}`} disabled={!portrait || loading || run?.status === "pending"} onClick={() => void start({ mode: "motion-transfer", videoUrl: item.videoUrl, imageUrls: [portrait!], prompt, resolution, title: item.title, poster: item.thumbUrl })}>{run?.status === "pending" ? <><Loader2 className="size-4 animate-spin" /> Generating…</> : <><Sparkles className="size-4" /> Generate with Genjutsu</>}</Button>
    <p className="text-[11px] text-zinc-500">Uses your connected Higgsfield account. Keep this popup open while rendering. Finished videos are saved to this agent&apos;s motion library.</p>
    {run?.status === "error" && <p role="alert" className="text-sm text-red-400">{run.error}</p>}
    {run?.url && <div><p className="mb-2 text-xs text-[#d7ff00]">Your latest generation</p><video src={run.url} controls playsInline className="max-h-56 w-full rounded-lg bg-black" /><a href={run.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-[#d7ff00] underline">Open / download video</a></div>}
  </div>;
}

export function ExplorePage({ initial }: { initial: Feed }) {
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.next);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [saved, setSaved] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReferenceVideo | null>(null);
  const [mint, setMint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [mediaError, setMediaError] = useState(false);
  const { profile, login } = useSupabaseAuth();
  const wallets = useMemo(() => [...new Set([...(profile?.walletAddresses ?? []), profile?.walletAddress].filter((w): w is string => !!w))], [profile]);
  const agents = useQuery(api.influencers.listByCreators, wallets.length ? { creatorWallets: wallets } : "skip");
  const reduced = useReducedMotion();
  // Restore browser-only bookmarks after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const data = JSON.parse(localStorage.getItem("solcameo.explore.saved") || "[]"); if (Array.isArray(data)) setSaved(data.filter((v): v is string => typeof v === "string")); } catch { /* corrupt storage */ } }, []);
  const visible = items.filter(i => (category === "All" || i.category === category) && (!savedOnly || saved.includes(i.id)) && `${i.title} ${i.description}`.toLowerCase().includes(query.toLowerCase().trim()));
  function toggleSave(id: string) { const updated = saved.includes(id) ? saved.filter(v => v !== id) : [...saved, id]; setSaved(updated); try { localStorage.setItem("solcameo.explore.saved", JSON.stringify(updated)); } catch { /* storage unavailable */ } }
  async function loadMore() {
    if (!next || loading) return;
    setLoading(true); setError("");
    try { const res = await fetch(`/api/explore?cursor=${next}`); const d: Feed & { error?: string } = await res.json(); if (!res.ok) throw new Error(d.error); setItems(prev => { const ids = new Set(prev.map(i => i.id)); return [...prev, ...d.items.filter(i => !ids.has(i.id))]; }); setNext(d.next && d.next > next ? d.next : null); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load references"); } finally { setLoading(false); }
  }
  async function copy() { if (!selected) return; try { await navigator.clipboard.writeText(selected.videoUrl); setCopied(true); setCopyError(""); } catch { setCopyError("Copy unavailable. Select and copy the source URL below."); } }
  return <main className="explore-library min-h-screen bg-[#090a0b] px-4 py-7 text-white sm:px-7 lg:px-9">
    <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-[1600px]">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#d7ff00]"><span className="size-1.5 rounded-full bg-[#d7ff00]" /> Original motion library</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Explore<span className="text-[#d7ff00]">.</span></h1><p className="mt-2 text-sm text-zinc-400">Original clips, ready for your next Genjutsu creation.</p></div><div className="flex gap-6 font-mono text-xs"><div><p className="text-lg text-white">{initial.total.toLocaleString()}</p><p className="text-zinc-500">in source catalog</p></div><div><p className="text-lg text-[#d7ff00]">Genjutsu</p><p className="text-zinc-500">motion transfer</p></div></div></div>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3 size-4 text-zinc-500" /><Input aria-label="Search loaded references" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search motion, style, or scene…" className="h-10 border-white/10 pl-9 text-white" /></div><Button variant="outline" onClick={() => setSavedOnly(!savedOnly)} aria-pressed={savedOnly} className={savedOnly ? GREEN : "h-10 border-white/10 bg-transparent text-zinc-300"}><Bookmark className="size-4" /> Saved ({saved.length})</Button></div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1.5">{CATEGORIES.map(c => <Button key={c} onClick={() => setCategory(c)} aria-pressed={category === c} className={category === c ? GREEN : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"}>{c}</Button>)}</div><p className="font-mono text-[11px] text-zinc-500">{visible.length} shown · {items.length} loaded · trending</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{visible.map(item => <ReferenceCard key={item.id} item={item} saved={saved.includes(item.id)} onSave={() => toggleSave(item.id)} onOpen={() => { setSelected(item); setMediaError(false); setCopied(false); setCopyError(""); }} />)}</div>
      {!visible.length && <div className="py-20 text-center"><Film className="mx-auto mb-3 size-8 text-zinc-600" /><p className="text-zinc-400">No matching references in the loaded library.</p><Button variant="ghost" onClick={() => { setQuery(""); setCategory("All"); setSavedOnly(false); }}>Reset filters</Button></div>}
      <div className="flex flex-col items-center gap-3 py-8">{error && <p role="alert" className="text-sm text-red-400">{error}</p>}{next && <Button variant="outline" disabled={loading} onClick={() => void loadMore()} className="h-10 border-white/15 bg-transparent px-7 text-white">{loading ? <><Loader2 className="size-4 animate-spin" /> Loading…</> : error ? "Retry loading" : "Load more references"}</Button>}<p className="text-[11px] text-zinc-500">Search and filters apply to loaded references. Public references via <a href="https://higgsfield.ai/ai/video?model=genjutsu" target="_blank" rel="noreferrer" className="underline">Higgsfield</a>.</p></div>
    </motion.div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !generating) setSelected(null); }}><DialogContent showCloseButton={!generating} className="max-h-[90dvh] overflow-y-auto border border-white/10 bg-[#111214]/95 p-5 shadow-2xl backdrop-blur-2xl text-white sm:max-w-4xl">
      {selected && <><DialogTitle className="pr-8 text-xl">{selected.title}</DialogTitle><DialogDescription className="text-zinc-400">Original input video · copied and used directly for generation.</DialogDescription><div className="grid gap-6 md:grid-cols-2"><div><video key={selected.id} src={selected.videoUrl} onError={() => setMediaError(true)} poster={selected.thumbUrl} controls playsInline preload="metadata" style={{ aspectRatio: selected.width && selected.height ? `${selected.width} / ${selected.height}` : "3 / 4" }} className="max-h-[50vh] w-full rounded-lg bg-black object-contain" />{mediaError && <p role="alert" className="mt-3 text-xs text-red-400">This original is unavailable from the source. Choose another reference.</p>}<p className="mt-3 text-[11px] text-zinc-500">Original reference · {Math.round(selected.duration)}s{selected.width && selected.height ? ` · ${selected.width} × ${selected.height}` : ""}</p><p className="mt-3 text-xs leading-relaxed text-zinc-400">{selected.description}</p><div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => void copy()} className="border-white/10 bg-transparent text-white">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied source" : "Copy original URL"}</Button><a href={selected.videoUrl} target="_blank" rel="noreferrer" aria-label="Open original reference" className="grid size-8 place-items-center rounded-lg border border-white/10"><ArrowUpRight className="size-4" /></a></div>{copyError && <><p role="alert" className="mt-2 text-xs text-red-400">{copyError}</p><Input readOnly value={selected.videoUrl} onFocus={e => e.target.select()} aria-label="Reference URL" /></>}</div><div><p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#d7ff00]">01 reference → 02 influencer → 03 generate</p><label className="mb-4 block text-xs text-zinc-400">Your influencer<Select disabled={generating} value={mint} onValueChange={value => setMint(value ?? "")}><SelectTrigger aria-label="Your influencer" className="mt-2 h-11 w-full border-white/10 bg-white/5 text-white"><SelectValue placeholder="Choose an influencer" /></SelectTrigger><SelectContent className="border-white/10 bg-[#17191d] text-white">{agents?.map(a => <SelectItem key={a.mintAddress} value={a.mintAddress}>{a.name}</SelectItem>)}</SelectContent></Select></label>{mint && !mediaError ? <Generator key={mint} mint={mint} item={selected} onBusy={setGenerating} /> : <div className="rounded-lg border border-dashed border-white/15 p-6 text-center"><Sparkles className="mx-auto mb-3 size-7 text-[#d7ff00]" /><p className="text-sm text-zinc-400">{!profile ? "Sign in to use your AI influencers." : agents === undefined ? "Loading your influencers…" : agents.length ? "Choose your influencer to continue." : "Create your first influencer to start recreating."}</p>{!profile ? <Button onClick={() => void login()} className={`mt-4 ${GREEN}`}>Sign in</Button> : <Link href="/builder?type=influencer&onboarding=1" className="mt-4 inline-block text-sm text-[#d7ff00] underline">Create an influencer</Link>}</div>}</div></div></>}
    </DialogContent></Dialog>
  </main>;
}
