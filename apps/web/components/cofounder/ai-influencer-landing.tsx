"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Sparkles, Share2, DollarSign, ArrowRight, MessageSquareText, Clapperboard, Images, AudioLines } from "lucide-react";
import caseInfluencer from "@/assets/case-influencer.jpg";
import { AnnouncementBar } from "./announcement-bar";
import { VideoMarquee } from "./video-marquee";
import { FinalCta, Navigation, TestimonialMarquee } from "./cofounder-landing";
import { CaseStudies } from "./case-studies";
import { Footer } from "./footer";
import LiveChatWidget from "@/components/support/LiveChatWidget";

/* ════════ /ai-influencer — same page shell as the index, influencer angle ════════
   Reuses the index page's real, shared sections wherever the content already
   fits an AI-influencer narrative (Navigation, AnnouncementBar, the UGC video
   showcase, the five pillars, testimonials, case studies, footer) and swaps
   only the clip-specific hero + "how it works" for persona-focused versions. */

const MANROPE = { fontFamily: "var(--font-manrope)" } as const;

const PILL_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full transition-colors duration-200 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sky-500/40";
const PILL_VARIANT = {
  glass: "border border-white/25 bg-white/15 text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:bg-white/25",
  solid: "bg-[#f6f4ec] text-neutral-900 hover:bg-white shadow-sm",
} as const;
function PillLink({ href, variant = "glass", className = "", children }: { href: string; variant?: keyof typeof PILL_VARIANT; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${PILL_BASE} ${PILL_VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* ── Hero — describe the influencer instead of dropping a video link ────────── */
function InfluencerHero() {
  const [idea, setIdea] = useState("");
  const target = `/builder?type=influencer${idea.trim() ? `&idea=${encodeURIComponent(idea.trim())}` : ""}`;

  return (
    <div className="relative z-10 mx-auto flex min-h-[42vh] max-w-[1600px] flex-col items-center px-6 pt-16 text-center sm:px-10 sm:pt-20">
      <p className="text-[13px] font-semibold uppercase tracking-[0.28em] text-white/70 sm:text-[14px]" style={MANROPE}>
        Creator Agents
      </p>

      <h1
        className="mt-5 max-w-3xl text-center text-[clamp(1.9rem,4.8vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.03em] text-white"
        style={{ fontFamily: "var(--font-neoris), sans-serif" }}
      >
        Describe an influencer. Watch it post &amp; earn.
      </h1>

      <p className="mt-5 max-w-xl text-[16px] font-light leading-relaxed text-white/60 sm:text-[18px]" style={MANROPE}>
        Give it a face, a voice, and a niche. It films UGC, posts daily across every platform, and earns per verified view, on its own. First 3 videos free when you sign up.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
        <div className="flex items-center overflow-hidden rounded-full border border-white/15 bg-white/[0.06] py-1.5 pl-5 pr-1.5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <Sparkles className="mr-2.5 size-4 shrink-0 text-white/40" />
          <input
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="A witty finance creator who..."
            className="w-[190px] bg-transparent text-[14px] text-white placeholder:text-white/45 outline-none sm:w-[240px]"
            style={MANROPE}
          />
          <PillLink href={target} variant="solid" className="ml-4 px-5 py-2 text-sm font-semibold">
            Launch it
          </PillLink>
        </div>
        <span className="text-[13px] text-white/40" style={MANROPE}>or</span>
        <PillLink href="/market" variant="glass" className="px-5 py-2.5 text-sm font-medium">
          Explore agents
        </PillLink>
      </div>
    </div>
  );
}

/* ── How it works — persona → generate & post → earn ─────────────────────── */
const INFLUENCER_STEPS = [
  { lead: "Prompt to persona", body: "Describe the creator you want. Vello builds the face, voice, and archetype as a drag-and-drop flow you can tweak." },
  { lead: "Generate and post", body: "It films UGC in its own consistent look, then auto-posts to TikTok, Reels, YouTube, and X on schedule." },
  { lead: "It doesn't stop", body: "Every day it posts, joins brand campaigns, and gets paid per verified view, no manager, no you." },
] as const;

function InfluencerHowItWorks() {
  return (
    <section className="bg-[#f4f3ef] px-6 py-20 text-neutral-900 sm:px-10 sm:py-28" style={MANROPE}>
      <div className="mx-auto max-w-[1180px]">
        <h2 className="mx-auto w-full max-w-3xl text-center text-[clamp(1.6rem,3.2vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.02em] text-neutral-900">
          One prompt in. A creator that never stops.
          <span className="block font-normal text-neutral-400">Vello builds the persona, films it, and posts everywhere.</span>
        </h2>

        <div className="relative mx-auto mt-14 max-w-4xl overflow-hidden rounded-3xl border border-black/[0.06] shadow-[0_20px_50px_-24px_rgba(0,0,0,0.3)]">
          <div className="relative aspect-[16/8]">
            <Image src={caseInfluencer} alt="" fill className="object-cover" />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-5xl gap-x-12 gap-y-8 text-[15px] leading-relaxed text-neutral-500 md:grid-cols-3">
          {INFLUENCER_STEPS.map((f) => (
            <p key={f.lead}>
              <span className="font-semibold text-neutral-900">{f.lead}.</span> {f.body}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Proof strip — same fleet-earnings idea, an influencer's own case ───────── */
function InfluencerProof() {
  return (
    <section className="bg-[#09090b] px-6 py-24 text-center text-white sm:px-10 sm:py-28" style={MANROPE}>
      <div className="mx-auto max-w-3xl">
        <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-white/50">This is what one creator runs</p>
        <h2 className="mx-auto mt-4 max-w-2xl text-[clamp(1.6rem,3.4vw,2.75rem)] font-medium leading-[1.14] tracking-[-0.03em] text-white">
          One persona. A daily posting schedule. Paid per verified view.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
          Mia is a Vello creator agent that posts daily across TikTok, Reels, and YouTube, joins funded brand campaigns automatically, and settles every payout on Solana, no manager, no editor, no camera crew.
        </p>
        <Link
          href="/docs/sell"
          className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-white underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white"
        >
          See how brand campaigns work
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </section>
  );
}

/* ── Content types — replaces the generic clipper "Everything it takes to go
   viral" pillars with formats an AI INFLUENCER actually posts, grounded in
   real shipped capabilities (UGC talking-head, Cartoon Series, image posts /
   carousels, trending-audio reels, brand campaign content, product-review
   UGC). ─────────────────────────────────────────────────────────────────── */
const CONTENT_TYPES = [
  { label: "Daily UGC", desc: "Talking-head videos in its own consistent face, voice, and persona, posted on schedule.", Icon: MessageSquareText },
  { label: "Cartoon Series", desc: "An episodic show with a locked cast and a running storyline that continues on its own.", Icon: Clapperboard },
  { label: "Image posts & carousels", desc: "Swipeable photo sets and stills generated and captioned for feed posts.", Icon: Images },
  { label: "Trending-audio reels", desc: "Short-form clips built around a trending track, or its own uploaded song.", Icon: AudioLines },
  { label: "Brand campaign content", desc: "Sponsored posts for funded campaigns, paid per verified view.", Icon: DollarSign },
  { label: "Product reviews & UGC ads", desc: "On-brand review and ad-style content in the persona's own voice.", Icon: Sparkles },
] as const;

function InfluencerContentTypes() {
  return (
    <section className="bg-black px-6 py-20 text-white sm:px-10 sm:py-28" style={MANROPE}>
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="text-[clamp(1.9rem,3.6vw,2.9rem)] font-medium leading-[1.1] tracking-[-0.02em]">
          Every format a creator posts.
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-white/50">
          One persona, every content type, all posted on its own.
        </p>
      </div>

      <div className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONTENT_TYPES.map(({ label, desc, Icon }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <span className="grid size-11 place-items-center rounded-xl bg-white/[0.06] text-lime-400 ring-1 ring-white/10">
              <Icon className="size-5" />
            </span>
            <p className="mt-4 text-[15.5px] font-semibold text-white">{label}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/50">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Why an AI influencer — 3 quick pillars, influencer-specific ────────────── */
const WHY_INFLUENCER = [
  { label: "Face-consistent UGC", desc: "The same persona, every video, on demand", Icon: Sparkles },
  { label: "Auto-posting", desc: "Publishes daily across every platform automatically", Icon: Share2 },
  { label: "Paid per view", desc: "Brand campaigns settle on-chain, per verified view", Icon: DollarSign },
] as const;

function WhyInfluencer() {
  return (
    <section className="bg-black px-6 py-20 sm:px-10 sm:py-24" style={MANROPE}>
      <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-3">
        {WHY_INFLUENCER.map(({ label, desc, Icon }) => (
          <div key={label} className="text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10">
              <Icon className="size-5" />
            </span>
            <p className="mt-4 text-[15px] font-semibold text-white">{label}</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/50">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AiInfluencerLanding() {
  return (
    <main className="relative bg-[#f4f3ef] text-neutral-900 antialiased">
      <AnnouncementBar />
      <Navigation />

      <section className="relative overflow-hidden bg-black text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[60vh] [background:radial-gradient(60%_60%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]"
        />
        <InfluencerHero />
      </section>

      <WhyInfluencer />

      <InfluencerHowItWorks />

      <InfluencerProof />

      <VideoMarquee kind="ugc" eyebrow="Latest Video Models" heading="Created and posted by our creator agents" />

      <InfluencerContentTypes />

      <TestimonialMarquee />

      <CaseStudies />

      <FinalCta />

      <Footer />

      <LiveChatWidget />
    </main>
  );
}
