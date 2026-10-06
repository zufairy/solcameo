"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQuery } from "convex/react";
import { Check, Circle, Clock3, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatWhen } from "./ui";

const STATES: Record<string, { label: string; color: string; bar: string; icon: typeof Check }> = {
  succeeded: { label: "Done", color: "text-emerald-300", bar: "bg-emerald-400", icon: Check },
  running: { label: "Working", color: "text-sky-300", bar: "bg-sky-400", icon: Loader2 },
  pending: { label: "Queued", color: "text-zinc-400", bar: "bg-zinc-500", icon: Clock3 },
  awaiting_approval: { label: "Needs approval", color: "text-amber-300", bar: "bg-amber-400", icon: Clock3 },
  failed: { label: "Failed", color: "text-rose-300", bar: "bg-rose-400", icon: X },
  cancelled: { label: "Cancelled", color: "text-zinc-500", bar: "bg-zinc-600", icon: Circle },
};

/** Convex pushes task changes directly, including completion of an existing row. Rendered as bare rows, no wrapping card. */
export function AgentTaskActivity({ mintAddress }: { mintAddress: string }) {
  const tasks = useQuery(api.agentTasks.listByMint, { mintAddress, limit: 30 });
  const reducedMotion = useReducedMotion();
  const recent = [...(tasks ?? [])].sort((a, b) =>
    (b.completedAt ?? b.startedAt ?? b._creationTime) - (a.completedAt ?? a.startedAt ?? a._creationTime)
  ).slice(0, 10);
  const completed = tasks?.filter(task => task.status === "succeeded").length ?? 0;
  const running = tasks?.filter(task => task.status === "running").length ?? 0;

  return (
    <section aria-label="Agent task activity" className="mt-5">
      {tasks === undefined ? (
        <p role="status" className="flex items-center gap-2 py-3 text-xs text-zinc-400"><Loader2 className={`size-3.5 ${reducedMotion ? "" : "animate-spin"}`} /> Loading tasks…</p>
      ) : recent.length === 0 ? (
        <p className="py-3 text-[12px] leading-relaxed text-zinc-500">No tasks yet. Your agent&apos;s work will appear here as it happens.</p>
      ) : (
        <>
          <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60" /><span className="relative size-1.5 rounded-full bg-emerald-400" /></span>
            {completed} done{running > 0 ? ` · ${running} working` : ""}
          </p>
          <ul aria-live="polite" aria-relevant="additions text" className="relative space-y-1.5">
            <AnimatePresence initial={false}>
              {recent.map(task => {
                const state = STATES[task.status] ?? { label: task.status.replace(/_/g, " "), color: "text-zinc-400", bar: "bg-zinc-500", icon: Circle };
                const Icon = state.icon;
                const timestamp = task.completedAt ?? task.startedAt ?? task._creationTime;
                return (
                  <motion.li key={task._id} layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.22 }} className="group relative flex items-start gap-2.5 overflow-hidden rounded-[3px] border border-white/10 bg-black/30 py-2 pl-3.5 pr-2.5 transition-colors hover:border-white/25 hover:bg-white/[0.04]">
                    <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${state.bar} ${task.status === "running" && !reducedMotion ? "animate-pulse" : ""}`} />
                    <Icon className={`mt-[3px] size-3.5 shrink-0 ${state.color} ${task.status === "running" && !reducedMotion ? "animate-spin" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[12px] font-medium leading-[18px] text-zinc-100">{task.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[9.5px] uppercase tracking-[0.12em]"><motion.span key={task.status} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} className={state.color}>{state.label}</motion.span><time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()} className="text-zinc-600">{formatWhen(timestamp)}</time></div>
                      {task.status === "failed" && task.errorMessage && <p className="mt-1 break-words text-[11px] normal-case leading-4 tracking-normal text-rose-300/80">{task.errorMessage}</p>}
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
