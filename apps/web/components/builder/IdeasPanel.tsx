"use client";

// Ideas tab — the agent's idea queue. Ratings STEER, they never gate: with no
// interaction the heartbeat auto-produces the top-scored idea (full-auto mode).
// 👍 approves (approved ideas are produced first, FIFO), 👎 rejects, and both
// feed the taste profile so ideation gets better over time.

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "convex/react";
import { useSiwsSession } from "@/hooks/use-siws-session";
import {
  ThumbsUp, ThumbsDown, Zap, Newspaper, Repeat2, User, Sprout, Brain,
  ChevronDown, Clock, Loader2, Check, Pencil, Clapperboard, Send, AlertCircle,
  Lightbulb, RefreshCw, Sparkles, X, Search, Wand2, ShieldCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import TabPageHeader from "./TabPageHeader";

const GLASS_BG: React.CSSProperties = {
  background:
    "radial-gradient(120% 90% at 12% -10%, rgba(255,255,255,0.05), transparent 55%), " +
    "radial-gradient(100% 80% at 105% 110%, rgba(255,255,255,0.035), transparent 55%), " +
    "#050506",
};
const chipIdle = "border border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10";
const chipActive = "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300";

const MODES = [
  { id: "full-auto", label: "Full auto", hint: "plans, renders, posts on its own" },
  { id: "review-ideas", label: "Review ideas", hint: "only makes ideas you approve" },
  { id: "review-video", label: "Review videos", hint: "renders wait for your release" },
] as const;

/** Renders a real error message the operator can act on. Some failures
 *  (a transient Convex/upstream gateway hiccup) surface as a raw, unwrapped
 *  JSON body in `err.message` — e.g. `{"code":"ServiceUnavailable","message":
 *  "Service temporarily unavailable (Code: 04)"}` — with no sanitization
 *  between the failed fetch and this card. Detect that shape and show a
 *  plain "try again" message instead of dumping JSON at the operator; any
 *  other error (ours, hand-written and already readable) passes through
 *  unchanged. */
function friendlyTaskError(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: unknown; code?: unknown; error?: unknown };
      const inner = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : "";
      return `Temporarily unavailable${inner ? ` (${inner})` : ""} — try again in a moment.`;
    } catch {
      return "Temporarily unavailable — try again in a moment.";
    }
  }
  return raw;
}

const SOURCE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  news: { label: "News", icon: Newspaper },
  evergreen: { label: "Evergreen", icon: Sprout },
  series: { label: "Series", icon: Repeat2 },
  user: { label: "You", icon: User },
};

const INTENT_META: Record<string, { label: string; cls: string }> = {
  entertain: { label: "🎭 entertain", cls: "bg-fuchsia-400/10 text-fuchsia-300" },
  value: { label: "💡 value", cls: "bg-sky-400/10 text-sky-300" },
  promo: { label: "🤝 promo", cls: "bg-amber-400/10 text-amber-300" },
};

/** Progress steps shown while ideation is in flight. Real server-side work
 *  has no incremental progress channel (one request, one response), so this
 *  is time-based — it approximates the actual pipeline order (live news
 *  search → the ideation LLM call → dedup against the existing pool, see
 *  lib/server/ideation.ts / convex/contentIdeas.ts) closely enough to read
 *  as real progress rather than a fake bar. Caps at the last step and
 *  holds there until the request actually resolves — never claims "done"
 *  before the response lands. */
const IDEATE_STEPS = [
  { label: "Scanning today's news and your niche", icon: Search, ms: 0 },
  { label: "Pitching episode ideas", icon: Wand2, ms: 2200 },
  { label: "Checking against your existing ideas", icon: ShieldCheck, ms: 5200 },
] as const;

/** Animated step list — a SEPARATE component so its step index resets for
 *  free on every run via mount/unmount (the parent only renders this while
 *  `ideating` is true) instead of an effect reaching back to reset state,
 *  which trips the "no synchronous setState in an effect" lint rule. */
function IdeateSteps() {
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    const timers = IDEATE_STEPS.slice(1).map((s, i) =>
      setTimeout(() => setStepIdx(i + 1), s.ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="mt-5 space-y-2.5 text-left">
      {IDEATE_STEPS.map((step, i) => {
        const Icon = step.icon;
        const active = i === stepIdx;
        const past = i < stepIdx;
        return (
          <motion.div
            key={step.label}
            animate={{ opacity: past ? 0.5 : 1 }}
            className="flex items-center gap-2.5 text-[12.5px]"
          >
            <span className={`grid size-6 shrink-0 place-items-center rounded-full ${active ? "bg-lime-400/15" : "bg-white/[0.06]"}`}>
              {past ? <Check className="size-3.5 text-lime-300" /> : (
                <Icon className={`size-3.5 ${active ? "animate-pulse text-lime-300" : "text-zinc-500"}`} />
              )}
            </span>
            <span className={active ? "font-medium text-white" : past ? "text-zinc-500 line-through decoration-zinc-600" : "text-zinc-500"}>
              {step.label}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

function IdeateModal({
  open, ideating, error, outcome, onClose,
}: {
  open: boolean;
  ideating: boolean;
  error: string | null;
  outcome: { ideated: number; fresh: number; message?: string } | null;
  onClose: () => void;
}) {
  const done = !ideating && (error || outcome);
  const gotNewIdeas = outcome && outcome.ideated > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => { if (done) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#141418] p-6 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
          >
            {done && (
              <button type="button" onClick={onClose} aria-label="Close"
                className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white">
                <X className="size-4" />
              </button>
            )}

            {/* Icon: pulsing while working, settles into a result glyph when done. */}
            <div className="relative mx-auto grid size-16 place-items-center">
              {ideating && (
                <motion.span
                  className="absolute inset-0 rounded-full bg-lime-400/20"
                  animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <span className={`relative grid size-14 place-items-center rounded-full border ${
                error ? "border-red-400/40 bg-red-400/10" : gotNewIdeas ? "border-lime-400/40 bg-lime-400/10" : "border-white/15 bg-white/[0.06]"
              }`}>
                {ideating ? (
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}>
                    <Sparkles className="size-6 text-lime-300" />
                  </motion.span>
                ) : error ? (
                  <AlertCircle className="size-6 text-red-300" />
                ) : gotNewIdeas ? (
                  <Check className="size-6 text-lime-300" />
                ) : (
                  <Lightbulb className="size-6 text-zinc-300" />
                )}
              </span>
            </div>

            {/* In-flight: animated step list. Done: result message. */}
            {ideating ? (
              <IdeateSteps />
            ) : (
              <div className="mt-4">
                <p className="text-[14.5px] font-semibold text-white">
                  {error ? "Something went wrong" : gotNewIdeas ? `${outcome!.ideated} new idea${outcome!.ideated === 1 ? "" : "s"} added` : "No new ideas this time"}
                </p>
                <p className="mx-auto mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-zinc-500">
                  {error ?? outcome?.message ?? "Fresh episode ideas are ready below."}
                </p>
                <button type="button" onClick={onClose}
                  className="mx-auto mt-4 rounded-lg bg-lime-500 px-4 py-2 text-[12px] font-bold text-black transition-colors hover:bg-lime-400">
                  {error ? "Close" : "Got it"}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const STATUS_STYLE: Record<string, string> = {
  proposed: "bg-white/[0.06] text-zinc-400",
  approved: "bg-lime-400/15 text-lime-300",
  producing: "bg-amber-400/15 text-amber-300",
  produced: "bg-sky-400/15 text-sky-300",
  rejected: "bg-white/[0.04] text-zinc-600",
  expired: "bg-white/[0.04] text-zinc-600",
};

interface IdeaRow {
  _id: Id<"contentIdeas">;
  headline: string; angle: string; whyNow?: string;
  intent?: string; campaignId?: string; campaignTitle?: string;
  source: string; sourceRefs?: string[]; format: string; styleId?: string;
  suggestedDurationSec: number; score: number; status: string;
  expiresAt?: number; feedback?: string; editedByUser?: boolean;
  producedTaskId?: string; createdAt: number;
  // News-commentary overlay/context inputs (lib/server/ideation.ts) — carried
  // through to run-task's create_video input below so a manual "Generate
  // video" click gets the same headline-screenshot overlay + grounded facts
  // the autonomous idea pipeline already attaches (lib/server/ideaPipeline.ts).
  newsFacts?: string[]; referenceImageUrl?: string;
}

export default function IdeasPanel({ mintAddress }: { mintAddress?: string }) {
  const agent = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { autonomyMode?: string; tasteProfile?: { prose?: string }; showBible?: unknown }
    | null
    | undefined;
  const autonomyMode = agent?.autonomyMode;
  const tasteProse = agent?.tasteProfile?.prose;
  const ideas = useQuery(api.contentIdeas.listForMint, mintAddress ? { mintAddress, limit: 50 } : "skip") as IdeaRow[] | undefined;
  const setFeedback = useMutation(api.contentIdeas.setFeedback);
  const setStatus = useMutation(api.contentIdeas.setStatus);
  const updateAngle = useMutation(api.contentIdeas.updateAngle);
  const { ensureSiwsSession } = useSiwsSession();

  const [modeBusy, setModeBusy] = useState(false);
  const [modeLocal, setModeLocal] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [tasteOpen, setTasteOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Per-idea render/publish state. `renderTask` maps ideaId → the create_video
  // taskId fired from THIS session; produced ideas from earlier sessions are
  // watched via their persisted producedTaskId instead.
  const [renderTask, setRenderTask] = useState<Record<string, string>>({});
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState<Record<string, boolean>>({});
  const [published, setPublished] = useState<Record<string, string>>({}); // ideaId → platform list label
  const [ideating, setIdeating] = useState(false);
  const [ideateError, setIdeateError] = useState<string | null>(null);
  const [ideateModalOpen, setIdeateModalOpen] = useState(false);
  const [ideateOutcome, setIdeateOutcome] = useState<{ ideated: number; fresh: number; message?: string } | null>(null);
  const autoIdeatedRef = useRef(false);

  const mode = modeLocal ?? autonomyMode ?? "full-auto";

  /** Fire the ideation-only endpoint — new ideas land via Convex reactivity.
   *  Drives the IdeateModal below: opens it, runs the request, and always
   *  reports a real outcome (success count, "nothing new" explanation, or
   *  the actual error) instead of the old silent no-op — a failure or a
   *  legitimate zero-result used to close with no feedback at all.
   *  `silent` (used by the auto-ideate-on-empty effect below) skips the
   *  modal entirely — that's a passive background refill on tab open, not
   *  something the operator asked for, so it shouldn't pop a blocking
   *  dialog; the inline empty-state card still reflects its progress/result. */
  const generateIdeas = async (opts?: { silent?: boolean }) => {
    if (!mintAddress || ideating) return;
    setIdeating(true);
    setIdeateError(null);
    setIdeateOutcome(null);
    if (!opts?.silent) setIdeateModalOpen(true);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ideated?: number; fresh?: number; message?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Idea generation failed (${res.status})`);
      setIdeateOutcome({ ideated: data.ideated ?? 0, fresh: data.fresh ?? 0, message: data.message });
    } catch (e) {
      setIdeateError(friendlyTaskError(e instanceof Error ? e.message : "Idea generation failed"));
    } finally {
      setIdeating(false);
    }
  };

  // AUTO-GENERATE on an empty/expired queue — right after onboarding (the
  // wizard hands off to this tab) or once every idea has been produced or has
  // expired, the tab refills itself instead of showing a dead end. Fires at
  // most once per mount, only after the query has actually settled, and only
  // when the agent has a show plan (bible) to ideate from.
  useEffect(() => {
    if (autoIdeatedRef.current || !mintAddress || ideas === undefined || agent === undefined || agent === null) return;
    const hasBible = !!(agent as { showBible?: unknown } | null | undefined && (agent as unknown as { showBible?: unknown }).showBible);
    const actionable = ideas.filter((i) => i.status === "proposed" || i.status === "approved").length;
    if (hasBible && actionable === 0) {
      autoIdeatedRef.current = true;
      void generateIdeas({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas, agent, mintAddress]);

  // Every task worth watching: renders fired this session + producedTaskId of
  // produced ideas (so the Publish button survives a reload). generationStatus
  // is reactive — cards flip to "video ready" the moment the render lands.
  const watchIds = useMemo(() => {
    const ids = new Set<string>(Object.values(renderTask));
    for (const i of ideas ?? []) if (i.producedTaskId) ids.add(i.producedTaskId);
    return Array.from(ids) as Id<"agentTasks">[];
  }, [renderTask, ideas]);
  const taskStates = useQuery(api.agentTasks.generationStatus, watchIds.length ? { ids: watchIds } : "skip") as
    | Record<string, { status: string; videoUrl?: string; posterUrl?: string; note?: string; error?: string }>
    | undefined;

  const taskFor = (idea: IdeaRow) => renderTask[idea._id] ?? idea.producedTaskId;

  const generate = async (idea: IdeaRow) => {
    if (!mintAddress || renderTask[idea._id]) return;
    setCardError((s) => ({ ...s, [idea._id]: "" }));
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "create_video",
          title: `Idea: ${idea.headline.slice(0, 60)}`,
          // ideaId rides along so the pipeline marks this idea produced (and
          // resets it to proposed on failure) exactly like a heartbeat render.
          input: {
            topic: `${idea.headline}, ${idea.angle}`,
            durationSeconds: idea.suggestedDurationSec,
            ideaId: idea._id,
            // Same fields lib/server/ideaPipeline.ts attaches for an autonomous
            // render — without these, run-task has no way to know this idea
            // already has real facts/a source article, so it silently reruns a
            // generic search AND never sets overlays.newsImageUrl.
            ...(idea.newsFacts?.length ? { newsRefs: idea.newsFacts } : {}),
            ...(idea.referenceImageUrl ? { newsImageUrl: idea.referenceImageUrl } : {}),
            ...(idea.sourceRefs?.[0] ? { newsSourceUrl: idea.sourceRefs[0] } : {}),
          },
          triggeredBy: "ideas_tab",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Render failed (${res.status})`);
      setRenderTask((s) => ({ ...s, [idea._id]: data.taskId! }));
    } catch (e) {
      setCardError((s) => ({ ...s, [idea._id]: friendlyTaskError(e instanceof Error ? e.message : "Render failed") }));
    }
  };

  const publish = async (idea: IdeaRow, videoUrl: string) => {
    if (!mintAddress || publishing[idea._id]) return;
    setPublishing((s) => ({ ...s, [idea._id]: true }));
    setCardError((s) => ({ ...s, [idea._id]: "" }));
    try {
      await ensureSiwsSession();
      // platforms: [] = every connected account (the route resolves the live
      // connected set itself); Smart Captions run server-side per platform.
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: mintAddress,
          platforms: [],
          type: "video",
          title: idea.headline,
          description: idea.angle,
          mediaUrls: [videoUrl],
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; posted?: string[] };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `Publish failed (${res.status})`);
      setPublished((s) => ({ ...s, [idea._id]: data.posted?.length ? data.posted.join(", ") : "connected accounts" }));
    } catch (e) {
      setCardError((s) => ({ ...s, [idea._id]: friendlyTaskError(e instanceof Error ? e.message : "Publish failed") }));
    } finally {
      setPublishing((s) => ({ ...s, [idea._id]: false }));
    }
  };

  const saveMode = async (next: string) => {
    if (!mintAddress || next === mode) return;
    setModeLocal(next); setModeBusy(true); setModeError(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "autonomy", payload: { mode: next } }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error || `Save failed (${res.status})`);
    } catch (e) {
      setModeError(e instanceof Error ? e.message : "Save failed");
      setModeLocal(null);
    } finally { setModeBusy(false); }
  };

  const rate = (idea: IdeaRow, up: boolean) => {
    void setFeedback({ ideaId: idea._id, feedback: up ? "up" : "down" });
    void setStatus({ ideaId: idea._id, status: up ? "approved" : "rejected" });
  };

  const startEdit = (idea: IdeaRow) => { setEditing(idea._id); setEditText(idea.angle); };
  const commitEdit = (idea: IdeaRow) => {
    const angle = editText.trim();
    if (angle && angle !== idea.angle) void updateAngle({ ideaId: idea._id, angle });
    setEditing(null);
  };

  return (
    <div className="min-h-full px-8 py-8" style={{ ...GLASS_BG, fontFamily: "var(--font-geist-sans, system-ui)" }}>
      <IdeateModal
        open={ideateModalOpen}
        ideating={ideating}
        error={ideateError}
        outcome={ideateOutcome}
        onClose={() => setIdeateModalOpen(false)}
      />
      <div className="mx-auto max-w-[1100px]">
        {/* Masthead + autonomy dial */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <TabPageHeader icon={Lightbulb} title="Ideas" blurb="What the agent makes next. Rate to steer." />
          <div>
            <div className="flex gap-1.5">
              <button type="button" disabled={!mintAddress || ideating}
                onClick={() => void generateIdeas()}
                title="Research the niche and pitch fresh ideas now"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-colors active:scale-[0.97] disabled:opacity-40 ${chipIdle}`}>
                {ideating ? <Loader2 className="size-3 animate-spin" /> : <Lightbulb className="size-3" />}
                {ideating ? "Researching…" : "New ideas"}
              </button>
              {MODES.map((m) => (
                <button key={m.id} type="button" disabled={!mintAddress || modeBusy}
                  onClick={() => void saveMode(m.id)} aria-pressed={mode === m.id} title={m.hint}
                  className={`rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-colors active:scale-[0.97] disabled:opacity-40 ${mode === m.id ? chipActive : chipIdle}`}>
                  {m.label}
                </button>
              ))}
              {modeBusy && <span className="grid place-items-center px-1 text-zinc-500"><Loader2 className="size-3.5 animate-spin" /></span>}
            </div>
            {modeError && <p className="mt-1 text-right text-[11px] text-red-400">{modeError}</p>}
          </div>
        </div>

        {/* Taste readout */}
        <button type="button" onClick={() => setTasteOpen((o) => !o)}
          className="mt-5 flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]">
          <Brain className="size-4 shrink-0 text-lime-300" />
          <span className="text-[13px] font-semibold text-white">What your agent learned about your taste</span>
          <ChevronDown className={`ml-auto size-4 text-zinc-500 transition-transform ${tasteOpen ? "rotate-180" : ""}`} />
        </button>
        {tasteOpen && (
          <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <p className="text-[13px] leading-relaxed text-zinc-300">
              {tasteProse?.trim() || "Nothing yet, rate a few ideas and post some videos, and the taste profile appears here."}
            </p>
          </div>
        )}

        {/* Idea cards */}
        <div className="mt-5 space-y-3">
          {ideas === undefined && (
            <div className="grid place-items-center rounded-xl border border-white/10 bg-white/[0.02] py-12 text-zinc-500">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          {ideas?.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
              {ideating ? (
                <>
                  <Loader2 className="mx-auto size-5 animate-spin text-lime-400" />
                  <p className="mt-3 text-[14px] font-semibold text-white">Researching your niche…</p>
                  <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] leading-relaxed text-zinc-500">
                    The agent is reading today&apos;s news and your show plan, then pitches its next episodes here, about a minute.
                  </p>
                </>
              ) : agent && !agent.showBible ? (
                <>
                  <p className="text-[14px] font-semibold text-white">Finish your show plan first</p>
                  <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] leading-relaxed text-zinc-500">
                    The Director tab&apos;s setup wizard writes the plan every idea is pitched against.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-semibold text-white">No ideas yet</p>
                  <p className="mx-auto mt-1 max-w-[420px] text-[12.5px] leading-relaxed text-zinc-500">
                    Tap below and the agent researches your niche and pitches its next episodes.
                  </p>
                  <button type="button" disabled={!mintAddress}
                    onClick={() => void generateIdeas()}
                    className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg bg-lime-500 px-4 py-2 text-[12px] font-bold text-black transition-colors hover:bg-lime-400 disabled:opacity-40">
                    <RefreshCw className="size-3.5" /> Generate ideas
                  </button>
                </>
              )}
              {ideateError && (
                <p className="mx-auto mt-3 inline-flex items-center gap-1 text-[11.5px] text-red-300"><AlertCircle className="size-3" /> {ideateError}</p>
              )}
            </div>
          )}
          {ideas?.map((idea) => {
            const src = SOURCE_META[idea.source] ?? SOURCE_META.evergreen;
            const SrcIcon = src.icon;
            const dead = idea.status === "rejected" || idea.status === "expired";
            const actionable = idea.status === "proposed";
            const taskId = taskFor(idea);
            const task = taskId ? taskStates?.[taskId] : undefined;
            const rendering = !!taskId && (!task || task.status === "pending" || task.status === "running") && !task?.videoUrl;
            const videoUrl = task?.videoUrl;
            const renderFailed = task?.status === "failed";
            // "producing" means the heartbeat is already on it — no double-render.
            const canGenerate = !dead && !rendering && !videoUrl && (actionable || idea.status === "approved" || renderFailed);
            return (
              <div key={idea._id} className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${dead ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] ${STATUS_STYLE[idea.status] ?? STATUS_STYLE.proposed}`}>{idea.status}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-zinc-400"><SrcIcon className="size-2.5" /> {src.label}</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">{idea.format}</span>
                      {idea.styleId && idea.styleId !== idea.format && (
                        <span className="rounded-full border border-lime-400/30 bg-lime-400/10 px-2 py-0.5 text-[10px] font-semibold text-lime-300" title="Video style this idea is written for">
                          {idea.styleId.replace(/-/g, " ")}
                        </span>
                      )}
                      {idea.intent && INTENT_META[idea.intent] && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INTENT_META[idea.intent].cls}`}>{INTENT_META[idea.intent].label}</span>
                      )}
                      {idea.campaignId && (
                        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200" title={idea.campaignTitle}>
                          💰 {idea.campaignTitle ? idea.campaignTitle.slice(0, 24) : "campaign"}
                        </span>
                      )}
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-zinc-400">~{idea.suggestedDurationSec}s</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-lime-300/80">{idea.score}</span>
                      {idea.expiresAt && idea.status === "proposed" && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-300/80"><Clock className="size-2.5" /> {idea.expiresAt > Date.now() ? `${Math.max(1, Math.round((idea.expiresAt - Date.now()) / 3600_000))}h left` : "expiring"}</span>
                      )}
                    </div>
                    <h3 className="mt-2 text-[15px] font-semibold leading-snug text-white">{idea.headline}</h3>
                    {editing === idea._id ? (
                      <textarea autoFocus rows={2} value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={() => commitEdit(idea)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(idea); } }}
                        className="mt-1.5 w-full resize-none rounded-lg border border-lime-400/40 bg-white/[0.05] px-3 py-2 text-[13px] leading-relaxed text-white outline-none" />
                    ) : (
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
                        {idea.angle}
                        {!dead && idea.status !== "produced" && (
                          <button type="button" onClick={() => startEdit(idea)} aria-label="Edit angle"
                            className="ml-2 inline-flex align-middle text-zinc-600 transition-colors hover:text-white"><Pencil className="size-3" /></button>
                        )}
                      </p>
                    )}
                    {idea.whyNow && <p className="mt-1.5 text-[11.5px] italic text-amber-200/70">Why now: {idea.whyNow}</p>}
                    {(idea.sourceRefs?.length ?? 0) > 0 && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px] text-zinc-600">
                        <span>Source:</span>
                        {idea.sourceRefs!.map((ref, i) => {
                          let host = ref;
                          try { host = new URL(ref).hostname.replace(/^www\./, ""); } catch { /* not a URL — show as-is */ }
                          return /^https?:\/\//i.test(ref) ? (
                            <a
                              key={ref}
                              href={ref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="truncate underline decoration-zinc-700 underline-offset-2 hover:text-lime-300 hover:decoration-lime-300"
                              title={ref}
                            >
                              {host}
                            </a>
                          ) : (
                            <span key={i}>{ref}</span>
                          );
                        })}
                      </p>
                    )}
                  </div>
                  {actionable && (
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => rate(idea, true)} aria-label="Approve idea"
                          className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-zinc-300 transition-colors hover:border-lime-400/50 hover:text-lime-300">
                          <ThumbsUp className="size-3.5" />
                        </button>
                        <button type="button" onClick={() => rate(idea, false)} aria-label="Reject idea"
                          className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.05] text-zinc-300 transition-colors hover:border-red-400/50 hover:text-red-300">
                          <ThumbsDown className="size-3.5" />
                        </button>
                      </div>
                      <button type="button" onClick={() => void setStatus({ ideaId: idea._id, status: "approved" })}
                        className="inline-flex items-center gap-1 rounded-lg bg-lime-500 px-2.5 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-lime-400">
                        <Zap className="size-3" /> Make next
                      </button>
                    </div>
                  )}
                  {idea.status === "approved" && !taskId && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-lime-300"><Check className="size-3.5" /> queued</span>
                  )}
                </div>

                {/* Render / publish rail, Generate fires the create_video NOW
                    (bible brief applies server-side); once the reactive task
                    watch reports a videoUrl, Publish pushes it to every
                    connected social account. Survives reloads via the idea's
                    persisted producedTaskId. */}
                {!dead && (canGenerate || rendering || videoUrl || renderFailed || cardError[idea._id]) && (
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    {rendering ? (
                      <div className="flex items-center gap-2 text-[12px] text-amber-200/90">
                        <Loader2 className="size-3.5 animate-spin" />
                        Rendering video… a few minutes. It appears here and in Generations.
                      </div>
                    ) : videoUrl ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <video src={videoUrl} controls playsInline poster={task?.posterUrl}
                          className="h-40 rounded-lg border border-white/10 bg-black" />
                        <div className="flex flex-col gap-1.5">
                          {published[idea._id] ? (
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-lime-300">
                              <Check className="size-3.5" /> Published to {published[idea._id]}
                            </span>
                          ) : (
                            <button type="button" onClick={() => void publish(idea, videoUrl)} disabled={publishing[idea._id]}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-[11.5px] font-bold text-black transition-colors hover:bg-sky-400 disabled:opacity-50">
                              {publishing[idea._id] ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                              {publishing[idea._id] ? "Publishing…" : "Publish to all connected"}
                            </button>
                          )}
                          <span className="text-[10.5px] text-zinc-600">Posts with the agent&apos;s caption style to every connected account.</span>
                          {task?.note && <span className="max-w-[280px] text-[10.5px] text-amber-300/80">{task.note}</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void generate(idea)} disabled={!mintAddress}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400/40 bg-lime-400/[0.1] px-3 py-1.5 text-[11.5px] font-bold text-lime-300 transition-colors hover:bg-lime-400/[0.18] disabled:opacity-40">
                          <Clapperboard className="size-3.5" /> {renderFailed ? "Retry render" : "Generate video"}
                        </button>
                        {renderFailed && task?.error && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-300"><AlertCircle className="size-3" /> {friendlyTaskError(task.error).slice(0, 120)}</span>
                        )}
                      </div>
                    )}
                    {cardError[idea._id] && (
                      <p className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-red-300"><AlertCircle className="size-3" /> {cardError[idea._id]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
