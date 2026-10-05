"use client";

// Show Bible editor — the Director tab's top section. The operator describes
// the show in one prompt; the LLM compiles it into a structured bible that
// drives every future video (ideas, scripts, visuals, durations). Direct field
// edits save through the SIWS-owner-gated /api/agents/config route (kind
// "bible"); recompiles go through /api/agents/compile-bible.

import { useState } from "react";
import { Loader2, Check, X, Plus, Sparkles, AlertCircle, BookOpen, Wand2, Lock, Unlock, ImagePlus } from "lucide-react";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { bibleVideoStyles, normalizeShowBible, type ShowBible, type ShowBibleVisualRef, type VideoStyle } from "@/lib/builder/showBible";
import { getArchetype } from "@/lib/builder/showArchetypes";
import ShowDesigner from "./ShowDesigner";

const labelCls = "font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500";
const inputCls =
  "h-10 rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3 text-[13px] text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50 disabled:cursor-not-allowed disabled:opacity-40";
const areaCls =
  "w-full resize-none rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3.5 py-3 text-[13px] leading-relaxed text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50 disabled:opacity-40";
const primaryBtn =
  "rounded-lg bg-lime-500 text-black font-bold shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-lime-500";
const ghostBtn =
  "rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-40";

function TagList({ values, onChange, placeholder, disabled }: {
  values: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v || values.includes(v)) { setText(""); return; }
    onChange([...values, v].slice(0, 10));
    setText("");
  };
  return (
    <div>
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400/40 bg-lime-400/10 px-2.5 py-1 text-[12px] font-medium text-lime-200">
              {v}
              <button type="button" disabled={disabled} onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="text-lime-300/70 transition-colors hover:text-white">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input value={text} disabled={disabled} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder} className={`${inputCls} flex-1`} />
        <button type="button" disabled={disabled || !text.trim()} onClick={add}
          className={`${primaryBtn} inline-flex h-10 items-center gap-1 px-3 text-[12px]`}>
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function FieldCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className={`${labelCls} mb-2.5`}>{title}</p>
      {children}
    </div>
  );
}

export default function ShowBibleEditor({ mintAddress, rawBible }: { mintAddress?: string; rawBible?: unknown }) {
  const serverBible = normalizeShowBible(rawBible);
  // Local override reconciles against the server doc, same pattern as the
  // Director tab's cfgOverride: server (reactive query in the parent) wins
  // whenever it changes.
  const [override, setOverride] = useState<ShowBible | null>(null);
  const [overrideKey, setOverrideKey] = useState<string | null>(null);
  const serverKey = JSON.stringify(serverBible ?? null);
  const bible = override && overrideKey === serverKey ? override : serverBible;

  const [concept, setConcept] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShowBible | null>(null);
  const [busy, setBusy] = useState<"compile" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const { ensureSiwsSession } = useSiwsSession();

  const disabled = !mintAddress;
  const conceptText = concept ?? bible?.compiledFrom ?? "";

  const flashSaved = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400); };

  const compile = async (save: boolean) => {
    if (!mintAddress || !conceptText.trim()) return;
    setBusy("compile"); setError(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/compile-bible", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, concept: conceptText, save }),
      });
      const data = (await res.json().catch(() => ({}))) as { bible?: unknown; error?: string };
      if (!res.ok || !data.bible) throw new Error(data.error || `Compile failed (${res.status})`);
      const compiled = normalizeShowBible(data.bible);
      if (!compiled) throw new Error("Compiler returned an unusable bible, try rephrasing");
      if (save) {
        setOverride(compiled); setOverrideKey(serverKey); setPreview(null); flashSaved();
      } else {
        setPreview(compiled);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compile failed");
    } finally { setBusy(null); }
  };

  const saveBible = async (next: ShowBible) => {
    if (!mintAddress) return;
    setOverride(next); setOverrideKey(serverKey);
    setBusy("save"); setError(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "bible", payload: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      flashSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(null); }
  };

  const patch = (p: Partial<ShowBible>) => { if (bible) void saveBible({ ...bible, ...p }); };
  const patchDeep = <K extends keyof ShowBible>(key: K, value: ShowBible[K]) => patch({ [key]: value } as Partial<ShowBible>);

  const shown = preview ?? bible;

  return (
    <div className="rounded-2xl border border-lime-400/20 bg-lime-400/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-lime-400/10 text-lime-300"><BookOpen className="size-4.5" /></span>
          <div>
            <h2 className="font-sans text-[16px] font-semibold text-white leading-none tracking-tight">Show Bible</h2>
            <p className="mt-1 text-[12px] text-zinc-500">Describe the show, the agent compiles it and runs it. Bible wins over the manual settings below.</p>
          </div>
        </div>
        <div className="shrink-0">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-zinc-400"><Loader2 className="size-3 animate-spin" /> {busy === "compile" ? "Compiling" : "Saving"}</span>
          ) : savedFlash ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-400/15 px-2.5 py-1 text-[11px] font-semibold text-lime-300"><Check className="size-3" /> Saved</span>
          ) : error ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-300" title={error}><AlertCircle className="size-3" /> {error.slice(0, 60)}</span>
          ) : bible ? (
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] font-semibold text-zinc-400">v{bible.version}</span>
              {!designerOpen && (
                <button type="button" onClick={() => setDesignerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/10">
                  <Wand2 className="size-3" /> Redesign show
                </button>
              )}
            </span>
          ) : null}
        </div>
      </div>

      {/* No bible yet (or explicit redesign) → the visual Show Designer wizard
          is the entry, not a form. */}
      {(!bible || designerOpen) ? (
        <ShowDesigner
          mintAddress={mintAddress}
          onCancel={bible ? () => setDesignerOpen(false) : undefined}
          onDone={(b) => {
            setOverride(b);
            setOverrideKey(serverKey);
            setDesignerOpen(false);
          }}
        />
      ) : (
      <>
      {/* Concept prompt + compile */}
      <textarea
        rows={bible ? 2 : 4}
        disabled={disabled || busy !== null}
        value={conceptText}
        onChange={(e) => setConcept(e.target.value)}
        placeholder={'e.g. "A cartoon lawyer who reacts to today\'s real legal news with sharp, funny commentary, plus occasional courtroom skits."'}
        className={areaCls}
      />
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" disabled={disabled || busy !== null || !conceptText.trim()}
          onClick={() => void compile(false)}
          className={`${primaryBtn} inline-flex items-center gap-1.5 px-4 py-2 text-[12px]`}>
          <Sparkles className="size-3.5" /> {bible ? "Recompile preview" : "Compile preview"}
        </button>
        {preview && (
          <>
            <button type="button" disabled={busy !== null} onClick={() => void compile(true)}
              className={`${primaryBtn} px-4 py-2 text-[12px]`}>
              Save bible
            </button>
            <button type="button" disabled={busy !== null} onClick={() => setPreview(null)} className={ghostBtn}>
              Discard
            </button>
            <span className="text-[11px] uppercase tracking-[0.08em] text-amber-300">Previewing, not saved</span>
          </>
        )}
      </div>

      {/* Video styles, the rotation unit: each card is one complete look the
          director cycles through by weight. Replaces the old Formats +
          Variation-axes forms (those re-described the same thing three times). */}
      {shown && (
        <div className="mt-4">
          <p className={`${labelCls} mb-2`}>Video styles, the agent rotates these</p>
          <VideoStylesEditor
            styles={bibleVideoStyles(shown)}
            authored={!!shown.videoStyles?.length}
            disabled={disabled || !!preview}
            onChange={(videoStyles) => {
              // Keep the legacy mirrors in sync so every downstream consumer
              // (format.kinds gate in normalize, per-format durations) stays valid.
              const kinds = [...new Set(videoStyles.map((s) => s.format))];
              const perFormatDuration = { ...shown.cadence.perFormatDuration };
              for (const s of videoStyles) if (s.durationSec) perFormatDuration[s.format] = s.durationSec;
              patch({
                videoStyles,
                ...(kinds.length ? { format: { ...shown.format, kinds } } : {}),
                cadence: { ...shown.cadence, perFormatDuration },
              });
            }}
          />
        </div>
      )}

      {/* Identity, set once, shared by every style */}
      {shown && (
        <p className={`${labelCls} mt-5`}>Identity, shared by every style</p>
      )}
      {shown && (
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <FieldCard title="Premise">
            <textarea rows={3} disabled={disabled || !!preview} value={shown.premise}
              onChange={(e) => bible && !preview && setOverride({ ...bible, premise: e.target.value })}
              onBlur={(e) => !preview && patch({ premise: e.target.value })}
              className={areaCls} />
          </FieldCard>
          <FieldCard title="Cast (visual identity is locked across videos)">
            <div className="space-y-2">
              {shown.cast.map((c, i) => (
                <div key={`${c.name}-${i}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white">{c.name}</span>
                    <span className="text-[11px] text-zinc-500">{c.role}</span>
                    <button type="button" disabled={disabled || !!preview} aria-label={`Remove ${c.name}`}
                      onClick={() => patchDeep("cast", shown.cast.filter((_, j) => j !== i))}
                      className="ml-auto text-zinc-500 hover:text-white"><X className="size-3.5" /></button>
                  </div>
                  <textarea rows={2} disabled={disabled || !!preview} value={c.visualIdentity}
                    onChange={(e) => bible && !preview && setOverride({ ...bible, cast: bible.cast.map((m, j) => j === i ? { ...m, visualIdentity: e.target.value } : m) })}
                    onBlur={(e) => !preview && patchDeep("cast", shown.cast.map((m, j) => j === i ? { ...m, visualIdentity: e.target.value } : m))}
                    className={`${areaCls} mt-1.5 !py-2 text-[12px]`} />
                </div>
              ))}
              {shown.cast.length === 0 && <p className="text-[12px] text-zinc-500">No recurring cast, recompile with a character in the concept to add one.</p>}
            </div>
          </FieldCard>
          <FieldCard title="Visual world">
            <input disabled={disabled || !!preview} value={shown.visualWorld.style}
              onChange={(e) => bible && !preview && setOverride({ ...bible, visualWorld: { ...bible.visualWorld, style: e.target.value } })}
              onBlur={(e) => !preview && patchDeep("visualWorld", { ...shown.visualWorld, style: e.target.value })}
              placeholder="2D cartoon, bold outlines…" className={`${inputCls} mb-3 w-full`} />
            <p className={`${labelCls} mb-1.5`}>Settings (rotate)</p>
            <TagList values={shown.visualWorld.settings} disabled={disabled || !!preview}
              onChange={(settings) => patchDeep("visualWorld", { ...shown.visualWorld, settings })}
              placeholder="courtroom, office desk…" />
            <p className={`${labelCls} mb-1.5 mt-3`}>Moods</p>
            <TagList values={shown.visualWorld.moods} disabled={disabled || !!preview}
              onChange={(moods) => patchDeep("visualWorld", { ...shown.visualWorld, moods })}
              placeholder="playful, tense…" />
          </FieldCard>
          <FieldCard title="Voice">
            <input disabled={disabled || !!preview} value={shown.voice.tone}
              onChange={(e) => bible && !preview && setOverride({ ...bible, voice: { ...bible.voice, tone: e.target.value } })}
              onBlur={(e) => !preview && patchDeep("voice", { ...shown.voice, tone: e.target.value })}
              placeholder="sharp, witty…" className={`${inputCls} mb-3 w-full`} />
            <p className={`${labelCls} mb-1.5`}>Catchphrases</p>
            <TagList values={shown.voice.catchphrases ?? []} disabled={disabled || !!preview}
              onChange={(catchphrases) => patchDeep("voice", { ...shown.voice, catchphrases })}
              placeholder='"Objection!"' />
          </FieldCard>
          <FieldCard title="Content engine">
            <p className={`${labelCls} mb-1.5`}>Live news searches (per ideation)</p>
            <TagList values={shown.contentEngine.newsQueries} disabled={disabled || !!preview}
              onChange={(newsQueries) => patchDeep("contentEngine", { ...shown.contentEngine, newsQueries })}
              placeholder="latest supreme court ruling…" />
            <p className={`${labelCls} mb-1.5 mt-3`}>Evergreen topic pools</p>
            <TagList values={shown.contentEngine.evergreenPools} disabled={disabled || !!preview}
              onChange={(evergreenPools) => patchDeep("contentEngine", { ...shown.contentEngine, evergreenPools })}
              placeholder="weird laws explained…" />
            <p className={`${labelCls} mb-1.5 mt-3`}>Content mix (%, keeps the feed from becoming all hard sell)</p>
            <div className="flex items-center gap-3">
              {(["entertain", "value", "promo"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-[12px] text-zinc-300">
                  <span className="capitalize">{k === "value" ? "💡 value" : k === "promo" ? "🤝 promo" : "🎭 entertain"}</span>
                  <input type="number" min={0} max={100} disabled={disabled || !!preview}
                    value={shown.contentMix[k]}
                    onChange={(e) => patchDeep("contentMix", { ...shown.contentMix, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    className={`${inputCls} h-8 w-16 px-2 tabular-nums`} aria-label={`${k} percent`} />
                </label>
              ))}
            </div>
          </FieldCard>
          <FieldCard title={`Visual refs, locked ones feed every render${shown.archetype ? ` (${getArchetype(shown.archetype)?.label ?? shown.archetype})` : ""}`}>
            <VisualRefsEditor
              refs={shown.visualRefs ?? []}
              disabled={disabled || !!preview}
              onChange={(visualRefs) => patchDeep("visualRefs", visualRefs)}
              upload={async (base64: string) => {
                await ensureSiwsSession();
                const res = await fetch("/api/upload-ref", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ base64 }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
                return data.url as string;
              }}
            />
          </FieldCard>
        </div>
      )}
      </>
      )}
    </div>
  );
}

/** Card grid of the show's video styles — one card per rotation recipe. Editing
 *  any field (or adding/removing a card) materializes `videoStyles` as the
 *  authored source of truth; until then legacy bibles show their synthesized
 *  starters so there is always something concrete to edit. */
function VideoStylesEditor({ styles, authored, disabled, onChange }: {
  styles: VideoStyle[];
  authored: boolean;
  disabled?: boolean;
  onChange: (styles: VideoStyle[]) => void;
}) {
  const patchStyle = (i: number, p: Partial<VideoStyle>) =>
    onChange(styles.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const addStyle = () => {
    const n = styles.length + 1;
    onChange([...styles, {
      id: `style-${Date.now().toString(36)}`,
      name: `New style ${n}`,
      format: styles[0]?.format ?? "talking-head",
      durationSec: { min: 16, max: 32 },
      weight: 1,
    }]);
  };
  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      {node}
    </label>
  );
  const smallInput = `${inputCls} h-8 w-full px-2 text-[12px]`;
  return (
    <div>
      {!authored && styles.length > 0 && (
        <p className="mb-2 text-[11px] text-zinc-500">Starter styles from your current show, edit any field to make them yours.</p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {styles.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <input disabled={disabled} value={s.name}
                onChange={(e) => patchStyle(i, { name: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-white outline-none placeholder:text-zinc-600"
                placeholder="Style name" aria-label="Style name" />
              <button type="button" disabled={disabled || styles.length <= 1} aria-label={`Remove ${s.name}`}
                onClick={() => onChange(styles.filter((_, j) => j !== i))}
                className="text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-30">
                <X className="size-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {field("Format", (
                <input disabled={disabled} value={s.format}
                  onChange={(e) => patchStyle(i, { format: e.target.value })}
                  placeholder="news-react, skit…" className={smallInput} />
              ))}
              {field("Hook style", (
                <input disabled={disabled} value={s.hookStyle ?? ""}
                  onChange={(e) => patchStyle(i, { hookStyle: e.target.value || undefined })}
                  placeholder="bold claim, question…" className={smallInput} />
              ))}
              <div className="col-span-2">
                {field("Structure", (
                  <input disabled={disabled} value={s.structure ?? ""}
                    onChange={(e) => patchStyle(i, { structure: e.target.value || undefined })}
                    placeholder="problem-twist-verdict…" className={smallInput} />
                ))}
              </div>
              {field("Length (sec)", (
                <div className="flex items-center gap-1.5">
                  <input type="number" min={5} max={60} disabled={disabled}
                    value={s.durationSec?.min ?? 16}
                    onChange={(e) => {
                      const min = Number(e.target.value) || 16;
                      const max = s.durationSec?.max ?? 32;
                      patchStyle(i, { durationSec: { min: Math.min(min, max), max: Math.max(min, max) } });
                    }}
                    className={`${inputCls} h-8 w-14 px-1.5 tabular-nums`} aria-label={`${s.name} min seconds`} />
                  <span className="text-zinc-600">–</span>
                  <input type="number" min={5} max={60} disabled={disabled}
                    value={s.durationSec?.max ?? 32}
                    onChange={(e) => {
                      const max = Number(e.target.value) || 32;
                      const min = s.durationSec?.min ?? 16;
                      patchStyle(i, { durationSec: { min: Math.min(min, max), max: Math.max(min, max) } });
                    }}
                    className={`${inputCls} h-8 w-14 px-1.5 tabular-nums`} aria-label={`${s.name} max seconds`} />
                </div>
              ))}
              {field(`How often · ${s.weight ?? 1}×`, (
                <input type="range" min={1} max={5} step={1} disabled={disabled}
                  value={s.weight ?? 1}
                  onChange={(e) => patchStyle(i, { weight: Number(e.target.value) })}
                  className="mt-2 w-full accent-lime-400" aria-label={`${s.name} rotation weight`} />
              ))}
            </div>
          </div>
        ))}
        <button type="button" disabled={disabled} onClick={addStyle}
          className="grid min-h-[150px] place-items-center rounded-xl border border-dashed border-white/20 text-zinc-500 transition-colors hover:border-lime-400/50 hover:text-lime-300 disabled:opacity-40">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold"><Plus className="size-4" /> Add style</span>
        </button>
      </div>
    </div>
  );
}

function VisualRefsEditor({ refs, disabled, onChange, upload }: {
  refs: ShowBibleVisualRef[];
  disabled?: boolean;
  onChange: (refs: ShowBibleVisualRef[]) => void;
  upload: (base64: string) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: ShowBibleVisualRef[] = [];
      for (const f of Array.from(files).slice(0, 4)) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        // A builder-uploaded image is real material by definition.
        added.push({ url: await upload(base64), kind: "real-photo", role: "style", locked: true });
      }
      if (added.length) onChange([...refs, ...added].slice(0, 20));
    } catch { /* surfaced by parent save state on next patch */ }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {refs.map((r, i) => (
          <div key={`${r.url}-${i}`} className={`relative w-24 overflow-hidden rounded-lg border ${r.locked ? "border-lime-400/50" : "border-white/10"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.url} alt={r.role} className="aspect-[3/4] w-full object-cover" />
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-zinc-300">{r.kind}</span>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/70 px-1.5 py-1">
              <span className="truncate text-[9px] text-zinc-400">{r.role}</span>
              <span className="flex gap-1">
                <button type="button" disabled={disabled} aria-label={r.locked ? "Unlock ref" : "Lock ref"}
                  onClick={() => onChange(refs.map((x, j) => j === i ? { ...x, locked: !x.locked } : x))}
                  className={r.locked ? "text-lime-300" : "text-zinc-500 hover:text-white"}>
                  {r.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                </button>
                <button type="button" disabled={disabled} aria-label="Remove ref"
                  onClick={() => onChange(refs.filter((_, j) => j !== i))}
                  className="text-zinc-500 hover:text-red-300">
                  <X className="size-3" />
                </button>
              </span>
            </div>
          </div>
        ))}
        <label className={`grid aspect-[3/4] w-24 cursor-pointer place-items-center rounded-lg border border-dashed border-white/20 text-zinc-500 transition-colors hover:border-lime-400/50 hover:text-lime-300 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          <input type="file" accept="image/*" multiple hidden disabled={disabled || busy}
            onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-zinc-600">
        Locked refs are the show&apos;s identity, realistic shows use only real photos/frames, stylized shows use design sheets (prevents the uncanny AI look).
      </p>
    </div>
  );
}
