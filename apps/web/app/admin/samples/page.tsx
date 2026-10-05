"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Sparkles, Loader2, Link2, Check, AlertCircle, Download, Play, History, RotateCcw } from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { api } from "@/convex/_generated/api";

type TemplateId = "podcast" | "genz" | "aliabdaal";

const TEMPLATES: { id: TemplateId; label: string; blurb: string; accent: string }[] = [
  { id: "podcast", label: "Podcast Clean", blurb: "Gold premium captions, zoom + auto-fit to face, auto hook, quieter source audio.", accent: "from-sky-500/20 to-sky-500/0" },
  { id: "genz", label: "Gen Z", blurb: "White karaoke captions, punch-zoom on the face, meme SFX sting + pouting sticker on the face.", accent: "from-amber-400/20 to-amber-400/0" },
  { id: "aliabdaal", label: "Ali Abdaal Intro", blurb: "Top/bottom gradient scrim, cascading multi-font intro words, mono captions + cinematic grade.", accent: "from-violet-500/20 to-violet-500/0" },
];

type ClipResult =
  | { ok: true; templateId: string; templateLabel: string; clipUrl: string; title: string; captionText: string; viralScore: number; startSeconds: number; endSeconds: number }
  | { ok: false; templateId: string; templateLabel: string; error: string };

// How long each rendered sample clip should be — passed straight through to
// normalizeClipConfig's clipLength (server clamps to [5,90]s either way, this
// is just the picker's own sane range of presets).
const LENGTH_PRESETS: { id: string; label: string; min: number; max: number }[] = [
  { id: "short", label: "15-30s", min: 15, max: 30 },
  { id: "default", label: "30-45s", min: 30, max: 45 },
  { id: "medium", label: "45-60s", min: 45, max: 60 },
  { id: "long", label: "60-90s", min: 60, max: 90 },
];

const STAGES = ["Downloading + transcribing source…", "Selecting the 3 best moments…", "Rendering 3 sample clips…"];

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function AdminSamplesPage() {
  const { accessToken, getFreshToken } = useSupabaseAuth();
  const [sourceUrl, setSourceUrl] = useState("");
  const [selected, setSelected] = useState<TemplateId[]>(["podcast", "genz", "aliabdaal"]);
  const [lengthPresetId, setLengthPresetId] = useState("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipResult[] | null>(null);
  const [stageIdx, setStageIdx] = useState(0);

  // Persisted run history (convex/sampleRuns.ts) — reactive, updates itself the
  // moment the generate route's best-effort write lands. Doubles as the "reuse a
  // downloaded link" selector below (deduped to one entry per sourceUrl).
  const history = useQuery(api.sampleRuns.listRecent, { limit: 30 });
  const recentLinks = useMemo(() => {
    if (!history) return [];
    const seen = new Map<string, (typeof history)[number]>();
    for (const run of history) if (!seen.has(run.sourceUrl)) seen.set(run.sourceUrl, run);
    return Array.from(seen.values()).slice(0, 8);
  }, [history]);

  const toggleTemplate = (id: TemplateId) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((t) => t !== id) : prev;
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const run = async () => {
    if (!sourceUrl.trim() || selected.length !== 3 || loading) return;
    setLoading(true);
    setError(null);
    setClips(null);
    setStageIdx(0);
    try {
      const token = (await getFreshToken?.()) || accessToken || undefined;
      const timer = setTimeout(() => setStageIdx(1), 8_000);
      const timer2 = setTimeout(() => setStageIdx(2), 20_000);
      const preset = LENGTH_PRESETS.find((p) => p.id === lengthPresetId) ?? LENGTH_PRESETS[1];
      const res = await fetch("/api/admin/samples/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          templates: selected,
          accessToken: token,
          clipLength: { min: preset.min, max: preset.max },
        }),
      });
      clearTimeout(timer);
      clearTimeout(timer2);
      // Read as TEXT first, then try to parse — a killed/timed-out request can
      // come back as the platform gateway's own raw "upstream error" body
      // instead of our JSON error shape, and `res.json()` on that throws an
      // opaque "Unexpected token 'u'..." SyntaxError instead of a readable
      // message. Same defensive pattern as convex/clipJobs.ts's post() helper.
      const raw = await res.text();
      let data: { ok?: boolean; error?: string; clips?: ClipResult[] } | null = null;
      try { data = JSON.parse(raw); } catch { /* non-JSON body, handled below */ }
      if (!data) throw new Error(`Request failed (HTTP ${res.status}): ${raw.slice(0, 200) || "no response body"}`);
      if (!res.ok || !data.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setClips(data.clips ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadFromHistory = (url: string, runClips?: readonly { ok: boolean }[]) => {
    setSourceUrl(url);
    setError(null);
    if (runClips) setClips(runClips as ClipResult[]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex items-center justify-center size-7 rounded-lg bg-violet-500/15 border border-violet-500/25">
          <Sparkles className="size-3.5 text-violet-400" />
        </div>
        <h1 className="text-[19px] font-bold text-white">Samples</h1>
      </div>
      <p className="text-[13px] text-zinc-500 max-w-xl mb-8">
        Paste a podcast or video URL. We pull only the 3 best moments and render one sample clip
        per template — a fast, low-cost preview for a prospective client, not the full clip run.
        Re-using a link below skips re-transcribing it.
      </p>

      <div className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] p-5 mb-6">
        <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Source URL</label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#1e1e24] bg-[#0a0a0c] px-3.5 h-11 focus-within:border-violet-500/50">
          <Link2 className="size-4 text-zinc-600 shrink-0" />
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=… or a direct video URL"
            className="flex-1 bg-transparent text-[13px] text-white placeholder:text-zinc-600 outline-none"
            disabled={loading}
          />
        </div>

        {recentLinks.length > 0 && (
          <>
            <label className="mt-4 block text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
              Recent links <span className="text-zinc-700 normal-case font-normal">(already transcribed — reusing one skips that step)</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentLinks.map((r) => (
                <button
                  key={r._id}
                  type="button"
                  onClick={() => setSourceUrl(r.sourceUrl)}
                  disabled={loading}
                  title={r.sourceUrl}
                  className="max-w-[220px] h-7 px-2.5 rounded-md border border-[#1e1e24] bg-[#0a0a0c] text-[11px] text-zinc-400 hover:border-[#2a2a32] hover:text-zinc-200 truncate"
                >
                  {r.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="mt-5 block text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
          Templates <span className="text-zinc-700 normal-case font-normal">(pick 3 — one per sample clip)</span>
        </label>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => {
            const active = selected.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTemplate(t.id)}
                disabled={loading}
                className={`relative text-left rounded-xl border p-3.5 transition overflow-hidden ${
                  active ? "border-violet-500/50 bg-violet-500/[0.06]" : "border-[#1e1e24] bg-[#0a0a0c] hover:border-[#2a2a32]"
                }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${t.accent} pointer-events-none`} />
                <div className="relative flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-white">{t.label}</span>
                  {active && (
                    <div className="flex items-center justify-center size-4 rounded-full bg-violet-500">
                      <Check className="size-2.5 text-white" strokeWidth={3} />
                    </div>
                  )}
                </div>
                <p className="relative mt-1 text-[11.5px] leading-snug text-zinc-500">{t.blurb}</p>
              </button>
            );
          })}
        </div>

        <label className="mt-5 block text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
          Clip length <span className="text-zinc-700 normal-case font-normal">(target range for all 3 clips)</span>
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {LENGTH_PRESETS.map((p) => {
            const active = lengthPresetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setLengthPresetId(p.id)}
                disabled={loading}
                className={`h-8 px-3.5 rounded-lg border text-[12px] font-medium transition ${
                  active ? "border-violet-500/50 bg-violet-500/[0.1] text-white" : "border-[#1e1e24] bg-[#0a0a0c] text-zinc-400 hover:border-[#2a2a32]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={run}
          disabled={loading || !sourceUrl.trim() || selected.length !== 3}
          className="mt-5 inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-white text-zinc-900 text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-100"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {loading ? "Generating…" : "Generate 3 sample clips"}
        </button>

        {loading && (
          <div className="mt-3 flex items-center gap-2">
            {STAGES.map((s, i) => (
              <div key={s} className={`h-1 flex-1 rounded-full ${i <= stageIdx ? "bg-violet-500" : "bg-[#1c1c22]"}`} />
            ))}
          </div>
        )}
        {loading && <p className="mt-1.5 text-[11.5px] text-zinc-500">{STAGES[stageIdx]}</p>}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3.5 py-3 text-[12.5px] text-red-300">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Live cards below the form: skeletons while a run is in flight (one per
          picked template, so the operator sees exactly what's coming), swapped
          for the real results as soon as the request finishes. */}
      {(loading || clips) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {loading
            ? selected.map((id) => {
                const t = TEMPLATES.find((x) => x.id === id)!;
                return (
                  <div key={id} className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-[#1c1c22]">
                      <span className="text-[12px] font-semibold text-white">{t.label}</span>
                    </div>
                    <div className="w-full aspect-[9/16] bg-[#0a0a0c] flex flex-col items-center justify-center gap-2">
                      <Loader2 className="size-5 text-violet-400 animate-spin" />
                      <span className="text-[11px] text-zinc-600 px-4 text-center">{STAGES[stageIdx]}</span>
                    </div>
                  </div>
                );
              })
            : clips!.map((c, i) => (
                <div key={i} className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-[#1c1c22] flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-white">{c.templateLabel}</span>
                    {c.ok && <span className="text-[10px] font-mono text-zinc-600">score {c.viralScore}</span>}
                  </div>
                  {c.ok ? (
                    <>
                      <video src={c.clipUrl} controls playsInline className="w-full aspect-[9/16] bg-black" />
                      <div className="p-3.5">
                        <p className="text-[12.5px] font-medium text-white leading-snug">{c.title}</p>
                        <p className="mt-1 text-[11.5px] text-zinc-500 leading-snug">{c.captionText}</p>
                        <a
                          href={c.clipUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-violet-400 hover:text-violet-300"
                        >
                          <Play className="size-3" /> Open <Download className="size-3 ml-0.5" />
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="p-3.5 flex items-start gap-2 text-[12px] text-red-300">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" />
                      <span>{c.error}</span>
                    </div>
                  )}
                </div>
              ))}
        </div>
      )}

      {/* History: every past run, newest first. Click a card to reload its clips
          without re-generating. */}
      <div className="flex items-center gap-2 mb-3">
        <History className="size-3.5 text-zinc-600" />
        <h2 className="text-[13px] font-semibold text-zinc-400">History</h2>
      </div>
      {history === undefined ? (
        <p className="text-[12px] text-zinc-600">Loading history…</p>
      ) : history.length === 0 ? (
        <p className="text-[12px] text-zinc-600">No runs yet — your generated samples will show up here.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((r: { _id: string; sourceUrl: string; createdAt: number; clips: { ok: boolean; templateLabel: string }[] }) => {
            const okCount = r.clips.filter((c) => c.ok).length;
            return (
              <button
                key={r._id}
                type="button"
                onClick={() => loadFromHistory(r.sourceUrl, r.clips)}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#1c1c22] bg-[#0d0d10] px-4 py-3 text-left hover:border-[#2a2a32] transition"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] text-white truncate">{r.sourceUrl}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-600">
                    {okCount}/{r.clips.length} clips · {timeAgo(r.createdAt)} · {r.clips.map((c) => c.templateLabel).join(", ")}
                  </p>
                </div>
                <RotateCcw className="size-3.5 text-zinc-600 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
