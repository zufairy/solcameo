"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock, ChevronDown, Film, Languages, Pencil, RotateCcw, User } from "lucide-react";
import type { ShowBible } from "@/lib/builder/showBible";
import { formatById } from "@/lib/builder/formatCatalog";
import { getVideoEngine, videoCreditsForLength, DEFAULT_VIDEO_ENGINE, type VideoEngineId } from "@/lib/builder/agentTypes";

/** Rough monthly-spend estimate from the bible's formats/durations/cadence —
 *  same cost model as VideoDirectorTab (per-clip price × ceil(len/maxClip)),
 *  averaged across the chosen formats using each format's first (default)
 *  engine, falling back to the platform default engine when a format lists
 *  none. This is a recap-line estimate, not a persisted budget. */
function estimateMonthlyCredits(bible: ShowBible): number {
  const kinds = bible.format?.kinds ?? [];
  if (!kinds.length) return 0;
  const postsPerDay = bible.cadence?.postsPerDay ?? 1;
  const perVideo = kinds.map((id) => {
    const fmt = formatById(id);
    const range = bible.cadence?.perFormatDuration?.[id];
    const avgSec = range ? Math.round((range.min + range.max) / 2) : fmt?.durationSec.default ?? 20;
    const engineId = (fmt?.engines[0] as VideoEngineId | undefined) ?? DEFAULT_VIDEO_ENGINE;
    try {
      return videoCreditsForLength(getVideoEngine(engineId), avgSec);
    } catch {
      return 0;
    }
  });
  const avgPerVideo = perVideo.reduce((a, b) => a + b, 0) / perVideo.length;
  return Math.round(avgPerVideo * postsPerDay * 30);
}

function formatsLine(bible: ShowBible): string {
  const kinds = bible.format?.kinds ?? [];
  if (!kinds.length) return "No formats picked yet";
  const parts = kinds.map((id) => {
    const fmt = formatById(id);
    const name = fmt?.name ?? id;
    const range = bible.cadence?.perFormatDuration?.[id];
    const sec = range ? Math.round((range.min + range.max) / 2) : fmt?.durationSec.default;
    return sec ? `${name} (${sec}s)` : name;
  });
  const verb = parts.length > 1 ? "Rotates" : "Makes";
  if (parts.length <= 1) return `${verb} ${parts[0] ?? ""}`;
  if (parts.length === 2) return `${verb} ${parts[0]} and ${parts[1]}`;
  return `${verb} ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** One readable recap line — bolded phrase, optional pencil-edit affordance. */
function RecapLine({ children, onEdit, label }: { children: ReactNode; onEdit?: () => void; label: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 py-3.5 last:border-b-0">
      <p className="min-w-0 text-[13.5px] leading-relaxed text-zinc-300">{children}</p>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          title={`Edit ${label}`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-lime-300"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export default function ShowPlanRecap({
  bible,
  onEdit,
  onRedo,
  advanced,
}: {
  bible: ShowBible;
  /** Open the wizard at the given content step (1 premise, 2 formats, 3 tunables, 4 voice, 5 cadence). */
  onEdit: (step: number) => void;
  /** Restart the wizard from scratch. */
  onRedo: () => void;
  /** The legacy Director-tab sections, rendered inside the "Advanced settings" collapse. */
  advanced: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const monthlyCredits = estimateMonthlyCredits(bible);
  const postsPerDay = bible.cadence?.postsPerDay ?? 1;
  const tone = bible.voice?.tone?.trim();
  const language = bible.voice?.language?.trim();
  const voiceBits = [tone, language].filter(Boolean).join(", ");
  // The locked identity reference (wizard face pick or any locked visual ref):
  // the same image every render anchors to, shown as the plan's circular avatar.
  const faceUrl = (bible.visualRefs ?? []).find((r) => r.locked)?.url;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-6"
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="font-sans text-[15px] font-semibold text-white leading-none">Show Plan</h2>
            <p className="mt-1.5 text-[11.5px] text-zinc-500">What this agent makes, how often, and how it sounds.</p>
          </div>
          <button
            type="button"
            onClick={onRedo}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="size-3.5" /> Redo setup
          </button>
        </div>

        <div className="flex flex-col md:flex-row">
          {/* ── Plan details (~70%) ── */}
          <div className="min-w-0 flex-1 px-5 py-2">
            <RecapLine label="formats" onEdit={() => onEdit(3)}>
              {formatsLine(bible)}
            </RecapLine>
            <RecapLine label="cadence" onEdit={() => onEdit(6)}>
              <b className="text-white">{postsPerDay} post{postsPerDay === 1 ? "" : "s"}/day</b>
              {monthlyCredits > 0 && <span className="text-zinc-500"> · ~{monthlyCredits.toLocaleString()} credits/mo</span>}
            </RecapLine>
            <RecapLine label="voice" onEdit={() => onEdit(5)}>
              {voiceBits ? <>Voice: <b className="text-white">{voiceBits}</b></> : "Voice: not set yet"}
            </RecapLine>
            <RecapLine label="premise" onEdit={() => onEdit(1)}>
              {bible.premise?.trim() ? <>Premise: {bible.premise.trim()}</> : "Premise: not set yet"}
            </RecapLine>
          </div>

          {/* ── Identity summary (~30%): the locked reference image as a circle
              plus the plan's at-a-glance numbers, side by side with the lines. ── */}
          <div className="flex shrink-0 flex-col items-center gap-4 border-t border-white/[0.07] px-5 py-6 md:w-[30%] md:min-w-[210px] md:border-l md:border-t-0">
            <button
              type="button"
              onClick={() => onEdit(2)}
              aria-label="Edit the face reference"
              title="Edit the face reference"
              className="group relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-lime-400/70"
            >
              <span aria-hidden className="absolute -inset-1.5 rounded-2xl bg-gradient-to-b from-lime-400/30 to-transparent opacity-70" />
              {/* FULL 9:16 portrait, uncropped — this exact frame is what Grok/
                  Omni animate into vertical videos, so the Director shows the
                  whole reference, never a crop. */}
              {faceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={faceUrl}
                  alt="Locked face reference (full 9:16 video frame)"
                  className="relative aspect-[9/16] w-[124px] rounded-xl border border-white/15 object-cover shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)]"
                />
              ) : (
                <span className="relative grid aspect-[9/16] w-[124px] place-items-center rounded-xl border border-white/15 bg-white/[0.05]">
                  <User className="size-8 text-zinc-500" />
                </span>
              )}
              <span className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full border border-white/15 bg-[#141410] text-zinc-400 transition-colors group-hover:text-lime-300">
                <Pencil className="size-3" />
              </span>
            </button>
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              {faceUrl ? "Video reference · 9:16" : "No face picked yet"}
            </p>

            <div className="w-full space-y-2">
              {[
                { Icon: Film, label: "Formats", value: String((bible.format?.kinds ?? []).length || "0") },
                { Icon: CalendarClock, label: "Posts / day", value: String(postsPerDay) },
                ...(language ? [{ Icon: Languages, label: "Language", value: language }] : []),
              ].map(({ Icon, label, value }) => (
                <div key={label} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                    <Icon className="size-3" /> {label}
                  </span>
                  <span className="text-[12px] font-semibold text-white">{value}</span>
                </div>
              ))}
              {monthlyCredits > 0 && (
                <p className="pt-1 text-center text-[10.5px] text-zinc-600">Estimated ~{monthlyCredits.toLocaleString()} credits/mo at this cadence</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
        >
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-zinc-400">Advanced settings</span>
          <ChevronDown className={`size-4 text-zinc-500 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </button>
        {advancedOpen && <div className="mt-2">{advanced}</div>}
      </div>
    </motion.div>
  );
}
