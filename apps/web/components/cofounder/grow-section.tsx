import type { ReactNode } from "react";
import { Play, Scissors } from "lucide-react";
import caseInfluencer from "@/assets/case-influencer.jpg";
import flashAvatar from "@/assets/flash.jpeg";
import caseAgency from "@/assets/case-agency.png";
import caseEvent from "@/assets/case-event.jpeg";
import { UgcPhonesVisual, CampaignStackVisual } from "./grow-visuals";
import { POSTING_ICONS } from "./social-icons";

/* ════════ "Everything it takes to go viral" — Vello's five pillars ════════
   A dark section mirroring the reference: a bold two-line headline, a muted
   sub-line, then a single row of image-topped feature cards. Visuals are compact
   glass mockups on one shared dark backdrop with a single emerald accent, so the
   row reads as one intentional system rather than five different gradients. The
   Auto-Posting tile uses real platform logos (Simple Icons CDN). */

const INTER = { fontFamily: "var(--font-inter)" } as const;

/* ── Shared surface: unified dark backdrop, faint grid, soft emerald top-glow ──
   `shellClassName` overrides the default square aspect (e.g. a wide banner when a
   pillar spans the full width on mobile). */
function VisualShell({ children, shellClassName }: { children: ReactNode; shellClassName?: string }) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#0c0d10] ${shellClassName ?? "aspect-square"}`}>
      {/* faint dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.4px)",
          backgroundSize: "14px 14px",
        }}
      />
      {/* soft emerald glow from the top */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 45% at 50% 0%, rgba(52,211,153,0.10), transparent 60%)" }}
      />
      <div className="relative z-10 flex size-full items-center justify-center">{children}</div>
    </div>
  );
}

// 1 — AI Influencer pillar lives in ./grow-visuals (UgcPhonesVisual) — three portrait
// phones auto-playing real UGC clips from the feed.

// 2 — AI Clipper: a real video still in an editor — a scrubbing playhead, a
// Smart Caption, and a clip timeline with the kept viral moment highlighted.
function ClipperVisual() {
  return (
    <VisualShell>
      <div className="flex w-[82%] flex-col rounded-xl border border-white/10 bg-zinc-900/80 p-2 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)]">
        {/* Preview — real footage being clipped. */}
        <div className="relative aspect-video overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={caseEvent.src} alt="" className="absolute inset-0 size-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white/85 ring-1 ring-white/10">
            <Scissors className="size-2.5" /> Auto-clip
          </span>
          <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[9px] text-white/80">00:42</span>
          {/* centre play button */}
          <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-sm">
            <Play className="size-3.5 translate-x-px fill-white text-white" />
          </span>
          {/* scrubbing playhead */}
          <span className="cf-scrub absolute bottom-0 top-0 w-px bg-emerald-400 shadow-[0_0_8px_#34d399]">
            <span className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-emerald-400" />
          </span>
          {/* Smart caption */}
          <div className="absolute inset-x-0 bottom-1.5 text-center">
            <span className="inline-block rounded bg-black/65 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white ring-1 ring-white/10">
              this part went <span className="text-emerald-400">viral</span>
            </span>
          </div>
        </div>
        {/* Editing timeline — thumbnails + waveform, kept clip highlighted. */}
        <div className="mt-2 flex items-center gap-1">
          {[caseEvent.src, flashAvatar.src, caseInfluencer.src, caseAgency.src, caseEvent.src].map((src, i) => (
            <span
              key={i}
              className={`relative h-6 flex-1 overflow-hidden rounded-[3px] ${i === 2 ? "ring-2 ring-emerald-400" : "opacity-70 ring-1 ring-white/10"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" />
              {i === 2 && <span aria-hidden className="absolute inset-0 bg-emerald-400/20" />}
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
          <Scissors className="size-2.5 text-emerald-400" />
          <span className="h-1 flex-1 rounded-full bg-gradient-to-r from-emerald-400/70 via-white/15 to-white/10" />
          <span className="font-mono text-[8px] text-white/40">0:15</span>
        </div>
      </div>
    </VisualShell>
  );
}

// 3 — Auto-Posting: brand-coloured platform icons on white tiles, scheduled.
function PostingVisual() {
  return (
    <VisualShell>
      <div className="grid grid-cols-3 gap-2.5">
        {POSTING_ICONS.map((p, i) => (
          <span
            key={p.key}
            title={p.label}
            className="relative grid size-12 place-items-center rounded-2xl border border-black/[0.06] bg-white shadow-sm shadow-black/30"
          >
            <p.Icon className="size-6" />
            {/* one tile shows a live "scheduled" pulse */}
            {i === 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0c0d10]" />
              </span>
            )}
          </span>
        ))}
        {/* remaining networks */}
        <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-[13px] font-semibold text-white/45">
          +6
        </span>
      </div>
    </VisualShell>
  );
}

// 4 — Brand Campaigns lives in ./grow-visuals (CampaignStackVisual) — two
// stacked cards from real running campaigns.

// 5 — On-chain Payouts: a premium, shining Solana logomark — payouts settle on Solana.
const SOL_BARS = [
  "M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H15.5c-5.8 0-8.7-7-4.6-11.1L64.6 237.9z",
  "M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H15.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z",
  "M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.6z",
];

function PayoutVisual() {
  return (
    // Full-width wide banner on mobile (the card spans both columns), reverting to
    // the shared square on sm+.
    <VisualShell shellClassName="aspect-[16/10] sm:aspect-square">
      <style>{`
        @keyframes solGlow  { 0%,100% { opacity:.5; transform:scale(.9); } 50% { opacity:.95; transform:scale(1.08); } }
        @keyframes solFloat { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
        @keyframes solShine { 0% { transform:translateX(-320px); } 55%,100% { transform:translateX(680px); } }
        @media (prefers-reduced-motion: reduce) {
          .sol-glow, .sol-float, .sol-shine { animation: none !important; }
        }
      `}</style>
      <div className="relative flex size-full items-center justify-center">
        {/* pulsing Solana brand glow */}
        <div
          aria-hidden
          className="sol-glow pointer-events-none absolute size-[62%] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(153,69,255,0.55), rgba(20,241,149,0.22) 45%, transparent 70%)",
            filter: "blur(10px)",
            animation: "solGlow 4.2s ease-in-out infinite",
          }}
        />
        {/* floating logomark */}
        <div className="sol-float w-[46%]" style={{ animation: "solFloat 6s ease-in-out infinite" }}>
          <svg viewBox="0 0 398 312" className="h-auto w-full" style={{ filter: "drop-shadow(0 10px 26px rgba(153,69,255,0.4))" }} aria-label="Solana">
            <defs>
              <linearGradient id="solGrad" x1="360" y1="-30" x2="141" y2="340" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
              <clipPath id="solClip">
                {SOL_BARS.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </clipPath>
            </defs>
            <g clipPath="url(#solClip)">
              <rect x="0" y="0" width="398" height="312" fill="url(#solGrad)" />
              {/* shine sweep — a skewed highlight travelling across, clipped to the bars */}
              <g className="sol-shine" style={{ animation: "solShine 3.4s ease-in-out infinite" }}>
                <rect
                  x="-70"
                  y="-90"
                  width="90"
                  height="500"
                  transform="skewX(-18)"
                  fill="rgba(255,255,255,0.85)"
                />
              </g>
            </g>
          </svg>
        </div>
        {/* caption */}
        <div className="absolute bottom-4 flex items-center gap-1.5 text-[11px] text-zinc-400">
          <span className="size-1.5 rounded-full bg-emerald-400" /> Settled on Solana
        </div>
      </div>
    </VisualShell>
  );
}

/* ── Pillars data ─────────────────────────────────────────────────────────── */
type Pillar = {
  title: string;
  lead: string;
  body: string;
  Visual: () => ReactNode;
};

const PILLARS: Pillar[] = [
  {
    title: "AI Influencer",
    lead: "Face-consistent short videos, on demand.",
    body: "Give your AI influencer a face, voice, and persona. It films UGC that looks genuinely human.",
    Visual: UgcPhonesVisual,
  },
  {
    title: "AI Clipper",
    lead: "Turn one long video into ten viral clips.",
    body: "Auto-cuts the strongest moments and writes Smart Captions tuned to each platform.",
    Visual: ClipperVisual,
  },
  {
    title: "Auto-Posting",
    lead: "Post daily across every platform.",
    body: "TikTok, Reels, Shorts, and X, published on schedule in your influencer's own voice.",
    Visual: PostingVisual,
  },
  {
    title: "Brand Campaigns",
    lead: "Get paid per verified view.",
    body: "One brief, many agents. Clips auto-submit to brand bounties across your whole fleet; an oracle verifies the views before you're paid.",
    Visual: CampaignStackVisual,
  },
  {
    title: "On-chain Payouts",
    lead: "Earnings land straight in your wallet.",
    body: "Every payout settles on Solana: transparent, auditable, and instant.",
    Visual: PayoutVisual,
  },
];

export function GrowSection() {
  return (
    <section className="bg-[#09090b] px-6 py-24 text-white sm:px-10 sm:py-32" style={INTER}>
      <div className="mx-auto max-w-[1280px]">
        <h2 className="text-center text-[clamp(1.55rem,3.4vw,2.5rem)] font-medium leading-[1.08] tracking-[-0.03em]">
          Everything it takes to go viral.
          <span className="mt-1 block bg-[linear-gradient(180deg,#ffffff_0%,#d4d4d8_52%,#8b8b93_100%)] bg-clip-text text-[clamp(2.3rem,6vw,4.25rem)] font-semibold leading-[1.0] tracking-[-0.035em] text-transparent">
            All in one place.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-[clamp(0.95rem,1.4vw,1.1rem)] text-zinc-400">
          The five pillars behind every Vello influencer, working together and getting smarter every week.
        </p>

        <div className="mt-16 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-5">
          {PILLARS.map(({ title, lead, body, Visual }) => (
            // On-chain Payouts is the lone 5th card on mobile's 2-col grid, so span
            // it full width (both columns) there; normal single cell on sm+.
            <div key={title} className={title === "On-chain Payouts" ? "col-span-2 sm:col-span-1" : undefined}>
              <Visual />
              <h3 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">
                <span className="font-semibold text-white">{lead}</span> {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
