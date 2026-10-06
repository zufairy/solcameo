"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertTriangle, ArrowRightLeft, Check, CheckCircle2, CircleDashed, Clapperboard, Loader2, Play, RotateCcw,
  Scissors, Send, X,
} from "lucide-react";
import {
  type Agent, type FeedItem, type Plan, type PlanStep, type PostProposal, type ReviewItem,
  PLATFORM_LABEL, advancePlan, agentKind, approvePlan, approveProposal, approveResult, cancelPlan,
  rejectProposal, rejectResult, reportClipJobs, reportVideoTask, retryStep, toggleStep,
} from "./store";
import { Avatar, CONTROL_GLASS_ACTION, ITEM, SPRING, STAGGER } from "./ui";
import { useVideoLightbox } from "./VideoLightbox";

/* ════════ Mission card ════════
   The whole approval-first loop lives in the chat:
   proposed → (owner approves) → running (live) → review (owner approves each
   video + caption + platforms) → posted. Nothing is ever posted without an
   explicit click here. */

const STATUS_PILL: Record<Plan["status"], string> = {
  proposed: "bg-lime-400/15 text-lime-300",
  running: "bg-sky-500/15 text-sky-300",
  done: "bg-emerald-500/15 text-emerald-300",
  cancelled: "bg-white/[0.06] text-zinc-500",
};
const STATUS_LABEL: Record<Plan["status"], string> = {
  proposed: "Needs your approval", running: "In progress", done: "Done", cancelled: "Cancelled",
};

function asFeedItem(r: ReviewItem, mint: string, i: number): FeedItem {
  return {
    id: `mission-${mint}-${i}-${r.videoUrl}`,
    videoUrl: r.videoUrl,
    posterUrl: null,
    caption: r.caption || r.title,
    postUrl: null,
    platformPostId: null,
    mint,
    createdAt: Date.now(),
    state: r.status === "posted" ? "scheduled" : "generated",
    viewCount: null,
    platform: undefined,
  } as unknown as FeedItem;
}

export function PlanCard({ threadKey, msgId, plan, agents }: {
  threadKey: string;
  msgId: string;
  plan: Plan;
  agents: Map<string, Agent>;
}) {
  // Resume on (re)mount: start any hand-off whose source finished while away.
  useEffect(() => {
    if (plan.status === "running") void advancePlan(threadKey, msgId);
  }, [plan.status, threadKey, msgId]);

  const kept = plan.steps.filter((s) => s.status !== "skipped");
  const resolved = plan.steps.filter((s) => ["posted", "rejected", "failed", "skipped"].includes(s.status)).length;
  const pct = plan.steps.length ? Math.round((resolved / plan.steps.length) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={SPRING}
      className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#131316]"
    >
      <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-lime-300/20 bg-lime-400/10">
          <Image src="/vello-mark-lime.png" alt="" width={21} height={21} className="size-[21px] object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">Mission</p>
          <p className="truncate text-[15px] font-semibold text-white">{plan.title}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[plan.status]}`}>{STATUS_LABEL[plan.status]}</span>
      </div>

      {plan.status === "running" && (
        <div className="h-0.5 bg-white/[0.05]">
          <motion.div className="h-full bg-gradient-to-r from-sky-400 to-emerald-400" animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
        </div>
      )}

      {plan.status === "proposed" && (
        <p className="px-4 pt-3 text-[12.5px] leading-relaxed text-zinc-400">
          Here&apos;s the plan. <span className="text-zinc-200">Nothing runs until you approve it</span>, and every finished video comes
          back here for your OK before anything is posted. Untick a step to drop it.
        </p>
      )}

      <motion.ol variants={STAGGER} initial="hidden" animate="show" className="space-y-1 p-2">
        {plan.steps.map((st, i) => (
          <StepRow key={st.id} index={i} step={st} plan={plan} threadKey={threadKey} msgId={msgId} agent={agents.get(st.agentMint)} />
        ))}
      </motion.ol>

      {plan.status === "proposed" && (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={!kept.length}
            onClick={() => approvePlan(threadKey, msgId)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold text-black transition-opacity hover:bg-zinc-200 disabled:opacity-30"
          >
            <Check className="size-4" /> Approve &amp; run{kept.length > 1 ? ` (${kept.length} steps)` : ""}
          </motion.button>
          <button onClick={() => cancelPlan(threadKey, msgId)} className="rounded-xl px-3 py-2 text-[13px] text-zinc-400 hover:bg-white/5 hover:text-white">
            Not now
          </button>
          <span className="ml-auto text-[11px] text-zinc-600">Uses each agent&apos;s wallet credits</span>
        </div>
      )}
    </motion.div>
  );
}

function StepRow({ index, step, plan, threadKey, msgId, agent }: {
  index: number;
  step: PlanStep;
  plan: Plan;
  threadKey: string;
  msgId: string;
  agent?: Agent;
}) {
  const who = agent ?? ({ name: step.agentName, avatarUrl: "" } as Pick<Agent, "name" | "avatarUrl">);
  const isClip = step.kind === "clip_video";
  const what = isClip
    ? step.sourceStep !== undefined ? `Clip the video from step ${step.sourceStep + 1}` : "Clip the video you shared"
    : step.topic ?? "Video";
  const dim = step.status === "skipped";

  return (
    <motion.li variants={ITEM} className={`rounded-xl px-2 py-2 transition-colors ${dim ? "opacity-45" : "hover:bg-white/[0.02]"}`}>
      <div className="flex items-start gap-2.5">
        {plan.status === "proposed" ? (
          <button
            onClick={() => toggleStep(threadKey, msgId, step.id)}
            aria-label={dim ? "Include this step" : "Drop this step"}
            className={`mt-1 grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${dim ? "border-white/15" : "border-lime-300/70 bg-lime-400 text-black"}`}
          >
            {!dim && <Check className="size-3" strokeWidth={3} />}
          </button>
        ) : (
          <span className="mt-1 grid size-5 shrink-0 place-items-center text-[11px] font-semibold text-zinc-500">{index + 1}</span>
        )}
        <Avatar agent={who} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold text-white">{step.agentName}</span>
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] ${isClip ? "bg-sky-500/15 text-sky-300" : "bg-lime-400/15 text-lime-300"}`}>
              {isClip ? <Scissors className="size-3" /> : <Clapperboard className="size-3" />}{isClip ? "Clip" : "Video"}
            </span>
            {isClip && step.sourceStep !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] text-zinc-400">
                <ArrowRightLeft className="size-3" /> hand-off
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-300">{what}</p>
          {step.why && <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{step.why}</p>}
          {plan.status !== "proposed" && <StepStatusLine step={step} plan={plan} onRetry={() => retryStep(threadKey, msgId, step.id)} />}
        </div>
      </div>

      {/* Live watchers — Convex subscriptions that move the step forward. */}
      {step.status === "running" && step.kind === "create_video" && step.taskId && (
        <TaskWatcher taskId={step.taskId} onUpdate={(s) => reportVideoTask(threadKey, msgId, step.id, s)} />
      )}
      {step.status === "running" && step.kind === "clip_video" && step.clipJobIds?.length ? (
        <ClipWatcher jobIds={step.clipJobIds} onUpdate={(jobs, clips) => reportClipJobs(threadKey, msgId, step.id, jobs, clips)} />
      ) : null}

      <AnimatePresence initial={false}>
        {step.results?.length ? (
          <motion.div
            key="results"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 pl-[3.25rem]">
              {step.results.map((r, i) => (
                <ReviewCard
                  key={`${r.videoUrl}-${i}`}
                  item={r}
                  mint={step.agentMint}
                  index={i}
                  all={step.results!}
                  connected={agent?.connectedPlatforms ?? []}
                  onApprove={(edit) => approveResult(threadKey, msgId, step.id, i, edit)}
                  onReject={() => rejectResult(threadKey, msgId, step.id, i)}
                />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function StepStatusLine({ step, plan, onRetry }: { step: PlanStep; plan: Plan; onRetry: () => void }) {
  const waitingOn = step.kind === "clip_video" && step.sourceStep !== undefined && step.status === "queued";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (step.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [step.status]);
  const mins = step.startedAt ? Math.max(0, Math.round((now - step.startedAt) / 60_000)) : 0;

  const line = (() => {
    switch (step.status) {
      case "queued": return { icon: <CircleDashed className="size-3.5" />, text: waitingOn ? `Waiting for step ${step.sourceStep! + 1}'s video (hand-off)` : "Queued", tone: "text-zinc-500" };
      case "starting": return { icon: <Loader2 className="size-3.5 animate-spin" />, text: "Starting…", tone: "text-sky-300" };
      case "running": return {
        icon: <Loader2 className="size-3.5 animate-spin" />,
        text: `${step.kind === "clip_video" ? "Clipping" : "Rendering"}… ${mins ? `${mins} min so far · ` : ""}usually 2-6 min`,
        tone: "text-sky-300",
      };
      case "review": return { icon: <AlertTriangle className="size-3.5" />, text: "Ready, waiting for your review", tone: "text-amber-300" };
      case "posting": return { icon: <Loader2 className="size-3.5 animate-spin" />, text: "Scheduling…", tone: "text-sky-300" };
      case "posted": return { icon: <CheckCircle2 className="size-3.5" />, text: "Approved and scheduled", tone: "text-emerald-400" };
      case "rejected": return { icon: <X className="size-3.5" />, text: "Skipped by you", tone: "text-zinc-500" };
      case "failed": return { icon: <AlertTriangle className="size-3.5" />, text: step.error ?? "Failed", tone: "text-rose-300" };
      case "skipped": return { icon: <X className="size-3.5" />, text: "Dropped from the plan", tone: "text-zinc-600" };
      default: return null;
    }
  })();
  if (!line) return null;
  return (
    <div className={`mt-1.5 flex items-center gap-1.5 text-[12px] ${line.tone}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={step.status} initial={{ opacity: 0, filter: "blur(3px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0 }} className="flex min-w-0 items-center gap-1.5">
          {line.icon}<span className="min-w-0">{line.text}</span>
        </motion.span>
      </AnimatePresence>
      {(step.status === "failed" || step.status === "rejected") && plan.status !== "cancelled" && (
        <button onClick={onRetry} className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-zinc-300 hover:bg-white/10">
          <RotateCcw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}

function TaskWatcher({ taskId, onUpdate }: { taskId: string; onUpdate: (s: { status: string; videoUrl?: string; error?: string }) => void }) {
  const res = useQuery(api.agentTasks.generationStatus, { ids: [taskId as Id<"agentTasks">] });
  const s = res?.[taskId];
  useEffect(() => {
    if (s) onUpdate({ status: s.status, videoUrl: s.videoUrl, error: s.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.status, s?.videoUrl, s?.error]);
  return null;
}

type JobSnap = { status: string; error?: string };
type ClipSnap = { clipUrl?: string; title?: string; captionText?: string; status: string };
function ClipWatcher({ jobIds, onUpdate }: { jobIds: string[]; onUpdate: (jobs: JobSnap[], clips: ClipSnap[]) => void }) {
  const [snaps, setSnaps] = useState<Record<string, { job: JobSnap; clips: ClipSnap[] }>>({});
  const sig = useMemo(() => JSON.stringify(snaps), [snaps]);
  useEffect(() => {
    const vals = jobIds.map((id) => snaps[id]);
    if (vals.some((v) => !v)) return;
    onUpdate(vals.map((v) => v!.job), vals.flatMap((v) => v!.clips));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return (
    <>
      {jobIds.map((id) => (
        <JobProbe key={id} jobId={id} onSnap={(job, clips) => setSnaps((m) => ({ ...m, [id]: { job, clips } }))} />
      ))}
    </>
  );
}
function JobProbe({ jobId, onSnap }: { jobId: string; onSnap: (job: JobSnap, clips: ClipSnap[]) => void }) {
  const job = useQuery(api.clipJobs.getJob, { jobId: jobId as Id<"clipJobs"> });
  const clips = useQuery(api.clipJobs.getClipsForJob, { jobId: jobId as Id<"clipJobs"> });
  const sig = `${job?.status ?? ""}|${job?.error ?? ""}|${clips?.map((c) => `${c.status}:${c.clipUrl ?? ""}`).join(",") ?? ""}`;
  useEffect(() => {
    if (job === undefined || clips === undefined) return;
    onSnap(job ? { status: job.status, error: job.error } : { status: "error", error: "Clip job not found." }, clips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

/* ── Review: play it, tweak caption + platforms, approve or skip ── */
export function ReviewCard({ item, mint, index, all, connected, onApprove, onReject }: {
  item: ReviewItem;
  mint: string;
  index: number;
  all: ReviewItem[];
  connected: string[];
  onApprove: (edit: { caption: string; platforms: string[] }) => void;
  onReject: () => void;
}) {
  const openVideo = useVideoLightbox();
  const [caption, setCaption] = useState(item.caption);
  const [platforms, setPlatforms] = useState<string[]>(item.platforms ?? connected);
  const decided = item.status === "posted" || item.status === "rejected";
  const busy = item.status === "posting";
  const toggle = (p: string) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={SPRING}
      className={`flex gap-3 rounded-[4px] border p-3 transition-colors ${item.status === "posted" ? "border-emerald-500/25 bg-emerald-500/[0.04]" : item.status === "rejected" ? "border-white/[0.05] opacity-50" : "border-white/[0.08] bg-white/[0.02]"}`}
    >
      <button
        onClick={() => openVideo(all.map((r, i) => asFeedItem(r, mint, i)), index)}
        className="group relative aspect-[9/16] w-[100px] shrink-0 self-start overflow-hidden rounded-[4px] sm:w-[140px] bg-black"
        aria-label="Play video"
      >
        <video src={item.videoUrl} preload="metadata" muted playsInline className="h-full w-full object-contain" />
        <span className="absolute inset-0 grid place-items-center bg-black/20 transition-colors group-hover:bg-black/40">
          <Play className="size-5 fill-white text-white" />
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {decided ? (
          <>
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-zinc-300">{item.caption || item.title}</p>
            <p className={`flex items-center gap-1 text-[12px] ${item.status === "posted" ? "text-emerald-400" : "text-zinc-500"}`}>
              {item.status === "posted"
                ? <><CheckCircle2 className="size-3.5" /> Scheduled to {(item.platforms ?? []).map((p) => PLATFORM_LABEL[p] ?? p).join(", ")}. Posts within ~5 min</>
                : <><X className="size-3.5" /> Skipped</>}
            </p>
          </>
        ) : (
          <>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              disabled={busy}
              aria-label="Caption"
              className="w-full resize-y rounded-[4px] border border-white/20 bg-white/[0.08] backdrop-blur-xl px-2 py-1.5 text-[12.5px] leading-snug text-zinc-200 outline-none focus:border-white/25"
            />
            {connected.length ? (
              <div className="flex flex-wrap gap-1">
                {connected.map((p) => (
                  <button
                    key={p}
                    onClick={() => toggle(p)}
                    disabled={busy}
                    aria-pressed={platforms.includes(p)}
                    className={`${CONTROL_GLASS_ACTION} px-2 py-1 text-[11px] ${platforms.includes(p) ? "!border-white/60 !bg-white/25" : "text-white/60"}`}
                  >
                    {PLATFORM_LABEL[p] ?? p}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-amber-300">
                No socials connected. <Link href={`/builder?mint=${encodeURIComponent(mint)}&tab=schedule`} className="underline">Connect one in the Builder</Link> to post.
              </p>
            )}
            {item.error && <p className="text-[11.5px] text-rose-300">{item.error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.95 }}
                disabled={busy || !platforms.length || !caption.trim()}
                onClick={() => onApprove({ caption: caption.trim(), platforms })}
                className={`${CONTROL_GLASS_ACTION} inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold`}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Approve &amp; post
              </motion.button>
              <button onClick={onReject} disabled={busy} className={`${CONTROL_GLASS_ACTION} px-2 py-1.5 text-[12px]`}>
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ── Existing videos the agent offered to post ── */
export function ProposalCard({ threadKey, msgId, proposal, agent }: {
  threadKey: string;
  msgId: string;
  proposal: PostProposal;
  agent?: Agent;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={SPRING}
      className="w-full max-w-[640px] rounded-[4px] border border-white/[0.08] bg-[#131316] p-3"
    >
      <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-zinc-400">
        <Send className="size-3.5 text-lime-300" /> Ready to post{agent ? ` from ${agent.name} (${agentKind(agent)})` : ""}. Approve each one:
      </p>
      <div className="space-y-2">
        {proposal.items.map((it, i) => (
          <ReviewCard
            key={`${it.videoUrl}-${i}`}
            item={it}
            mint={proposal.mint}
            index={i}
            all={proposal.items}
            connected={agent?.connectedPlatforms?.length ? agent.connectedPlatforms : proposal.platforms}
            onApprove={(edit) => approveProposal(threadKey, msgId, i, edit)}
            onReject={() => rejectProposal(threadKey, msgId, i)}
          />
        ))}
      </div>
    </motion.div>
  );
}
