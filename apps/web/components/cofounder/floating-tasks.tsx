"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/* ── Live agent-activity feed ────────────────────────────────────────────────
   A 3D-tilted stack of "task" chips floating above the laptop. It reads as a
   live feed: new work lands at the BOTTOM (closest/brightest), everything shifts
   UP, and the oldest chip lifts away off the TOP. Depth is faked with per-index
   scale + opacity so the stack recedes into the scene. Reduced-motion users get
   a static stack (no cycling). */

type Task = { status: string; title: string; running?: boolean };

const POOL: Task[] = [
  { status: "Task running", title: "bug fix", running: true },
  { status: "Task Completed", title: "SEO Optimization" },
  { status: "Task Completed", title: "Marketing Campaign" },
  { status: "Task running", title: "Render daily video", running: true },
  { status: "Task Completed", title: "Post to TikTok" },
  { status: "Task Completed", title: "New webpage" },
  { status: "Task running", title: "Clip podcast", running: true },
  { status: "Task Completed", title: "Reply to 12 comments" },
  { status: "Task Completed", title: "Brand deal outreach" },
  { status: "Task Completed", title: "Payout 240 USDC" },
];

const VISIBLE = 3;

function TaskChip({ task }: { task: Task }) {
  return (
    <div className="relative flex w-fit items-center gap-2.5 rounded-xl border border-white/15 bg-[#0e2a2a]/55 px-3.5 py-2.5 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl">
      {/* glossy top edge so the glass catches light like a premium chip */}
      <span aria-hidden className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
      <span className="relative flex size-2.5 shrink-0 items-center justify-center" aria-hidden>
        {task.running && <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400/70" />}
        <span className={`relative inline-flex size-2.5 rounded-full ${task.running ? "bg-amber-400" : "bg-emerald-400"}`} />
      </span>
      <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-white/55">{task.status}</span>
      <span className="whitespace-nowrap text-[14px] font-semibold text-white">{task.title}</span>
    </div>
  );
}

export function FloatingTasks() {
  const reduce = useReducedMotion();
  const idRef = useRef(0);
  const poolRef = useRef(VISIBLE);
  const [items, setItems] = useState<(Task & { key: number })[]>(() =>
    POOL.slice(0, VISIBLE).map((t) => ({ ...t, key: idRef.current++ })),
  );

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setItems((prev) => {
        const next = POOL[poolRef.current % POOL.length];
        poolRef.current += 1;
        return [...prev.slice(1), { ...next, key: idRef.current++ }];
      });
    }, 2600);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div
      aria-label="Live agent activity"
      className="pointer-events-none absolute left-[56%] top-[31%] z-10 hidden w-[300px] md:block xl:left-[59%]"
      style={{ perspective: "1000px" }}
    >
      <motion.div
        className="flex flex-col items-start gap-3"
        style={{ transformStyle: "preserve-3d" }}
        // Enter: slide/rotate into place from the right. Then hold a stronger 3D
        // tilt and drift gently up-and-down forever so the stack feels alive.
        initial={reduce ? { opacity: 1, rotateX: 8, rotateY: -16 } : { opacity: 0, x: 40, rotateX: 15, rotateY: -30 }}
        animate={reduce ? { opacity: 1, rotateX: 8, rotateY: -16 } : { opacity: 1, x: 0, rotateX: 8, rotateY: -16, y: [0, -12, 0] }}
        transition={{
          opacity: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
          x: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
          rotateX: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
          rotateY: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
          y: { duration: 6, ease: "easeInOut", repeat: Infinity, delay: 0.9 },
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((it, idx) => {
            // 0 = top (recedes) … VISIBLE-1 = bottom (closest, newest).
            const depth = idx / (VISIBLE - 1);
            return (
              <motion.div
                key={it.key}
                layout
                initial={{ opacity: 0, y: 36, scale: 0.88, rotateX: -24 }}
                animate={{ opacity: 0.5 + depth * 0.5, y: 0, scale: 0.9 + depth * 0.1, rotateX: 0 }}
                exit={{ opacity: 0, y: -32, scale: 0.86, rotateX: 28 }}
                transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
                className="origin-left will-change-transform"
              >
                <TaskChip task={it} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
