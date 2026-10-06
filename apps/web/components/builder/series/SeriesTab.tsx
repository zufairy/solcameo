"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Trash2, Loader2, Sparkles, Users, Film, Wand2, UserPlus, Clock, X, Maximize2, Clapperboard } from "lucide-react";
import TabPageHeader from "../TabPageHeader";

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3 py-2 text-[13px] text-white placeholder:text-zinc-500 outline-none focus-visible:border-lime-400/50 disabled:opacity-40";
const labelCls = "font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500";

/* Floating section — a small caps label + blurb, no card/border. */
function Section({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section className="py-2">
      <h2 className={labelCls}>{title}</h2>
      {blurb && <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{blurb}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

type CastMember = { name: string; role?: string; designPrompt?: string; refImages?: string[] };
type SeriesCfg = { enabled?: boolean; premise?: string; world?: string; themes?: string[]; cast?: CastMember[] };
type EpisodeRow = {
  number: number;
  premise: string;
  intent: string;
  openThreads?: string[];
  cliffhanger?: boolean;
  cast?: string[];
  videoUrl?: string;
};

type Ideation = {
  episodeNumber: number;
  intent: string;
  reason: string;
  premise: string;
  cast: { name: string; role?: string; refImage?: string }[];
  hook: string;
  script: string;
  caption: string;
  sceneBeats: { seconds?: string; action?: string; scene?: string }[];
  estSeconds: number;
};

/** A creating-in-realtime episode card — shimmer while pending, swaps to the
 *  actual video the instant the render finishes. Removed once the finished
 *  episode shows up in the live `episodes` list from Convex. */
type PendingEpisode = { taskId: Id<"agentTasks">; premise: string; startedAt: number; status: "pending" | "error"; error?: string };

const CHARACTER_MEDIUM_CHIPS = [
  { id: "2d", label: "2D cartoon" },
  { id: "3d", label: "3D animated" },
  { id: "claymation", label: "Claymation" },
  { id: "pixel", label: "Pixel art" },
  { id: "realistic", label: "Realistic / live-action" },
];

/**
 * Series — first-class workspace tab. Three jobs, top to bottom: describe the
 * show, build the cast (each design sheet becomes that character's locked video
 * reference), then plan + watch episodes — ideate first (premise, cast, hook,
 * beats on cards, no render yet), then commit with one glass button.
 */
export function SeriesTab({ mintAddress }: { mintAddress?: string }) {
  const doc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { name?: string; avatarStills?: string[]; videoConfig?: { series?: SeriesCfg } }
    | null
    | undefined;
  const episodes = useQuery(api.seriesEpisodes.recent, mintAddress ? { mintAddress, limit: 12 } : "skip") as
    | EpisodeRow[]
    | undefined;

  const saved: SeriesCfg = doc?.videoConfig?.series ?? {};
  const [premiseDraft, setPremiseDraft] = useState<string | null>(null);
  const [worldDraft, setWorldDraft] = useState<string | null>(null);
  const premise = premiseDraft ?? saved.premise ?? "";
  const world = worldDraft ?? saved.world ?? "";
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const [medium, setMedium] = useState("2d");
  const [designing, setDesigning] = useState(false);
  const [episodePrompt, setEpisodePrompt] = useState("");
  const [ideating, setIdeating] = useState(false);
  const [ideation, setIdeation] = useState<Ideation | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<PendingEpisode[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const disabled = !mintAddress;

  const hasPending = pending.some((p) => p.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  const pendingTaskIds = useMemo(() => pending.filter((p) => p.status === "pending").map((p) => p.taskId), [pending]);
  const statusMap = useQuery(
    api.agentTasks.generationStatus,
    pendingTaskIds.length > 0 ? { ids: pendingTaskIds } : "skip",
  ) as Record<string, { status: string; videoUrl?: string; posterUrl?: string; error?: string }> | undefined;

  useEffect(() => {
    if (!statusMap) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending((prev) => prev.flatMap((p) => {
      if (p.status !== "pending") return [p];
      const s = statusMap[p.taskId];
      if (!s) return [p];
      // On success the finished episode appears in the live Convex `episodes`
      // query almost immediately (recordEpisode runs as part of the same
      // completion) — drop the local placeholder so it isn't shown twice.
      if (s.status === "succeeded") return [];
      if (s.status === "failed") return [{ ...p, status: "error", error: s.error || "Render failed" }];
      return [p];
    }));
  }, [statusMap]);

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

  /** Generate a character's design sheet, then save the character with its frames.
   *  Create + poll: holding the request open while the model renders is what makes
   *  a proxy return an HTML error page instead of JSON. */
  const addCharacter = async () => {
    setErr("");
    if (!charName.trim()) { setErr("Give the character a name."); return; }
    if (charDesc.trim().length < 8) { setErr("Describe the character, colour, body, one distinctive feature."); return; }
    setDesigning(true);
    try {
      const createRes = await fetch("/api/agents/character-design/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, name: charName.trim(), description: charDesc.trim(), medium }),
      });
      const created = (await createRes.json().catch(() => ({}))) as { tasks?: { taskId: string; view: string }[]; error?: string };
      if (!createRes.ok || !created.tasks?.length) throw new Error(created.error || "could not start the design sheet");

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

  /** Ideation, not a render: plan the next episode + write its script, show it
   *  on cards. Nothing is queued or spent yet. */
  const ideate = useCallback(async () => {
    if (!mintAddress) { setErr("Mint the agent first."); return; }
    setIdeating(true); setErr(""); setIdeation(null);
    try {
      const res = await fetch("/api/agents/series/preview-episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, prompt: episodePrompt.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as Ideation & { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIdeation(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not plan the episode");
    } finally {
      setIdeating(false);
    }
  }, [mintAddress, episodePrompt]);

  /** Commit the ideated episode — carries the SAME premise + script the cards
   *  showed (via input.script, run-task's confirmed-card short-circuit), so the
   *  render never drifts from what was previewed. */
  const createEpisode = useCallback(async () => {
    if (!mintAddress || !ideation) return;
    setCreating(true); setErr("");
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "create_video",
          title: `Episode: ${ideation.premise.slice(0, 60)}`,
          input: {
            topic: ideation.premise,
            script: { hook: ideation.hook, script: ideation.script, caption: ideation.caption },
          },
          triggeredBy: "series_panel",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; taskId?: string; error?: string; message?: string };
      if (!res.ok || data.error || !data.taskId) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setPending((prev) => [{ taskId: data.taskId as Id<"agentTasks">, premise: ideation.premise, startedAt: Date.now(), status: "pending" }, ...prev]);
      setIdeation(null);
      setEpisodePrompt("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not queue the episode");
    } finally {
      setCreating(false);
    }
  }, [mintAddress, ideation]);

  const castList = saved.cast ?? [];

  // The agent's OWN locked face — the same avatarStills every other tab
  // (carousel/image-posts/video) already uses as the KIE reference. No
  // generation needed: it's already a photoreal, already-consistent reference,
  // so adding it as a cast member is just copying the URLs in. This is the
  // "same real person every episode" path, and it's what makes a REALISTIC
  // drama work — the design-sheet flow above is only for brand-new characters.
  const agentStills = (doc?.avatarStills ?? []).filter((u) => /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u));
  const selfAlreadyCast = !!doc?.name && castList.some((c) => c.name === doc.name);
  const addSelfAsCast = () => {
    if (!doc?.name || agentStills.length === 0 || selfAlreadyCast) return;
    const member: CastMember = {
      name: doc.name,
      role: castList.length === 0 ? "lead" : "co-star",
      designPrompt: "The agent's own face and persona, always the same real person, every episode.",
      refImages: agentStills,
    };
    void persist({ cast: [...castList, member] });
  };

  return (
    <div className="min-h-full px-8 py-8" style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <div className="mx-auto max-w-[900px]">
        <div className="flex items-end gap-3">
          <TabPageHeader icon={Clapperboard} title="Series" blurb="Every video becomes the next episode of one show." />
          <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-zinc-300">
            <input
              type="checkbox"
              checked={saved.enabled === true}
              disabled={saving || disabled}
              onChange={(e) => void persist({ enabled: e.target.checked })}
              className="size-3.5 accent-lime-500"
            />
            {saved.enabled ? <span className="text-lime-300">Series mode on</span> : "Series mode off"}
          </label>
        </div>

        <div className="mt-4 flex flex-col divide-y divide-white/[0.06]">
          {/* ── The show ────────────────────────────────────────────────────── */}
          <Section title="The show" blurb="With series mode on, every video this agent makes, including on its own schedule, is the next episode.">
            <div className="space-y-2">
              <input
                value={premise}
                disabled={disabled}
                onChange={(e) => setPremiseDraft(e.target.value)}
                onBlur={() => premise !== saved.premise && void persist({ premise })}
                placeholder="Premise, e.g. two aliens run a failing space diner"
                className={inputCls}
              />
              <input
                value={world}
                disabled={disabled}
                onChange={(e) => setWorldDraft(e.target.value)}
                onBlur={() => world !== saved.world && void persist({ world })}
                placeholder="World, e.g. a rusted diner orbiting a dead moon"
                className={inputCls}
              />
            </div>
          </Section>

          {/* ── Cast ────────────────────────────────────────────────────────── */}
          <Section title="Cast" blurb="Up to 3 appear per episode, the video model locks at most three references. A bigger cast rotates; the first character is always the lead.">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-400">
                <Users className="size-3.5" /> {castList.length} character{castList.length === 1 ? "" : "s"}
              </div>
              {doc?.name && (
                <button
                  type="button"
                  onClick={addSelfAsCast}
                  disabled={disabled || saving || selfAlreadyCast || agentStills.length === 0}
                  title={agentStills.length === 0 ? "This agent has no locked avatar stills yet" : selfAlreadyCast ? `${doc.name} is already in the cast` : `Use ${doc.name}'s own locked face, same real person every episode`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400/40 bg-lime-400/10 px-2.5 py-1 text-[11px] font-semibold text-lime-300 transition-colors hover:bg-lime-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <UserPlus className="size-3.5" />
                  {selfAlreadyCast ? `${doc.name} is in the cast` : `Add ${doc.name} (this agent)`}
                </button>
              )}
            </div>
            {castList.length > 0 && (
              <ul className="mt-2 space-y-2">
                {castList.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex items-center gap-2.5 py-1.5">
                    <div className="flex gap-1">
                      {(c.refImages ?? []).slice(0, 3).map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={url} src={url} alt="" className="size-12 rounded-lg object-cover" />
                      ))}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-white">{c.name}{c.role ? ` · ${c.role}` : ""}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{c.designPrompt}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void persist({ cast: castList.filter((_, idx) => idx !== i) })}
                      disabled={saving}
                      aria-label={`Remove ${c.name}`}
                      className="rounded-lg p-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 space-y-2 rounded-xl border border-dashed border-white/15 p-3">
              <input
                value={charName}
                disabled={disabled}
                onChange={(e) => setCharName(e.target.value)}
                placeholder="Character name, e.g. Gorb"
                className={inputCls}
              />
              <textarea
                value={charDesc}
                disabled={disabled}
                onChange={(e) => setCharDesc(e.target.value)}
                rows={2}
                placeholder="Describe them, e.g. chubby orange alien, three eyes, dented space helmet, always chewing"
                className={`${inputCls} resize-none`}
              />
              <div className="flex flex-wrap gap-1.5">
                {CHARACTER_MEDIUM_CHIPS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMedium(m.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                      medium === m.id ? "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300" : "border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-zinc-500">The medium is locked for the whole series, the video model matches the reference and never restyles it.</p>
              <button
                type="button"
                onClick={() => void addCharacter()}
                disabled={designing || saving || disabled}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 backdrop-blur-xl px-3.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {designing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {designing ? "Designing (about a minute)…" : "Design character"}
              </button>
            </div>
          </Section>

          {/* ── Next episode: ideate first, create second ──────────────────── */}
          <Section title="Next episode" blurb="Leave the prompt empty to let the agent decide, it continues an open thread or starts fresh from the show's own memory. Ideate first to see how it'll look, then create it.">
            <div className="flex gap-2">
              <input
                value={episodePrompt}
                disabled={disabled}
                onChange={(e) => setEpisodePrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !ideating) void ideate(); }}
                placeholder="Optional: what should happen this episode…"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void ideate()}
                disabled={ideating || saved.enabled !== true || disabled}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 backdrop-blur-xl px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ideating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {ideating ? "Ideating…" : "Ideate"}
              </button>
            </div>
            {saved.enabled !== true && <p className="mt-2 text-[11px] text-zinc-500">Turn series mode on above first.</p>}
            {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}

            <AnimatePresence>
              {ideation && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="mt-4"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-zinc-500">EP{ideation.episodeNumber} · {ideation.intent}</span>
                    <span className="text-[11px] text-zinc-500">{ideation.reason}</span>
                  </div>
                  <p className="mt-2 text-[14px] font-semibold leading-snug text-white">{ideation.premise}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">&ldquo;{ideation.hook}&rdquo;</p>

                  {ideation.cast.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ideation.cast.map((c) => (
                        <div key={c.name} className="flex items-center gap-1.5 rounded-full bg-white/[0.05] py-1 pl-1 pr-2.5">
                          {c.refImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.refImage} alt="" className="size-6 rounded-full object-cover" />
                          ) : (
                            <span className="grid size-6 place-items-center rounded-full bg-white/10 text-[9px] text-zinc-400">{c.name[0]}</span>
                          )}
                          <span className="text-[11px] font-medium text-zinc-300">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {ideation.sceneBeats.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {ideation.sceneBeats.slice(0, 6).map((b, i) => (
                        <div key={i} className="rounded-xl bg-white/[0.035] p-2.5">
                          <span className="font-mono text-[9px] font-bold uppercase tracking-wide text-lime-400/80">{b.seconds ?? `Beat ${i + 1}`}</span>
                          <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-zinc-300">{b.action || b.scene}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void createEpisode()}
                      disabled={creating}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-5 py-2 text-[13px] font-bold text-white backdrop-blur-xl transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {creating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                      {creating ? "Starting…" : "Create episode"}
                    </button>
                    <button type="button" onClick={() => setIdeation(null)} disabled={creating}
                      className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-300 disabled:opacity-40">
                      Discard
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          {/* ── Episode log ─────────────────────────────────────────────────── */}
          <Section title="Episodes" blurb="What the planner made, and why, continuity is visible, not a black box.">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-zinc-400">
              <Film className="size-3.5" /> {episodes?.length ?? 0} episode{(episodes?.length ?? 0) === 1 ? "" : "s"}
            </div>
            {(pending.length > 0 || (episodes && episodes.length > 0)) ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <AnimatePresence initial={false}>
                  {pending.map((p) => {
                    const elapsedSec = Math.max(0, Math.round((now - p.startedAt) / 1000));
                    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
                    const ss = String(elapsedSec % 60).padStart(2, "0");
                    if (p.status === "error") {
                      return (
                        <motion.div key={p.taskId} layout
                          initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                          className="relative flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-red-500/30 bg-red-500/[0.06] px-3 text-center"
                        >
                          <span className="text-[10.5px] leading-snug text-red-300">{p.error ?? "Render failed"}</span>
                          <button type="button" onClick={() => setPending((prev) => prev.filter((x) => x.taskId !== p.taskId))}
                            className="mt-1 text-[10.5px] font-semibold text-zinc-400 hover:text-white">Dismiss</button>
                        </motion.div>
                      );
                    }
                    return (
                      <motion.div key={p.taskId} layout
                        initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-zinc-900"
                      >
                        <motion.div
                          className="absolute inset-0"
                          style={{ background: "linear-gradient(120deg, rgba(255,255,255,0.03), rgba(190,255,120,0.12), rgba(255,255,255,0.03))", backgroundSize: "200% 200%", filter: "blur(14px)" }}
                          animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
                        />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 px-3 text-center backdrop-blur-sm">
                          <Loader2 className="size-5 animate-spin text-lime-300" />
                          <span className="flex items-center gap-1 text-[10px] tabular-nums text-zinc-500"><Clock className="size-2.5" /> {mm}:{ss}</span>
                          <span className="line-clamp-3 text-[10.5px] text-zinc-300">{p.premise}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {episodes?.map((e) => (
                  <div key={e.number} className="group relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-zinc-900">
                    {e.videoUrl ? (
                      <video src={e.videoUrl} muted loop playsInline preload="metadata"
                        className="absolute inset-0 size-full object-cover"
                        onMouseEnter={(ev) => { void ev.currentTarget.play(); }}
                        onMouseLeave={(ev) => { ev.currentTarget.pause(); ev.currentTarget.currentTime = 0; }}
                        onClick={() => setLightbox(e.videoUrl!)} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/[0.02]">
                        <Film className="size-6 text-zinc-600" />
                      </div>
                    )}
                    <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" />
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-zinc-300 backdrop-blur-sm">EP{e.number}</span>
                    {e.videoUrl && (
                      <button type="button" onClick={() => setLightbox(e.videoUrl!)} title="Watch"
                        className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 group-hover:opacity-100">
                        <Maximize2 className="size-3" />
                      </button>
                    )}
                    <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6">
                      <p className="line-clamp-2 text-[11px] leading-snug text-white/85">{e.premise}</p>
                      {e.cliffhanger && (e.openThreads?.length ?? 0) > 0 && (
                        <p className="mt-0.5 line-clamp-1 text-[9.5px] text-amber-400">unresolved: {e.openThreads![0]}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] text-zinc-500">No episodes yet, the first one starts self-contained.</p>
            )}
          </Section>
        </div>
      </div>

      {lightbox && (
        <div role="button" tabIndex={-1} onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
          <button type="button" onClick={() => setLightbox(null)} title="Close"
            className="absolute right-5 top-5 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="size-5" />
          </button>
          <video src={lightbox} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
