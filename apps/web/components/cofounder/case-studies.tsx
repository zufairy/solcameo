"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Scissors, Megaphone, Sparkles } from "lucide-react";
import caseAgency from "@/assets/case-agency.png";
import caseEvent from "@/assets/case-event.jpeg";
import caseInfluencer from "@/assets/case-influencer.jpg";
import { ScrollVideo } from "./scroll-video";

/* ── Case studies ────────────────────────────────────────────────────────────
   Accordion tabs on the left (one per real result), a cross-fading photo panel
   on the right — mirroring the "What can Vello do for you?" layout. Selecting a
   tab expands its story + stats and swaps the image. Auto-advances until the
   user interacts; hover pauses. Reduced-motion is handled by framer-motion. */

const INTER = { fontFamily: "var(--font-inter)" } as const;
// Single accent for the case tabs — one green for the active title + row dot
// (replaces the three per-case accent colors).
const CASE_GREEN = "#65a30d";
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type Stat = { label: string; value: string };
type Case = {
  tab: string;
  Icon: typeof Scissors;
  accent: string;
  metric: string;
  metricSub: string;
  /** Optional label shown in the tab row (defaults to `metric`). */
  tabMetric?: string;
  title: string;
  body: string;
  by: string;
  role: string;
  stats: Stat[];
  img: StaticImageData;
};

// Usage-first stories: each one names WHO the reader might be, HOW they run
// Vello day to day, and only then the number — so a visitor reads their own
// workflow into the case instead of just seeing a stat.
const CASES: Case[] = [
  {
    tab: "Clipping agency",
    Icon: Scissors,
    accent: "#65a30d",
    metric: "$30K",
    metricSub: "a month, 3-person team",
    title: "An agency that sells clips without hiring editors",
    body: "Cliphauz runs a clipping agency for podcasters. Their whole workflow is pasting each client's episode link into Vello: the AI cuts the best moments, burns in captions and hooks, and posts to every client account on schedule. They charge per client, Vello does the editing, 42,000 clips a month with nobody on the timeline.",
    by: "Cliphauz",
    role: "Clipping agency",
    stats: [
      { label: "Clips / month", value: "42,000" },
      { label: "Editors hired", value: "0" },
      { label: "People involved", value: "3" },
    ],
    img: caseAgency,
  },
  {
    tab: "Product launch",
    Icon: Megaphone,
    accent: "#2563eb",
    metric: "10,000",
    metricSub: "signups, first 7 days",
    tabMetric: "10,000 signups",
    title: "A startup that launched with clips instead of ads",
    body: "JobTepi had a product demo and zero marketing budget. They dropped the demo footage into Vello and let it flood short-form: 60+ clips a day across TikTok, Reels, Shorts, and X, each cut and captioned automatically. Views became clicks, clicks became accounts, 10,000 signups in the first week, $0 spent on ads.",
    by: "JobTepi",
    role: "Product launch",
    stats: [
      { label: "Ad spend", value: "$0" },
      { label: "Days to 10K", value: "7" },
      { label: "Posts / day", value: "60+" },
    ],
    img: caseEvent,
  },
  {
    tab: "AI influencer",
    Icon: Sparkles,
    accent: "#db2777",
    metric: "$12K",
    metricSub: "earned in month one",
    title: "A creator who earns from a face that isn't hers",
    body: "Mia described one persona in Vello, a face, a voice, a niche, and let it run. The AI influencer films UGC daily, posts across every platform, and picks up funded brand campaigns on its own, paid per verified view. First 30 days: 40 brand deals, $12K, and she never opened an editor.",
    by: "Mia",
    role: "AI influencer",
    stats: [
      { label: "Brand deals", value: "40" },
      { label: "Videos filmed by her", value: "0" },
      { label: "Paid in", value: "USDC" },
    ],
    img: caseInfluencer,
  },
];

export function CaseStudies() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance until the user interacts (hover pauses; click sticks).
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((a) => (a + 1) % CASES.length), 6000);
    return () => clearInterval(id);
  }, [paused]);

  const c = CASES[active];

  return (
    <section className="relative bg-[#f4f3ef] px-6 pb-24 pt-24 text-neutral-900 sm:px-10 sm:pb-32 sm:pt-32" style={INTER}>
      {/* Scroll-triggered video card — straddles the divider between the dark
          section above and this one, centered on the seam. */}
      <div className="mx-auto -mt-[calc(6rem+(100vw-48px)*0.281)] mb-20 max-w-5xl sm:-mt-[calc(8rem+min(288px,(100vw-80px)*0.281))] sm:mb-24">
        <ScrollVideo />
      </div>

      <div className="mx-auto max-w-6xl">
        {/* Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-neutral-400">Case studies</p>
          <h2 className="mt-2 text-[clamp(1.9rem,4vw,3rem)] font-medium leading-[1.05] tracking-[-0.02em]">
            Three ways people run Vello.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-neutral-500">
            An agency selling clips, a startup launching a product, a creator running an AI influencer. Same platform, three playbooks, and each one starts with a free account.
          </p>
        </div>

        <div
          className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Tabs — accordion list. The tablist owns ONLY tabs; the "Build yours"
              CTA is a sibling (not a tab), so ARIA required-children holds. */}
          <div className="flex flex-col">
            <div role="tablist" aria-label="Case studies" className="flex flex-col">
            {CASES.map((cs, i) => {
              const on = i === active;
              return (
                <button
                  key={cs.tab}
                  role="tab"
                  aria-selected={on}
                  aria-controls="case-panel"
                  onClick={() => { setActive(i); setPaused(true); }}
                  className="group border-t border-black/10 py-6 text-left outline-none transition-colors focus-visible:bg-black/[0.03]"
                >
                  <div className="flex items-center gap-3">
                    {/* Lime-green dot — same marker for every case (replaces the
                        per-case lucide icons). */}
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full transition-opacity duration-300"
                      style={{ background: CASE_GREEN, opacity: on ? 1 : 0.4 }}
                    />
                    <span
                      className="text-[clamp(1.15rem,2.3vw,1.55rem)] font-semibold tracking-tight transition-colors duration-300"
                      style={{ color: on ? CASE_GREEN : "#171717" }}
                    >
                      {cs.title}
                    </span>
                    <span className="ml-auto text-[13px] font-medium tabular-nums text-neutral-400">{cs.tabMetric ?? cs.metric}</span>
                  </div>

                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.4, ease: EASE_OUT }}
                        className="overflow-hidden"
                      >
                        <p className="mt-3 max-w-md pl-8 text-[15px] leading-relaxed text-neutral-600">{cs.body}</p>
                        <div className="mt-5 flex gap-8 pl-8">
                          {cs.stats.map((s) => (
                            <div key={s.label}>
                              <p className="text-[18px] font-bold tabular-nums leading-none text-neutral-900">{s.value}</p>
                              <p className="mt-1 text-[11.5px] leading-tight text-neutral-500">{s.label}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
            </div>

            <a
              href="/builder"
              className="mt-8 inline-flex w-fit items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2.5 text-[14px] font-semibold text-white outline-none transition-colors hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f3ef]"
            >
              Build yours <ArrowUpRight className="size-4" />
            </a>
          </div>

          {/* Image panel — cross-fades on tab change, with a metric overlay. */}
          <div
            id="case-panel"
            role="tabpanel"
            className="relative aspect-[5/4] overflow-hidden rounded-[28px] ring-1 ring-black/10 shadow-[0_40px_90px_-45px_rgba(0,0,0,0.45)]"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
                className="absolute inset-0"
              >
                <Image src={c.img} alt={c.role} fill priority={active === 0} sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-7">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-white/25 backdrop-blur-sm"
                    style={{ background: `${c.accent}cc` }}
                  >
                    <c.Icon className="size-3" /> {c.tab}
                  </span>
                  <p className="mt-3 flex items-baseline gap-2">
                    <span className="text-[clamp(2.25rem,5vw,3rem)] font-bold leading-none tracking-tight tabular-nums [text-shadow:0_2px_16px_rgba(0,0,0,0.4)]">
                      {c.metric}
                    </span>
                    <span className="text-[15px] font-semibold text-white/85">{c.metricSub}</span>
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
