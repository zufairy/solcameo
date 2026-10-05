"use client";

/* ════════ /dev/team-schedule — staff 4-week posting checklist ════════
   4 staff × 4-week program (setup/warm-up → engage/scale → reporting →
   fix/analytics), each week a fixed set of daily steps checked off per day.
   Curriculum is static (lib/dev/teamSchedule.ts); only the checkmarks persist
   (convex/devTeamSchedule.ts) — real Convex-backed state, shared across
   whoever opens this page, not per-browser localStorage (this is a team
   tool, everyone needs to see the same checked cells). No auth — low-stakes
   internal ops checklist, not user data. */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LabTabs } from "@/components/dev-lab/lab-tabs";
import { STAFF, WEEKS, DAY_LABELS, type StaffId } from "@/lib/dev/teamSchedule";
import { SERVICE_PRICES, CLIP_SKILL_PRICE_USDC } from "@/lib/economy/servicePrices";
import { Check, ChevronLeft, ChevronRight, Calculator } from "lucide-react";

const fmt$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Live-computed from the SAME price constants the platform actually bills
 *  (lib/economy/servicePrices.ts), not hand-typed numbers — a "standard"
 *  clip's skill stack (captions + hook + a zoom pass) is an assumption,
 *  labeled as one; render + social_post are exact platform prices. Raw AI
 *  provider costs for the underlying video-generation MODEL (Veo/Kie) aren't
 *  in this file and aren't included — this is platform-metering cost only. */
function CostEstimatePanel() {
  const assumedSkills = ["clip.captions", "clip.hook", "clip.zoom"];
  const skillStackCost = assumedSkills.reduce((s, id) => s + (CLIP_SKILL_PRICE_USDC[id] ?? 0), 0);
  const perClipPost = SERVICE_PRICES.render + SERVICE_PRICES.social_post + skillStackCost;
  const perInfluencerPost = SERVICE_PRICES.render + SERVICE_PRICES.social_post;

  const clipPostsPerStaffDay = 2 * 3.5; // 2 accounts × 3–4/day avg
  const influencerPostsPerStaffDay = 2 * 3; // 2 accounts × 3/day

  const perStaffDay = clipPostsPerStaffDay * perClipPost + influencerPostsPerStaffDay * perInfluencerPost;
  const allStaffDay = perStaffDay * STAFF.length;
  const fourWeekTotal = allStaffDay * 28;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-white">
        <Calculator className="size-3.5 text-emerald-400" /> Video-generation cost estimate
      </h2>
      <p className="mt-0.5 text-[11.5px] text-white/40">
        Platform metering only (render + social_post + a standard skill stack), computed live from the real prices in{" "}
        <code className="text-white/60">lib/economy/servicePrices.ts</code>. Raw AI provider cost for the underlying
        video-generation model isn&rsquo;t in that file, so it isn&rsquo;t in this number.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Per clip post</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums text-white">{fmt$(perClipPost)}</p>
          <p className="mt-0.5 text-[9.5px] text-white/30">render + post + captions/hook/zoom</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Per influencer post</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums text-white">{fmt$(perInfluencerPost)}</p>
          <p className="mt-0.5 text-[9.5px] text-white/30">render + post</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Per staff / day</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums text-white">{fmt$(perStaffDay)}</p>
          <p className="mt-0.5 text-[9.5px] text-white/30">2 clip + 2 influencer accounts</p>
        </div>
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/70">4 weeks, all 4 staff</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums text-emerald-300">{fmt$(fourWeekTotal)}</p>
          <p className="mt-0.5 text-[9.5px] text-emerald-300/50">{fmt$(allStaffDay)}/day × 28 days</p>
        </div>
      </div>
    </div>
  );
}

export default function TeamSchedulePage() {
  const [staffId, setStaffId] = useState<StaffId>(STAFF[0].id);
  const [weekIdx, setWeekIdx] = useState(0);

  const allChecks = useQuery(api.devTeamSchedule.listAll, {}) as
    | { staffId: string; weekIdx: number; dayIdx: number; stepIdx: number; checked: boolean }[]
    | undefined;
  const toggleCheck = useMutation(api.devTeamSchedule.toggleCheck);

  const checkedSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of allChecks ?? []) if (c.checked) s.add(`${c.staffId}:${c.weekIdx}:${c.dayIdx}:${c.stepIdx}`);
    return s;
  }, [allChecks]);

  const week = WEEKS[weekIdx];
  const totalCells = week.steps.length * DAY_LABELS.length;
  const doneCells = useMemo(() => {
    let n = 0;
    for (let d = 0; d < DAY_LABELS.length; d++) for (let s = 0; s < week.steps.length; s++) {
      if (checkedSet.has(`${staffId}:${weekIdx}:${d}:${s}`)) n++;
    }
    return n;
  }, [checkedSet, staffId, weekIdx, week.steps.length]);

  const toggle = (dayIdx: number, stepIdx: number) => {
    const key = `${staffId}:${weekIdx}:${dayIdx}:${stepIdx}`;
    void toggleCheck({ staffId, weekIdx, dayIdx, stepIdx, checked: !checkedSet.has(key) });
  };

  return (
    <div className="min-h-screen bg-[#08080a] px-6 py-6 text-white">
      <LabTabs active="team-schedule" />
      <div className="mx-auto max-w-6xl space-y-6">
        {/* ── Staff tabs ── */}
        <div className="flex flex-wrap items-center gap-2">
          {STAFF.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStaffId(s.id)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                s.id === staffId ? "bg-white text-black" : "border border-white/10 bg-white/[0.04] text-white/60 hover:text-white"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* ── Week pager ── */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setWeekIdx((w) => Math.max(0, w - 1))}
            disabled={weekIdx === 0}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:text-white disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>

          <div className="flex-1 text-center">
            <h1 className="text-[20px] font-semibold tracking-tight text-white">{week.title}</h1>
            <p className="mt-0.5 text-[12px] text-white/40">{week.blurb}</p>
          </div>

          <button
            type="button"
            onClick={() => setWeekIdx((w) => Math.min(WEEKS.length - 1, w + 1))}
            disabled={weekIdx === WEEKS.length - 1}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:text-white disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5">
          {WEEKS.map((w, i) => (
            <button
              key={w.title}
              type="button"
              onClick={() => setWeekIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === weekIdx ? "w-6 bg-emerald-400" : "w-1.5 bg-white/15 hover:bg-white/30"}`}
              aria-label={w.title}
            />
          ))}
        </div>

        {/* ── Progress ── */}
        <div className="flex items-center justify-between rounded-full border border-white/10 bg-white/[0.03] px-4 py-2">
          <span className="text-[12px] text-white/50">{STAFF.find((s) => s.id === staffId)?.name}&rsquo;s progress this week</span>
          <span className="text-[12.5px] font-semibold tabular-nums text-white">
            {doneCells} / {totalCells}
          </span>
        </div>

        {/* ── Checklist grid ── */}
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="w-[260px] px-4 py-3 text-left text-[10.5px] font-medium uppercase tracking-wide text-white/35">Step</th>
                {DAY_LABELS.map((d) => (
                  <th key={d} className="px-2 py-3 text-center text-[10.5px] font-medium uppercase tracking-wide text-white/35">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.steps.map((step, stepIdx) => (
                <tr key={step} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 text-white/80">{step}</td>
                  {DAY_LABELS.map((_, dayIdx) => {
                    const on = checkedSet.has(`${staffId}:${weekIdx}:${dayIdx}:${stepIdx}`);
                    return (
                      <td key={dayIdx} className="px-2 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(dayIdx, stepIdx)}
                          aria-pressed={on}
                          aria-label={`${step} — ${DAY_LABELS[dayIdx]}`}
                          className={`mx-auto grid size-6 place-items-center rounded-md border transition-colors ${
                            on
                              ? "border-emerald-400 bg-emerald-400/20 text-emerald-300"
                              : "border-white/15 bg-white/[0.02] text-transparent hover:border-white/30"
                          }`}
                        >
                          <Check className="size-3.5" strokeWidth={3} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Daily posting target reference ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Clip accounts</p>
            <p className="mt-1 text-[15px] font-semibold text-white">2 per staff</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Clip posts/day</p>
            <p className="mt-1 text-[15px] font-semibold text-white">3–4 each</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Influencer accounts</p>
            <p className="mt-1 text-[15px] font-semibold text-white">2 per staff</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">Influencer posts/day</p>
            <p className="mt-1 text-[15px] font-semibold text-white">3 each</p>
          </div>
        </div>

        <CostEstimatePanel />
      </div>
    </div>
  );
}
