"use client";

import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Search, X, Check, Download, Loader2, Users, Zap,
  Store, ExternalLink, Sparkles, ShieldCheck,
  Captions, Megaphone, Share2, MessagesSquare, ImagePlus, Scissors, SlidersHorizontal,
  Clapperboard, Upload, Trash2, Images,
} from "lucide-react";
import { useMutation } from "convex/react";
import { getSkillsForAgent, estimateDailyBurn, type Skill } from "@/lib/builder/skillsCatalog";
import { CAPTION_PRESETS } from "@/lib/builder/captionPresets";
import { IMAGE_ENGINES, imageRetailPriceUsd, resolveImageEngine } from "@/lib/builder/imageEngines";
import { HOOK_DESIGNS, DEFAULT_HOOK_DESIGN_ID, DEFAULT_HOOK_DURATION_SEC } from "@/lib/builder/hookDesigns";
import tiktok from "@/assets/logos/tiktok.svg";
import solana from "@/assets/logos/solana.svg";
import gemini from "@/assets/logos/googlegemini.svg";

// Static SVG imports resolve to a string URL or a { src } object depending on the
// loader — normalise to a plain URL string (mirrors components/mach/logos.ts).
const logoUrl = (v: unknown): string => (typeof v === "string" ? v : (v as { src: string }).src);

// ─── App logos ───────────────────────────────────────────────────────────────
// App-Store feel: each card shows a real LOGO IMAGE (not a line icon). Brand-backed
// apps get their brand mark (white monochrome glyph, shown on the category-accent
// tile); Vello-native features get the full-colour Vello square app icon.
// `brand: true` → a white glyph centred on a coloured tile. Omitted → a full-bleed
// square app icon (the image carries its own background).
type AppIcon = { brand?: string; Icon?: React.ComponentType<{ className?: string }>; accent: string };
// Every app gets its OWN icon — a real brand mark where one genuinely fits, else a
// distinct line glyph relevant to the app's job. `accent` is the tile colour; the
// set is varied but tasteful so the grid reads lively yet cohesive with the cream/
// lime builder theme (no two apps share an icon).
const APP_ICON: Record<string, AppIcon> = {
  "music.trendingaudio": { brand: logoUrl(tiktok),  accent: "#18181b" }, // trending sounds → TikTok
  "video.autohook":      { Icon: Zap,               accent: "#d97706" }, // scroll-stopping hook
  "video.captions":      { Icon: Captions,          accent: "#0284c7" }, // burned-in captions
  "video.cta":           { Icon: Clapperboard,      accent: "#7c3aed" }, // CTA clip appended to end
  "video.series":        { Icon: Clapperboard,      accent: "#a855f7" }, // episodic character show
  "video.imageposts":    { Icon: Sparkles,          accent: "#ec4899" }, // KIE stills instead of video
  "clip.carouselbuilder": { Icon: Images,           accent: "#65a30d" }, // multi-image swipeable carousels
  "video.hookvideos":    { Icon: Clapperboard,      accent: "#f59e0b" }, // uploaded openers
  "video.maincontent":   { Icon: Clapperboard,      accent: "#0ea5e9" }, // uploaded body videos
  "monetize.pervideo":   { brand: logoUrl(solana),  accent: "#6d28d9" }, // USDC payouts on Solana
  "vello.campaigns":     { Icon: Megaphone,         accent: "#4d7c0f" }, // brand campaigns (lime)
  "social.uploadpost":   { Icon: Share2,            accent: "#0d9488" }, // multi-platform auto-post
  "social.fanreply":     { Icon: MessagesSquare,    accent: "#be123c" }, // daily fan replies
  "kie.video.generate":  { brand: logoUrl(gemini),  accent: "#4f46e5" }, // AI video (Veo/Gemini)
  "kie.image.generate":  { Icon: ImagePlus,         accent: "#db2777" }, // AI image generation
  "video.clip":          { Icon: Scissors,          accent: "#ea580c" }, // clip a long video
  "video.edit":          { Icon: SlidersHorizontal, accent: "#0891b2" }, // AI video editor
};
const appIcon = (id: string): AppIcon => APP_ICON[id] ?? { Icon: Store, accent: "#52525b" };

/** The app's icon rendered as a coloured app-tile (white glyph on the app's accent
 *  — a brand mark, or a distinct line glyph). `tileClassName` controls size/rounding
 *  so the card (small) and the modal header (larger) share one renderer. */
function AppLogo({ skillId, tileClassName = "size-12 rounded-xl", imgClassName = "size-6" }: {
  skillId: string; tileClassName?: string; imgClassName?: string;
}) {
  const cfg = appIcon(skillId);
  const Glyph = cfg.Icon;
  return (
    <span className={`grid ${tileClassName} shrink-0 place-items-center shadow-sm ring-1 ring-black/5`} style={{ background: cfg.accent }}>
      {cfg.brand ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cfg.brand} alt="" className={`${imgClassName} object-contain`} style={{ filter: "brightness(0) invert(1)" }} />
      ) : Glyph ? (
        <Glyph className={`${imgClassName} text-white`} />
      ) : null}
    </span>
  );
}

const CAT_META: Record<string, { label: string; accent: string; soft: string; Icon: React.ComponentType<{ className?: string }> }> = {
  content:       { label: "Content",       accent: "#7c3aed", soft: "#f3e8ff", Icon: Sparkles },
  distribution:  { label: "Distribution",  accent: "#0ea5e9", soft: "#e0f2fe", Icon: Zap },
  monetization:  { label: "Monetization",  accent: "#16a34a", soft: "#dcfce7", Icon: Store },
  messaging:     { label: "Messaging",     accent: "#db2777", soft: "#fce7f3", Icon: Users },
  data:          { label: "Data",          accent: "#ca8a04", soft: "#fef9c3", Icon: Zap },
  intelligence:  { label: "Intelligence",  accent: "#4f46e5", soft: "#e0e7ff", Icon: Sparkles },
  execution:     { label: "Execution",     accent: "#0d9488", soft: "#ccfbf1", Icon: Zap },
};
const catMeta = (c: string) => CAT_META[c] ?? { label: c, accent: "#525252", soft: "#f4f4f5", Icon: Store };
const priceLabel = (s: Skill) => (s.pricePerUseUsdc > 0 ? `$${s.pricePerUseUsdc}/${s.pricingUnit}` : "Free");

interface Props {
  installedSkills: string[];
  onToggleSkill: (skillId: string, install: boolean) => void;
  mintAddress?: string;
}

export default function AppStoreTab({ installedSkills, onToggleSkill, mintAddress }: Props) {
  const apps = useMemo(() => getSkillsForAgent("influencer"), []);
  const counts = useQuery(api.influencers.installCounts, {}) as Record<string, number> | undefined;
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(apps.map((a) => a.category))), [apps]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter((a) => {
      if (cat !== "all" && a.category !== cat) return false;
      if (!q) return true;
      return (a.name + " " + a.description + " " + a.provider).toLowerCase().includes(q);
    });
  }, [apps, query, cat]);

  const open = openId ? apps.find((a) => a.id === openId) ?? null : null;

  return (
    <section className="max-w-[1100px] mx-auto px-6 py-8" style={{ fontFamily: "var(--font-inter)" }}>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-[26px] font-bold text-zinc-900 leading-none tracking-tight flex items-center gap-2">
            <Store className="size-6 text-zinc-900" /> App Store
          </h2>
          <p className="text-[13px] text-zinc-500 mt-2">
            Install apps to give your AI influencer new powers, music, hooks, captions, posting, campaigns and more.
          </p>
        </div>
        <div className="relative">
          <Search className="size-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps…"
            className="w-[240px] rounded-full border border-zinc-300 bg-white pl-9 pr-3 py-2 text-[13px] text-zinc-800 outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {/* Category chips */}
      <div className="flex items-center gap-1.5 mt-5 overflow-x-auto pb-1">
        {["all", ...categories].map((c) => {
          const active = cat === c;
          const label = c === "all" ? "All" : catMeta(c).label;
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                active ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 border border-zinc-300 hover:border-zinc-400"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
        {filtered.map((s) => (
          <AppCard
            key={s.id}
            skill={s}
            installed={installedSkills.includes(s.id)}
            count={counts?.[s.id]}
            onOpen={() => setOpenId(s.id)}
            onToggle={() => onToggleSkill(s.id, !installedSkills.includes(s.id))}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-[13px] text-zinc-500 col-span-full py-10 text-center">No apps match your search.</p>
        )}
      </div>

      {/* Detail modal */}
      <AnimatePresence>
        {open && (
          <AppDetail
            key={open.id}
            skill={open}
            installed={installedSkills.includes(open.id)}
            count={counts?.[open.id]}
            mintAddress={mintAddress}
            onToggle={() => onToggleSkill(open.id, !installedSkills.includes(open.id))}
            onClose={() => setOpenId(null)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function AppCard({ skill, installed, count, onOpen, onToggle }: {
  skill: Skill; installed: boolean; count?: number; onOpen: () => void; onToggle: () => void;
}) {
  const cm = catMeta(skill.category);
  return (
    <motion.div
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="group cursor-pointer rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-zinc-300 hover:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.25)] transition-all"
    >
      <div className="flex items-start gap-3">
        <AppLogo skillId={skill.id} tileClassName="size-12 rounded-xl" imgClassName="size-6" />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold text-zinc-900 leading-tight truncate">{skill.name}</p>
          <p className="text-[11.5px] text-zinc-500 truncate">{skill.provider}</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-zinc-600 leading-snug line-clamp-2 min-h-[32px]">{skill.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[11px] text-zinc-500">
          <span className="font-mono font-semibold text-zinc-700">{priceLabel(skill)}</span>
          {typeof count === "number" && (
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{count.toLocaleString()}</span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${
            installed
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
              : "bg-zinc-900 text-white hover:bg-zinc-800"
          }`}
        >
          {installed ? <><Check className="size-3.5" /> Installed</> : <><Download className="size-3.5" /> Install</>}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────
function AppDetail({ skill, installed, count, mintAddress, onToggle, onClose }: {
  skill: Skill; installed: boolean; count?: number; mintAddress?: string; onToggle: () => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const cm = catMeta(skill.category);
  const dailyBurn = estimateDailyBurn([skill.id]);

  if (!mounted) return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] grid place-items-center px-4"
      onClick={onClose}
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        {/* Header, compact + theme-matched (cream/ink/lime). Replaces the oversized
            rainbow banner that broke the modal and clashed with the paper theme. */}
        <div className="flex items-center gap-3 border-b border-zinc-900/10 bg-[#fbfaf6] px-5 py-4">
          <AppLogo skillId={skill.id} tileClassName="size-11 rounded-xl" imgClassName="size-6" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-extrabold leading-tight text-zinc-900">{skill.name}</h3>
            <p className="truncate text-[11.5px] text-zinc-500">{skill.provider} · {cm.label}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-500"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 pb-6">

          {/* Install button */}
          <button
            onClick={onToggle}
            className={`mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-extrabold transition-colors ${
              installed ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100" : "bg-zinc-900 text-white hover:bg-zinc-800"
            }`}
          >
            {installed ? <><Check className="size-4" /> Installed, tap to remove</> : <><Download className="size-4" /> Install app</>}
          </button>

          {/* Stat row */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Price" value={priceLabel(skill)} />
            <Stat label="Installs" value={typeof count === "number" ? count.toLocaleString() : "-"} />
            <Stat label="Est. / day" value={dailyBurn > 0 ? `$${dailyBurn.toFixed(2)}` : "$0"} />
          </div>

          {/* Description */}
          <p className="mt-4 text-[13.5px] text-zinc-700 leading-relaxed whitespace-pre-wrap">{skill.description}</p>

          {/* API tier / requirements */}
          {(skill.apiTier || (skill.requires && skill.requires.length > 0)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              {skill.apiTier && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-600 capitalize">
                  <ShieldCheck className="size-3" /> {skill.apiTier}
                </span>
              )}
              {skill.setupUrl && (
                <a href={skill.setupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold">
                  Setup <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          )}

          {/* App-specific config */}
          {installed && skill.id === "music.trendingaudio" && (
            <MusicConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.captions" && (
            <CaptionConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.autohook" && (
            <HookConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.cta" && (
            <CtaConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.imageposts" && (
            <ImagePostsConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.series" && (
            <SeriesConfig mintAddress={mintAddress} accent={cm.accent} />
          )}
          {installed && skill.id === "video.hookvideos" && (
            <VideoPoolConfig
              mintAddress={mintAddress} accent={cm.accent} field="hookVideos"
              title="Hook videos"
              caption="Played before every video"
              blurb="Upload several openers. The one whose content best matches the video airs; until they're transcribed they rotate, so every hook gets used."
            />
          )}
          {installed && skill.id === "video.maincontent" && (
            <VideoPoolConfig
              mintAddress={mintAddress} accent={cm.accent} field="mainVideos" bypass
              title="Main content videos"
              caption="Used as the body"
              blurb="Upload the footage you want published. They cycle to fill the run's video count."
            />
          )}
          {installed && skill.id === "clip.carouselbuilder" && (
            <div className="mt-4 rounded-xl border border-lime-200 bg-lime-50 px-3.5 py-3 text-[12.5px] text-lime-800">
              Installed, a new <span className="font-bold">Carousel</span> tab now appears in the sidebar. Generate and post multi-image carousels from there.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 py-2.5">
      <p className="text-[15px] font-extrabold text-zinc-900 tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}

// ─── Music loudness slider + save (Trending Audio) ────────────────────────────
const MUSIC_MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40MB, plenty for one MP3 track

function MusicConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { music?: { volumePct?: number; customUrl?: string; customStorageId?: string } } }
    | null
    | undefined;
  const savedPct = doc?.videoConfig?.music?.volumePct;
  const savedCustomUrl = doc?.videoConfig?.music?.customUrl;
  const savedCustomStorageId = doc?.videoConfig?.music?.customStorageId;
  const [pct, setPct] = useState(30);
  const [customUrl, setCustomUrl] = useState<string | undefined>(undefined);
  const [customStorageId, setCustomStorageId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  // Sync from the saved value once it loads.
  useEffect(() => {
    if (typeof savedPct === "number") setPct(savedPct);
  }, [savedPct]);
  useEffect(() => {
    setCustomUrl(savedCustomUrl);
    setCustomStorageId(savedCustomStorageId);
  }, [savedCustomUrl, savedCustomStorageId]);

  const dirty = (typeof savedPct === "number" ? pct !== savedPct : pct !== 30) || customUrl !== savedCustomUrl;

  const persist = async (nextCustomUrl: string | undefined, nextCustomStorageId: string | undefined, nextPct: number) => {
    if (!mintAddress) { setErr("Mint the agent to save music settings."); return; }
    setSaving(true); setErr(""); setSaved(false);
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          kind: "video",
          payload: {
            music: {
              enabled: true,
              autoMusic: !nextCustomUrl,
              volumePct: nextPct,
              ...(nextCustomUrl ? { customUrl: nextCustomUrl, customStorageId: nextCustomStorageId } : {}),
            },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      setCustomUrl(nextCustomUrl);
      setCustomStorageId(nextCustomStorageId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (file: File) => {
    setErr("");
    if (!file.type.startsWith("audio/") && !/\.mp3$/i.test(file.name)) { setErr("Pick an audio file (.mp3/.m4a/.wav)."); return; }
    if (file.size > MUSIC_MAX_UPLOAD_BYTES) { setErr(`File is ${(file.size / 1048576).toFixed(0)}MB, keep the track under 40MB.`); return; }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "audio/mpeg" }, body: file });
      if (!up.ok) throw new Error(`upload failed (${up.status})`);
      const { storageId } = (await up.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (!publicUrl) throw new Error("could not resolve uploaded track");
      await persist(publicUrl, storageId, pct);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">Music loudness</p>
        <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: accent }}>{pct}%</span>
      </div>
      <p className="text-[11px] text-zinc-500 mt-0.5">
        {customUrl ? "How loud your uploaded track sits under the voiceover." : "How loud the trending track sits under the voiceover."} 30% keeps speech clear.
      </p>
      <input
        type="range" min={0} max={100} step={5}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        className="mt-3 w-full accent-current"
        style={{ accentColor: accent }}
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void persist(customUrl, customStorageId, pct)}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
          {saved ? "Saved" : "Save"}
        </button>
        <button onClick={() => setPct(30)} className="text-[12px] text-zinc-500 hover:text-zinc-800">Reset to 30%</button>
      </div>
      {err && <p className="mt-2 text-[11px] text-rose-600">{err}</p>}

      <div className="mt-4 border-t border-zinc-200 pt-3.5">
        <p className="text-[12.5px] font-semibold text-zinc-800">Or use your own song</p>
        {customUrl ? (
          <div className="mt-2 space-y-2">
            <audio src={customUrl} controls className="w-full" />
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {busy ? "Uploading…" : "Replace"}
                <input type="file" accept="audio/*,.mp3" className="hidden" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
              </label>
              <button
                type="button"
                disabled={busy || saving}
                onClick={() => void persist(undefined, undefined, pct)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            </div>
          </div>
        ) : (
          <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-5 text-center transition-colors hover:border-zinc-400">
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin text-zinc-400" />
                <span className="text-xs text-zinc-600">Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-zinc-400" />
                <span className="text-xs text-zinc-600">Upload an MP3</span>
                <span className="text-[10.5px] text-zinc-400">Plays instead of the curated pack · up to 40MB</span>
              </>
            )}
            <input type="file" accept="audio/*,.mp3" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
          </label>
        )}
      </div>
    </div>
  );
}

/** Caption-template picker for the influencer's "Captions" app — the same preset
 *  library the clipper uses (lib/builder/captionPresets.ts). Choosing one saves
 *  videoConfig.captions.style.preset; the render pipeline (render-step →
 *  overlay-burn → renderCaptionsAss) then transcribes each generated video and
 *  burns word-synced captions in that template. */
function CaptionConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { captions?: { style?: { mode?: string; fontColor?: string; fontSize?: number; position?: string; preset?: string } } } }
    | null
    | undefined;
  const savedStyle = doc?.videoConfig?.captions?.style;
  const savedPreset = savedStyle?.preset;
  const [selected, setSelected] = useState(savedPreset ?? "default");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // Sync to the persisted preset once it loads.
  useEffect(() => { if (savedPreset) setSelected(savedPreset); }, [savedPreset]);

  const choose = async (id: string) => {
    setSelected(id);
    if (!mintAddress) { setErr("Mint the agent to save the caption style."); return; }
    setSaving(id); setErr("");
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          kind: "video",
          // Preserve the existing style fields (required by the validator); the
          // preset drives the actual burned-in look in the renderer.
          payload: {
            captions: {
              enabled: true,
              style: {
                mode: savedStyle?.mode ?? "word",
                fontColor: savedStyle?.fontColor ?? "#FFFFFF",
                fontSize: savedStyle?.fontSize ?? 66,
                position: savedStyle?.position ?? "bottom",
                preset: id,
              },
            },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">Caption template</p>
        <span className="text-[11px] font-semibold" style={{ color: accent }}>Active on every video</span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500">Every generated video is transcribed and captioned in this style. Tap to choose.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {CAPTION_PRESETS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void choose(p.id)}
              aria-pressed={active}
              className={`relative overflow-hidden rounded-xl border-2 p-3 text-left transition ${active ? "border-zinc-900" : "border-transparent hover:border-zinc-400"}`}
              style={{ background: p.preview.chipBg ?? "#0A0A0A" }}
            >
              <span className="block text-center text-[14px] leading-tight">
                <span style={p.preview.base}>Your </span>
                <span style={p.preview.active ?? p.preview.base}>caption</span>
              </span>
              <span className="mt-2 block text-[10.5px] font-semibold text-white/80">{p.name}</span>
              {saving === p.id ? (
                <span className="absolute right-1.5 top-1.5"><Loader2 className="size-3.5 animate-spin text-white" /></span>
              ) : active ? (
                <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-white text-zinc-900"><Check className="size-3" /></span>
              ) : null}
            </button>
          );
        })}
      </div>
      {err && <p className="mt-2 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

// ─── Auto Hook: template + duration + Kie-generated hook line ──────────────────
/** Config for the influencer's "Auto Hook" app. The operator picks a style
 *  template (lib/builder/hookDesigns.ts), how many seconds it shows, and writes a
 *  brief we turn into a short hook via Kie (/api/agents/hook/generate). We persist
 *  videoConfig.hookText; the render pipeline (render-step / videoJobs →
 *  overlay-burn) resolves the design and burns the hook — centered, multi-line,
 *  never to the edge — over the opening seconds of every generated video. */
const HOOK_DURATION_CHOICES = [3, 5, 8, 12] as const;

function HookConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { hookText?: { text?: string; templateId?: string; durationSeconds?: number; prompt?: string } } }
    | null
    | undefined;
  const saved = doc?.videoConfig?.hookText;

  const [templateId, setTemplateId] = useState(DEFAULT_HOOK_DESIGN_ID);
  const [duration, setDuration] = useState<number>(DEFAULT_HOOK_DURATION_SEC);
  const [prompt, setPrompt] = useState("");
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [err, setErr] = useState("");

  // Hydrate once the persisted config loads.
  useEffect(() => {
    if (!saved) return;
    if (saved.templateId) setTemplateId(saved.templateId);
    if (typeof saved.durationSeconds === "number") setDuration(saved.durationSeconds);
    if (typeof saved.prompt === "string") setPrompt(saved.prompt);
    if (typeof saved.text === "string") setText(saved.text);
  }, [saved]);

  const generate = async () => {
    if (!prompt.trim()) { setErr("Describe the hook you want first."); return; }
    setGenerating(true); setErr("");
    try {
      const res = await fetch("/api/agents/hook/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; hook?: string; error?: string };
      if (!res.ok || json.ok === false || !json.hook) throw new Error(json.error || `Generation failed (${res.status})`);
      setText(json.hook);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!mintAddress) { setErr("Mint the agent to save the hook."); return; }
    setSaving(true); setErr(""); setSavedOk(false);
    let line = text.trim();
    try {
      // Auto Hook that works even without a pinned line: when the operator left the
      // hook line empty but wrote a brief, generate the line from the brief NOW so a
      // real, saved hook is burned on every video (transcript-free — no caption/audio
      // required). The render pipeline also regenerates per-video from the prompt, so
      // this is belt-and-suspenders, not the only path.
      if (!line && prompt.trim()) {
        const g = await fetch("/api/agents/hook/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() }),
        });
        const gj = (await g.json().catch(() => ({}))) as { ok?: boolean; hook?: string };
        if (g.ok && gj.ok !== false && typeof gj.hook === "string" && gj.hook.trim()) {
          line = gj.hook.trim();
          setText(line);
        }
      }
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          kind: "video",
          payload: {
            hookText: {
              enabled: true,
              // A generated line pins a custom hook on every video; empty falls back
              // to each video's own script hook — still styled by the chosen template.
              source: line ? "custom" : "auto",
              text: line,
              templateId,
              durationSeconds: duration,
              prompt: prompt.trim(),
              // `style` is required by the validator; the template drives the actual
              // burned-in look, so we store neutral defaults here.
              style: { mode: "line", fontColor: "#FFFFFF", fontSize: 56, position: "top" },
            },
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const previewText = text.trim() || "Wait till you see this…";

  return (
    <div className="mt-5 space-y-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">Auto Hook</p>
        <span className="text-[11px] font-semibold" style={{ color: accent }}>Burned on every video</span>
      </div>

      {/* Prompt → Kie-generated hook */}
      <div>
        <label htmlFor="hook-prompt" className="text-[11.5px] font-semibold text-zinc-700">What kind of hook?</label>
        <p className="text-[11px] text-zinc-500">Describe the angle, we write a short, scroll-stopping line with AI.</p>
        <textarea
          id="hook-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. bold contrarian take about saving money in your 20s"
          className="mt-2 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12.5px] text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          style={{ ["--tw-ring-color" as string]: accent }}
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating || !prompt.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-bold text-zinc-800 transition-colors hover:bg-zinc-100 disabled:opacity-50"
        >
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" style={{ color: accent }} />}
          {generating ? "Writing…" : "Generate hook"}
        </button>
      </div>

      {/* Editable hook line */}
      <div>
        <label htmlFor="hook-text" className="text-[11.5px] font-semibold text-zinc-700">Hook line</label>
        <input
          id="hook-text"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={90}
          placeholder="Generate one above, or type your own"
          className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12.5px] text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          style={{ ["--tw-ring-color" as string]: accent }}
        />
        <p className="mt-1 text-[10.5px] text-zinc-400">Leave empty to use each video&apos;s own hook line, still in the style below.</p>
      </div>

      {/* Style templates */}
      <div>
        <p className="text-[11.5px] font-semibold text-zinc-700">Style</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {HOOK_DESIGNS.map((d) => {
            const active = templateId === d.id;
            const label = d.render.allCaps ? previewText.toUpperCase() : previewText;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setTemplateId(d.id)}
                aria-pressed={active}
                title={d.blurb}
                className={`relative grid min-h-[52px] place-items-center overflow-hidden rounded-xl border-2 p-2.5 text-center transition ${active ? "border-zinc-900" : "border-transparent hover:border-zinc-400"}`}
                style={{ background: "#101014" }}
              >
                <span className="block text-[12.5px] leading-tight line-clamp-2" style={d.preview}>{label}</span>
                <span className="mt-1 block text-[9.5px] font-semibold uppercase tracking-wide text-white/55">{d.name}</span>
                {active ? (
                  <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-white text-zinc-900"><Check className="size-3" /></span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Duration */}
      <div>
        <p className="text-[11.5px] font-semibold text-zinc-700">On screen for</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {HOOK_DURATION_CHOICES.map((s) => {
            const active = duration === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setDuration(s)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold tabular-nums transition-colors ${active ? "border-transparent text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}
                style={active ? { background: accent } : undefined}
              >
                {s}s
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[12.5px] font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : savedOk ? <Check className="size-3.5" /> : null}
          {savedOk ? "Saved" : "Save hook"}
        </button>
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
      </div>
    </div>
  );
}




// ─── Image Posts: KIE stills instead of video ────────────────────────────────
/**
 * Config for the Image Posts app (video.imageposts).
 *
 * Three controls, because three is all it needs: whether to stop making video at
 * all, the standing idea every image follows, and which engine renders it. The
 * engine list comes from the shared registry, so the dropdown can never offer a
 * model the server can't call.
 */
function ImagePostsConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { imagePosts?: { enabled?: boolean; imageOnly?: boolean; idea?: string; engine?: string } } }
    | null
    | undefined;
  const saved = doc?.videoConfig?.imagePosts ?? {};
  const [ideaDraft, setIdeaDraft] = useState<string | null>(null);
  const idea = ideaDraft ?? saved.idea ?? "";
  const engine = resolveImageEngine(saved.engine);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const persist = async (next: Record<string, unknown>) => {
    if (!mintAddress) { setErr("Mint the agent to save this."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "video", payload: { imagePosts: { ...saved, ...next } } }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">Image posts</p>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold" style={{ color: accent }}>
          <input
            type="checkbox"
            checked={saved.enabled === true}
            disabled={saving}
            onChange={(e) => void persist({ enabled: e.target.checked })}
            className="size-3.5 accent-zinc-900"
          />
          On
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3">
        <input
          type="checkbox"
          checked={saved.imageOnly === true}
          disabled={saving || saved.enabled !== true}
          onChange={(e) => void persist({ imageOnly: e.target.checked })}
          className="mt-0.5 size-4 accent-zinc-900"
        />
        <span>
          <span className="block text-[12px] font-semibold text-zinc-800">Generate image only</span>
          <span className="block text-[11px] text-zinc-500">
            Skip video generation entirely, every post becomes a still, published as a photo to your connected
            accounts. Costs one image (~${imageRetailPriceUsd(engine).toFixed(3)}) instead of a video render.
          </span>
        </span>
      </label>

      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-zinc-700">What should the images be?</p>
        <textarea
          value={idea}
          onChange={(e) => setIdeaDraft(e.target.value)}
          onBlur={() => idea !== (saved.idea ?? "") && void persist({ idea })}
          rows={3}
          placeholder="e.g. moody desk shots of the product next to coffee, always shot from above, warm light"
          className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12px] text-zinc-800 placeholder:text-zinc-400"
        />
        <p className="mt-1 text-[10.5px] text-zinc-500">
          A standing brief. Each post still gets its OWN prompt, written from this plus the agent&apos;s persona and
          what it has posted recently, so the images stay on-theme without repeating.
        </p>
      </div>

      <div>
        <p className="mb-1 text-[11.5px] font-semibold text-zinc-700">Image engine</p>
        <select
          value={engine.id}
          disabled={saving}
          onChange={(e) => void persist({ engine: e.target.value })}
          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12px] font-medium text-zinc-800"
        >
          {IMAGE_ENGINES.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label} · {opt.resolution} · ${imageRetailPriceUsd(opt).toFixed(3)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10.5px] text-zinc-500">{engine.blurb}</p>
        {!engine.acceptsReferences && (
          <p className="mt-1 text-[10.5px] text-amber-700">
            This engine takes no character reference, so the agent&apos;s avatar won&apos;t appear in the image.
          </p>
        )}
      </div>

      {err && <p className="text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

// ─── Cartoon Series: cast, premise, and the episode log ───────────────────────
/**
 * Config surface for the Cartoon Series app (video.series).
 *
 * Three jobs, in the order an operator actually does them: describe the show,
 * build the cast (each character's generated design sheet becomes its locked
 * reference), then watch the episodes come out — including WHY the planner chose
 * each one, because "continued the keys thread" is the difference between a show
 * and a pile of clips.
 */
type CastMember = { name: string; role?: string; designPrompt?: string; refImages?: string[] };
type SeriesCfg = { enabled?: boolean; premise?: string; world?: string; themes?: string[]; cast?: CastMember[] };

const CHARACTER_MEDIUM_CHIPS = [
  { id: "2d", label: "2D cartoon" },
  { id: "3d", label: "3D animated" },
  { id: "claymation", label: "Claymation" },
  { id: "pixel", label: "Pixel art" },
];

function SeriesConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { series?: SeriesCfg } }
    | null
    | undefined;
  const episodes = useQuery(api.seriesEpisodes.recent, mintAddress ? { mintAddress, limit: 8 } : "skip") as
    | { number: number; premise: string; intent: string; openThreads?: string[]; cliffhanger?: boolean; cast?: string[] }[]
    | undefined;

  const saved: SeriesCfg = doc?.videoConfig?.series ?? {};
  // Draft-or-saved rather than an effect that copies the query into state: syncing
  // with setState inside an effect cascades a render every time the query result
  // changes, and would clobber what the operator is mid-way through typing.
  const [premiseDraft, setPremiseDraft] = useState<string | null>(null);
  const [worldDraft, setWorldDraft] = useState<string | null>(null);
  const premise = premiseDraft ?? saved.premise ?? "";
  const world = worldDraft ?? saved.world ?? "";
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // New-character form.
  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const [medium, setMedium] = useState("2d");
  const [designing, setDesigning] = useState(false);
  // Manual episode prompt.
  const [episodePrompt, setEpisodePrompt] = useState("");
  const [firing, setFiring] = useState(false);
  const [fired, setFired] = useState("");

  const persist = async (next: SeriesCfg) => {
    if (!mintAddress) { setErr("Mint the agent to save the series."); return false; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "video", payload: { series: { ...saved, ...next } } }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Generate a character's design sheet, then save the character with its frames.
   * Create + poll, because holding the request open while the model renders is what
   * makes a proxy return an HTML error page instead of JSON.
   */
  const addCharacter = async () => {
    setErr("");
    if (!charName.trim()) { setErr("Give the character a name."); return; }
    if (charDesc.trim().length < 8) { setErr("Describe the character, colour, body, one distinctive feature."); return; }
    setDesigning(true);
    try {
      const createRes = await fetch("/api/agents/character-design/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: charName.trim(), description: charDesc.trim(), medium }),
      });
      const created = (await createRes.json().catch(() => ({}))) as { tasks?: { taskId: string; view: string }[]; error?: string };
      if (!createRes.ok || !created.tasks?.length) throw new Error(created.error || "could not start the design sheet");

      // Poll until every view is done. ~2 minutes is generous for three frames; past
      // that the operator gets a real error instead of a spinner forever.
      const deadline = Date.now() + 150_000;
      let images: { view: string; url: string }[] = [];
      for (;;) {
        if (Date.now() > deadline) throw new Error("the design sheet is taking too long, try again");
        await new Promise((r) => setTimeout(r, 4000));
        const collectRes = await fetch("/api/agents/character-design/collect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tasks: created.tasks }),
        });
        const out = (await collectRes.json().catch(() => ({}))) as { pending?: boolean; images?: { view: string; url: string }[]; error?: string };
        if (out.error) throw new Error(out.error);
        if (out.pending) continue;
        images = out.images ?? [];
        break;
      }
      if (!images.length) throw new Error("the design sheet came back empty");

      const cast = [...(saved.cast ?? []), {
        name: charName.trim(),
        role: (saved.cast?.length ?? 0) === 0 ? "lead" : "co-star",
        designPrompt: charDesc.trim(),
        refImages: images.map((i) => i.url),
      }];
      if (await persist({ cast })) { setCharName(""); setCharDesc(""); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not design the character");
    } finally {
      setDesigning(false);
    }
  };

  const makeEpisode = async () => {
    if (!mintAddress) { setErr("Mint the agent first."); return; }
    setFiring(true); setErr(""); setFired("");
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "create_video",
          title: episodePrompt.trim() ? `Episode: ${episodePrompt.trim().slice(0, 60)}` : "Next episode",
          // No prompt = let the planner decide from the show's memory, exactly as the
          // agent does on its own schedule.
          input: episodePrompt.trim() ? { topic: episodePrompt.trim() } : {},
          triggeredBy: "series_panel",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok || data.error) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setFired("Episode queued, it'll appear in Generations when it renders.");
      setEpisodePrompt("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not queue the episode");
    } finally {
      setFiring(false);
    }
  };

  const castList = saved.cast ?? [];

  return (
    <div className="mt-5 space-y-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">The show</p>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold" style={{ color: accent }}>
          <input
            type="checkbox"
            checked={saved.enabled === true}
            disabled={saving}
            onChange={(e) => void persist({ enabled: e.target.checked })}
            className="size-3.5 accent-zinc-900"
          />
          Series mode on
        </label>
      </div>
      <p className="-mt-3 text-[11px] text-zinc-500">
        With this on, every video the agent makes, on its own schedule too, is the next episode.
      </p>

      <div className="space-y-2">
        <input
          value={premise}
          onChange={(e) => setPremiseDraft(e.target.value)}
          onBlur={() => premise !== saved.premise && void persist({ premise })}
          placeholder="Premise, e.g. two aliens run a failing space diner"
          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12px] text-zinc-800 placeholder:text-zinc-400"
        />
        <input
          value={world}
          onChange={(e) => setWorldDraft(e.target.value)}
          onBlur={() => world !== saved.world && void persist({ world })}
          placeholder="World, e.g. a rusted diner orbiting a dead moon"
          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12px] text-zinc-800 placeholder:text-zinc-400"
        />
      </div>

      {/* ── Cast ─────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[12px] font-semibold text-zinc-800">Cast</p>
        <p className="text-[11px] text-zinc-500">
          Up to 3 appear per episode, the video model locks at most three references. A bigger cast rotates, and the
          first character is always the lead.
        </p>
        {castList.length > 0 && (
          <ul className="mt-2 space-y-2">
            {castList.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-2">
                <div className="flex gap-1">
                  {(c.refImages ?? []).slice(0, 3).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="size-12 rounded-lg border border-zinc-200 object-cover" />
                  ))}
                </div>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-zinc-800">{c.name}{c.role ? ` · ${c.role}` : ""}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{c.designPrompt}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void persist({ cast: castList.filter((_, idx) => idx !== i) })}
                  disabled={saving}
                  aria-label={`Remove ${c.name}`}
                  className="rounded-lg border border-zinc-300 bg-white p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 space-y-2 rounded-xl border border-dashed border-zinc-300 bg-white p-3">
          <input
            value={charName}
            onChange={(e) => setCharName(e.target.value)}
            placeholder="Character name, e.g. Gorb"
            className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] text-zinc-800 placeholder:text-zinc-400"
          />
          <textarea
            value={charDesc}
            onChange={(e) => setCharDesc(e.target.value)}
            rows={2}
            placeholder="Describe them, e.g. chubby orange alien, three eyes, dented space helmet, always chewing"
            className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] text-zinc-800 placeholder:text-zinc-400"
          />
          <div className="flex flex-wrap gap-1.5">
            {CHARACTER_MEDIUM_CHIPS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMedium(m.id)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  medium === m.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-zinc-500">
            The medium is locked for the whole series, the video model matches the reference and never restyles it.
          </p>
          <button
            type="button"
            onClick={() => void addCharacter()}
            disabled={designing || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
          >
            {designing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {designing ? "Designing (about a minute)…" : "Design character"}
          </button>
        </div>
      </div>

      {/* ── Episodes ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[12px] font-semibold text-zinc-800">Episodes</p>
        {episodes && episodes.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {episodes.map((e) => (
              <li key={e.number} className="rounded-xl border border-zinc-200 bg-white px-2.5 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-bold text-zinc-500">EP{e.number}</span>
                  <span className="flex-1 text-[12px] text-zinc-800">{e.premise}</span>
                  {/* The intent is the show's logic made visible, "continue" means it
                      paid off a thread rather than inventing something unrelated. */}
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">{e.intent}</span>
                </div>
                {e.cliffhanger && (e.openThreads?.length ?? 0) > 0 && (
                  <p className="mt-0.5 text-[10.5px] text-amber-700">unresolved: {e.openThreads!.join("; ")}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-zinc-500">No episodes yet, the first one starts self-contained.</p>
        )}
      </div>

      {/* ── Make one now ─────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
        <input
          value={episodePrompt}
          onChange={(e) => setEpisodePrompt(e.target.value)}
          placeholder="Optional: prompt this episode, leave empty to let the agent decide"
          className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[12px] text-zinc-800 placeholder:text-zinc-400"
        />
        <button
          type="button"
          onClick={() => void makeEpisode()}
          disabled={firing || saved.enabled !== true}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
        >
          {firing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {firing ? "Queuing…" : "Make the next episode"}
        </button>
        {saved.enabled !== true && <p className="text-[10.5px] text-zinc-500">Turn series mode on first.</p>}
        {fired && <p className="text-[11px] text-emerald-700">{fired}</p>}
      </div>

      {err && <p className="text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

// ─── Video POOL apps: Hook Videos + Main Content ──────────────────────────────
/** Shared config surface for the two pool apps. The operator uploads SEVERAL
 *  videos; the render picks one per video (best transcript match, cycling until
 *  transcripts are warm). Persists to videoConfig.hookVideos / .mainVideos through
 *  the same /api/agents/config route the CTA app uses. */
const POOL_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB, a body video can be long

function VideoPoolConfig({
  mintAddress, accent, field, title, caption, blurb, bypass,
}: {
  mintAddress?: string;
  accent: string;
  field: "hookVideos" | "mainVideos";
  title: string;
  caption: string;
  blurb: string;
  /** Main Content only: renders the "No clip / UGC needed" switch. */
  bypass?: boolean;
}) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { hookVideos?: string[]; mainVideos?: string[]; mainVideosOnly?: boolean } }
    | null
    | undefined;
  const saved = doc?.videoConfig?.[field] ?? [];
  const savedOnly = doc?.videoConfig?.mainVideosOnly ?? false;

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const persist = async (payload: Record<string, unknown>) => {
    if (!mintAddress) { setErr("Mint the agent to save uploads."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "video", payload }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleFiles = async (files: File[]) => {
    setErr("");
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (videos.length === 0) { setErr("Pick video files (.mp4/.mov/.webm)."); return; }
    const tooBig = videos.find((f) => f.size > POOL_MAX_UPLOAD_BYTES);
    if (tooBig) { setErr(`${tooBig.name} is ${(tooBig.size / 1048576).toFixed(0)}MB, keep each under 500MB.`); return; }
    setBusy(true);
    try {
      const urls: string[] = [];
      // Sequential: a parallel burst of large uploads is what makes a browser tab
      // stall, and the operator gets no progress signal from it either.
      for (const file of videos) {
        const uploadUrl = await generateUploadUrl({});
        const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!up.ok) throw new Error(`upload failed (${up.status})`);
        const { storageId } = (await up.json()) as { storageId: string };
        const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (publicUrl) urls.push(publicUrl);
      }
      if (urls.length) await persist({ [field]: [...saved, ...urls] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (url: string) => void persist({ [field]: saved.filter((u) => u !== url) });

  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">{title}</p>
        <span className="text-[11px] font-semibold" style={{ color: accent }}>{caption}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500">{blurb}</p>

      {bypass && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3">
          <input
            type="checkbox"
            checked={savedOnly}
            disabled={saving || saved.length === 0}
            onChange={(e) => void persist({ mainVideosOnly: e.target.checked })}
            className="mt-0.5 size-4 accent-zinc-900"
          />
          <span>
            <span className="block text-[12px] font-semibold text-zinc-800">No clip / UGC needed</span>
            <span className="block text-[11px] text-zinc-500">
              Skip clipping and video generation entirely, post these uploads as the content, with a hook video in
              front when that app is installed. Captions, filters and the CTA still apply.
              {saved.length === 0 && " Upload at least one video to enable this."}
            </span>
          </span>
        </label>
      )}

      {saved.length > 0 && (
        <ul className="mt-3 space-y-2">
          {saved.map((url, i) => (
            <li key={url} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-2">
              <video src={url} className="h-16 w-28 shrink-0 rounded-lg bg-black object-cover" muted playsInline />
              <span className="flex-1 truncate text-[11.5px] text-zinc-600">Video {i + 1}</span>
              <button
                type="button"
                onClick={() => remove(url)}
                disabled={saving}
                aria-label={`Remove video ${i + 1}`}
                className="rounded-lg border border-zinc-300 bg-white p-1.5 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-5 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-50">
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin" style={{ color: accent }} />
            <span className="text-[12px] text-zinc-600">Uploading…</span>
          </>
        ) : (
          <>
            <Upload className="size-5 text-zinc-400" />
            <span className="text-[12px] text-zinc-700">{saved.length ? "Add more videos" : "Drop or click to upload videos"}</span>
            <span className="text-[10.5px] text-zinc-500">.mp4 / .mov / .webm · up to 500MB each · pick several at once</span>
          </>
        )}
        <input
          type="file" accept="video/*" multiple className="hidden" disabled={busy || saving}
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void handleFiles(f); }}
        />
      </label>
      {err && <p className="mt-2 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}

// ─── Video Call To Action: upload a clip appended to the end of every video ────
/** Config for the influencer's "Video Call To Action" app. The operator uploads a
 *  short clip; we store it to Convex storage and persist its URL to
 *  videoConfig.ctaVideo. The render pipeline (render-step / videoJobs →
 *  append-cta) stitches it onto the END of every generated video. */
const CTA_MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB, a CTA is short

function CtaConfig({ mintAddress, accent }: { mintAddress?: string; accent: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { ctaVideo?: string } }
    | null
    | undefined;
  const savedUrl = doc?.videoConfig?.ctaVideo;

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const [url, setUrl] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Hydrate from the persisted value once it loads.
  useEffect(() => { if (typeof savedUrl === "string") setUrl(savedUrl); }, [savedUrl]);

  const effectiveUrl = url ?? savedUrl;

  // Persist the CTA url (or "" to remove) to videoConfig.
  const persist = async (next: string) => {
    if (!mintAddress) { setErr("Mint the agent to save the CTA video."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "video", payload: { ctaVideo: next } }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
      setUrl(next || undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (file: File) => {
    setErr("");
    if (!file.type.startsWith("video/")) { setErr("Pick a video file (.mp4/.mov/.webm)."); return; }
    if (file.size > CTA_MAX_UPLOAD_BYTES) { setErr(`Video is ${(file.size / 1048576).toFixed(0)}MB, keep the CTA under 200MB.`); return; }
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const up = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!up.ok) throw new Error(`upload failed (${up.status})`);
      const { storageId } = (await up.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (!publicUrl) throw new Error("could not resolve uploaded video");
      await persist(publicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-zinc-800">Call-to-action clip</p>
        <span className="text-[11px] font-semibold" style={{ color: accent }}>Appended to every video</span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500">Upload a short clip (subscribe bumper, offer, logo sting). It&apos;s stitched onto the end of every generated video, scaled to fit and with its own audio.</p>

      {effectiveUrl ? (
        <div className="mt-3">
          <video src={effectiveUrl} controls playsInline className="w-full max-h-56 rounded-xl bg-black" />
          <div className="mt-2 flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-bold text-zinc-800 transition-colors hover:bg-zinc-100">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {busy ? "Uploading…" : "Replace"}
              <input type="file" accept="video/*" className="hidden" disabled={busy || saving}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
            </label>
            <button
              type="button"
              onClick={() => void persist("")}
              disabled={busy || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-6 text-center transition-colors hover:border-zinc-400 hover:bg-zinc-50">
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin" style={{ color: accent }} />
              <span className="text-[12px] text-zinc-600">Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="size-5 text-zinc-400" />
              <span className="text-[12px] text-zinc-700">Drop or click to upload a CTA video</span>
              <span className="text-[10.5px] text-zinc-500">.mp4 / .mov / .webm · up to 200MB</span>
            </>
          )}
          <input type="file" accept="video/*" className="hidden" disabled={busy || saving}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
        </label>
      )}
      {err && <p className="mt-2 text-[11px] text-rose-600">{err}</p>}
    </div>
  );
}
