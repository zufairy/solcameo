"use client";

import { useState, useEffect, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSpring, useMotionValueEvent, useReducedMotion } from "framer-motion";
import {
  Check, X, Plus, Minus, ArrowRight, ArrowUp, Film, Video, Zap, Users,
  ChevronUp, ChevronDown, Clock, Eye, DollarSign, Percent, Info,
} from "lucide-react";
import velloSquare from "@/assets/transparent-image.png";
import cofounderBg from "@/public/cofounder-bg.png";
import { Footer } from "./footer";
import { Navigation } from "./cofounder-landing";
import { SUBSCRIPTION_TIERS } from "@/lib/shared/creditPricing";

/* ════════ Vello — Pricing ════════
   Dark theme, matching the rest of the app (same near-black canvas + white/
   opacity text scale as the landing page and product pages): three plan
   cards with a lime-accented "featured" tier and a premium dark Enterprise
   card, an interactive cost estimator, a full feature-comparison matrix,
   managed-integrations strip, an FAQ accordion, and a closing CTA. */

const INTER = { fontFamily: "var(--font-manrope)" } as const;
const GEIST = { fontFamily: "var(--font-geist-sans)" } as const;
// The site's other two already-loaded families (see app/layout.tsx) — used to
// give the pricing calculator's result tiles genuinely distinct typography
// per tile instead of one font repeated six times.
const SPACE = { fontFamily: "var(--font-space)" } as const;
const NEWS_ITALIC = { fontFamily: "var(--font-newsreader)", fontStyle: "italic" } as const;

/* Smoothly springs an integer to its target and prints it (isolated re-render). */
function AnimatedInt({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 24 });
  const [display, setDisplay] = useState(value);
  useEffect(() => { if (reduce) setDisplay(value); else spring.set(value); }, [value, reduce, spring]);
  useMotionValueEvent(spring, "change", (v) => setDisplay(v));
  return <>{Math.round(display).toLocaleString("en-US")}</>;
}

/* The square Vello mark, shown whole on a transparent background. */
function AppLogoIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <Image
        src={velloSquare}
        alt="Vello"
        fill
        sizes="64px"
        className="object-contain drop-shadow-[0_10px_22px_rgba(120,170,20,0.35)]"
      />
    </span>
  );
}

/* Primary CTA — a white pill, readable on the dark page background. Used on
   the regular/featured plan cards and the comparison-table headers. */
const PRIMARY_BTN =
  "flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-[14px] " +
  "font-semibold text-neutral-900 outline-none transition-all duration-200 hover:bg-neutral-100 " +
  "active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]";

/* Enterprise CTA — the brand lime gradient, so the top-tier card's action
   still reads as the most premium one even though every card is dark now. */
const ENTERPRISE_BTN =
  "flex w-full items-center justify-center rounded-xl px-4 py-3 text-[14px] font-semibold text-[#0a1505] " +
  "bg-[linear-gradient(105deg,#bef264_0%,#a3e635_45%,#4ade80_100%)] outline-none transition-all duration-200 " +
  "shadow-[0_6px_20px_-6px_rgba(163,230,53,0.55)] hover:shadow-[0_8px_26px_-6px_rgba(163,230,53,0.7)] hover:brightness-[1.04] " +
  "active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-lime-300/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]";

/* ── Shared pill button system (dark theme) ────────────────────────────────── */
const PILL_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg " +
  "transition-colors duration-200 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f]";

const PILL_VARIANT = {
  ghost: "text-white/60 hover:bg-white/[0.06] hover:text-white",
  glass: "border border-white/15 bg-white/[0.06] text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:bg-white/[0.1]",
  solid: "bg-white text-neutral-900 hover:bg-neutral-100 shadow-sm",
} as const;

function PillLink({
  href, variant = "glass", className = "", children,
}: { href: string; variant?: keyof typeof PILL_VARIANT; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${PILL_BASE} ${PILL_VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* ── Navigation — reuses the exact landing-page header (same black sticky
   glass bar, centered nav, Features/Solutions mega-menus, account pill) so
   the whole site shares one nav instead of pricing carrying its own stale
   copy. See ./cofounder-landing's <Navigation />. ──────────────────────────── */

/* ── Plan cards — clean, image-free tiles: bold price, white CTA, hairline,
   then a checked feature list. Priced around clipping volume (videos/month,
   cost per video) rather than agent minting — that's the thing people are
   actually buying. ─────────────────────────────────────────────────────── */
type Plan = {
  name: string;
  price: string;         // "Free" / "$59" / "$1,500"
  suffix?: string;       // "/ month"
  sub?: string;          // recurring/overage line under the price
  clips: string;         // e.g. "10 / mo" — AI Clipper quota
  aiVideos: string;      // e.g. "~133 / mo" or "Locked" or "Custom" — AI Influencer quota
  agentAccounts: string; // e.g. "3" or "Locked" or "Custom" — agent accounts included
  credits: string;       // e.g. "6,000 / mo" or "None" or "Custom" — the shared spend pool
  simple?: boolean;      // Enterprise: skip the 3-stat grid, one plain line instead
  tagline: string;       // one-line summary under the button
  inherit?: string;      // "Everything in Starter, plus..."
  featured?: boolean;    // center card: floating badge + lime-accented elevation
  badge?: string;
  dark?: boolean;        // Enterprise: deepest card with a circle grid + lime CTA
  features: string[];
  cta: { label: string; href: string; tier?: "starter" | "creator" | "growth" };
};

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "Free",
    clips: "Up to 30",
    aiVideos: "1 trial",
    agentAccounts: "1 draft",
    credits: "Trial balance",
    tagline: "Create an agent and try the complete workflow.",
    features: [
      "AI Clipper: auto-cut viral moments",
      "Auto Captions, Smart Framing, Auto Hook",
      "AI Video Editor, AI Brolls",
      "Virality score on every selected clip",
      "Watermarked exports and three-day retention",
    ],
    cta: { label: "Start free", href: "/studio/build" },
  },
  {
    name: "Starter",
    price: "$9",
    suffix: "/ month",
    sub: "900 flexible credits every month",
    clips: "Up to 7.5 hr",
    aiVideos: "Pay by model",
    agentAccounts: "1 active",
    credits: `${SUBSCRIPTION_TIERS.starter.creditsPerMonth.toLocaleString()} / mo`,
    tagline: "A low-cost start for one publishing agent.",
    inherit: "Everything in Free, plus…",
    features: [
      "One active AI Clipper or AI Influencer",
      "No watermark",
      "One connected social account",
      "Credits show before every clip or generation",
    ],
    cta: { label: "Subscribe", href: "/studio/build", tier: "starter" },
  },
  {
    name: "Creator",
    price: "$29",
    suffix: "/ month",
    sub: "2,900 flexible credits every month",
    clips: "Up to 24 hr",
    aiVideos: "Pay by model",
    agentAccounts: "3 active",
    credits: `${SUBSCRIPTION_TIERS.creator.creditsPerMonth.toLocaleString()} / mo`,
    tagline: "For creators running a daily content system.",
    featured: true,
    badge: "Most popular",
    inherit: "Everything in Starter, plus…",
    features: [
      "Three active agents",
      "Three connected social accounts",
      "Automatic posting and scheduling",
      "Brand campaigns and USDC payouts",
    ],
    cta: { label: "Subscribe", href: "/studio/build", tier: "creator" },
  },
  {
    name: "Growth",
    price: "$59",
    suffix: "/ month",
    sub: "6,000 flexible credits every month",
    clips: "Up to 50 hr",
    aiVideos: "Pay by model",
    agentAccounts: "5 active",
    credits: `${SUBSCRIPTION_TIERS.growth.creditsPerMonth.toLocaleString()} / mo`,
    tagline: "For multi-agent brands and production teams.",
    dark: true,
    inherit: "Everything in Creator, plus…",
    features: [
      "Five active agents",
      "Ten connected social accounts",
      "Priority generation queue",
      "One-month credit rollover while subscribed",
    ],
    cta: { label: "Subscribe", href: "/studio/build", tier: "growth" },
  },
];

/** Growth/Pro "Subscribe" — starts the real Stripe subscription checkout
 *  (same /api/billing/checkout route + tier ids TopUpModal's Subscribe tab
 *  uses) instead of just linking to /studio/build, so this page's price is
 *  the price you actually get charged, not a promise a different page has to
 *  keep. Signed-out visitors get Privy's login prompt automatically — the
 *  global fetch interceptor in supabase-auth-provider attaches auth to every
 *  /api/ call and pops the modal on a 401, no extra wiring needed here. */
function SubscribeButton({ tier, label, accent }: { tier: "starter" | "creator" | "growth"; label: string; accent: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = accent ? ENTERPRISE_BTN : PRIMARY_BTN;

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={subscribe}
        disabled={loading}
        className={`${cls} disabled:cursor-wait disabled:opacity-70`}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && <p className="mt-2 text-center text-[12px] text-red-400">{error}</p>}
    </div>
  );
}

function PlanCta({ cta, accent = false }: { cta: Plan["cta"]; accent?: boolean }) {
  const cls = accent ? ENTERPRISE_BTN : PRIMARY_BTN;
  if (cta.tier) return <SubscribeButton tier={cta.tier} label={cta.label} accent={accent} />;
  return cta.href.startsWith("mailto:")
    ? <a href={cta.href} className={cls}>{cta.label}</a>
    : <Link href={cta.href} className={cls}>{cta.label}</Link>;
}

/* Premium concentric-circle grid for the Enterprise card. */
function CircleGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1.4px)",
          backgroundSize: "18px 18px",
          maskImage: "radial-gradient(120% 80% at 50% 0%, #000 25%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(120% 80% at 50% 0%, #000 25%, transparent 72%)",
        }}
      />
      {/* concentric rings + soft lime glow behind the price */}
      <div
        className="absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(163,230,53,0.16), transparent 60%)",
          boxShadow: "0 0 0 1px rgba(163,230,53,0.06), inset 0 0 0 40px rgba(163,230,53,0.02)",
        }}
      />
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const enterprise = plan.dark;
  const featured = plan.featured;
  return (
    <div className="relative flex flex-col">
      {plan.badge && (
        <span className="absolute -top-3 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-neutral-900 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.6)]">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {plan.badge}
        </span>
      )}
      <div
        className={`relative flex flex-1 flex-col overflow-hidden rounded-[1.75rem] p-7 ${
          enterprise
            ? "border border-white/10 bg-neutral-950 text-white shadow-[0_34px_74px_-28px_rgba(0,0,0,0.85)]"
            : featured
              ? "border border-lime-300/25 bg-white/[0.045] text-white shadow-[0_34px_70px_-30px_rgba(0,0,0,0.6)] ring-1 ring-lime-300/10"
              : "border border-white/10 bg-white/[0.03] text-white shadow-[0_20px_48px_-26px_rgba(0,0,0,0.55)]"
        }`}
      >
        {enterprise && <CircleGrid />}

      <div className="relative z-10 flex flex-1 flex-col">
        <h3 className="text-[19px] font-bold tracking-tight text-white" style={GEIST}>{plan.name}</h3>

        {/* Price */}
        <div className="mt-5 flex items-end gap-1.5">
          <span className="text-[clamp(2.6rem,4vw,3.1rem)] font-bold leading-[0.95] tracking-tight text-white" style={GEIST}>
            {plan.price}
          </span>
          {plan.suffix && <span className="mb-1.5 text-[15px] text-white/40">{plan.suffix}</span>}
        </div>
        <p className="mt-1.5 h-4 text-[12.5px] text-white/40">{plan.sub}</p>

        {/* What you actually get, in plain terms — clips, AI videos, and the
            shared credit pool that funds AI-video generation (the same pool
            the billing page and top-up modal charge from, so this page and
            checkout never disagree). Enterprise skips the math — it's a
            custom package, not a metered quota. */}
        {plan.simple ? (
          <p className="mt-4 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[12.5px] text-white/70">
            Custom clips, AI videos, and credits, sized to your accounts.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-white/[0.07] rounded-xl bg-white/[0.05]">
            {[
              { icon: Film, label: "Clips (AI Clipper)", value: plan.clips },
              { icon: Video, label: "AI Videos (Influencer)", value: plan.aiVideos },
              { icon: Users, label: "Agent Accounts", value: plan.agentAccounts },
              { icon: Zap, label: "Total credits", value: plan.credits },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                <span className="flex items-center gap-1.5 text-white/50">
                  <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {label}
                </span>
                <span className={`font-semibold tabular-nums ${value === "Locked" ? "text-white/35" : "text-white"}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-4">
          <PlanCta cta={plan.cta} accent={enterprise} />
        </div>

        <p className="mt-5 text-[13.5px] text-white/50">{plan.tagline}</p>
        <div className="mt-5 h-px bg-white/10" />

        {/* Features */}
        <div className="mt-5 flex-1">
          {plan.inherit && <p className="mb-3 text-[13.5px] font-semibold text-white/85">{plan.inherit}</p>}
          <ul className="space-y-3">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-white/65">
                <Check className="mt-0.5 size-4 shrink-0 text-lime-400" strokeWidth={2.5} />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      </div>
    </div>
  );
}

/* ── Create & Grow Faster Calculator — pick a package, average views per
   clip, content category, and platform; the six result cards below recompute
   live off real plan numbers (clips included + effective cost/clip mirror
   PLANS / FEATURE_ROWS above — keep the three in sync if pricing changes). ── */
const CALC_PACKAGES = [
  { name: "Free",    clips: 30,  price: 0,  costPerClip: 0 },
  { name: "Starter", clips: 45,  price: 9,  costPerClip: 0.20 },
  { name: "Creator", clips: 145, price: 29, costPerClip: 0.20 },
  { name: "Growth",  clips: 300, price: 59, costPerClip: 0.20 },
] as const;

// Rough engagement multipliers by content category — directional, not a
// scientific benchmark, same spirit as the reference calculator's category
// picker: it moves the estimate, it isn't a guarantee.
const CALC_CATEGORIES = [
  { name: "Education", multiplier: 1.0 },
  { name: "Lifestyle", multiplier: 1.15 },
  { name: "Finance", multiplier: 0.9 },
  { name: "Gaming", multiplier: 1.3 },
  { name: "Fashion", multiplier: 1.1 },
  { name: "Food", multiplier: 1.2 },
  { name: "Tech", multiplier: 0.95 },
  { name: "Fitness", multiplier: 1.05 },
] as const;

const CALC_PLATFORMS = [
  { name: "TikTok", slug: "tiktok", multiplier: 1.25 },
  { name: "Instagram", slug: "instagram", multiplier: 1.0 },
  { name: "YouTube", slug: "youtube", multiplier: 0.85 },
] as const;

// Manual cut + caption + format time an editor spends per clip, the same
// reference point the old "vs. hiring an editor" copy used, now folded into
// "time saved" and "money saved" instead of a separate editor-tier picker.
const MINUTES_SAVED_PER_CLIP = 25;
const FREELANCE_RATE_PER_CLIP = 40;
const WEEKS_PER_MONTH = 4.345;
const CALC_BASELINE_VIEWS = CALC_PACKAGES[0].clips * 300; // Starter @ 300 avg views — the "no uplift" reference point
// $ per 1,000 views — a blended organic (creator-fund-style) + brand-campaign
// estimate. Directional, same spirit as the category/platform reach
// multipliers above: it moves the number, it isn't a guaranteed rate.
const RPM_ESTIMATE = 2.5;

/* A number field with up/down steppers, styled for the dark theme: a
   dark pill, big value, unit label riding outside the box. */
function NumberField({
  label, value, onChange, min = 0, max = 999999, step = 1, unit,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div>
      <p className="mb-2 text-[12.5px] font-medium text-white/45">{label}</p>
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
            className="w-full rounded-xl border border-white/12 bg-white/[0.05] py-2.5 pl-3.5 pr-8 text-[16px] font-semibold tabular-nums text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 flex-col">
            <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(clamp(value + step))} className="grid h-3.5 w-5 place-items-center rounded-t text-white/40 hover:bg-white/[0.08] hover:text-white">
              <ChevronUp className="size-3" />
            </button>
            <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(clamp(value - step))} className="grid h-3.5 w-5 place-items-center rounded-b text-white/40 hover:bg-white/[0.08] hover:text-white">
              <ChevronDown className="size-3" />
            </button>
          </div>
        </div>
        <span className="shrink-0 text-[13px] font-medium text-white/40">{unit}</span>
      </div>
    </div>
  );
}

/* ── Result mosaic — Windows-8/Metro-tile spirit: asymmetric sizes (one big
   hero tile, wide 2x1 tiles, plain squares), each with its own flat accent
   colorway and its own type family pulled from the site's already-loaded
   font set (Geist Sans / Manrope / Space Grotesk / Newsreader), so the six
   numbers read as distinct tiles rather than one repeated card six times.
   Layout is CSS grid-template-areas (see the <style> block in
   SavingsCalculator) — genuinely asymmetric, not six equal boxes. */
type TileAccent = { text: string; ring: string; wash: string; iconBg: string };
const TILE_ACCENT: Record<string, TileAccent> = {
  lime:    { text: "text-lime-300",    ring: "ring-lime-400/25",    wash: "from-lime-400/[0.14] via-lime-400/[0.05] to-transparent",    iconBg: "bg-lime-400/15 text-lime-300" },
  sky:     { text: "text-sky-300",     ring: "ring-sky-400/25",     wash: "from-sky-400/[0.14] via-sky-400/[0.05] to-transparent",       iconBg: "bg-sky-400/15 text-sky-300" },
  fuchsia: { text: "text-fuchsia-300", ring: "ring-fuchsia-400/25", wash: "from-fuchsia-400/[0.14] via-fuchsia-400/[0.05] to-transparent", iconBg: "bg-fuchsia-400/15 text-fuchsia-300" },
  amber:   { text: "text-amber-300",   ring: "ring-amber-400/25",   wash: "from-amber-400/[0.14] via-amber-400/[0.05] to-transparent",   iconBg: "bg-amber-400/15 text-amber-300" },
  cyan:    { text: "text-cyan-300",    ring: "ring-cyan-400/25",    wash: "from-cyan-400/[0.14] via-cyan-400/[0.05] to-transparent",     iconBg: "bg-cyan-400/15 text-cyan-300" },
  rose:    { text: "text-rose-300",    ring: "ring-rose-400/25",    wash: "from-rose-400/[0.14] via-rose-400/[0.05] to-transparent",     iconBg: "bg-rose-400/15 text-rose-300" },
};

function MosaicTile({
  area, accent, hero, icon, value, valueFont, label, hint, sub,
}: {
  area: string;
  accent: keyof typeof TILE_ACCENT;
  hero?: boolean;
  icon: ReactNode;
  value: ReactNode;
  valueFont: CSSProperties;
  label: string;
  hint: string;
  sub?: string;
}) {
  const a = TILE_ACCENT[accent];
  return (
    <div
      className={`pricing-mosaic-${area} relative flex flex-col justify-between overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-6 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.55)] ring-1 ${a.ring} sm:p-7 ${hero ? "ring-2" : ""}`}
    >
      <div aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.wash}`} />
      <div className="relative">
        <div className={`mb-4 flex size-9 items-center justify-center rounded-xl ${a.iconBg}`}>{icon}</div>
        <p
          className={`leading-none tracking-tight tabular-nums text-white ${hero ? "text-[clamp(2.6rem,5.5vw,4.2rem)] font-bold" : "text-[clamp(1.8rem,3.2vw,2.4rem)] font-extrabold"}`}
          style={valueFont}
        >
          {value}
        </p>
        {sub && <p className={`mt-1.5 text-[13px] font-medium ${a.text}`}>{sub}</p>}
      </div>
      <p className="relative mt-4 flex items-center gap-1.5 text-[13px] text-white/55" title={hint}>
        {label}
        <Info className="size-3.5 shrink-0 text-white/25" />
      </p>
    </div>
  );
}

function SavingsCalculator() {
  const [pkgIdx, setPkgIdx] = useState(1); // Growth by default
  const [avgViews, setAvgViews] = useState(500);
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [platformIdx, setPlatformIdx] = useState(0);

  const pkg = CALC_PACKAGES[pkgIdx];
  const category = CALC_CATEGORIES[categoryIdx];
  const platform = CALC_PLATFORMS[platformIdx];

  const clipsPerMonth = pkg.clips;
  const reach = category.multiplier * platform.multiplier;
  const extraViews = Math.round(clipsPerMonth * avgViews * reach);
  const timeSavedPerWeekHours = Math.round((clipsPerMonth * MINUTES_SAVED_PER_CLIP) / 60 / WEEKS_PER_MONTH);
  const watchTimeIncreasePct = Math.max(0, Math.round(((extraViews / CALC_BASELINE_VIEWS) - 1) * 1000) / 10);
  const moneySavedPerMonth = Math.max(0, Math.round(clipsPerMonth * FREELANCE_RATE_PER_CLIP - pkg.price));
  const expectedEarnings = Math.round((extraViews / 1000) * RPM_ESTIMATE);
  const fmtMoney = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n);

  return (
    <section className="relative overflow-hidden px-6 py-20 text-white sm:px-10" style={INTER}>
      {/* Same background language as the hero (scattered blurred mascot art on
          the plain dark canvas) instead of this section's own separate dot-
          grid + spotlight treatment — one visual identity down the page. */}
      <MascotDecor />
      <div className="relative mx-auto max-w-[1100px]">
        <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-bold tracking-tight text-white" style={GEIST}>
          Create &amp; grow faster calculator
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/50">
          Pick a package, your average views per clip, category, and platform. Vello estimates the output,
          time, reach, and money you&apos;d get every month.
        </p>

        {/* Controls */}
        <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-white/45">Which package?</p>
            <div className="relative">
              <select
                value={pkgIdx}
                onChange={(e) => setPkgIdx(Number(e.target.value))}
                className="w-full appearance-none rounded-xl border border-white/12 bg-white/[0.05] py-2.5 pl-3.5 pr-8 text-[16px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                {CALC_PACKAGES.map((p, i) => (
                  <option key={p.name} value={i} className="text-neutral-900">{p.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
            </div>
          </div>

          <NumberField label="Average views per clip" value={avgViews} onChange={setAvgViews} min={0} step={50} unit="views" />

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-white/45">Content category</p>
            <div className="relative">
              <select
                value={categoryIdx}
                onChange={(e) => setCategoryIdx(Number(e.target.value))}
                className="w-full appearance-none rounded-xl border border-white/12 bg-white/[0.05] py-2.5 pl-3.5 pr-8 text-[16px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] outline-none focus-visible:ring-2 focus-visible:ring-white/25"
              >
                {CALC_CATEGORIES.map((c, i) => (
                  <option key={c.name} value={i} className="text-neutral-900">{c.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12.5px] font-medium text-white/45">Which platform will you post to?</p>
            <div className="flex items-center gap-2">
              {CALC_PLATFORMS.map((p, i) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setPlatformIdx(i)}
                  title={p.name}
                  aria-pressed={platformIdx === i}
                  className={`grid size-11 place-items-center rounded-xl border bg-white/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all ${
                    platformIdx === i ? "border-white ring-2 ring-white/20" : "border-white/12 hover:border-white/30"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://cdn.simpleicons.org/${p.slug}/ffffff`} alt={p.name} width={20} height={20} className="size-5" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results — an asymmetric tile mosaic (Windows 8 Start-screen
            spirit): one big hero tile, wide 2x1 tiles, and plain squares,
            each its own accent color and type family, instead of six
            identical cards. grid-template-areas (in the <style> block below)
            drives the actual layout; Tailwind can't express named areas
            cleanly, and this is exactly the kind of explicit, asymmetric
            placement the mosaic needs. */}
        <div className="pricing-mosaic mt-10">
          <MosaicTile
            area="earnings"
            accent="lime"
            hero
            icon={<DollarSign className="size-[18px]" strokeWidth={2} />}
            value={<>${fmtMoney(expectedEarnings)}</>}
            valueFont={SPACE}
            label="Expected earnings / month"
            hint={`Extra views × a blended $${RPM_ESTIMATE.toFixed(2)}/1,000-view organic + brand-campaign estimate. Directional, not a guarantee.`}
            sub="Organic + brand campaigns"
          />
          <MosaicTile
            area="clips"
            accent="sky"
            icon={<Film className="size-4" strokeWidth={2} />}
            value={<AnimatedInt value={clipsPerMonth} />}
            valueFont={GEIST}
            label="Clips you'll get / month"
            hint="Your package's monthly clip quota."
          />
          <MosaicTile
            area="views"
            accent="fuchsia"
            icon={<Eye className="size-4" strokeWidth={2} />}
            value={<>{extraViews >= 1000 ? `${(extraViews / 1000).toFixed(1)}K` : extraViews}</>}
            valueFont={NEWS_ITALIC}
            label="Extra views gained"
            hint="Clips × average views, adjusted for category and platform reach."
          />
          <MosaicTile
            area="time"
            accent="amber"
            icon={<Clock className="size-4" strokeWidth={2} />}
            value={<>{timeSavedPerWeekHours} hr</>}
            valueFont={INTER}
            label="Time saved / week"
            hint={`~${MINUTES_SAVED_PER_CLIP} min of manual editing saved per clip vs. cutting, captioning, and formatting by hand.`}
          />
          <MosaicTile
            area="watch"
            accent="cyan"
            icon={<Percent className="size-4" strokeWidth={2} />}
            value={<>{watchTimeIncreasePct}%</>}
            valueFont={SPACE}
            label="Watch time increase"
            hint="Estimated lift vs. Starter's baseline volume and reach."
          />
          <MosaicTile
            area="money"
            accent="rose"
            icon={<Zap className="size-4" strokeWidth={2} />}
            value={<>${fmtMoney(moneySavedPerMonth)}</>}
            valueFont={NEWS_ITALIC}
            label="Money saved / month"
            hint={`vs. hiring a freelance editor at $${FREELANCE_RATE_PER_CLIP}/clip.`}
          />
        </div>
      </div>

      {/* Mosaic grid: single column on phones (earnings tile stays full-width
          hero, the rest stack in a 2-up grid below it); at lg the real
          asymmetric layout kicks in — a 4-col × 3-row area map with one 2×2
          hero, two 2×1 wides, and three 1×1 squares. Plain <style>, not
          styled-jsx (this file isn't set up for it) — class names are
          prefixed pricing-mosaic- to stay collision-safe in a large app. */}
      <style>{`
        .pricing-mosaic { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
        .pricing-mosaic-earnings { grid-column: span 2; }
        @media (min-width: 1024px) {
          .pricing-mosaic {
            grid-template-columns: repeat(4, 1fr);
            grid-template-rows: repeat(3, minmax(150px, auto));
            grid-template-areas:
              "earnings earnings clips clips"
              "earnings earnings views time"
              "watch watch money money";
          }
          .pricing-mosaic-earnings { grid-area: earnings; grid-column: auto; }
          .pricing-mosaic-clips { grid-area: clips; }
          .pricing-mosaic-views { grid-area: views; }
          .pricing-mosaic-time { grid-area: time; }
          .pricing-mosaic-watch { grid-area: watch; }
          .pricing-mosaic-money { grid-area: money; }
        }
      `}</style>
    </section>
  );
}

/* ── Compare features — a clean, hairline table: plan headers with a white
   CTA, then a flat "Features" list of rows. ────────────────────────────────── */
type Cell = boolean | string;

const CMP_PLANS: { name: string; price: string; cta: Plan["cta"] }[] = [
  { name: "Free", price: "$0", cta: { label: "Start free", href: "/studio/build" } },
  { name: "Starter", price: "$9 / mo", cta: { label: "Subscribe", href: "/studio/build", tier: "starter" } },
  { name: "Creator", price: "$29 / mo", cta: { label: "Subscribe", href: "/studio/build", tier: "creator" } },
  { name: "Growth", price: "$59 / mo", cta: { label: "Subscribe", href: "/studio/build", tier: "growth" } },
];

const FEATURE_ROWS: { label: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { label: "Monthly credits", cells: ["Trial", "900", "2,900", "6,000"] },
  { label: "Clip capacity", cells: ["Up to 30", "Up to 45", "Up to 145", "Up to 300"] },
  { label: "AI video pricing", cells: ["1 trial", "By model", "By model", "By model"] },
  { label: "Active agents", cells: ["1 draft", "1", "3", "5"] },
  { label: "Virality scoring", cells: [true, true, true, true] },
  { label: "AI Clipper (auto-cut, captions, hooks)", cells: [true, true, true, true] },
  { label: "AI Influencer", cells: [false, true, true, true] },
  { label: "AI Video Editor", cells: [true, true, true, true] },
  { label: "Custom Captions", cells: [true, true, true, true] },
  { label: "AI Brolls", cells: [true, true, true, true] },
  { label: "Auto Posting to socials", cells: [false, "1 account", "3 accounts", "10 accounts"] },
  { label: "Brand campaign bounties", cells: [false, false, true, true] },
  { label: "Priority render queue", cells: [false, false, false, true] },
  { label: "Export agents and data", cells: [false, true, true, true] },
];

const CMP_GRID = "grid grid-cols-[minmax(190px,1.3fr)_repeat(4,1fr)] gap-x-6";

function CellMark({ value }: { value: Cell }) {
  if (value === true) return <Check className="size-[18px] text-lime-400" strokeWidth={2.5} aria-label="Included" />;
  if (value === false) return <X className="size-[18px] text-white/20" strokeWidth={2.5} aria-label="Not included" />;
  return <span className="text-[13.5px] text-white/60">{value}</span>;
}

function CompareFeatures() {
  return (
    <section className="px-6 py-20 text-white sm:px-10" style={INTER}>
      <div className="mx-auto max-w-[1200px]">
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            {/* Plan header row */}
            <div className={`${CMP_GRID} items-end pb-8`}>
              <div />
              {CMP_PLANS.map((p) => (
                <div key={p.name}>
                  <h3 className="text-[18px] font-bold tracking-tight text-white" style={GEIST}>{p.name}</h3>
                  <p className="mt-1 text-[13px] text-white/40">{p.price}</p>
                  <div className="mt-4"><PlanCta cta={p.cta} /></div>
                </div>
              ))}
            </div>

            <h2 className="text-[22px] font-bold tracking-tight text-white" style={GEIST}>Features</h2>

            <div className="mt-3">
              {FEATURE_ROWS.map((r) => (
                <div key={r.label} className={`${CMP_GRID} items-center border-t border-white/10 py-4`}>
                  <div className="text-[14px] text-white/75">{r.label}</div>
                  {r.cells.map((cell, i) => (
                    <div key={i}><CellMark value={cell} /></div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Managed integrations strip — real platform logos on a lime-green tile ──── */
const INTEGRATIONS = [
  { name: "TikTok", slug: "tiktok" },
  { name: "Instagram", slug: "instagram" },
  { name: "YouTube", slug: "youtube" },
  { name: "X", slug: "x" },
] as const;

function Integrations() {
  return (
    <section className="px-6 pb-8 pt-4 text-white sm:px-10" style={INTER}>
      <div className="mx-auto max-w-[680px]">
        <div className="relative overflow-hidden rounded-3xl border border-[#8fd14f]/60 bg-gradient-to-b from-[#e9f7c8] to-[#cfec95] shadow-[0_10px_40px_-20px_rgba(108,181,54,0.6)]">
          {/* soft lime glow edges */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-[#8fd14f]/35 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-[#8fd14f]/35 to-transparent" />
          <div className="relative flex flex-wrap items-center justify-center gap-x-9 gap-y-6 px-6 py-11">
            {INTEGRATIONS.map(({ name, slug }) => (
              <div key={name} className="flex items-center gap-2.5 text-neutral-800">
                <span className="grid size-11 place-items-center rounded-2xl bg-white shadow-[0_2px_8px_rgba(47,107,41,0.18)] ring-1 ring-black/[0.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://cdn.simpleicons.org/${slug}`}
                    alt={name}
                    width={22}
                    height={22}
                    className="size-[22px]"
                    loading="lazy"
                  />
                </span>
                <span className="text-[15px] font-semibold">{name}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-md text-center text-[13.5px] leading-relaxed text-white/50">
          Vello connects and manages your TikTok, Instagram, YouTube, and X accounts while your
          influencers create and post. When you are ready, you can export your agents and data at any point.
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 text-[12px] text-white/40">
          Included on
          <span className="rounded-md border border-white/15 bg-white/[0.06] px-2 py-0.5 text-white/70">Growth</span>
          and above
        </p>
      </div>
    </section>
  );
}

/* ── FAQ ───────────────────────────────────────────────────────────────────── */
const FAQS = [
  {
    q: "Are the first clips really free?",
    a: "Yes. Free includes a trial balance for AI clipping, captions, formatting, and virality scoring, so you can judge the output before subscribing.",
  },
  {
    q: "How does pricing work after the free clips?",
    a: "Paid plans include flexible credits. Clipping is charged by source duration, while original AI video is quoted by model and duration before it starts. The exact credit debit is always visible.",
  },
  {
    q: "Which paid plan should I choose?",
    a: "Starter is for one active agent. Creator adds three agents, scheduling, campaigns, and three social accounts. Growth provides 6,000 monthly credits, five active agents, ten social accounts, and priority generation.",
  },
  {
    q: "How much can Vello save me versus hiring an editor?",
    a: "A freelance or agency video editor typically charges $40–$120 per finished clip. Vello charges clipping by source duration and shows the credit estimate before the run, so the calculator can compare your expected volume.",
  },
  {
    q: "Can I take my agents and clips with me?",
    a: "Yes. Paid plans can export agents, personas, and clips. You are never locked in.",
  },
  {
    q: "Can I connect my existing social accounts?",
    a: "Yes. You can connect your existing TikTok, Instagram, YouTube, and X accounts, and Vello posts on their behalf with your approval flow in place.",
  },
  {
    q: "Can Vello help my agents earn?",
    a: "Vello surfaces brand campaign bounties your agents can take, generates the campaign assets, and settles verified payouts on Solana, so your agents can earn while they post.",
  },
];

function FaqItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left outline-none"
      >
        <span className="text-[14px] font-medium text-white/85">{q}</span>
        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-white/15 text-white/40 transition-colors">
          {open ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-white/50">{a}</p>
        </div>
      </div>
    </div>
  );
}

function Faq() {
  return (
    <section className="px-6 py-20 text-white sm:px-10" style={INTER}>
      <div className="mx-auto max-w-[720px]">
        <h2 className="mb-10 text-center text-[clamp(1.6rem,3.2vw,2.4rem)] font-medium tracking-[-0.02em]">
          Frequently asked questions
        </h2>
        <div>
          {FAQS.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Closing CTA ───────────────────────────────────────────────────────────── */
function ClosingCta() {
  return (
    <section className="px-6 pb-24 pt-8 sm:px-10" style={INTER}>
      <div className="mx-auto grid max-w-[1100px] items-center gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-[clamp(1.8rem,3.6vw,2.6rem)] font-medium leading-[1.1] tracking-[-0.02em] text-white">
            Launch an entire influencer<br className="hidden sm:block" />
            <span className="text-white/40">network with AI</span>
          </h2>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-white/50">
            Give each influencer a face, a persona, and a memory. They create, post daily, take brand
            campaigns, and earn for you.
          </p>
          <div className="mt-7">
            <PillLink href="/studio/build" variant="solid" className="px-5 py-2.5 text-sm font-semibold">
              Launch an influencer <ArrowRight className="ml-2 size-4" />
            </PillLink>
          </div>
        </div>

        {/* Artwork card */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.6)]">
          <Image src={cofounderBg} alt="" aria-hidden className="h-[280px] w-full object-cover" style={{ objectPosition: "60% 40%" }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p className="max-w-xs text-[15px] font-medium leading-snug text-white">
              Vello Agents is a content agent network <span className="text-white/70">designed to create, post, and earn.</span>
            </p>
            <PillLink href="/studio/build" variant="glass" className="mt-4 px-4 py-2 text-[13px] font-semibold">
              <ArrowUp className="mr-1.5 size-3.5" /> Get started
            </PillLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */
/* Scattered, blurred mascot stickers behind the hero + plan cards — the same
   art already used on /agents, just softened into background texture instead
   of a crisp CTA sticker, so the page reads as distinctly "Vello" instead of
   a generic dark SaaS page. Purely decorative (aria-hidden, no pointer events). */
function MascotDecor() {
  const spots: { src: string; top: string; left?: string; right?: string; size: number; rotate: number; opacity: number }[] = [
    { src: "/mascot-start.webp", top: "2%", left: "-6%", size: 260, rotate: -14, opacity: 0.16 },
    { src: "/mascot-launch.webp", top: "10%", right: "-7%", size: 300, rotate: 11, opacity: 0.14 },
    { src: "/mascot-launch.webp", top: "62%", left: "-4%", size: 230, rotate: 9, opacity: 0.12 },
    { src: "/mascot-start.webp", top: "80%", right: "-3%", size: 270, rotate: -8, opacity: 0.13 },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      {spots.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={s.src}
          alt=""
          className="absolute blur-2xl"
          style={{ top: s.top, left: s.left, right: s.right, width: s.size, height: "auto", opacity: s.opacity, transform: `rotate(${s.rotate}deg)` }}
        />
      ))}
    </div>
  );
}

export function PricingPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white antialiased" style={INTER}>
      <Navigation />

      <div className="relative">
        <MascotDecor />

        {/* Hero */}
        <section className="relative px-6 pb-4 pt-20 text-center sm:px-10 sm:pt-24">
          <h1 className="text-[clamp(2.4rem,5vw,3.7rem)] font-extrabold leading-[1.02] tracking-tight text-white" style={GEIST}>
            <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 align-middle">
              Start <AppLogoIcon className="size-11 sm:size-14" /> for free.
            </span>
            <span className="mt-1 block font-light text-white/45">Scale on your terms.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[14.5px] leading-relaxed text-white/55">
            Your first 10 clips are on us. After that, pay per video: the more you clip, the less each
            one costs. Add an AI Influencer whenever you&apos;re ready to post original content, too.
          </p>
        </section>

        {/* Plan cards */}
        <section className="relative px-6 py-12 sm:px-10">
          <div className="mx-auto grid max-w-[1320px] gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((p) => (
              <PlanCard key={p.name} plan={p} />
            ))}
          </div>
        </section>
      </div>

      <SavingsCalculator />
      <CompareFeatures />
      <ClosingCta />
      <Integrations />
      <Faq />
      <Footer />
    </main>
  );
}
