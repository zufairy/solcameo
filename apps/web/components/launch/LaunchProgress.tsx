"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle2, Film, Globe, Loader2, PencilLine, Sparkles, Wand2, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import SocialConnectionsPanel from "@/components/builder/SocialConnectionsPanel";

// Stage rail — mirrors lib/server/launch/runLaunch.ts stages.
const STAGES = [
  { id: "analyzing", label: "Reading your site", icon: Globe },
  { id: "naming", label: "Naming your agent", icon: Sparkles },
  { id: "minting", label: "Minting your agent", icon: Wand2 },
  { id: "rendering", label: "Rendering 3 videos", icon: Film },
] as const;
const STAGE_INDEX: Record<string, number> = { analyzing: 0, naming: 1, minting: 2, rendering: 3, done: 4, failed: -1 };

const SLOT_STAGES: Record<string, { label: string; icon: typeof Film }> = {
  pending: { label: "Queued", icon: Loader2 },
  scripting: { label: "Writing the script…", icon: PencilLine },
  rendering: { label: "Rendering video…", icon: Film },
  done: { label: "Done", icon: CheckCircle2 },
  failed: { label: "Failed", icon: AlertCircle },
};

export function LaunchProgress({ runId }: { runId: string }) {
  const run = useQuery(api.launchRuns.get, { runId: runId as Id<"launchRuns"> });
  const ugc = useQuery(api.ugcSampleRuns.get, run?.ugcRunId ? { runId: run.ugcRunId } : "skip");

  if (run === undefined) {
    return <Shell><p className="text-sm text-zinc-500">Loading…</p></Shell>;
  }
  if (run === null) {
    return <Shell><p className="text-sm text-zinc-400">This launch doesn&apos;t exist.</p></Shell>;
  }

  const idx = STAGE_INDEX[run.stage] ?? 0;
  const failed = run.stage === "failed";
  const done = run.stage === "done";
  // First finished video decides the page's mood + unlocks "connect": ask for
  // accounts at the moment they're watching their product get pitched, not
  // while a spinner is still going.
  const slots = ugc?.slots ?? [];
  const doneSlots = slots.filter((sl) => sl.status === "done" && sl.videoUrl);
  const firstVideoReady = doneSlots.length > 0;
  const orderedSlots = [...slots].sort((a, b) => Number(!(b.status === "done" && b.videoUrl)) - Number(!(a.status === "done" && a.videoUrl)));
  const showConnect = !!run.mintAddress && (firstVideoReady || done || run.samplesSkipped);
  const host = (() => { try { return new URL(run.websiteUrl).hostname.replace(/^www\./, ""); } catch { return run.websiteUrl; } })();

  return (
    <Shell>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[12px] uppercase tracking-[0.18em] text-zinc-500">Launch · {host}</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight text-white sm:text-[34px]">
          {failed ? "Something stopped the launch"
            : firstVideoReady && !done ? `Your first video is ready${doneSlots.length > 1 ? ` (${doneSlots.length} of ${slots.length})` : ""}`
            : done ? (run.agentName ? `${run.agentName} is live` : "Your agent is live")
            : run.agentName ? `Building ${run.agentName}…` : "Reading your site…"}
        </h1>
        {run.productSummary && <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-zinc-400">{run.productSummary}</p>}
      </div>

      {/* Stage rail */}
      <ol className="mb-10 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((s, i) => {
          const state = failed && i === idx ? "failed" : i < idx || done ? "done" : i === idx ? "active" : "todo";
          const Icon = state === "done" ? CheckCircle2 : state === "failed" ? AlertCircle : s.icon;
          return (
            <li key={s.id} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] ${
              state === "done" ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200"
              : state === "active" ? "border-white/20 bg-white/[0.06] text-white"
              : state === "failed" ? "border-red-500/40 bg-red-500/[0.08] text-red-200"
              : "border-white/10 bg-white/[0.02] text-zinc-500"}`}>
              <Icon className={`size-4 shrink-0 ${state === "active" ? "animate-pulse" : ""}`} />
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="mb-8 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-[13.5px] text-red-200">
          {run.error ?? "Unknown error"}
          <div className="mt-3"><Link href="/" className="underline underline-offset-4">Try another website</Link></div>
        </div>
      )}

      {/* Agent card */}
      {run.agentName && (
        <section className="mb-10 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="size-16 shrink-0 overflow-hidden rounded-full bg-zinc-800">
            {run.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={run.avatarUrl} alt="" className="size-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold text-white">{run.agentName}</p>
            <p className="truncate text-[13px] text-zinc-400">@{run.handle}{run.niche ? ` · ${run.niche}` : ""}</p>
            <p className="mt-1 text-[12px] text-zinc-500">
              {run.mintAddress ? "Minted and yours." : run.stage === "minting" ? "Minting…" : "Waiting to mint…"}
            </p>
          </div>
          {run.mintAddress && (
            <Link href={`/builder?mint=${encodeURIComponent(run.mintAddress)}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black hover:bg-white/90">
              Open studio <ArrowRight className="size-3.5" />
            </Link>
          )}
        </section>
      )}

      {/* Sample videos */}
      <section className="mb-10">
        <h2 className="mb-3 text-[15px] font-semibold text-white">Your first 3 videos</h2>
        {run.samplesSkipped ? (
          <p className="text-[13px] text-zinc-500">Samples were skipped this time (the presenter image didn&apos;t generate). Your agent can render from the studio.</p>
        ) : !ugc ? (
          <p className="text-[13px] text-zinc-500">{idx >= 3 || done ? "Starting the renders…" : "Waiting for the agent first…"}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {orderedSlots.map((slot, i) => {
              const st = SLOT_STAGES[slot.status] ?? SLOT_STAGES.pending;
              const Icon = st.icon;
              const busy = slot.status === "pending" || slot.status === "scripting" || slot.status === "rendering";
              return (
                <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                  <div className="flex items-center justify-between px-3 py-2 text-[12px] text-zinc-400">
                    <span className="font-medium text-zinc-200">{slot.label}</span>
                    <span>{slot.engine}</span>
                  </div>
                  {slot.status === "done" && slot.videoUrl ? (
                    <video src={slot.videoUrl} controls playsInline autoPlay={i === 0} muted={i === 0} loop={i === 0} className="aspect-[9/16] w-full bg-black" />
                  ) : (
                    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2.5 bg-[#0a0a0c] px-4">
                      <Icon className={`size-5 ${slot.status === "failed" ? "text-red-400" : "text-cyan-400"} ${busy ? "animate-pulse" : ""}`} />
                      <AnimatePresence mode="wait">
                        <motion.span key={slot.status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}
                          className={`text-center text-[11.5px] ${slot.status === "failed" ? "text-red-300" : "text-zinc-500"}`}>
                          {slot.status === "failed" ? (slot.error ?? st.label) : st.label}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Clips from long-form */}
      {run.sourceUrl && (
        <section className="mb-10">
          <h2 className="mb-3 text-[15px] font-semibold text-white">Clips from your long-form</h2>
          {run.clipsError ? (
            <p className="text-[13px] text-red-300">{run.clipsError}</p>
          ) : !run.clips ? (
            <p className="text-[13px] text-zinc-500">{idx >= 3 ? "Cutting the best moments… (this can take a few minutes)" : "Waiting for the agent first…"}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {run.clips.map((c) => (
                <div key={c.templateId} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                  <div className="px-3 py-2 text-[12px] font-medium text-zinc-200">{c.templateLabel}</div>
                  {c.ok && c.clipUrl ? (
                    <video src={c.clipUrl} controls playsInline className="aspect-[9/16] w-full bg-black" />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center px-4 text-center text-[11.5px] text-red-300">{c.error ?? "Failed"}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Connect accounts — gated on the first finished video */}
      {showConnect && (
        <section className="mb-16">
          <h2 className="mb-1 text-[15px] font-semibold text-white">Like it? Let {run.agentName ?? "your agent"} post it.</h2>
          <p className="mb-4 text-[13px] text-zinc-500">Connect TikTok, Instagram or X once. {run.agentName ?? "Your agent"} posts a video a day to your own accounts, each one carrying your signup link.</p>
          <SocialConnectionsPanel username={run.mintAddress!} variant="dark" bare hideHeader />
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#050506] text-white">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">{children}</div>
    </main>
  );
}
