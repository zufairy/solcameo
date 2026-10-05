"use client";

import { useCallback, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Clapperboard, Link as LinkIcon, Loader2, RotateCcw, Download, ChevronRight, Sparkles, Film, Mic, Clock,
} from "lucide-react";
import { AppHeaderShell } from "@/components/home/app-shell";

/* ── /documentary — story videos from internet stock media ─────────────────
   Same design language as the Photo Carousel app: dark glass, thin title,
   one prompt box. LOW-RESOURCE by design — no AI image/video generation;
   visuals come from the open stock catalog (+ the product page's own photos),
   narration from ElevenLabs, music from the free audio catalog. */

const BG = "#08080a";
const INTER = { fontFamily: "var(--font-inter)" } as const;
const CARD = "w-full max-w-[560px] rounded-2xl border border-white/10 bg-white/[0.035] p-6";
const PILL = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white";
const PRIMARY_BTN = "inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-neutral-900 transition-colors hover:bg-white/90 disabled:opacity-50";

// Mirrors lib/server/elevenTts.ts NARRATOR_VOICES / documentaryMusic MUSIC_MOODS
// (client copy — ids validated server-side, so drift degrades to the default).
const VOICES = [
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel · deep documentary" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah · warm storyteller" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George · classic narrator" },
  { id: "XB0fDUnXU5powFXDhCwa", label: "Charlotte · calm, intimate" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam · energetic voiceover" },
];
const MOODS = [
  { id: "cinematic", label: "Cinematic" },
  { id: "calm", label: "Calm & Warm" },
  { id: "uplifting", label: "Uplifting" },
  { id: "mystery", label: "Mystery" },
  { id: "none", label: "No music" },
];
// Mirrors app/api/documentary/generate/route.ts ALLOWED_DURATIONS.
const DURATIONS = [
  { sec: 30, label: "30s" },
  { sec: 60, label: "60s" },
  { sec: 90, label: "90s" },
  { sec: 120, label: "2min" },
];

type Project = {
  _id: Id<"documentaryProjects">;
  prompt: string;
  title?: string;
  script?: string;
  videoUrl?: string;
  statusMessage: string;
  status: "generating" | "ready" | "failed";
  error?: string;
  _creationTime: number;
};

function Select({ label, icon, value, onChange, options }: {
  label: string; icon: React.ReactNode; value: string; onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="relative flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
      <span className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-white/40">{icon}{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-transparent pt-0.5 text-[13px] font-medium text-white/85 outline-none [&>option]:bg-neutral-900">
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ChevronRight className="pointer-events-none absolute right-3 top-1/2 size-3.5 rotate-90 text-white/30" />
    </div>
  );
}

export function DocumentaryApp() {
  const { user, authenticated, login } = usePrivy();
  const ownerId = user?.id;

  const [prompt, setPrompt] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [musicMood, setMusicMood] = useState(MOODS[0].id);
  const [durationIdx, setDurationIdx] = useState(1); // default 60s
  const durationSec = DURATIONS[durationIdx].sec;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [projectId, setProjectId] = useState<Id<"documentaryProjects"> | null>(null);

  const project = useQuery(api.documentaryProjects.get, projectId ? { id: projectId } : "skip") as Project | null | undefined;
  const history = useQuery(api.documentaryProjects.listByOwner, ownerId ? { ownerId } : "skip") as Project[] | undefined;

  const generate = useCallback(async () => {
    if (!prompt.trim() || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/documentary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), productUrl: productUrl.trim() || undefined, voiceId, musicMood, durationSec }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; projectId?: string; error?: string };
      if (!res.ok || !j.ok || !j.projectId) { setError(j.error ?? `Failed (HTTP ${res.status})`); return; }
      setProjectId(j.projectId as Id<"documentaryProjects">);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setStarting(false);
    }
  }, [prompt, productUrl, voiceId, musicMood, durationSec, starting]);

  const reset = useCallback(() => { setProjectId(null); setError(null); }, []);
  const readyHistory = useMemo(() => (history ?? []).filter((p) => p.status === "ready" && p.videoUrl), [history]);

  if (!authenticated) {
    return (
      <AppHeaderShell>
        <div className="grid min-h-full place-items-center px-8 py-10" style={{ background: BG, ...INTER }}>
          <div className={`${CARD} text-center`}>
            <h2 className="text-[26px] font-thin tracking-tight text-white">Documentary</h2>
            <p className="mt-1.5 text-[13.5px] text-white/40">Sign in to turn an idea into a narrated story video.</p>
            <button type="button" onClick={login} className={`${PRIMARY_BTN} mt-4`}>Sign in</button>
          </div>
        </div>
      </AppHeaderShell>
    );
  }

  return (
    <AppHeaderShell>
    <div className="min-h-full px-8 py-10" style={{ background: BG, ...INTER }}>
      <div className="mx-auto max-w-[760px]">
        <div className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-2.5 text-[26px] font-thin tracking-tight text-white">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
              <Clapperboard className="size-4.5 text-white/80" strokeWidth={1.75} />
            </span>
            Documentary
          </h1>
          {projectId && (
            <button type="button" onClick={reset} className={PILL}><RotateCcw className="size-3.5" /> New story</button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-white/40">
          Real internet photos + an ElevenLabs narrator turn your idea (or product link) into a mini documentary — no AI footage, very light on credits.
        </p>

        {/* ── Composer ── */}
        {!projectId && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Tell the story you want: 'the rise of specialty coffee in Malaysia', 'why my handmade candle brand exists'…"
              className="w-full resize-none bg-transparent text-[14.5px] leading-relaxed text-white outline-none placeholder:text-white/30"
            />
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
              <LinkIcon className="size-4 shrink-0 text-white/30" />
              <input
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="Product link (optional, the story gets built around it, using its real photos)"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
              <Select label="Narrator" icon={<Mic className="size-3" />} value={voiceId} onChange={setVoiceId} options={VOICES} />
              <Select label="Soundtrack" icon={<Film className="size-3" />} value={musicMood} onChange={setMusicMood} options={MOODS} />
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-white/40">
                  <Clock className="size-3" /> Length
                </span>
                <span className="text-[13px] font-medium text-white/85">{DURATIONS[durationIdx].label}</span>
              </div>
              <input
                type="range"
                min={0}
                max={DURATIONS.length - 1}
                step={1}
                value={durationIdx}
                onChange={(e) => setDurationIdx(Number(e.target.value))}
                className="mt-2 w-full accent-white"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-white/30">
                {DURATIONS.map((d) => <span key={d.sec}>{d.label}</span>)}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[11.5px] text-white/35">{Math.max(4, Math.min(18, Math.round(durationSec / 9)))} scenes · stock visuals · voiceover · music bed</p>
              <button type="button" onClick={() => void generate()} disabled={starting || !prompt.trim()} className={PRIMARY_BTN}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Create documentary
              </button>
            </div>
            {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
          </div>
        )}

        {/* ── Live project ── */}
        {projectId && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            {project === undefined ? (
              <div className="grid h-40 place-items-center text-white/30"><Loader2 className="size-5 animate-spin" /></div>
            ) : project === null ? (
              <p className="py-8 text-center text-[13px] text-white/40">Project not found.</p>
            ) : (
              <>
                <h3 className="text-[16px] font-semibold text-white">{project.title || project.prompt}</h3>
                {project.status === "generating" && (
                  <p className="mt-2 inline-flex items-center gap-2 text-[13px] text-white/60">
                    <Loader2 className="size-3.5 animate-spin" /> {project.statusMessage}
                  </p>
                )}
                {project.status === "failed" && (
                  <p className="mt-2 text-[13px] text-red-400">{project.error ?? "Generation failed."}</p>
                )}
                {project.status === "ready" && project.videoUrl && (
                  <>
                    <video src={project.videoUrl} controls playsInline className="mt-4 max-h-[70vh] w-full rounded-xl bg-black" />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <a href={project.videoUrl} download target="_blank" rel="noreferrer" className={PILL}>
                        <Download className="size-3.5" /> Download
                      </a>
                    </div>
                    {project.script && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/35">Narration</span>
                        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-white/75">{project.script}</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── History ── */}
        {readyHistory.length > 0 && (
          <div className="mt-8">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-white/40">
              <Clapperboard className="size-3.5" /> History
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {readyHistory.map((p) => (
                <button key={p._id} type="button" onClick={() => setProjectId(p._id)}
                  className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition-transform hover:-translate-y-0.5">
                  <video src={`${p.videoUrl}#t=0.001`} muted playsInline preload="metadata" className="aspect-[9/16] w-full object-cover" />
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium text-white/60">{p.title || p.prompt}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </AppHeaderShell>
  );
}
