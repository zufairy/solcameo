"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import { Activity, Check, Circle, Clock3, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatWhen } from "./ui";

const STATES: Record<string, { label: string; color: string; icon: typeof Check }> = {
  succeeded: { label: "Done", color: "text-emerald-300", icon: Check },
  running: { label: "Working", color: "text-sky-300", icon: Loader2 },
  pending: { label: "Queued", color: "text-zinc-400", icon: Clock3 },
  awaiting_approval: { label: "Needs approval", color: "text-amber-300", icon: Clock3 },
  failed: { label: "Failed", color: "text-rose-300", icon: X },
  cancelled: { label: "Cancelled", color: "text-zinc-500", icon: Circle },
};

/** Convex pushes task changes directly, including completion of an existing row. */
export function AgentTaskActivity({ mintAddress }: { mintAddress: string }) {
  const tasks = useQuery(api.agentTasks.listByMint, { mintAddress, limit: 30 });
  const reducedMotion = useReducedMotion();
  const recent = [...(tasks ?? [])].sort((a, b) =>
    (b.completedAt ?? b.startedAt ?? b._creationTime) - (a.completedAt ?? a.startedAt ?? a._creationTime)
  ).slice(0, 10);
  const completed = tasks?.filter(task => task.status === "succeeded").length ?? 0;
  const running = tasks?.filter(task => task.status === "running").length ?? 0;

  return (
    <section aria-label="Agent task activity" className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_32px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[12px] font-semibold text-white"><Activity className="size-3.5 text-emerald-300" /> Agent tasks</h3>
        {tasks !== undefined && <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-300" /> Live</span>}
      </div>
      {tasks === undefined ? (
        <p role="status" className="flex items-center gap-2 py-5 text-xs text-zinc-400"><Loader2 className={`size-3.5 ${reducedMotion ? "" : "animate-spin"}`} /> Loading tasks…</p>
      ) : recent.length === 0 ? (
        <p className="py-5 text-[12px] leading-relaxed text-zinc-400">No tasks yet. Your agent’s work will appear here as it happens.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[11px] text-zinc-400">{completed} completed recently{running > 0 ? ` · ${running} working` : ""}</p>
          <ul aria-live="polite" aria-relevant="additions text" className="relative mt-3 space-y-1">
            <AnimatePresence initial={false}>
              {recent.map(task => {
                const state = STATES[task.status] ?? { label: task.status.replace(/_/g, " "), color: "text-zinc-400", icon: Circle };
                const Icon = state.icon;
                const timestamp = task.completedAt ?? task.startedAt ?? task._creationTime;
                return (
                  <motion.li key={task._id} layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.25 }} className="flex items-start gap-2.5 rounded-xl border border-white/[0.055] bg-white/[0.025] p-2.5">
                    <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 ${state.color}`}>
                      <Icon className={`size-3.5 ${task.status === "running" && !reducedMotion ? "animate-spin" : ""}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[12px] leading-5 text-zinc-200">{task.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px]"><motion.span key={task.status} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} className={state.color}>{state.label}</motion.span><time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()} className="text-zinc-500">{formatWhen(timestamp)}</time></div>
                      {task.status === "failed" && task.errorMessage && <p className="mt-1 break-words text-[11px] leading-4 text-rose-300/80">{task.errorMessage}</p>}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </>
      )}
    </section>
  );
}
