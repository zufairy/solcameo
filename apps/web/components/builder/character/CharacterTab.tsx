"use client";
/* eslint-disable @next/next/no-img-element -- previews are small static/R2 images */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api as convexApi } from "@/convex/_generated/api";
import {
  Brush, Check, CircleUserRound, Eye, Glasses, ImagePlus, Loader2, Lock, Palette, Pencil, Ruler, Scissors, Shirt, Shuffle, Sparkles,
  UserRound, Users, X,
} from "lucide-react";
import { buildPrompt, categoriesFor, isBuildable, sanitizeSelection, TIERS } from "@/lib/character/spec";
import { generationError } from "@/lib/character/generationError";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { PRESETS, type CharacterPreset } from "@/lib/character/presets";
import { isAnimalTier } from "@/lib/character/types";
import type { CharacterImage, CharModel, ModelChoice, SavedCharacter, Selection, Tier } from "@/lib/character/types";
import { Card, CountToggle, DISPLAY_FONT, LIME, Pill, RatioSelect, Section, SPRING, SURFACE, Swatch } from "./character-ui";
import { Gallery, MODEL_LABEL, type Tile } from "./Gallery";
import { ShirtStudio } from "./ShirtStudio";
import { StudioWalletBox, TopUpDialog, priceLabel, useStudioBilling } from "./studioBilling";
import { MotionLibrary, ReplicatePanel, RunsGrid, useMotionRuns, type MotionItem, type MotionRun } from "./motion";

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(163,230,53,0.07), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.04), transparent 55%), #050506",
};

const ICONS: Record<string, React.ReactNode> = {
  gender: <Users className="size-3.5" />, ethnicity_origin_base: <CircleUserRound className="size-3.5" />, age: <UserRound className="size-3.5" />,
  skin_tone: <Palette className="size-3.5" />, height: <Ruler className="size-3.5" />, body_type: <UserRound className="size-3.5" />,
  hair: <Scissors className="size-3.5" />, hair_colour: <Brush className="size-3.5" />, eye_shape: <Eye className="size-3.5" />,
  eye_color: <Eye className="size-3.5" />, aesthetic: <Shirt className="size-3.5" />, accessory: <Glasses className="size-3.5" />,
};
const DEFAULT_ICON = <Sparkles className="size-3.5" />;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let tileSeq = 0;
const tileId = () => `t${Date.now().toString(36)}${(tileSeq++).toString(36)}`;

export function CharacterTab({ mintAddress, agentName, onboarding = false, onCharacterReady, initialCharacter, canGenerate = true, onNeedLogin }: { mintAddress?: string; agentName?: string; onboarding?: boolean; initialCharacter?: SavedCharacter; canGenerate?: boolean; onNeedLogin?: () => void; onCharacterReady?: (character: SavedCharacter) => void }) {
  const { authenticated, accessToken } = useSupabaseAuth();
  const [loading, setLoading] = useState(!!mintAddress);
  const [saved, setSaved] = useState<SavedCharacter | null>(null);
  const [editing, setEditing] = useState(false);

  const [tier, setTier] = useState<Tier>(initialCharacter?.tier ?? "normal");
  const [selection, setSelection] = useState<Selection>(initialCharacter?.selection ?? {});
  // A preset carries the exact brief it was made with. Editing any trait afterwards drops it.
  const [preset, setPreset] = useState<CharacterPreset | null>(null);
  const [model, setModel] = useState<ModelChoice>(initialCharacter?.model === "soul" ? "soul" : "soul2");
  const [ratio, setRatio] = useState("3:4");
  const [count, setCount] = useState<1 | 4>(1);
  const [photoUrls, setPhotoUrls] = useState<string[]>(initialCharacter?.photoUrls ?? (initialCharacter?.photoUrl ? [initialCharacter.photoUrl] : []));
  const photoUrl = photoUrls[0];
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["tier", "gender"]));

  const [tiles, setTiles] = useState<Tile[]>(() => (initialCharacter?.candidates ?? []).map(c => ({ id: tileId(), model: c.model, ratio: c.ratio ?? "3:4", status: "done", url: c.url, startedAt: 0 })));
  const [generating, setGenerating] = useState(false);
  const [pickedUrl, setPickedUrl] = useState<string | null>(initialCharacter?.image.url ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [shirtTile, setShirtTile] = useState<Tile | null>(null);
  const runId = useRef(0);
  const billing = useStudioBilling(onboarding);
  const motion$ = useMotionRuns(mintAddress ?? "");
  const [mode, setMode] = useState<"builder" | "replicate">("builder");
  const [pickedMotion, setPickedMotion] = useState<MotionItem | null>(null);

  const categories = useMemo(() => categoriesFor(tier), [tier]);
  const prompt = useMemo(() => buildPrompt(selection, tier, { photo: !!photoUrl }), [selection, tier, photoUrl]);
  const ready = isAnimalTier(tier) || isBuildable(selection) || !!preset?.brief;
  const images = count;
  const picks = Object.values(selection).reduce((n, v) => n + v.length, 0);

  // A lone finished render is the obvious pick.
  const doneTiles = tiles.filter((t) => t.status === "done" && t.url);
  const effectivePicked = pickedUrl ?? (doneTiles.length === 1 && !generating ? doneTiles[0].url! : null);

  // Load the agent's one saved character.
  useEffect(() => {
    if (!mintAddress) return;
    let live = true;
    api<{ character: SavedCharacter | null }>(`/api/character?mint=${encodeURIComponent(mintAddress)}`)
      .then((d) => { if (live) setSaved(d.character); })
      .catch(() => { /* first visit / not signed in yet: show the builder */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mintAddress]);

  useEffect(() => {
    if (!authenticated || (!mintAddress && !onboarding)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setHistoryLoading(true);
      try {
        const data = await api<{ images: CharacterImage[]; pending: number }>(`/api/character/history?mint=${encodeURIComponent(mintAddress ?? "")}${onboarding ? "&draft=1" : ""}`);
        if (!live) return;
        setTiles(prev => {
          const known = new Set(prev.map(t => t.url).filter(Boolean));
          const recovered = data.images.filter(i => !known.has(i.url)).map(i => ({ id: tileId(), model: i.model, ratio: i.ratio ?? "3:4", status: "done" as const, url: i.url, startedAt: 0 }));
          return [...prev, ...recovered];
        });
        if (data.pending) timer = setTimeout(() => void load(), 10_000);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load image history");
      } finally { if (live) setHistoryLoading(false); }
    };
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [authenticated, accessToken, mintAddress, onboarding]);

  // Leaving the tab cancels any in-flight polling loops.
  useEffect(() => () => { runId.current++; }, []);

  const startEdit = useCallback(() => {
    if (saved) {
      setTier(saved.tier); setSelection(saved.selection); setModel(saved.model === "soul2" ? "soul2" : "soul"); setPhotoUrls(saved.photoUrls ?? (saved.photoUrl ? [saved.photoUrl] : []));
      setTiles(saved.candidates.map((c) => ({ id: tileId(), model: c.model, ratio: c.ratio ?? "3:4", status: "done" as const, url: c.url, startedAt: 0 })));
      setPickedUrl(saved.image.url);
    }
    setError(null);
    setEditing(true);
  }, [saved]);

  const toggle = (cid: string, oid: string, max: number) => {
    setPreset(null);
    setSelection((prev) => {
      const cur = prev[cid] ?? [];
      const next = cur.includes(oid) ? cur.filter((x) => x !== oid) : max === 1 ? [oid] : [...cur, oid].slice(-max);
      const copy = { ...prev };
      if (next.length) copy[cid] = next; else delete copy[cid];
      return copy;
    });
  };

  const changeTier = (t: Tier) => {
    setPreset(null);
    setTier(t);
    setSelection((prev) => {
      const out: Selection = {};
      for (const c of categoriesFor(t)) {
        const keep = (prev[c.id] ?? []).filter((id) => c.options.some((o) => o.id === id));
        if (keep.length) out[c.id] = keep;
      }
      return out;
    });
  };

  const applyPreset = (p: CharacterPreset) => {
    setPreset(p);
    setTier(p.tier);
    setSelection(sanitizeSelection(p.selection, p.tier));
  };

  const shuffle = () => {
    setPreset(null);
    const out: Selection = {};
    for (const c of categories) {
      if (c.max > 1 || c.id === "accessory") continue;
      out[c.id] = [c.options[Math.floor(Math.random() * c.options.length)].id];
    }
    setSelection(out);
  };

  const onPhoto = async (files: File[]) => {
    if (!canGenerate) { onNeedLogin?.(); return; }
    if (!files.length || uploading || (!mintAddress && !onboarding)) return;
    setUploading(true); setError(null);
    try {
      for (const file of files.slice(0, 3 - photoUrls.length)) {
      const fd = new FormData();
      fd.append("file", file);
      if (mintAddress) fd.append("mintAddress", mintAddress);
      if (onboarding) fd.append("draft", "1");
      const d = await api<{ url: string }>("/api/character/photo", { method: "POST", body: fd });
      setPhotoUrls(previous => [...previous, d.url].slice(0, 3));
      }
      if (ratio === "4:5") setRatio("3:4");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const patchTiles = useCallback((id: number, fn: (prev: Tile[]) => Tile[]) => {
    if (runId.current === id) setTiles(fn);
  }, []);

  const generate = async () => {
    if (!canGenerate) { onNeedLogin?.(); return; }
    if ((!mintAddress && !onboarding) || !ready || generating || uploading) return;
    setError(null);
    // Free allowance first, then a $0.10 USDC transfer from the account wallet to Solcameo. Null = top-up popup is open.
    const payment = await billing.prepare(count);
    if (!payment) return;
    const id = ++runId.current;
    setGenerating(true);
    try {
      const res = await api<{ jobs: { model: CharModel; requestId: string; ticket?: string; count?: number; ratio?: string }[] }>("/api/character/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, draft: onboarding, tier, selection, brief: preset?.brief || undefined, model: photoUrl ? "nano" : model, photoUrls, aspectRatio: ratio, count, useFree: billing.useFree, ...payment }),
      });
      billing.settled();
      const startedAt = Date.now();
      // Placeholder tiles go to the top of the masonry immediately so the feed reacts at once.
      const jobTiles = res.jobs.map((job) => ({
        job,
        tiles: Array.from({ length: job.count ?? count }, () => ({ id: tileId(), model: job.model, ratio: job.ratio ?? ratio, status: "pending" as const, startedAt })),
      }));
      setTiles((prev) => [...jobTiles.flatMap((j) => j.tiles), ...prev]);

      await Promise.all(jobTiles.map(async ({ job, tiles: mine }) => {
        const ids = new Set(mine.map((t) => t.id));
        const settle = (urls: string[], err?: string) => patchTiles(id, (prev) => {
          let i = 0;
          return prev.flatMap((t) => {
            if (!ids.has(t.id)) return [t];
            const url = urls[i++];
            if (url) return [{ ...t, status: "done" as const, url }];
            return err ? [{ ...t, status: "failed" as const, error: err }] : []; // extra tiles the model didn't return
          });
        });
        let delay = 2500;
        while (runId.current === id && Date.now() - startedAt < 5 * 60_000) {
          await sleep(delay);
          delay = Math.min(delay + 500, 5000);
          try {
            const r = await api<{ status: string; url?: string; urls?: string[]; error?: string }>(
              `/api/character/status?mint=${encodeURIComponent(mintAddress ?? "")}&id=${encodeURIComponent(job.requestId)}${onboarding ? "&draft=1" : ""}&ticket=${encodeURIComponent(job.ticket ?? "")}`,
            );
            if (r.status === "completed") { settle(r.urls?.length ? r.urls : r.url ? [r.url] : [], "No image came back"); return; }
            if (["failed", "nsfw", "canceled"].includes(r.status)) {
              const message = generationError(r.status, r.error);
              settle([], message);
              if (runId.current === id) setError(message);
              return;
            }
          } catch (e) {
            settle([], e instanceof Error ? e.message : "Status check failed");
            return;
          }
        }
        if (runId.current === id) settle([], "Timed out, try again");
      }));
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code === "payment_used") billing.discard();
      void billing.refresh();
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      if (runId.current === id) setGenerating(false);
    }
  };

  const save = async () => {
    const url = effectivePicked;
    const chosen = doneTiles.find((t) => t.url === url);
    if (!url || !chosen) return;
    if (onboarding) {
      onCharacterReady?.({ version: 1, tier, selection, prompt, model, image: { model: chosen.model, url, ratio: chosen.ratio }, candidates: doneTiles.slice(0, 24).map((t) => ({ model: t.model, url: t.url!, ratio: t.ratio })), photoUrl, photoUrls, updatedAt: Date.now() });
      return;
    }
    if (!mintAddress) return;
    setSaving(true); setError(null);
    try {
      const candidates: CharacterImage[] = doneTiles.slice(0, 24).map((t) => ({ model: t.model, url: t.url!, ratio: t.ratio }));
      const d = await api<{ character: SavedCharacter }>("/api/character", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, tier, selection, model, image: { model: chosen.model, url, ratio: chosen.ratio }, candidates, photoUrl, photoUrls }),
      });
      setSaved(d.character);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (!mintAddress && !onboarding) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-zinc-500">
        <div><Lock className="mx-auto mb-3 size-5" />Mint your agent to build its character.</div>
      </div>
    );
  }
  if (loading) {
    return <div className="flex h-full items-center justify-center" style={GLASS_BG}><Loader2 className="size-5 animate-spin text-zinc-500" /></div>;
  }

  const savedCard = !!saved && !editing && mode === "builder";
  const builderBody = mode === "builder" && !savedCard;
  const startMotion = (p: Parameters<typeof motion$.start>[0]) => { void motion$.start(p); };

  return (
    <div className="min-h-full" style={GLASS_BG}>
      <div className={`mx-auto grid max-w-6xl px-4 lg:grid-cols-[400px_1fr] ${onboarding ? "gap-3 py-3 lg:h-[calc(100dvh-3.5rem)]" : "gap-5 pb-8 pt-10"}`}>
        {/* LEFT: studio panel (same container for builder, saved influencer and Replicate) */}
        <div className={`flex min-h-[480px] flex-col overflow-hidden rounded-[32px] border border-white/[0.06] ${onboarding ? "h-[calc(100dvh-6.5rem)] lg:h-full lg:min-h-0" : "h-[calc(100dvh-192px)] lg:sticky lg:top-10 lg:self-start"}`} style={{ background: SURFACE.panel }}>
          <div className={`px-5 pt-2 text-center ${onboarding ? "pb-3" : "pb-6"}`}>
            <div className="flex h-4 items-center justify-between text-[12px]">
              <span className="w-16" />
              <AnimatePresence>
                {builderBody && picks > 0 && (
                  <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelection({})} className="text-zinc-500 transition-colors hover:text-white">Clear all ({picks})</motion.button>
                )}
              </AnimatePresence>
              {builderBody && saved ? <button onClick={() => setEditing(false)} className="flex w-16 items-center justify-end gap-1 text-zinc-500 transition-colors hover:text-white"><X className="size-3.5" /> Cancel</button> : <span className="w-16" />}
            </div>
            <p className="text-[12px] text-zinc-400">Create your own character with</p>
            <h2 className="text-[40px] font-black uppercase leading-[1.05] tracking-[0.04em] text-white" style={{ fontFamily: DISPLAY_FONT }}>AI Influencer</h2>
          </div>

          <div className={`px-4 ${savedCard ? "pb-5" : "pb-2.5"} ${onboarding ? "hidden" : ""}`}>
            <div className="grid grid-cols-2 rounded-2xl bg-black/40 p-1 text-[13px] font-semibold">
              {([["builder", "Influencer builder"], ["replicate", "Replicate"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setMode(id)}
                  className={`rounded-xl py-1.5 text-center transition-colors ${mode === id ? "border border-white/10 bg-[#202124] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "text-zinc-500 hover:text-zinc-300"}`}>{label}</button>
              ))}
            </div>
          </div>

          {mode === "replicate" ? (
            <ReplicatePanel mintAddress={mintAddress ?? ""} character={saved?.image.url} selected={pickedMotion} onClearSelected={() => setPickedMotion(null)} onGenerate={startMotion} />
          ) : savedCard && saved ? (
            <SavedCard character={saved} agentName={agentName} mintAddress={mintAddress} onEdit={startEdit} />
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-3 [scrollbar-width:thin]">
                <div className="flex items-center justify-between px-1 text-xs text-zinc-400"><span>Reference images</span><span>{photoUrls.length}/3 · optional</span></div>
                <div className="grid grid-cols-3 gap-2">
                  {photoUrls.map((url, index) => <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5"><img src={url} alt={`Reference ${index + 1}`} className="size-full object-cover" /><button type="button" disabled={uploading || generating} aria-label={`Remove reference ${index + 1}`} onClick={() => setPhotoUrls(previous => previous.filter((_, i) => i !== index))} className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white"><X className="size-3.5" /></button><span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white">{index === 0 ? "Primary" : `Reference ${index + 1}`}</span></div>)}
                  {photoUrls.length < 3 && <label className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-xs text-zinc-400 transition hover:border-[#d7ff00]/60 hover:text-white ${uploading ? "pointer-events-none" : ""}`}>
                    <input type="file" multiple disabled={uploading || generating} accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload reference images" onChange={e => { void onPhoto(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                    {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}<span>{uploading ? "Uploading…" : "Add images"}</span>
                  </label>}
                </div>
                <p className="px-1 text-[11px] leading-5 text-zinc-500">{photoUrl ? "Nano Banana Pro keeps your face, applies your traits and makes every image a new pose in the same style." : "Add up to three references to use Nano Banana Pro, or create with Soul and Soul 2."}</p>
                <Section title="Presets" count={PRESETS.length} icon={<Sparkles className="size-4" />} open={open.has("presets")} onToggle={() => setOpen(flip(open, "presets"))}>
                  <p className="px-1 pb-2 text-[11px] leading-5 text-zinc-500">Exact looks from the Higgsfield studio. Pick one to load its traits and original prompt, then generate. Every take gets a different pose.</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PRESETS.map((p, i) => <Card key={p.id} order={i} label={p.name} image={p.preview} selected={preset?.id === p.id} onClick={() => applyPreset(p)} />)}
                  </div>
                  {preset && <p className="px-1 pt-2 text-[11px] text-zinc-400"><span className="font-semibold text-white">{preset.name}</span> loaded. Changing any trait switches back to your own selection.</p>}
                </Section>
                <Section title="Character type" count={TIERS.length} icon={<Sparkles className="size-4" />} open={open.has("tier")} onToggle={() => setOpen(flip(open, "tier"))}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TIERS.map((t, i) => <Card key={t.id} showLabel order={i} label={t.label} image={t.image} characterType selected={tier === t.id} onClick={() => changeTier(t.id)} />)}
                  </div>
                </Section>

                {categories.map((c) => {
                  const n = selection[c.id]?.length ?? 0;
                  return (
                    <Section key={c.id} title={c.label} count={c.options.length} dot={n} icon={ICONS[c.id] ?? DEFAULT_ICON} open={open.has(c.id)} onToggle={() => setOpen(flip(open, c.id))}>
                      <div className={c.kind === "color" ? "flex flex-wrap gap-2 p-1.5" : c.kind === "text" ? "flex flex-wrap gap-1.5 p-1" : "grid grid-cols-4 gap-1.5"}>
                        {c.options.map((o, i) => {
                          const on = selection[c.id]?.includes(o.id) ?? false;
                          if (c.kind === "color") return <Swatch key={o.id} label={o.label} color={o.swatch ?? "#888"} selected={on} onClick={() => toggle(c.id, o.id, c.max)} />;
                          if (c.kind === "text") return <Pill key={o.id} label={o.label} selected={on} onClick={() => toggle(c.id, o.id, c.max)} />;
                          return <Card key={o.id} order={i} label={o.label} image={o.image} selected={on} onClick={() => toggle(c.id, o.id, c.max)} />;
                        })}
                      </div>
                    </Section>
                  );
                })}
                {onboarding && <StudioWalletBox billing={billing} />}
              </div>

              <div className="space-y-2 border-t border-white/[0.06] p-3" style={{ background: SURFACE.panel }}>
                <div className="flex gap-2">
                  <select aria-label="Higgsfield model" value={photoUrl ? "nano" : model === "soul2" ? "soul2" : "soul"} onChange={e => setModel(e.target.value as ModelChoice)} disabled={generating || !!photoUrl} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#202124] px-3 text-xs text-zinc-200"><option value="soul">Soul</option><option value="soul2">Soul 2</option><option value="nano" disabled={!photoUrl}>Nano Banana Pro · references</option></select>
                  <RatioSelect value={ratio} onChange={setRatio} disabled={generating} exclude={["4:5"]} />
                  <CountToggle value={count} onChange={setCount} disabled={generating} />
                </div>
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.9, rotate: 90 }} whileHover={{ rotate: -10 }} onClick={shuffle} disabled={generating} aria-label="Shuffle traits" title="Shuffle traits"
                    className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-black transition-opacity hover:bg-zinc-200 disabled:opacity-40">
                    <Shuffle className="size-4" />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.99 }}
                    disabled={!ready || generating || billing.paying} onClick={() => void generate()}
                    className="relative flex h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-lg text-sm font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                    style={{ background: LIME }}>
                    {billing.paying ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</> : generating ? <><Loader2 className="size-4 animate-spin" /> Generating…</> : ready ? <>Generate <Sparkles className="size-4 fill-black" /> <span title="Images per run">{images}</span>{priceLabel(billing, images) && <span className="rounded-full bg-black/15 px-2 py-0.5 text-[11px] font-semibold">{priceLabel(billing, images)}</span>}</> : "Pick a trait to start"}
                  </motion.button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT: feed. Builder = portrait feed; saved / Replicate = top video ideas from the motion library */}
        {builderBody ? (
          <Gallery
            tiles={tiles} generating={generating} pickedUrl={effectivePicked}
            onPick={(t) => setPickedUrl(t.url ?? null)}
            onDismiss={(tid) => setTiles((prev) => prev.filter((t) => t.id !== tid))}
            onShirt={canGenerate && (mintAddress || onboarding) ? setShirtTile : undefined}
            onSave={() => void save()} saving={saving} error={error} historyLoading={historyLoading} prompt={ready ? prompt : null} saveLabel={onboarding ? "Continue to coin details" : undefined} fill={onboarding}
          />
        ) : (
          <MotionSide
            runs={motion$.runs} onDismiss={motion$.dismiss} picked={pickedMotion} onPick={setPickedMotion}
            character={saved?.image.url} replicate={mode === "replicate"}
            onGenerate={() => { if (pickedMotion && saved) startMotion({ mode: "motion-transfer", videoUrl: pickedMotion.videoUrl, imageUrls: [saved.image.url], resolution: "720p", title: pickedMotion.title, poster: pickedMotion.thumbUrl }); }}
          />
        )}
      </div>
      <ShirtStudio
        tile={shirtTile} mintAddress={mintAddress} draft={onboarding} billing={billing} onClose={() => setShirtTile(null)}
        onResult={(url, ratio) => {
          // Saved the moment it finishes: the edited portrait is already in R2, so it joins the feed (and history) at once.
          setTiles((prev) => prev.some(t => t.url === url) ? prev : [{ id: tileId(), model: "reference", ratio, status: "done", url, startedAt: 0 }, ...prev]);
        }}
        onUse={(url) => setPickedUrl(url)}
      />
      <TopUpDialog billing={billing} />
    </div>
  );
}

const flip = (s: Set<string>, k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };

function SavedCard({ character, agentName, mintAddress, onEdit }: { character: SavedCharacter; agentName?: string; mintAddress?: string; onEdit: () => void }) {
  const influencer = useQuery(convexApi.influencers.getByMint, mintAddress ? { mintAddress } : "skip");
  const ticker = influencer?.coinTicker?.replace(/^\$/, "");
  const traits = useMemo(() => {
    const out: string[] = [];
    for (const c of categoriesFor(character.tier)) {
      for (const id of character.selection[c.id] ?? []) {
        const label = c.options.find((o) => o.id === id)?.label;
        if (label) out.push(label);
      }
    }
    return out;
  }, [character]);
  const shown = traits.slice(0, 6);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 pb-3 [scrollbar-width:thin]">
        <div className="px-1 pb-3 pt-1"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">Your character</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold leading-none tracking-tight text-white">{agentName || "Your AI influencer"}</h3>{ticker && <span className="inline-flex h-[22px] items-center rounded-[3px] bg-white px-1.5 text-[13px] font-semibold leading-none tracking-[-0.01em] text-black" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" }} aria-label={`Ticker ${ticker}`}><span className="mr-px text-black/45">$</span>{ticker.toUpperCase()}</span>}</div></div>
        <motion.div initial={{ scale: 0.97 }} animate={{ scale: 1 }} transition={SPRING} className="relative mx-auto w-full overflow-hidden rounded-[26px] ring-2 ring-lime-400/70 shadow-[0_24px_60px_-28px_rgba(163,230,53,0.5)]" style={{ aspectRatio: "1 / 1" }}>
          <img src={character.image.url} alt={agentName ? `${agentName} portrait` : "Your agent's character"} className="size-full object-cover object-[50%_25%] scale-[1.15]" />
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-black" style={{ background: LIME }}><Check className="size-3" strokeWidth={3.5} /> Saved</span>
          <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{MODEL_LABEL[character.image.model]}</span>
        </motion.div>
        <div className="px-1 pb-3 pt-5"><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">Character traits</p></div>
        <div className="flex flex-wrap gap-1.5 px-1">
          {traits.length === 0 && <span className="text-[12.5px] text-zinc-500">No traits</span>}
          {shown.map((t, i) => (
            <motion.span key={`${t}-${i}`} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.03 * i, ...SPRING }} className="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[12px] text-zinc-200">{t}</motion.span>
          ))}
          {traits.length > shown.length && <span className="rounded-full px-2 py-1 text-[12px] text-zinc-500">+{traits.length - shown.length}</span>}
        </div>
      </div>
      <div className="border-t border-white/[0.06] p-3" style={{ background: SURFACE.panel }}>
        <motion.button whileTap={{ scale: 0.99 }} onClick={onEdit}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-black"
          style={{ background: LIME }}>
          <Pencil className="size-4" /> Edit character
        </motion.button>
      </div>
    </motion.div>
  );
}

function MotionSide({ runs, onDismiss, picked, onPick, character, replicate, onGenerate }: {
  runs: MotionRun[]; onDismiss: (id: string) => void; picked: MotionItem | null; onPick: (m: MotionItem | null) => void;
  character?: string; replicate: boolean; onGenerate: () => void;
}) {
  return (
    <div className="relative min-w-0">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h3 className="text-[36px] font-black uppercase leading-none tracking-[-0.01em] text-white sm:text-[44px]" style={{ fontFamily: DISPLAY_FONT }}>Top video ideas</h3>
          <p className="mt-2 text-[14px] text-zinc-500">{replicate ? "Pick a motion, then Generate on the left." : "Trending motions from the Higgsfield library. Pick one to put your influencer in it."}</p>
        </div>
      </div>
      {runs.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Your videos</p>
          <RunsGrid runs={runs} onDismiss={onDismiss} />
        </div>
      )}
      <MotionLibrary selectedId={picked?.id} onSelect={onPick} />
      <AnimatePresence>
        {picked && !replicate && character && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={SPRING}
            className="sticky bottom-4 z-10 mx-auto mt-4 flex max-w-md items-center gap-3 rounded-md border border-white/10 p-2 pr-2.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl" style={{ background: "rgba(27,28,30,0.92)" }}>
            <img src={picked.thumbUrl ?? character} alt="" className="size-11 rounded-[4px] object-cover" />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-white">{picked.title}</span><span className="block text-[11px] text-zinc-500">with your AI influencer · 720p</span></span>
            <button type="button" onClick={onGenerate} className="h-10 rounded-[4px] px-4 text-sm font-medium text-black" style={{ background: LIME }}>Generate</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
