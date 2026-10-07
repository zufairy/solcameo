"use client";
/* eslint-disable @next/next/no-img-element -- remote media */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarClock, Check, Loader2, Repeat, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { estimateGenerationUsd, formatGenerationUsd, GENJUTSU_RESOLUTIONS, type GenjutsuResolution } from "@/lib/explore/generationPrice";
import type { ReferenceVideo } from "@/lib/explore/feed";
import { AgentOption } from "./AgentOption";
import { castToken } from "@/lib/explore/castKey";
import { CameoPrompt, type CameoMember } from "./CameoPrompt";

export type GenMode = "motion-transfer" | "object-swap";
export interface ScheduleAgent { mintAddress: string; name: string; avatarUrl?: string; coinTicker?: string; connectedPlatforms?: string[] }
interface Row { postStatus?: string; postError?: string; id: string; title: string; poster?: string; runAt: number; repeat: string; remaining: number; status: string; resolution: string; mode: string; resultUrl?: string; error?: string }

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
function presets(now = new Date()): Array<{ label: string; date: Date }> {
  const tonight = at(now, 20);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const monday = at(new Date(now.getTime() + ((8 - now.getDay()) % 7 || 7) * 86_400_000), 9);
  return [
    { label: "In 1 hour", date: new Date(now.getTime() + 3_600_000) },
    ...(tonight.getTime() > now.getTime() + 600_000 ? [{ label: "Tonight 8 PM", date: tonight }] : []),
    { label: "Tomorrow 9 AM", date: tomorrow },
    { label: "Next Monday", date: monday },
  ];
}
const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Upcoming", cls: "bg-sky-400/15 text-sky-300" },
  running: { label: "Starting", cls: "bg-amber-400/15 text-amber-300" },
  submitted: { label: "Rendering", cls: "bg-amber-400/15 text-amber-300" },
  completed: { label: "Ready", cls: "bg-emerald-400/15 text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-400/15 text-red-300" },
  cancelled: { label: "Cancelled", cls: "bg-white/10 text-zinc-400" },
};
const MODEL_LABEL: Record<GenMode, string> = { "motion-transfer": "Genjutsu · Motion transfer", "object-swap": "Genjutsu · Object swap" };

interface Props { item: ReferenceVideo | null; agents: ScheduleAgent[] | undefined; initialMint: string; mode: GenMode; resolution: GenjutsuResolution; onClose: () => void }

/** Mounts the form fresh for every reference, so its state never needs a reset effect. */
export function ScheduleDialog(props: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!props.item} onOpenChange={(o) => { if (!o && !busy) props.onClose(); }}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto border border-white/12 bg-[#17191c]/95 p-0 text-white shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-3xl">
        {props.item && <ScheduleBody key={props.item.id} {...props} item={props.item} onBusy={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleBody({ item, agents, initialMint, mode: initialMode, resolution: initialRes, onClose, onBusy }: Omit<Props, "item"> & { item: ReferenceVideo; onBusy: (b: boolean) => void }) {
  const reduced = useReducedMotion();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const [mint, setMint] = useState(initialMint || agents?.[0]?.mintAddress || "");
  const [mode, setMode] = useState<GenMode>(initialMode);
  const [resolution, setResolution] = useState<GenjutsuResolution>(initialRes);
  const [when, setWhen] = useState(() => toLocalInput(presets()[0].date));
  const [repeat, setRepeat] = useState<"once" | "daily" | "weekly">("once");
  const [count, setCount] = useState(7);
  const [autoPost, setAutoPost] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<CameoMember[]>([]);
  const [portraitState, setPortraitState] = useState<{ mint: string; url?: string } | null>(null);
  const effMint = mint || agents?.[0]?.mintAddress || "";
  const portrait = portraitState?.mint === effMint ? portraitState.url : undefined;
  const portraitLoading = !!effMint && portraitState?.mint !== effMint;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!effMint) return;
    const c = new AbortController();
    fetch(`/api/character?mint=${encodeURIComponent(effMint)}`, { signal: c.signal })
      .then(async (r) => { const d = await r.json(); setPortraitState({ mint: effMint, url: r.ok ? d.character?.image?.url : undefined }); })
      .catch(() => { if (!c.signal.aborted) setPortraitState({ mint: effMint }); });
    return () => c.abort();
  }, [effMint]);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!effMint) return;
    let alive = true;
    const load = () => fetch(`/api/explore/schedule?mint=${encodeURIComponent(effMint)}`, { cache: "no-store" })
      .then(async (r) => { if (alive && r.ok) setRows(((await r.json()) as { items: Row[] }).items); })
      .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [effMint, reload]);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);

  const runAt = when ? new Date(when).getTime() : NaN;
  const per = item ? estimateGenerationUsd(item.duration, resolution) : null;
  const runs = repeat === "once" ? 1 : count;
  const agent = agents?.find((a) => a.mintAddress === effMint);
  const xConnected = !!agent?.connectedPlatforms?.includes("x");
  const valid = !!item && !!portrait && per !== null && Number.isFinite(runAt) && runAt > nowMs + 60_000;
  const whenLabel = Number.isFinite(runAt) ? new Date(runAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  async function submit() {
    if (!item || !valid) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/explore/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: effMint, referenceId: item.id, referencePage: item.page, castTokens: [castToken(agent?.name ?? "Character"), ...cast.map((c) => c.token)], autoPost: xConnected && autoPost, imageUrls: [portrait!, ...cast.map((c) => c.avatarUrl)].slice(0, 8), prompt, mode, resolution, runAt, repeat, repeatCount: count }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not schedule this video.");
      setDone(true);
      setReload((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not schedule this video."); }
    finally { setBusy(false); }
  }
  async function cancel(id: string) {
    await fetch(`/api/explore/schedule?mint=${encodeURIComponent(effMint)}&id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    setReload((n) => n + 1);
  }

  const field = "mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm text-white outline-none transition-colors hover:bg-white/[0.08] focus:border-white/30 [color-scheme:dark]";
  return (
    <>
          <div className="grid md:grid-cols-[260px_1fr]">
            <div className="relative hidden bg-black md:block">
              <video src={item.videoUrl} poster={item.thumbUrl} muted loop autoPlay playsInline className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
              <div className="absolute inset-x-4 bottom-4">
                <span className="rounded-md border border-white/25 bg-white/15 px-2 py-0.5 text-[10px] font-medium backdrop-blur-xl">{item.category}</span>
                <p className="mt-2 text-sm font-semibold leading-snug">{item.title}</p>
                <p className="mt-1 text-[11px] text-white/60">{Math.round(item.duration)}s reference</p>
              </div>
            </div>
            <div className="min-w-0 space-y-5 p-5 md:p-6">
              <div>
                <DialogTitle className="flex items-center gap-2 text-xl"><CalendarClock className="size-5 text-[#d7ff00]" />Schedule this video</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-zinc-400">Pick when your influencer should recreate it. It renders on our servers, so you can close the tab.</DialogDescription>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  <motion.div key="done" initial={reduced ? false : { opacity: 0, y: 12, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} className="rounded-xl border border-[#d7ff00]/30 bg-[#d7ff00]/[0.07] p-5 text-center">
                    <motion.span initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 16 }} className="mx-auto grid size-12 place-items-center rounded-full bg-[#d7ff00] text-black"><Check className="size-6" strokeWidth={3} /></motion.span>
                    <p className="mt-3 text-base font-semibold">Scheduled</p>
                    <p className="mt-1 text-sm text-zinc-300">{agent?.name ? <span className="font-bold uppercase">{agent.name}</span> : "Your influencer"} will recreate this {repeat === "once" ? `on ${whenLabel}` : `${repeat}, starting ${whenLabel}`}.</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <button type="button" onClick={() => setDone(false)} className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold hover:bg-white/15">Schedule another</button>
                      <button type="button" onClick={onClose} className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200">Done</button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={false} className="space-y-5">
                    <label className="block text-xs text-zinc-400">Your influencer
                      <Select value={mint} onValueChange={(v) => setMint(v ?? "")}>
                        <SelectTrigger aria-label="Your influencer" className="mt-1.5 h-14 w-full border-white/10 bg-white/5 px-2.5 text-white">
                          <SelectValue placeholder="Choose an influencer">{(value: string | null) => { const a = agents?.find((x) => x.mintAddress === value); return a ? <AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer"; }}</SelectValue>
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(22rem,var(--available-height))] border-white/10 bg-[#17191d] p-1.5 text-white">
                          {agents?.map((a) => <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-14 py-1.5 pl-2"><AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /></SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>

                    <div>
                      <span className="text-xs text-zinc-400">When</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {presets().map((p) => {
                          const on = when === toLocalInput(p.date);
                          return <button key={p.label} type="button" aria-pressed={on} onClick={() => setWhen(toLocalInput(p.date))} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? "border-[#d7ff00] bg-[#d7ff00] text-black" : "border-white/15 bg-white/[0.05] text-zinc-300 hover:bg-white/10"}`}>{p.label}</button>;
                        })}
                      </div>
                      <input type="datetime-local" aria-label="Custom date and time" value={when} min={toLocalInput(new Date(nowMs + 120_000))} onChange={(e) => setWhen(e.target.value)} className={field} />
                    </div>

                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400"><Repeat className="size-3" />Repeat</span>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-0.5" role="group" aria-label="Repeat">
                          {(["once", "daily", "weekly"] as const).map((r) => <button key={r} type="button" aria-pressed={repeat === r} onClick={() => setRepeat(r)} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${repeat === r ? "bg-[#d7ff00] text-black" : "text-zinc-400 hover:text-white"}`}>{r === "once" ? "Just once" : r}</button>)}
                        </div>
                        {repeat !== "once" && (
                          <select aria-label="Number of runs" value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-9 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-white outline-none [color-scheme:dark]">
                            {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} times</option>)}
                          </select>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-xs text-zinc-400">Model
                        <select value={mode} onChange={(e) => setMode(e.target.value as GenMode)} className={field}>
                          {(Object.keys(MODEL_LABEL) as GenMode[]).map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-zinc-400">Quality
                        <select value={resolution} onChange={(e) => setResolution(e.target.value as GenjutsuResolution)} className={field}>
                          {GENJUTSU_RESOLUTIONS.map((r) => { const p = estimateGenerationUsd(item.duration, r); return <option key={r} value={r}>{r}{p !== null ? ` · ${formatGenerationUsd(p)}` : ""}</option>; })}
                        </select>
                      </label>
                    </div>

                    {portraitLoading ? <p className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="size-4 animate-spin" />Loading character…</p>
                      : portrait && mint ? <CameoPrompt key={`${effMint}:${item.id}`} mint={effMint} primaryName={agent?.name ?? "Character"} primaryImage={portrait} item={item} mode={mode} value={prompt} onChange={setPrompt} onCast={setCast} />
                      : <p className="text-xs text-amber-300">{mint ? "This influencer needs a saved character portrait first." : "Choose an influencer to continue."}</p>}

                    {portrait && xConnected && (
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs transition-colors hover:bg-white/[0.07] has-[:checked]:border-[#d7ff00]/40 has-[:checked]:bg-[#d7ff00]/[0.06]">
                        <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} className="peer sr-only" />
                        <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border border-white/30 bg-black/30 text-transparent transition-colors peer-checked:border-[#d7ff00] peer-checked:bg-[#d7ff00] peer-checked:text-black peer-focus-visible:ring-2 peer-focus-visible:ring-[#d7ff00]/60"><Check className="size-3" strokeWidth={3.5} /></span>
                        <span><span className="block text-sm font-semibold text-white">Auto-post to X when it&apos;s ready</span><span className="mt-0.5 block text-zinc-400">Each finished video gets a viral caption and goes out on the connected X account.</span></span>
                      </label>
                    )}
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-3"><span className="text-zinc-400">{Number.isFinite(runAt) ? (repeat === "once" ? whenLabel : `${repeat === "daily" ? "Daily" : "Weekly"} from ${whenLabel}`) : "Pick a time"}</span><span className="font-medium tabular-nums">{per !== null ? `${formatGenerationUsd(per)} per run` : "Reference must be 4 to 30s"}</span></div>
                      <p className="mt-1 text-right text-[11px] text-zinc-500">Charged from the agent wallet when each run starts. Includes the Solcameo fee (15% or $1, whichever is higher).</p>
                      {per !== null && runs > 1 && <p className="mt-1 text-right text-[11px] tabular-nums text-zinc-500">{runs} runs · about {formatGenerationUsd(per * runs)} in total</p>}
                    </div>
                    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
                    <button type="button" disabled={!valid || busy} onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#d7ff00] text-sm font-semibold text-black transition-colors hover:bg-[#e4ff59] disabled:opacity-50">
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}{busy ? "Scheduling…" : repeat === "once" ? "Schedule video" : `Schedule ${runs} videos`}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {rows.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Your schedule</p>
                  <ul className="space-y-1.5">
                    {rows.slice(0, 8).map((r) => (
                      <li key={r.id} className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2">
                        {r.poster ? <img src={r.poster} alt="" className="size-10 shrink-0 rounded-md object-cover" /> : <span className="size-10 shrink-0 rounded-md bg-white/10" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{r.title}</p>
                          <p className="truncate text-[11px] text-zinc-500">{new Date(r.runAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.resolution}{r.repeat !== "once" ? ` · ${r.repeat}` : ""}{r.error ? ` · ${r.error}` : ""}{r.postStatus === "posted" ? " · posted to X" : r.postStatus === "failed" ? ` · X post failed${r.postError ? `: ${r.postError}` : ""}` : ""}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span>
                        {r.status === "scheduled" && <button type="button" aria-label={`Cancel ${r.title}`} onClick={() => void cancel(r.id)} className="grid size-6 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"><X className="size-3.5" /></button>}
                        {r.status === "completed" && r.resultUrl && <a href={r.resultUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-semibold text-[#d7ff00] underline">Open</a>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
    </>
  );
}
