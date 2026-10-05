"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import velloLogo from "@/assets/logoblack.png";
import { useMyAgents } from "@/lib/client/useMyAgents";
import AgentSetupFlow from "./AgentSetupFlow";
import { OptionCard, Stagger, itemVariants } from "./setup-ui";
import type { SetupAgentType } from "./setup-data";

const EASE = [0.32, 0.72, 0, 1] as const;

/** "youtube.com/watch?v=abc…" style label for a queued link. */
export function shortLink(query: string): string {
  const m = query.match(/https?:\/\/[^\s]+/i)?.[0];
  if (!m) return "";
  try {
    const u = new URL(m);
    const label = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    return label.length > 38 ? `${label.slice(0, 37)}…` : label;
  } catch {
    return m.slice(0, 38);
  }
}

/**
 * The only way into /builder without an existing agent. Every new-agent visit,
 * whether from the home page, the landing page, a pasted clip link or a fresh
 * sign-up, lands here: pick an existing clipper for a queued video, or run the
 * guided setup. There is no chat until an agent exists.
 */
export default function NewAgentEntry({
  initialType,
  clipQuery,
  walkthrough,
}: {
  initialType: SetupAgentType | null;
  /** A queued "Clip this video: <url>" request, if any. */
  clipQuery: string;
  walkthrough: boolean;
}) {
  const router = useRouter();
  const { agents } = useMyAgents();
  const [mode, setMode] = useState<"choose" | "setup">("choose");
  const [gaveUp, setGaveUp] = useState(false);

  // The agent list can stay "loading" forever for an account whose wallet isn't
  // resolved yet. Don't trap the user: fall through to setup after a short wait.
  useEffect(() => {
    if (!clipQuery || agents !== undefined) return;
    const t = window.setTimeout(() => setGaveUp(true), 4000);
    return () => window.clearTimeout(t);
  }, [clipQuery, agents]);

  const clippers = (agents ?? []).filter((a) => a.type === "clipping");
  const carry = new URLSearchParams();
  if (clipQuery) {
    carry.set("q", clipQuery);
    if (walkthrough) carry.set("walkthrough", "1");
  }
  const carryStr = carry.toString() ? `&${carry.toString()}` : "";
  const queuedLabel = clipQuery ? shortLink(clipQuery) : "";

  const chooseExisting = (mint: string) => {
    const p = new URLSearchParams({ mint, type: "clipping", q: clipQuery });
    router.replace(`/builder?${p.toString()}`);
  };

  const waiting = clipQuery && mode === "choose" && agents === undefined && !gaveUp;
  const showChooser = clipQuery && mode === "choose" && clippers.length > 0;

  if (waiting) {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-[#F6F4F0] text-[#141413]">
        <div role="status" className="flex items-center gap-3 text-[15px] text-[#141413]/60"><Loader2 className="size-5 animate-spin" /> Getting your agents…</div>
      </div>
    );
  }

  if (showChooser) {
    return (
      <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#F6F4F0] text-[#141413]">
        <header className="flex items-center px-5 py-4 sm:px-8">
          <Image src={velloLogo} alt="Vello" className="h-8 w-auto mix-blend-multiply" priority />
        </header>
        <main className="mx-auto w-full max-w-[640px] px-5 pb-20 pt-8 sm:pt-14">
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="inline-flex max-w-full items-center gap-2 rounded-full bg-black/6 px-3.5 py-1.5 text-[12.5px] font-medium text-[#141413]/70">
            <span className="size-1.5 shrink-0 rounded-full bg-[#84CC16]" />
            <span className="truncate">Ready to clip {queuedLabel || "your video"}</span>
          </motion.p>
          <motion.h1 initial={{ opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.5, ease: EASE, delay: 0.05 }} className="mt-4 text-balance text-[clamp(30px,4.6vw,48px)] font-semibold leading-[1.05] tracking-[-0.035em]">
            Which agent should clip it?
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mt-3 text-[16px] leading-relaxed text-[#141413]/60">
            Pick one of your clipping agents, or create a new one in under a minute.
          </motion.p>
          <Stagger role="list" aria-label="Your clipping agents" className="mt-8 grid gap-3 sm:grid-cols-2">
            {clippers.map((a) => (
              <OptionCard key={a.mintAddress} selected={false} onClick={() => chooseExisting(a.mintAddress)} title={a.name} blurb={a.niche || "Clipping agent"}>
                <span className="relative mt-4 flex items-center gap-3">
                  <span className="size-14 shrink-0 overflow-hidden rounded-2xl bg-[#141413]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.avatarUrl && <img src={a.avatarUrl} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#141413]">Use this agent <ArrowRight className="size-3.5" /></span>
                </span>
              </OptionCard>
            ))}
            <motion.button type="button" variants={itemVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }} onClick={() => setMode("setup")} className="flex min-h-[148px] flex-col items-start justify-between rounded-2xl border-2 border-dashed border-black/20 bg-white/40 p-4 text-left transition-colors hover:border-[#141413] hover:bg-white">
              <span className="grid size-10 place-items-center rounded-xl bg-[#141413] text-[#A3E635]"><Plus className="size-5" /></span>
              <span>
                <span className="block text-[15px] font-semibold">Create a new agent</span>
                <span className="mt-0.5 block text-[13px] text-[#141413]/55">Guided setup, then it clips your video.</span>
              </span>
            </motion.button>
          </Stagger>
        </main>
      </div>
    );
  }

  return <AgentSetupFlow initialType={initialType} carry={carryStr} queuedLabel={queuedLabel} />;
}
