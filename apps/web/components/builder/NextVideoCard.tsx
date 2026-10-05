"use client";

// Home-tab "Make next video" card — the one obvious button after onboarding.
// Shows a state-aware step strip (plan → ideas → video → socials) so the
// operator always knows where they are and what happens next, surfaces the TOP
// ranked idea (headline + source + format, so the pick is explainable), and
// fires the exact same create_video the Ideas tab uses. Influencer agents only.

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Check, Lightbulb, Loader2, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSiwsSession } from "@/hooks/use-siws-session";

type IdeaRow = {
  _id: Id<"contentIdeas">;
  headline: string; angle: string; source: string; format: string;
  suggestedDurationSec: number; score: number; status: string;
};

export default function NextVideoCard({
  mintAddress,
  onOpenIdeas,
  onOpenSchedule,
}: {
  mintAddress: string;
  onOpenIdeas: () => void;
  onOpenSchedule: () => void;
}) {
  const { ensureSiwsSession } = useSiwsSession();
  const agent = useQuery(api.influencers.getByMint, { mintAddress }) as
    | { showBible?: unknown; agentType?: string }
    | null
    | undefined;
  const ideas = useQuery(api.contentIdeas.listForMint, { mintAddress, limit: 20 }) as IdeaRow[] | undefined;

  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "ideas" | "video">("");
  const [error, setError] = useState<string | null>(null);

  const taskStates = useQuery(
    api.agentTasks.generationStatus,
    taskId ? { ids: [taskId as Id<"agentTasks">] } : "skip",
  ) as Record<string, { status: string; videoUrl?: string; error?: string }> | undefined;
  const task = taskId ? taskStates?.[taskId] : undefined;
  const rendering = !!taskId && (!task || task.status === "pending" || task.status === "running");
  const videoUrl = task?.videoUrl;

  // Top actionable idea: approved first (operator's explicit picks), then
  // proposed by score — the same order the heartbeat produces them in.
  const nextIdea = useMemo(() => {
    const rows = (ideas ?? []).filter((i) => i.status === "approved" || i.status === "proposed");
    rows.sort((a, b) => (a.status === b.status ? b.score - a.score : a.status === "approved" ? -1 : 1));
    return rows[0];
  }, [ideas]);

  const hasPlan = !!(agent && (agent as { showBible?: unknown }).showBible);

  /** No ideas yet → run the ideation-only endpoint (fast; no produce/post). */
  const getIdeas = async () => {
    if (busy) return;
    setBusy("ideas");
    setError(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `Couldn't plan ideas (${res.status})`);
      // Ideas land via Convex reactivity — the list query updates on its own.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't plan ideas");
    } finally {
      setBusy("");
    }
  };

  /** Render the top idea NOW — identical payload to the Ideas tab's Generate. */
  const makeNext = async () => {
    if (!nextIdea || busy || rendering) return;
    setBusy("video");
    setError(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "create_video",
          title: `Idea: ${nextIdea.headline.slice(0, 60)}`,
          input: {
            topic: `${nextIdea.headline}, ${nextIdea.angle}`,
            durationSeconds: nextIdea.suggestedDurationSec,
            ideaId: nextIdea._id,
          },
          triggeredBy: "next_video_card",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Render failed (${res.status})`);
      setTaskId(data.taskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
      <div>
        {videoUrl ? (
          <div className="flex flex-wrap items-center gap-4">
            <video src={videoUrl} controls playsInline className="h-36 rounded-lg border border-white/10 bg-black" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white">
                <Check className="size-4 text-lime-400" /> Your next video is ready
              </p>
              <p className="mt-1 text-[12px] text-zinc-500">Publish it from the Ideas tab, or connect socials so future videos post themselves.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={onOpenIdeas} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-zinc-200 transition-colors hover:bg-white/10">
                  Open Ideas <ArrowRight className="ml-1 inline size-3" />
                </button>
                <button type="button" onClick={onOpenSchedule} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-zinc-200 transition-colors hover:bg-white/10">
                  Connect socials
                </button>
              </div>
            </div>
          </div>
        ) : rendering ? (
          <div className="flex items-center gap-2.5 text-[13px] text-amber-200/90">
            <Loader2 className="size-4 animate-spin" />
            Rendering &ldquo;{nextIdea?.headline ?? "your next video"}&rdquo;&hellip; a few minutes. It lands here and in Generations.
          </div>
        ) : nextIdea ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Up next</p>
              <p className="mt-1 truncate text-[17px] font-semibold tracking-tight text-white">{nextIdea.headline}</p>
              <p className="mt-1 text-[12px] text-zinc-500">
                {nextIdea.format} <span aria-hidden className="mx-1.5 text-zinc-700">·</span> ~{nextIdea.suggestedDurationSec}s
              </p>
            </div>
            <GenerateButton onClick={() => void makeNext()} busy={busy === "video"}>Make new video</GenerateButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[13.5px] font-semibold text-white">
                {hasPlan ? "No ideas queued yet" : "Finish your show plan first"}
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                {hasPlan
                  ? "One tap and the agent researches your niche and pitches its next videos."
                  : "The Director tab's setup wizard writes the plan every video follows."}
              </p>
            </div>
            {hasPlan ? (
              <GenerateButton onClick={() => void getIdeas()} busy={busy === "ideas"} icon={<Lightbulb className="size-[18px]" />}>
                {busy === "ideas" ? "Researching…" : "Get ideas"}
              </GenerateButton>
            ) : null}
          </div>
        )}
        {error && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-red-300">
            <AlertCircle className="size-3.5" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Higgsfield-style chunky lime button: flat fill, hard bottom edge, sparkle. */
function GenerateButton({ children, onClick, busy, icon }: { children: React.ReactNode; onClick: () => void; busy: boolean; icon?: React.ReactNode }) {
  return (
    <motion.button
      type="button" onClick={onClick} disabled={busy}
      whileHover={busy ? undefined : { y: -1 }} whileTap={busy ? undefined : { y: 3, boxShadow: "0 1px 0 0 #9cb524" }}
      className="relative inline-flex h-12 shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-6 text-[16px] font-bold text-black outline-none focus-visible:ring-2 focus-visible:ring-lime-200 disabled:opacity-60"
      style={{ background: "#D4F53C", boxShadow: "0 4px 0 0 #9cb524, 0 14px 30px -12px rgba(212,245,60,0.5)" }}
    >
      {busy ? <Loader2 className="size-[18px] animate-spin" /> : icon ?? <Sparkles className="size-[18px] fill-black" />}
      {children}
      {!busy && (
        <motion.span aria-hidden className="absolute inset-y-0 w-1/4 -skew-x-12 bg-gradient-to-r from-transparent via-white/50 to-transparent" initial={{ x: "-120%" }} animate={{ x: "520%" }} transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }} />
      )}
    </motion.button>
  );
}
