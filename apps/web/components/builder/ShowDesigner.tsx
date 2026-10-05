"use client";

// Show Designer wizard — the visual path from "what's in the builder's head"
// to a running show: Describe (text + reference images) → Pick one of 3
// pitched shows (each with a generated style frame) → Lock the look (design
// sheets for stylized archetypes, real photos for realistic ones) → Pilot
// (first render waits for approval on the Ideas tab; autonomy dial goes live
// when the builder flips it). Rendered by ShowBibleEditor as the empty state
// and on "Redesign show".

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, Sparkles, X, ImagePlus, Check, ArrowLeft, Zap, RefreshCw, Upload,
} from "lucide-react";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { ARCHETYPES, getArchetype } from "@/lib/builder/showArchetypes";
import { normalizeShowBible, type ShowBible, type ShowBibleVisualRef } from "@/lib/builder/showBible";
import type { ShowPitch } from "@/lib/server/showDesigner";

const areaCls =
  "w-full resize-none rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3.5 py-3 text-[13px] leading-relaxed text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50 disabled:opacity-40";
const inputCls =
  "h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[13px] text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50";
const primaryBtn =
  "rounded-lg bg-lime-500 text-black font-bold shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-lime-500";
const ghostBtn =
  "rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-40";


const TYPE_ICONS: Record<string, string> = {
  "cartoon-series": "🎨", "anime-series": "⛩️", "talking-head": "🎤", skit: "🎭",
  "news-react": "📰", faceless: "🎬", "ugc-product": "📱",
};
type PitchTask = { i: number; taskId: string | null };

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

export default function ShowDesigner({ mintAddress, onDone, onCancel }: {
  mintAddress?: string;
  /** Called with the committed bible + pilot headline when the wizard finishes. */
  onDone: (bible: ShowBible, pilotHeadline: string | null) => void;
  /** Present only when an existing bible can be returned to (Redesign mode). */
  onCancel?: () => void;
}) {
  const { ensureSiwsSession } = useSiwsSession();
  const [step, setStep] = useState<"describe" | "pick" | "lock" | "pilot">("describe");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Describe
  const [concept, setConcept] = useState("");
  const [typeHint, setTypeHint] = useState<string | null>(null); // null = surprise me
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Pick
  const [pitches, setPitches] = useState<ShowPitch[]>([]);
  const [frames, setFrames] = useState<Record<number, string>>({});
  const [pendingTasks, setPendingTasks] = useState<PitchTask[]>([]);
  const [remix, setRemix] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);

  // Lock / pilot
  const [bible, setBible] = useState<ShowBible | null>(null);
  const [pilotHeadline, setPilotHeadline] = useState<string | null>(null);
  const [castBusy, setCastBusy] = useState<string | null>(null);
  const [castRefs, setCastRefs] = useState<Record<string, string[]>>({}); // castName → urls

  const authedJson = useCallback(async (url: string, body: unknown) => {
    await ensureSiwsSession();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }, [ensureSiwsSession]);

  // ── Describe: image upload via /api/upload-ref ────────────────────────────
  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("upload"); setError(null);
    try {
      for (const f of Array.from(files).slice(0, 4 - refUrls.length)) {
        const base64 = await fileToDataUrl(f);
        const data = await authedJson("/api/upload-ref", { base64 });
        if (data.url) setRefUrls((u) => [...u, data.url].slice(0, 4));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  };

  // ── Pitch ─────────────────────────────────────────────────────────────────
  const pitch = async (remixNote?: string) => {
    if (!mintAddress || !concept.trim()) return;
    setBusy("pitch"); setError(null);
    try {
      const data = await authedJson("/api/agents/show-designer/pitch", {
        mintAddress,
        concept: remixNote ? `${concept}\n\nAdjustment: ${remixNote}` : concept,
        refUrls,
        ...(typeHint ? { archetypeHint: typeHint } : {}),
      });
      setPitches(data.pitches ?? []);
      setFrames({});
      setPendingTasks((data.tasks ?? []).filter((t: PitchTask) => t.taskId));
      setChosen(null);
      setStep("pick");
    } catch (e) { setError(e instanceof Error ? e.message : "Pitch failed"); }
    finally { setBusy(null); }
  };

  // Poll style frames while any task pending.
  useEffect(() => {
    if (step !== "pick" || pendingTasks.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await authedJson("/api/agents/show-designer/collect", { tasks: pendingTasks });
        if (cancelled) return;
        if (Array.isArray(data.frames)) {
          setFrames((f) => {
            const next = { ...f };
            for (const fr of data.frames) if (fr?.url) next[fr.i] = fr.url;
            return next;
          });
        }
        if (!data.pending) setPendingTasks([]);
      } catch { /* keep polling */ }
    };
    const id = setInterval(tick, 4000);
    void tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [step, pendingTasks, authedJson]);

  // ── Commit chosen pitch ───────────────────────────────────────────────────
  const commit = async (idx: number) => {
    if (!mintAddress) return;
    setBusy("commit"); setError(null);
    try {
      const data = await authedJson("/api/agents/show-designer/commit", {
        mintAddress,
        pitch: pitches[idx],
        styleFrameUrl: frames[idx],
        refUrls,
        remix: remix.trim() || undefined,
      });
      const b = normalizeShowBible(data.bible);
      if (!b) throw new Error("Commit returned an unusable bible");
      setBible(b);
      setPilotHeadline(data.pilotHeadline ?? null);
      setChosen(idx);
      const arch = getArchetype(b.archetype);
      setStep(arch?.needsCast === false ? "pilot" : "lock");
    } catch (e) { setError(e instanceof Error ? e.message : "Commit failed"); }
    finally { setBusy(null); }
  };

  // ── Lock the look ─────────────────────────────────────────────────────────
  const stylized = getArchetype(bible?.archetype)?.refPolicy === "stylized";

  const generateSheet = async (castName: string, visualIdentity: string) => {
    setCastBusy(castName); setError(null);
    try {
      const create = await authedJson("/api/agents/character-design/create", {
        name: castName,
        description: visualIdentity || `${castName}, ${bible?.visualWorld.style ?? ""}`,
        medium: bible?.visualWorld.style,
      });
      // Poll collect until all views land.
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((r) => setTimeout(r, 4000));
        const got = await authedJson("/api/agents/character-design/collect", { tasks: create.tasks });
        if (got.pending) continue;
        const urls = (got.images ?? []).map((im: { url: string }) => im.url).filter(Boolean);
        if (!urls.length) throw new Error("Design sheet came back empty, retry");
        setCastRefs((c) => ({ ...c, [castName]: urls }));
        return;
      }
      throw new Error("Design sheet timed out, retry");
    } catch (e) { setError(e instanceof Error ? e.message : "Design sheet failed"); }
    finally { setCastBusy(null); }
  };

  const uploadCastPhoto = async (castName: string, files: FileList | null) => {
    if (!files?.length) return;
    setCastBusy(castName); setError(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 3)) {
        const base64 = await fileToDataUrl(f);
        const data = await authedJson("/api/upload-ref", { base64 });
        if (data.url) urls.push(data.url);
      }
      if (urls.length) setCastRefs((c) => ({ ...c, [castName]: [...(c[castName] ?? []), ...urls].slice(0, 3) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setCastBusy(null); }
  };

  const lockLook = async () => {
    if (!mintAddress || !bible) return;
    setBusy("lock"); setError(null);
    try {
      const newRefs: ShowBibleVisualRef[] = Object.entries(castRefs).flatMap(([name, urls]) =>
        urls.map((url) => ({
          url,
          kind: (stylized ? "ai-sheet" : "real-photo") as ShowBibleVisualRef["kind"],
          role: `cast:${name}`,
          locked: true,
        })));
      const next = { ...bible, visualRefs: [...(bible.visualRefs ?? []), ...newRefs] };
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "bible", payload: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Lock failed");
      setBible(normalizeShowBible(next));
      setStep("pilot");
    } catch (e) { setError(e instanceof Error ? e.message : "Lock failed"); }
    finally { setBusy(null); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</p>
      )}

      {step === "describe" && (
        <div>
          <p className="mb-2 text-[13px] text-zinc-400">
            Step 1 · What kind of videos? Pick a type (or let the agent decide), the pitches follow that type&apos;s craft.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setTypeHint(null)} aria-pressed={typeHint === null}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.97] ${typeHint === null ? "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300" : "border border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10"}`}>
              ✨ Surprise me
            </button>
            {ARCHETYPES.filter((a) => a.id !== "custom").map((a) => (
              <button key={a.id} type="button" onClick={() => setTypeHint(a.id)} aria-pressed={typeHint === a.id}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors active:scale-[0.97] ${typeHint === a.id ? "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300" : "border border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10"}`}>
                {TYPE_ICONS[a.id] ?? ""} {a.label}
              </button>
            ))}
          </div>
          <p className="mb-2 text-[13px] text-zinc-400">
            Step 2 · Describe the show in your head, style, character, vibe, anything. Drop images of the look or person you want (real photos keep realistic shows real).
          </p>
          <textarea rows={4} disabled={!mintAddress || busy !== null} value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder={'e.g. "Anime girl who roasts crypto scams, sassy, neon Tokyo vibe, like these images"'}
            className={areaCls} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {refUrls.map((u) => (
              <span key={u} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="reference" className="size-14 rounded-lg border border-white/10 object-cover" />
                <button type="button" aria-label="Remove reference"
                  onClick={() => setRefUrls((r) => r.filter((x) => x !== u))}
                  className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-black text-zinc-300 hover:text-white">
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
            <button type="button" disabled={!mintAddress || busy !== null || refUrls.length >= 4}
              onClick={() => fileInput.current?.click()}
              className="grid size-14 place-items-center rounded-lg border border-dashed border-white/20 text-zinc-500 transition-colors hover:border-lime-400/50 hover:text-lime-300 disabled:opacity-40">
              {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            </button>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => { void addImages(e.target.files); e.target.value = ""; }} />
            <button type="button" disabled={!mintAddress || busy !== null || !concept.trim()}
              onClick={() => void pitch()}
              className={`${primaryBtn} ml-auto inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px]`}>
              {busy === "pitch" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Pitch my show
            </button>
          </div>
          {onCancel && (
            <button type="button" onClick={onCancel} className={`${ghostBtn} mt-3 inline-flex items-center gap-1`}>
              <ArrowLeft className="size-3" /> Keep current show
            </button>
          )}
        </div>
      )}

      {step === "pick" && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] text-zinc-400">Three ways to run it, pick the one that matches your head.</p>
            <button type="button" onClick={() => setStep("describe")} className={`${ghostBtn} inline-flex items-center gap-1`}>
              <ArrowLeft className="size-3" /> Edit description
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {pitches.map((p, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                <div className="relative aspect-[3/4] w-full bg-white/[0.04]">
                  {frames[i] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={frames[i]} alt={`${p.name} style frame`} className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center text-zinc-600">
                      {pendingTasks.length ? <Loader2 className="size-5 animate-spin" /> : <span className="text-[11px]">frame unavailable</span>}
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-lime-300">
                    {getArchetype(p.archetype)?.label ?? p.archetype}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-3.5">
                  <h3 className="text-[15px] font-semibold text-white">{p.name}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{p.premise}</p>
                  <ul className="mt-2 space-y-1">
                    {p.sampleIdeas.map((s, j) => (
                      <li key={j} className="text-[11.5px] leading-snug text-zinc-500">· {s.headline}</li>
                    ))}
                  </ul>
                  <button type="button" disabled={busy !== null}
                    onClick={() => void commit(i)}
                    className={`${primaryBtn} mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[12.5px]`}>
                    {busy === "commit" && chosen === null ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} This one
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={remix} disabled={busy !== null} onChange={(e) => setRemix(e.target.value)}
              placeholder='Remix: "card 2 but darker" / "more courtroom, less office"'
              className={`${inputCls} flex-1`} />
            <button type="button" disabled={busy !== null || !remix.trim()}
              onClick={() => void pitch(remix)}
              className={`${ghostBtn} inline-flex items-center gap-1.5`}>
              <RefreshCw className="size-3.5" /> Re-pitch
            </button>
          </div>
        </div>
      )}

      {step === "lock" && bible && (
        <div>
          <p className="mb-3 text-[13px] text-zinc-400">
            Lock the look. {stylized
              ? "Generate a design sheet per character, these exact frames anchor every future video."
              : "Upload real photos per character, realistic shows use real material only (AI stills make them look fake)."}
          </p>
          <div className="space-y-3">
            {bible.cast.map((c) => (
              <div key={c.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-white">{c.name}</span>
                  <span className="text-[11px] text-zinc-500">{c.role}</span>
                  <span className="ml-auto">
                    {stylized ? (
                      <button type="button" disabled={castBusy !== null}
                        onClick={() => void generateSheet(c.name, c.visualIdentity)}
                        className={`${ghostBtn} inline-flex items-center gap-1.5`}>
                        {castBusy === c.name ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        {castRefs[c.name]?.length ? "Regenerate sheet" : "Generate design sheet"}
                      </button>
                    ) : (
                      <label className={`${ghostBtn} inline-flex cursor-pointer items-center gap-1.5`}>
                        {castBusy === c.name ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload photos
                        <input type="file" accept="image/*" multiple hidden disabled={castBusy !== null}
                          onChange={(e) => { void uploadCastPhoto(c.name, e.target.files); e.target.value = ""; }} />
                      </label>
                    )}
                  </span>
                </div>
                {(castRefs[c.name]?.length ?? 0) > 0 && (
                  <div className="mt-2.5 flex gap-2">
                    {castRefs[c.name].map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt={`${c.name} reference`} className="h-20 rounded-lg border border-lime-400/40 object-cover" />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {bible.cast.length === 0 && (
              <p className="text-[12px] text-zinc-500">No cast on this show, skip ahead.</p>
            )}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" disabled={busy !== null}
              onClick={() => void lockLook()}
              className={`${primaryBtn} inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px]`}>
              {busy === "lock" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {Object.keys(castRefs).length ? "Lock the look" : "Skip for now"}
            </button>
            <p className="text-[11px] text-zinc-600">You can add or change refs later on the Director tab.</p>
          </div>
        </div>
      )}

      {step === "pilot" && bible && (
        <div className="rounded-xl border border-lime-400/30 bg-lime-400/[0.05] p-4">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-lime-300" />
            <h3 className="text-[15px] font-semibold text-white">Your show is set, pilot next</h3>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-300">
            Heartbeat runs in <b>review mode</b>: nothing posts without you.
            {pilotHeadline ? <> The pilot episode <b>&ldquo;{pilotHeadline}&rdquo;</b> renders on the next heartbeat.</> : <> The top idea renders on the next heartbeat.</>} Watch it land on the <b>Ideas</b> tab; when the look and voice feel right, flip the autonomy dial to <b>Full auto</b> and the show runs itself.
          </p>
          <button type="button" onClick={() => onDone(bible, pilotHeadline)}
            className={`${primaryBtn} mt-3 px-4 py-2 text-[12.5px]`}>
            Open the show bible
          </button>
        </div>
      )}
    </div>
  );
}
