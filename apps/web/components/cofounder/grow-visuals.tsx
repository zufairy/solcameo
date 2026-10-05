"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ErrorBoundary } from "@/components/error/error-boundary";
import caseInfluencer from "@/assets/case-influencer.jpg";
import flashAvatar from "@/assets/flash.jpeg";
import caseAgency from "@/assets/case-agency.png";
import caseEvent from "@/assets/case-event.jpeg";

/* Live illustrations for the "Everything it takes to go viral" pillars:
   • AI Influencer — three portrait phones auto-playing real UGC clips.
   • Brand Campaigns — two stacked cards from real running campaigns.
   Both pull from Convex with a static fallback and an ErrorBoundary so a feed
   hiccup can never crash the homepage. */

/* Shared dark visual surface (matches the other pillars). */
function VisualShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#0c0d10]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.4px)", backgroundSize: "14px 14px" }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(70% 45% at 50% 0%, rgba(52,211,153,0.10), transparent 60%)" }} />
      <div className="relative z-10 flex size-full items-center justify-center">{children}</div>
    </div>
  );
}

/* ── UGC phones ──────────────────────────────────────────────────────────── */

// Auto-playing muted clip; fades in over the poster/fallback once it can play.
function ClipVideo({ src, poster }: { src: string; poster?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (v) v.muted = true; // React's muted attr is flaky for autoplay
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      onCanPlay={(e) => { setReady(true); e.currentTarget.muted = true; e.currentTarget.play().catch(() => {}); }}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}

type Phone = { video?: string; poster?: string | null; fallback: string; rot: number; dx: number; dy: number; z: number };
// A centred, overlapping stack (a fanned deck) — bigger and middle-anchored.
const PHONE_LAYOUT = [
  { rot: -14, dx: -46, dy: 10, z: 10 },
  { rot: 13, dx: 46, dy: 10, z: 20 },
  { rot: 0, dx: 0, dy: -6, z: 30 }, // front, on top
] as const;
const FALLBACK_IMGS = [caseInfluencer.src, flashAvatar.src, caseAgency.src];

function PhoneCard({ video, poster, fallback, rot, dx, dy, z }: Phone) {
  return (
    <div
      className="absolute left-1/2 top-1/2 w-[78px] rounded-[15px] border border-white/15 bg-zinc-950 p-1 shadow-[0_22px_44px_-14px_rgba(0,0,0,0.8)]"
      style={{ zIndex: z, transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) rotate(${rot}deg)` }}
    >
      <span className="absolute left-1/2 top-[7px] z-10 h-1 w-6 -translate-x-1/2 rounded-full bg-white/25" />
      <div className="relative aspect-[9/16] overflow-hidden rounded-[13px] bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster || fallback} alt="" className="absolute inset-0 size-full object-cover" />
        {video && <ClipVideo src={video} poster={poster} />}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <span className="absolute bottom-1.5 left-1.5 flex items-end gap-[2px]">
          {[0, 1, 2].map((b) => (
            <span key={b} className="cf-eq block h-2.5 w-[2.5px] rounded-full bg-emerald-400" style={{ animationDelay: `${b * 0.14}s` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

function UgcView({ phones }: { phones: Phone[] }) {
  return (
    <VisualShell>
      <div className="relative size-full">
        {phones.map((p, i) => (
          <PhoneCard key={i} {...p} />
        ))}
      </div>
    </VisualShell>
  );
}

function UgcInner() {
  const feed = useQuery(api.clipJobs.globalVideoFeed, { limit: 8, kind: "ugc" });
  const items = (feed?.items ?? []).filter((i: { videoUrl?: string }) => i.videoUrl).slice(0, 3);
  const phones: Phone[] = PHONE_LAYOUT.map((p, i) => ({
    ...p,
    video: items[i]?.videoUrl,
    poster: items[i]?.posterUrl,
    fallback: FALLBACK_IMGS[i],
  }));
  return <UgcView phones={phones} />;
}

const STATIC_PHONES: Phone[] = PHONE_LAYOUT.map((p, i) => ({ ...p, fallback: FALLBACK_IMGS[i] }));

export function UgcPhonesVisual() {
  return (
    <ErrorBoundary fallback={<UgcView phones={STATIC_PHONES} />}>
      <UgcInner />
    </ErrorBoundary>
  );
}

/* ── Brand campaigns (stacked cards from real running campaigns) ─────────────── */

type Camp = {
  brandName: string;
  title: string;
  ratePerThousandViews: number;
  campaignImageUrl?: string | null;
  brandLogoUrl?: string | null;
};
const FALLBACK_CAMPS: Camp[] = [
  { brandName: "Mach City", title: "Introduce Mach City", ratePerThousandViews: 3, campaignImageUrl: caseEvent.src, brandLogoUrl: flashAvatar.src },
  { brandName: "Moonads App", title: "Content for Moonads", ratePerThousandViews: 5, campaignImageUrl: caseAgency.src, brandLogoUrl: caseInfluencer.src },
];

// One compact campaign row (logo + brand/title + $ rate / 1k views).
// Sleek compact campaign chip — logo, name, small reward.
function CampCard({ c }: { c: Camp }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/95 px-2 py-1.5 shadow-[0_16px_34px_-16px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      <span className="size-8 shrink-0 overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.campaignImageUrl || c.brandLogoUrl || ""} alt="" className="size-full object-cover" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-white">{c.brandName}</span>
        <p className="mt-[1px] text-[8.5px] uppercase tracking-wide text-zinc-500">Reward</p>
      </div>
      <div className="shrink-0 text-right leading-none">
        <span className="text-[12px] font-bold tracking-tight text-white">${(c.ratePerThousandViews ?? 0).toFixed(2)}</span>
        <p className="mt-[1px] text-[7.5px] text-zinc-400">/ 1k views</p>
      </div>
    </div>
  );
}

function CampView({ items }: { items: Camp[] }) {
  const [front, back] = items;
  // Two separate chips, staggered — top nudged left, bottom nudged right.
  return (
    <VisualShell>
      <div className="flex w-full flex-col items-center gap-3.5">
        <div className="w-[66%] -translate-x-[9%] -rotate-2">
          <CampCard c={front} />
        </div>
        {back && (
          <div className="w-[66%] translate-x-[9%] rotate-2">
            <CampCard c={back} />
          </div>
        )}
      </div>
    </VisualShell>
  );
}

function CampInner() {
  const camps = useQuery(api.campaigns.list);
  // Real, presentable campaigns only: needs a proper photo + brand name, and
  // skips throwaway "test" rows so the homepage never surfaces junk.
  const picked = (camps ?? [])
    .filter(
      (c: Camp) =>
        !!c.campaignImageUrl &&
        !!c.brandName &&
        !/^https?:/i.test(c.brandName) &&
        !/\btest\b/i.test(`${c.brandName} ${c.title}`),
    )
    .slice(0, 2) as Camp[];
  return <CampView items={picked.length >= 2 ? picked : FALLBACK_CAMPS} />;
}

export function CampaignStackVisual() {
  return (
    <ErrorBoundary fallback={<CampView items={FALLBACK_CAMPS} />}>
      <CampInner />
    </ErrorBoundary>
  );
}
