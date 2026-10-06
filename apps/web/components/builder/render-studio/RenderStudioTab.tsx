"use client";

// Render Studio: an agentic motion-graphics editor. Chat on the left, a live
// deterministic preview in the middle (runs entirely in the browser, instant),
// code on demand, and server-side MP4 export. Two engines, one runtime:
// HTML + three.js/GSAP (HyperFrames style) and React (Remotion-compatible API).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Check, ChevronDown, Code2, Download, Film, Loader2, Maximize2, Pause, Play, Redo2, Repeat,
  Sparkles, Square, Undo2, Wand2, X, Zap, Copy, AlertTriangle, Clapperboard, Layers, Plus, Search, Images,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { ASPECTS, buildDocument, clampComposition, starterFor, type Asset, type AspectKey, type Composition, type Engine } from "@/lib/render-studio/compose";

type Model = "auto" | "opus" | "fast";
interface Msg { id: string; role: "user" | "assistant"; text: string; checks?: string[]; error?: boolean; undoTo?: number; clips?: Asset[]; via?: string }
interface Project { comp: Composition; stack: Composition[]; at: number; msgs: Msg[]; touched: boolean }
interface Export { id: string; url: string; title: string; engine: Engine; w: number; h: number; at: number; quality: string }
type Projects = Record<Engine, Project>;
interface Run { step: string; label: string; section: string; chars: number; started: number }

const uid = () => Math.random().toString(36).slice(2, 9);
const STEPS: Array<{ id: string; label: string }> = [
  { id: "write", label: "Write" }, { id: "check", label: "Test" }, { id: "review", label: "Review" }, { id: "repair", label: "Fix" },
];

const SUGGESTIONS: Record<Engine, string[]> = {
  html: [
    "Make a 10k views milestone teaser with a 3D constellation and my agent's avatar",
    "Create a product launch reveal with glowing gold particles and a countdown",
    "Add a bottom call-to-action bar saying Follow for daily drops",
    "Make the headline bigger and slide in from the left with a spring",
  ],
  react: [
    "Make a leaderboard rank-up video: #3 to #1 with animated bars",
    "Create a kinetic typography hook: 'Your agents never sleep'",
    "Add a stats strip that counts up views, clips and earnings",
    "Slow down the intro and add a soft glow behind the title",
  ],
};

const welcome = (engine: Engine): Msg[] => [{
  id: uid(), role: "assistant",
  text: engine === "html"
    ? "HTML engine ready: HTML, CSS, GSAP and three.js. I loaded a starter so you can hit play right now. Tell me what to change, or describe a brand new video."
    : "React engine ready: a Remotion-compatible API (useCurrentFrame, spring, interpolate, Sequence). Starter loaded. Describe what you want and I will write, test and fix it.",
}];

function newProjects(aspect: AspectKey): Projects {
  const mk = (e: Engine): Project => ({ comp: starterFor(e, aspect), stack: [starterFor(e, aspect)], at: 0, msgs: welcome(e), touched: false });
  return { html: mk("html"), react: mk("react") };
}

const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10))}`;

/* ───────────────────────────── preview ───────────────────────────── */

interface PreviewApi { seek: (t: number) => void }

const Preview = memo(function Preview({ comp, time, playing, apiRef, onError }: { comp: Composition; time: number; playing: boolean; apiRef: React.MutableRefObject<PreviewApi | null>; onError: (m: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  // Double-buffered iframes: the new composition loads hidden and swaps in once
  // ready, so edits never flash a blank frame.
  const [slots, setSlots] = useState<Array<{ id: number; doc: string; ready: boolean }>>([]);
  const idRef = useRef(0);
  const refs = useRef<Map<number, HTMLIFrameElement>>(new Map());
  const timeRef = useRef(time);
  useEffect(() => { timeRef.current = time; }, [time]);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
    for (const f of refs.current.values()) f.contentWindow?.postMessage({ type: "rs-play", on: playing }, "*");
  }, [playing]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const fit = () => setScale(Math.max(0.05, Math.min((el.clientWidth - 8) / comp.width, (el.clientHeight - 8) / comp.height)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [comp.width, comp.height]);

  const doc = useMemo(() => buildDocument(comp), [comp]);
  useEffect(() => {
    const id = ++idRef.current;
    const h = setTimeout(() => setSlots((s) => [...s.slice(-1), { id, doc, ready: false }]), 60);
    return () => clearTimeout(h);
  }, [doc]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; msg?: string } | null;
      if (!d || typeof d.type !== "string") return;
      const from = [...refs.current.entries()].find(([, f]) => f.contentWindow === e.source);
      if (!from) return;
      if (d.type === "rs-ready") {
        const [id, frame] = from;
        frame.contentWindow?.postMessage({ type: "rs-play", on: playingRef.current }, "*");
        frame.contentWindow?.postMessage({ type: "rs-seek", t: timeRef.current }, "*");
        setSlots((s) => { const i = s.findIndex((x) => x.id === id); return i < 0 ? s : s.slice(i).map((x) => (x.id === id ? { ...x, ready: true } : x)); });
      } else if (d.type === "rs-error" && d.msg) onError(d.msg);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onError]);

  useEffect(() => {
    apiRef.current = {
      seek: (t) => {
        const ready = [...slots].reverse().find((s) => s.ready);
        if (ready) refs.current.get(ready.id)?.contentWindow?.postMessage({ type: "rs-seek", t }, "*");
      },
    };
  }, [slots, apiRef]);

  const shown = [...slots].reverse().find((s) => s.ready)?.id;
  const pending = slots.length > 0 && !slots[slots.length - 1].ready;
  return (
    <div ref={wrap} className="relative flex h-full w-full items-center justify-center">
      <div className="relative overflow-hidden rounded-[10px] bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,.8),0_0_0_1px_rgba(255,255,255,.08)]" style={{ width: comp.width * scale, height: comp.height * scale }}>
        {slots.map((s) => (
          <iframe
            key={s.id}
            ref={(el) => { if (el) refs.current.set(s.id, el); else refs.current.delete(s.id); }}
            title="Composition preview"
            sandbox="allow-scripts"
            srcDoc={s.doc}
            tabIndex={-1}
            className="absolute left-0 top-0 border-0 bg-black"
            style={{ width: comp.width, height: comp.height, transform: `scale(${scale})`, transformOrigin: "0 0", opacity: s.id === shown ? 1 : 0, pointerEvents: "none", transition: "opacity .18s" }}
          />
        ))}
        {!shown && <div className="absolute inset-0 grid place-items-center"><Loader2 className="size-5 animate-spin text-white/40" /></div>}
        {shown && pending && <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur"><Loader2 className="size-3 animate-spin" />Updating</div>}
      </div>
    </div>
  );
});

const ClipCard = memo(function ClipCard({ a, on, onToggle, compact }: { a: Asset; on: boolean; onToggle: () => void; compact?: boolean }) {
  const [hover, setHover] = useState(false);
  const vref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = vref.current; if (!v) return; if (hover) void v.play().catch(() => {}); else { v.pause(); v.currentTime = 0.1; } }, [hover]);
  return (
    <button onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={a.title}
      className={`group relative overflow-hidden rounded-lg border text-left transition ${on ? "border-lime-400 ring-1 ring-lime-400/50" : "border-white/10 hover:border-white/30"}`}>
      <div className={`relative w-full bg-black ${compact ? "aspect-[9/12]" : "aspect-[3/4]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.thumb ? <img src={a.thumb} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        <video ref={vref} src={`${a.url}#t=0.1`} muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
        <span className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full ${on ? "bg-lime-400 text-black" : "bg-black/60 text-white/80"}`}>{on ? <Check className="size-3" /> : <Plus className="size-3" />}</span>
        {a.duration ? <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1 text-[9.5px] tabular-nums text-white/80">{Math.round(a.duration)}s</span> : null}
      </div>
      {!compact && <div className="truncate px-1.5 py-1 text-[10.5px] text-white/60">{a.title}</div>}
    </button>
  );
});

/* ───────────────────────────── main ───────────────────────────── */

export default function RenderStudioTab({ mintAddress, agentName, avatarUrl }: { mintAddress?: string; agentName?: string; avatarUrl?: string }) {
  const storeKey = `vello.renderstudio.${mintAddress || "draft"}`;
  const [aspect, setAspect] = useState<AspectKey>("9:16");
  const [engine, setEngine] = useState<Engine>("html");
  const [model, setModel] = useState<Model>("auto");
  const [projects, setProjects] = useState<Projects>(() => newProjects("9:16"));
  const [exports, setExports] = useState<Export[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [input, setInput] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [codeTab, setCodeTab] = useState<"html" | "css" | "js">("js");
  const [exportOpen, setExportOpen] = useState(false);
  const [job, setJob] = useState<{ done: number; total: number; started: number; quality: string; err?: string } | null>(null);
  const [viewing, setViewing] = useState<Export | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [attached, setAttached] = useState<Asset[]>([]);
  const [clipsOpen, setClipsOpen] = useState(false);
  const [clipTab, setClipTab] = useState<"mine" | "stock">("mine");
  const [stockQ, setStockQ] = useState("");
  const [stock, setStock] = useState<{ assets: Asset[]; loading: boolean; err?: string; providers?: string[] }>({ assets: [], loading: false });

  // Library: the agent's rendered clips and downloaded sources.
  const myClips = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") as Doc<"clips">[] | undefined;
  const myDownloads = useQuery(api.downloadCache.listByMint, mintAddress ? { mintAddress } : "skip") as Doc<"downloadCache">[] | undefined;
  const mine = useMemo<Asset[]>(() => {
    const clips = [...(myClips ?? [])].filter((c) => c.clipUrl && /^https:/.test(c.clipUrl)).sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0)).slice(0, 40)
      .map((c): Asset => ({ id: `c${String(c._id).slice(-6)}`, kind: "video", url: c.clipUrl as string, title: c.title || "Clip", duration: Math.max(1, (c.endSeconds ?? 0) - (c.startSeconds ?? 0)) || undefined, source: "mine" }));
    const dls = (myDownloads ?? []).filter((d) => d.mode !== "audio" && /^https:/.test(d.url)).slice(0, 20)
      .map((d): Asset => ({ id: `d${String(d._id).slice(-6)}`, kind: "video", url: d.url, title: d.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48), duration: d.durationSeconds, source: "mine" }));
    return [...clips, ...dls];
  }, [myClips, myDownloads]);

  const apiRef = useRef<PreviewApi | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const proj = projects[engine];
  const comp = proj.comp;

  // Hydrate / persist (best-effort: storage can be unavailable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const j = JSON.parse(raw) as { projects?: Projects; exports?: Export[]; engine?: Engine; aspect?: AspectKey; model?: Model; attached?: Asset[] };
        if (j.projects?.html && j.projects?.react) setProjects(j.projects);
        if (j.exports) setExports(j.exports);
        if (j.engine) setEngine(j.engine);
        if (j.aspect && ASPECTS[j.aspect]) setAspect(j.aspect);
        if (j.model) setModel(j.model);
        if (j.attached) setAttached(j.attached);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, [storeKey]);
  useEffect(() => {
    if (!hydrated) return;
    const h = setTimeout(() => {
      try {
        const slim: Projects = { html: { ...projects.html, stack: projects.html.stack.slice(-12), at: Math.min(projects.html.at, 11), msgs: projects.html.msgs.slice(-30) }, react: { ...projects.react, stack: projects.react.stack.slice(-12), at: Math.min(projects.react.at, 11), msgs: projects.react.msgs.slice(-30) } };
        slim.html.at = slim.html.stack.length - 1 - (projects.html.stack.length - 1 - projects.html.at);
        slim.react.at = slim.react.stack.length - 1 - (projects.react.stack.length - 1 - projects.react.at);
        localStorage.setItem(storeKey, JSON.stringify({ projects: slim, exports: exports.slice(0, 30), engine, aspect, model, attached }));
      } catch { /* quota / disabled */ }
    }, 400);
    return () => clearTimeout(h);
  }, [projects, exports, engine, aspect, model, attached, hydrated, storeKey]);

  /* ── transport ── */
  const tRef = useRef(0);
  const compRef = useRef(comp);
  useEffect(() => { compRef.current = comp; }, [comp]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      let n = tRef.current + dt; const d = compRef.current.duration;
      if (n >= d) { if (loop) n = n % d; else { n = d; setPlaying(false); } }
      tRef.current = n; setT(n); apiRef.current?.seek(n);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop]);
  const seek = useCallback((n: number) => { tRef.current = n; setT(n); apiRef.current?.seek(n); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      if (e.code === "ArrowRight") seek(Math.min(compRef.current.duration, tRef.current + 1 / compRef.current.fps));
      if (e.code === "ArrowLeft") seek(Math.max(0, tRef.current - 1 / compRef.current.fps));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [proj.msgs.length, run?.step, run?.section]);

  /* ── project mutations ── */
  const patchProject = useCallback((e: Engine, fn: (p: Project) => Project) => setProjects((ps) => ({ ...ps, [e]: fn(ps[e]) })), []);
  const commit = useCallback((e: Engine, next: Composition, replaceTop = false) => patchProject(e, (p) => {
    const stack = (replaceTop ? p.stack.slice(0, p.at) : p.stack.slice(0, p.at + 1)).concat(next).slice(-40);
    return { ...p, comp: next, stack, at: stack.length - 1, touched: true };
  }), [patchProject]);
  const undo = () => patchProject(engine, (p) => (p.at > 0 ? { ...p, at: p.at - 1, comp: p.stack[p.at - 1] } : p));
  const redo = () => patchProject(engine, (p) => (p.at < p.stack.length - 1 ? { ...p, at: p.at + 1, comp: p.stack[p.at + 1] } : p));
  const addMsg = useCallback((e: Engine, m: Omit<Msg, "id">) => patchProject(e, (p) => ({ ...p, msgs: [...p.msgs, { ...m, id: uid() }] })), [patchProject]);

  const switchAspect = (a: AspectKey) => {
    if (a === aspect) return;
    setAspect(a);
    const dims = ASPECTS[a];
    setProjects((ps) => {
      const out = { ...ps };
      (["html", "react"] as Engine[]).forEach((e) => {
        const p = ps[e];
        const next = p.touched ? clampComposition({ ...p.comp, width: dims.width, height: dims.height }) : starterFor(e, a);
        out[e] = { ...p, comp: next, stack: p.touched ? [...p.stack.slice(0, p.at + 1), next] : [next], at: p.touched ? p.at + 1 : 0 };
      });
      return out;
    });
    if (proj.touched) addMsg(engine, { role: "assistant", text: `Canvas is now ${ASPECTS[a].label}. The layout was written for the old shape, so ask me to adapt it.` });
  };

  /* ── clips ── */
  const toggleAttach = useCallback((a: Asset) => setAttached((cur) => (cur.some((x) => x.url === a.url) ? cur.filter((x) => x.url !== a.url) : [...cur, a].slice(0, 8))), []);
  const searchStock = useCallback(async (q: string) => {
    const query = q.trim(); if (query.length < 2) return;
    setStock((s) => ({ ...s, loading: true, err: undefined }));
    try {
      const d = ASPECTS[aspect];
      const res = await fetch(`/api/render-studio/clips?${new URLSearchParams({ q: query, w: String(d.width), h: String(d.height) })}`);
      const j = (await res.json().catch(() => ({}))) as { assets?: Asset[]; providers?: string[]; error?: string };
      if (!res.ok) throw new Error(j.error || `Search failed (${res.status})`);
      setStock({ assets: j.assets ?? [], loading: false, providers: j.providers, err: j.assets?.length ? undefined : "No footage found. Try simpler words like \"racing car track\"." });
    } catch (e) { setStock({ assets: [], loading: false, err: (e as Error).message }); }
  }, [aspect]);

  /* ── agent ── */
  const send = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt || run) return;
    const e = engine;
    const p0 = projects[e];
    setInput("");
    addMsg(e, { role: "user", text: prompt });
    const ctl = new AbortController(); abortRef.current = ctl;
    setRun({ step: "write", label: p0.touched ? "Editing your video" : "Writing your video", section: "thinking", chars: 0, started: Date.now() });
    const history = [...p0.msgs, { role: "user" as const, text: prompt }].filter((m) => m.role === "user" || !m.error).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    const before = p0.at;
    try {
      const res = await fetch("/api/render-studio/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ mintAddress, prompt, engine: e, model, comp: p0.comp, touched: p0.touched, attached, aspect: ASPECTS[aspect], history, agent: { agentName, avatarUrl }, review: true }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ""; let finished = false;
      let first = true;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { type: string; [k: string]: unknown };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "status") setRun((r) => r && { ...r, step: String(ev.step), label: String(ev.text) });
          else if (ev.type === "progress") setRun((r) => r && { ...r, section: String(ev.section), chars: Number(ev.chars) });
          else if (ev.type === "clips") addMsg(e, { role: "assistant", text: `Found ${(ev.assets as Asset[]).length} clips online (${(ev.queries as string[]).join(", ")}). Tap any to attach it.`, clips: ev.assets as Asset[] });
          else if (ev.type === "comp") { commit(e, clampComposition(ev.comp as Composition), !first); first = false; setPreviewErr(null); if (!playing) setPlaying(true); }
          else if (ev.type === "done" && ev.changed === false) {
            finished = true;
            addMsg(e, { role: "assistant", text: String(ev.summary || "Done."), checks: (ev.checks as string[]) ?? [], via: String(ev.model || "") });
          } else if (ev.type === "done") {
            finished = true;
            const c = clampComposition(ev.comp as Composition);
            patchProject(e, (p) => {
              const stack = p.stack.slice(0, p.at).concat(c);
              return { ...p, comp: c, stack: first ? p.stack.slice(0, before + 1).concat(c) : stack, at: first ? before + 1 : p.at, touched: true };
            });
            addMsg(e, { role: "assistant", text: String(ev.summary || "Done."), checks: (ev.checks as string[]) ?? [], undoTo: before, via: String(ev.model || "") });
          } else if (ev.type === "error") throw new Error(String(ev.message));
        }
      }
      if (!finished) throw new Error("The connection dropped before the agent finished. Your previous version is intact.");
    } catch (err) {
      if ((err as Error).name === "AbortError") addMsg(e, { role: "assistant", text: "Stopped. Your previous version is still there." });
      else addMsg(e, { role: "assistant", text: (err as Error).message || "Something went wrong.", error: true });
    } finally { setRun(null); abortRef.current = null; }
  }, [addMsg, agentName, aspect, attached, avatarUrl, commit, engine, model, patchProject, playing, projects, run]);

  /* ── export ── */
  const doExport = async (quality: "draft" | "final") => {
    setExportOpen(false);
    if (job && !job.err && job.done < job.total) return;
    const total = Math.round(comp.duration * comp.fps);
    setJob({ done: 0, total, started: Date.now(), quality });
    try {
      const res = await fetch("/api/render-studio/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mintAddress, comp, quality }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Render failed (${res.status})`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; done?: number; total?: number; url?: string; message?: string; width?: number; height?: number };
          if (ev.type === "progress") setJob((j) => j && { ...j, done: ev.done ?? j.done, total: ev.total ?? j.total });
          else if (ev.type === "error") throw new Error(ev.message);
          else if (ev.type === "done" && ev.url) {
            const x: Export = { id: uid(), url: ev.url, title: comp.title, engine, w: ev.width ?? comp.width, h: ev.height ?? comp.height, at: Date.now(), quality };
            setExports((l) => [x, ...l]); setViewing(x); setJob(null);
            return;
          }
        }
      }
      throw new Error("Render ended without a file");
    } catch (e) { setJob((j) => j && { ...j, err: (e as Error).message }); }
  };

  const stageErrors = previewErr;
  const eta = job && job.done > 4 ? Math.max(0, Math.round(((Date.now() - job.started) / job.done) * (job.total - job.done) / 1000)) : null;
  const running = !!run;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0d] text-white">
      {/* top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="mr-1 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-lime-400/30 bg-gradient-to-b from-lime-400/20 to-lime-400/5"><Clapperboard className="size-4 text-lime-300" /></span>
          <div className="leading-tight"><div className="text-[13px] font-semibold">Render Studio</div><div className="text-[10.5px] text-white/40">{comp.title} · {comp.width}×{comp.height} · {comp.fps}fps · {comp.duration}s</div></div>
        </div>

        <div className="ml-2 flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" role="tablist" aria-label="Engine">
          {([["html", "HTML · three.js", "HyperFrames-style"], ["react", "React · Remotion", "Remotion-compatible API"]] as const).map(([id, label, tip]) => (
            <button key={id} role="tab" aria-selected={engine === id} title={tip} disabled={running} onClick={() => { setEngine(id); seek(0); }}
              className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition ${engine === id ? "bg-white text-black" : "text-white/55 hover:text-white"} disabled:opacity-50`}>{label}</button>
          ))}
        </div>

        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" aria-label="Aspect ratio">
          {(Object.keys(ASPECTS) as AspectKey[]).map((a) => (
            <button key={a} onClick={() => switchAspect(a)} disabled={running} className={`rounded-md px-2 py-1 text-[12px] font-medium transition ${aspect === a ? "bg-white/15 text-white" : "text-white/45 hover:text-white"}`}>{a}</button>
          ))}
        </div>

        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5" aria-label="Model">
          {([["auto", "Auto", Wand2, "Cheap model for small tweaks, Opus for creative work"], ["opus", "Opus", Sparkles, "Always Opus (best, slower)"], ["fast", "Fast", Zap, "Always the fast model"]] as const).map(([id, label, Ic, tip]) => (
            <button key={id} onClick={() => setModel(id)} title={tip} className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium ${model === id ? (id === "fast" ? "bg-white/15 text-white" : "bg-lime-400 text-black") : "text-white/50 hover:text-white"}`}><Ic className="size-3" />{label}</button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={undo} disabled={proj.at <= 0 || running} title="Undo" className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/70 transition hover:bg-white/10 disabled:opacity-30"><Undo2 className="size-3.5" /></button>
          <button onClick={redo} disabled={proj.at >= proj.stack.length - 1 || running} title="Redo" className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/70 transition hover:bg-white/10 disabled:opacity-30"><Redo2 className="size-3.5" /></button>
          <button onClick={() => setClipsOpen((o) => !o)} className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition ${clipsOpen ? "border-lime-400/40 bg-lime-400/10 text-lime-300" : "border-white/10 text-white/70 hover:bg-white/10"}`}><Images className="size-3.5" />Clips{attached.length > 0 && <span className="rounded-full bg-lime-400 px-1.5 text-[10px] font-bold text-black">{attached.length}</span>}</button>
          <button onClick={() => setShowCode((s) => !s)} className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition ${showCode ? "border-lime-400/40 bg-lime-400/10 text-lime-300" : "border-white/10 text-white/70 hover:bg-white/10"}`}><Code2 className="size-3.5" />Code</button>
          <div className="relative">
            <button onClick={() => setExportOpen((o) => !o)} disabled={running || (!!job && !job.err)} className="flex h-8 items-center gap-1.5 rounded-lg bg-lime-400 px-3 text-[12px] font-bold text-black transition hover:bg-lime-300 disabled:opacity-50"><Film className="size-3.5" />Export MP4<ChevronDown className="size-3" /></button>
            {exportOpen && (
              <div className="absolute right-0 top-10 z-30 w-56 overflow-hidden rounded-xl border border-white/15 bg-[#141416] p-1 shadow-2xl">
                <button onClick={() => doExport("draft")} className="flex w-full items-start gap-2 rounded-lg p-2.5 text-left hover:bg-white/10"><Zap className="mt-0.5 size-3.5 text-lime-300" /><span><span className="block text-[12.5px] font-semibold">Quick draft</span><span className="text-[11px] text-white/45">Half size, fastest to check</span></span></button>
                <button onClick={() => doExport("final")} className="flex w-full items-start gap-2 rounded-lg p-2.5 text-left hover:bg-white/10"><Sparkles className="mt-0.5 size-3.5 text-lime-300" /><span><span className="block text-[12.5px] font-semibold">Final {comp.width}×{comp.height}</span><span className="text-[11px] text-white/45">Full quality H.264</span></span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* chat */}
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-white/10 max-lg:w-[300px]">
          <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {proj.msgs.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
                {m.role === "assistant" && <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lime-400/15 text-lime-300"><Wand2 className="size-3" /></span>}
                <div className={`max-w-[88%] text-[13px] leading-relaxed ${m.role === "user" ? "rounded-2xl rounded-br-md bg-white/10 px-3 py-2" : m.error ? "text-red-300" : "text-white/80"}`}>
                  {m.error && <AlertTriangle className="mr-1 inline size-3.5" />}{m.text}
                  {m.checks && m.checks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">{m.checks.map((c, i) => <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${/^(Unresolved|.*skipped)/.test(c) ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-lime-400/25 bg-lime-400/10 text-lime-200"}`}>{/^(Unresolved|.*skipped)/.test(c) ? <AlertTriangle className="size-2.5" /> : <Check className="size-2.5" />}{c}</span>)}</div>
                  )}
                  {m.clips && m.clips.length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {m.clips.map((c) => <ClipCard key={c.url} a={c} on={attached.some((x) => x.url === c.url)} onToggle={() => toggleAttach(c)} compact />)}
                    </div>
                  )}
                  {m.via && m.role === "assistant" && <div className="mt-1.5 text-[10px] uppercase tracking-wider text-white/25">{m.via.startsWith("claude") ? "Opus" : m.via === "fast" ? "Fast model" : m.via}</div>}
                  {m.undoTo !== undefined && proj.at > m.undoTo && (
                    <button onClick={() => patchProject(engine, (p) => ({ ...p, at: m.undoTo!, comp: p.stack[m.undoTo!] }))} className="mt-2 flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white"><Undo2 className="size-3" />Undo this change</button>
                  )}
                </div>
              </div>
            ))}

            {run && (
              <div className="rounded-xl border border-lime-400/20 bg-gradient-to-b from-lime-400/[0.07] to-transparent p-3">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold text-lime-200"><Loader2 className="size-3.5 animate-spin" />{run.label}</div>
                <div className="mt-2.5 flex items-center gap-1">
                  {STEPS.map((s, i) => {
                    const idx = STEPS.findIndex((x) => x.id === run.step);
                    const state = i < idx ? "done" : i === idx ? "on" : "off";
                    return <div key={s.id} className="flex flex-1 flex-col gap-1"><div className={`h-1 rounded-full transition-all ${state === "done" ? "bg-lime-400" : state === "on" ? "animate-pulse bg-lime-300" : "bg-white/10"}`} /><span className={`text-[9.5px] uppercase tracking-wider ${state === "off" ? "text-white/25" : "text-lime-200/80"}`}>{s.label}</span></div>;
                  })}
                </div>
                {run.step === "write" && <div className="mt-2 font-mono text-[11px] text-white/40">{run.section} · {run.chars.toLocaleString()} chars</div>}
              </div>
            )}

            {!run && !proj.touched && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-widest text-white/30">Try</div>
                {SUGGESTIONS[engine].map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[12.5px] text-white/70 transition hover:border-lime-400/30 hover:bg-lime-400/[0.06] hover:text-white">{s}</button>
                ))}
              </div>
            )}
            {!run && proj.touched && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(engine === "html" ? ["Make it more cinematic", "Add a subtle film grain", "Speed up the intro", "Add an outro CTA"] : ["Make it punchier", "Add a glow behind the title", "Speed up the intro", "Add an outro CTA"]).map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11.5px] text-white/55 transition hover:border-lime-400/30 hover:text-white">{s}</button>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 p-3">
            {attached.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attached.map((a) => (
                  <span key={a.url} className="inline-flex max-w-[150px] items-center gap-1 rounded-full border border-lime-400/25 bg-lime-400/10 py-0.5 pl-2 pr-1 text-[10.5px] text-lime-100"><Film className="size-2.5 shrink-0" /><span className="truncate">{a.title}</span><button onClick={() => toggleAttach(a)} aria-label="Remove" className="grid size-4 place-items-center rounded-full hover:bg-white/15"><X className="size-2.5" /></button></span>
                ))}
                <button onClick={() => void send(`Use my attached clips (${attached.map((a) => a.id).join(", ")}) as the main footage: cut them to the beat, add titles, and keep it premium.`)} disabled={running} className="rounded-full border border-white/15 px-2 py-0.5 text-[10.5px] text-white/60 hover:text-white disabled:opacity-40">Use them in the video</button>
              </div>
            )}
            <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-2 transition focus-within:border-lime-400/50">
              <textarea
                ref={taRef} value={input} rows={2} disabled={running}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder={proj.touched ? "Tell the agent what to change..." : "Describe the video you want..."}
                className="block max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-[13px] text-white outline-none placeholder:text-white/30"
              />
              <div className="flex items-center justify-between pt-1">
                <span className="px-1.5 text-[10.5px] text-white/30">Enter to send · Shift+Enter for a new line</span>
                {running ? (
                  <button onClick={() => abortRef.current?.abort()} className="flex h-7 items-center gap-1 rounded-lg bg-white/15 px-2.5 text-[12px] font-semibold hover:bg-white/25"><Square className="size-3 fill-current" />Stop</button>
                ) : (
                  <button onClick={() => void send(input)} disabled={!input.trim()} className="grid size-7 place-items-center rounded-lg bg-lime-400 text-black transition hover:bg-lime-300 disabled:bg-white/10 disabled:text-white/30"><ArrowUp className="size-4" strokeWidth={2.5} /></button>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* stage */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-[radial-gradient(60%_50%_at_50%_40%,#17181c,#0b0b0d)] p-4">
            <Preview comp={comp} time={t} playing={playing} apiRef={apiRef} onError={setPreviewErr} />
            {running && <div className="pointer-events-none absolute inset-x-0 top-0 h-px animate-pulse bg-gradient-to-r from-transparent via-lime-400 to-transparent" />}
            {stageErrors && (
              <button onClick={() => { setPreviewErr(null); void send(`The preview shows this error, please fix it: ${stageErrors}`); }} className="absolute bottom-4 left-1/2 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full border border-red-400/30 bg-red-950/80 px-3 py-1.5 text-[12px] text-red-200 backdrop-blur">
                <AlertTriangle className="size-3.5 shrink-0" /><span className="truncate">{stageErrors}</span><span className="shrink-0 font-semibold text-white">Ask agent to fix</span>
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-4 py-2.5">
            <button onClick={() => { if (!playing && t >= comp.duration - 0.02) seek(0); setPlaying((p) => !p); }} className="grid size-8 place-items-center rounded-full bg-white text-black transition hover:scale-105" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
            </button>
            <span className="w-[112px] shrink-0 whitespace-nowrap font-mono text-[11.5px] tabular-nums text-white/60">{fmtT(t)} / {fmtT(comp.duration)}</span>
            <input type="range" min={0} max={comp.duration} step={1 / comp.fps} value={t} onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }} aria-label="Timeline" className="h-1 min-w-0 flex-1 cursor-pointer accent-lime-400" />
            <button onClick={() => setLoop((l) => !l)} title="Loop" className={`grid size-8 place-items-center rounded-lg border transition ${loop ? "border-lime-400/40 bg-lime-400/10 text-lime-300" : "border-white/10 text-white/50 hover:text-white"}`}><Repeat className="size-3.5" /></button>
          </div>
        </section>

        {/* clips */}
        {clipsOpen && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-white/10 max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-20 max-xl:bg-[#0b0b0d]">
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-2">
              {([["mine", "My videos"], ["stock", "Stock footage"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setClipTab(id)} className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${clipTab === id ? "bg-white/15 text-white" : "text-white/45 hover:text-white"}`}>{label}</button>
              ))}
              <button onClick={() => setClipsOpen(false)} className="ml-auto grid size-7 place-items-center rounded-md text-white/50 hover:bg-white/10" aria-label="Close"><X className="size-3.5" /></button>
            </div>
            {clipTab === "stock" && (
              <form onSubmit={(e) => { e.preventDefault(); void searchStock(stockQ); }} className="flex shrink-0 gap-2 border-b border-white/10 p-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-2.5"><Search className="size-3.5 shrink-0 text-white/40" /><input value={stockQ} onChange={(e) => setStockQ(e.target.value)} placeholder="racing car track, city night..." className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-white/30" /></div>
                <button type="submit" disabled={stock.loading} className="rounded-lg bg-lime-400 px-3 text-[12px] font-bold text-black disabled:opacity-50">{stock.loading ? <Loader2 className="size-3.5 animate-spin" /> : "Find"}</button>
              </form>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {clipTab === "mine" ? (
                mine.length ? <div className="grid grid-cols-2 gap-2">{mine.map((c) => <ClipCard key={c.url} a={c} on={attached.some((x) => x.url === c.url)} onToggle={() => toggleAttach(c)} />)}</div>
                  : <div className="grid place-items-center gap-2 px-4 py-14 text-center text-[12.5px] text-white/40"><Images className="size-6 text-white/25" />Your rendered clips and downloaded videos will show up here. Download a video in the Clipping tab, or use Stock footage.</div>
              ) : stock.assets.length ? <div className="grid grid-cols-2 gap-2">{stock.assets.map((c) => <ClipCard key={c.url} a={c} on={attached.some((x) => x.url === c.url)} onToggle={() => toggleAttach(c)} />)}</div>
                : <div className="px-4 py-14 text-center text-[12.5px] text-white/40">{stock.err ?? "Search free stock footage (Pexels, Pixabay, Wikimedia). You can also just ask the agent, it searches for you."}</div>}
            </div>
            {attached.length > 0 && <div className="shrink-0 border-t border-white/10 p-3"><button onClick={() => { setClipsOpen(false); void send(`Use my attached clips (${attached.map((a) => a.id).join(", ")}) as the main footage: cut them to the beat, add titles, and keep it premium.`); }} disabled={running} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-lime-400 text-[12.5px] font-bold text-black hover:bg-lime-300 disabled:opacity-50"><Wand2 className="size-3.5" />Edit {attached.length} clip{attached.length > 1 ? "s" : ""} with the agent</button></div>}
          </aside>
        )}

        {/* code */}
        {showCode && (
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10 max-xl:hidden">
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-2">
              {(["js", "css", "html"] as const).filter((k) => !(engine === "react" && k === "html")).map((k) => (
                <button key={k} onClick={() => setCodeTab(k)} className={`rounded-md px-2 py-1 text-[11.5px] font-semibold uppercase ${codeTab === k ? "bg-white/15 text-white" : "text-white/45 hover:text-white"}`}>{engine === "react" && k === "js" ? "JSX" : k}</button>
              ))}
              <button onClick={() => { void navigator.clipboard?.writeText(comp[codeTab]); }} className="ml-auto grid size-7 place-items-center rounded-md text-white/50 hover:bg-white/10 hover:text-white" title="Copy"><Copy className="size-3.5" /></button>
            </div>
            <textarea
              spellCheck={false} value={comp[codeTab === "html" && engine === "react" ? "js" : codeTab]}
              onChange={(e) => { const k = codeTab === "html" && engine === "react" ? "js" : codeTab; const next = { ...comp, [k]: e.target.value }; patchProject(engine, (p) => ({ ...p, comp: next, touched: true })); }}
              onBlur={() => patchProject(engine, (p) => (p.stack[p.at] === p.comp ? p : { ...p, stack: [...p.stack.slice(0, p.at + 1), p.comp].slice(-40), at: Math.min(p.at + 1, 39) }))}
              className="min-h-0 flex-1 resize-none bg-[#08080a] p-3 font-mono text-[11.5px] leading-[1.55] text-white/80 outline-none"
            />
          </aside>
        )}
      </div>

      {/* exports strip */}
      {exports.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-2">
          <Layers className="size-3.5 shrink-0 text-white/35" />
          {exports.slice(0, 12).map((x) => (
            <button key={x.id} onClick={() => setViewing(x)} className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left transition hover:border-lime-400/30">
              <Film className="size-3.5 text-lime-300" /><span className="max-w-[140px] truncate text-[11.5px] text-white/75">{x.title}</span><span className="text-[10px] text-white/35">{x.quality} · {x.w}×{x.h}</span>
            </button>
          ))}
        </div>
      )}

      {/* export progress */}
      {job && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[340px] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#141416]/95 p-3.5 shadow-2xl backdrop-blur">
          {job.err ? (
            <div className="flex items-start gap-2 text-[12.5px] text-red-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{job.err}</span><button onClick={() => setJob(null)} aria-label="Dismiss"><X className="size-4" /></button></div>
          ) : (
            <>
              <div className="flex items-center justify-between text-[12.5px] font-semibold"><span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin text-lime-300" />Rendering {job.quality === "draft" ? "draft" : "final"} MP4</span><span className="font-mono text-white/60">{Math.round((job.done / Math.max(1, job.total)) * 100)}%</span></div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-300 transition-all" style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} /></div>
              <div className="mt-1.5 text-[11px] text-white/40">Frame {job.done} of {job.total}{eta !== null ? ` · about ${eta}s left` : ""}</div>
            </>
          )}
        </div>
      )}

      {/* viewer */}
      {viewing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm" onClick={() => setViewing(null)}>
          <div className="flex max-h-full w-full max-w-[420px] flex-col gap-3 rounded-2xl border border-white/15 bg-[#101012] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-1"><span className="truncate text-[13px] font-semibold">{viewing.title}</span><button onClick={() => setViewing(null)} aria-label="Close"><X className="size-4 text-white/60" /></button></div>
            <video src={viewing.url} controls autoPlay loop playsInline className="max-h-[68vh] w-full rounded-xl bg-black" />
            <div className="flex gap-2">
              <a href={viewing.url} download target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-lime-400 py-2 text-[12.5px] font-bold text-black hover:bg-lime-300"><Download className="size-3.5" />Download</a>
              <button onClick={() => void navigator.clipboard?.writeText(viewing.url)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-[12.5px] font-semibold hover:bg-white/10"><Copy className="size-3.5" />Copy link</button>
              <a href={viewing.url} target="_blank" rel="noreferrer" className="grid w-10 place-items-center rounded-lg border border-white/15 hover:bg-white/10" aria-label="Open"><Maximize2 className="size-3.5" /></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
