"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { LoginModal } from "@/components/auth/login-modal";
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal";
import { motion, AnimatePresence, useScroll, useTransform, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
  AudioLines,
  Camera,
  Captions,
  ChevronDown,
  Crop,
  Link as LinkIcon,
  Loader2,
  ArrowRight,
  MessageSquareText,
  Scissors,
  Share2,
  X,
} from "lucide-react";
import velloLogo from "@/assets/solcameo-dark.png";
import aiEditorIllustration from "@/assets/ai-editor-illustration.png";
// Real product screenshots — one per "How it works" step, matched to what
// that step actually does (prompt box → clips grid → editor → schedule).
import howStep1 from "@/assets/m1.png";
import howStep2 from "@/assets/m3.png";
import howStep3 from "@/assets/m2.png";
import howStep4 from "@/assets/m4.png";
import fastlaneCar from "@/assets/fastlane-car.png";
import type { StaticImageData } from "next/image";
// White-silhouette, transparent-background versions (bg keyed out + forced
// white via ffmpeg colorkey+lutrgb from the raw white-bg source in app/company/).
import logo1 from "@/assets/logos/clients/1.png";
import logo2 from "@/assets/logos/clients/2.png";
import logo3 from "@/assets/logos/clients/3.png";
import logo4 from "@/assets/logos/clients/4.png";
import logo5 from "@/assets/logos/clients/5.png";
import logo6 from "@/assets/logos/clients/6.png";
import logo7 from "@/assets/logos/clients/7.png";
import logo8 from "@/assets/logos/clients/8.png";
import logo9 from "@/assets/logos/clients/9.png";
import logo10 from "@/assets/logos/clients/10.png";
import logo11 from "@/assets/logos/clients/11.png";
import logo12 from "@/assets/logos/clients/12.png";
import logo13 from "@/assets/logos/clients/13.png";
import logo14 from "@/assets/logos/clients/14.png";
import logo15 from "@/assets/logos/clients/15.png";
import logo16 from "@/assets/logos/clients/16.png";
import logo17 from "@/assets/logos/clients/17.png";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { NodeMenuBanner, NodeMenuDivider } from "./node-menu-banner";
import { AnnouncementBar } from "./announcement-bar";
import { LeadMagnetModal } from "./lead-magnet-modal";
import { GrowSection } from "./grow-section";
// Temporarily hidden: import { FloatingTasks } from "./floating-tasks";
import { CaseStudies } from "./case-studies";
import { Footer } from "./footer";
import LiveChatWidget from "@/components/support/LiveChatWidget";
import { FeatureShowcaseCarousel } from "./feature-showcase-carousel";
import { GlobalLaunch } from "./global-launch";

/* ════════ Vello landing — pixel-art scene with a frosted-glass nav ════════
   A full-bleed pixel-art park scene with a blurred glass navigation bar, a
   left-aligned hero, and three floating "task" cards drifting above the laptop
   in the artwork. Every button shares one of two pill styles defined below so
   the whole page stays visually consistent. */

const INTER = { fontFamily: "var(--font-inter)" } as const;
const HERO_FONT = { fontFamily: "var(--font-geist-sans), sans-serif" } as const;

/* ── Shared button system ───────────────────────────────────────────────────
   Two variants, used everywhere so "the buttons all follow the same":
   • glass → light frosted-glass pill with a glossy top highlight (nav default)
   • solid → cream pill, dark text (primary CTA) */
const PILL_BASE =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg " +
  "transition-colors duration-200 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-sky-500/40";

const PILL_VARIANT = {
  // Frosted glass: translucent fill, strong blur, hairline ring, and an inset
  // top highlight so light catches the upper edge like real glass.
  glass:
    "border border-white/25 bg-white/15 text-white backdrop-blur-xl " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] hover:bg-white/25",
  solid: "bg-[#f6f4ec] text-neutral-900 hover:bg-white shadow-sm",
} as const;

function PillLink({
  href,
  variant = "glass",
  className = "",
  children,
}: {
  href: string;
  variant?: keyof typeof PILL_VARIANT;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${PILL_BASE} ${PILL_VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* ── Navigation ─────────────────────────────────────────────────────────────
   Sticky glass header, opus.pro-style: logo left, nav CENTERED, account right.
   "Create" and "Solutions" open full-width mega-menus on hover — state-driven
   (not pure CSS :hover) because the panel is a wide edge-to-edge sibling of the
   small trigger, not its tightly-bound descendant, and the trigger row + panel
   share ONE continuous mouse-leave boundary so there's no dead gap that drops
   the hover mid-transit (the classic "gap kills the dropdown" bug). */
// Plain single-destination items — no dropdown, since each is one real page,
// not a menu of distinct sub-pages.
// Shorts Agent / AI Influencers / Pricing are hidden from the header (their
// pages still exist and stay reachable from the footer and Solutions menu).
const PLAIN_ITEMS = [
  { label: "Docs", href: "/docs" },
  { label: "Marketplace", href: "/agents" },
  { label: "1B Club", href: "/1b-club" },
] as const;


const FEATURE_CARDS = [
  { title: "AI Influencers", href: "/builder?type=influencer", video: "/menu/influencers.mp4" },
  { title: "AI Clippers", href: "/builder?type=clipping", video: "/menu/clippers.mp4" },
] as const;

function MenuVideo({ src }: { src: string }) {
  return (
    <>
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
        className="absolute inset-0 -z-20 size-full scale-[1.03] object-cover transition-transform duration-700 ease-out group-hover:scale-110"
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
      <div aria-hidden className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(70%_60%_at_20%_100%,rgba(190,242,100,0.2),transparent_70%)]" />
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </>
  );
}

function FeatureVideoCard({ title, href, video, onClick }: (typeof FEATURE_CARDS)[number] & { onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="group relative isolate flex min-h-[300px] items-end overflow-hidden rounded-2xl border border-white/10 p-6 outline-none transition-all duration-300 hover:border-lime-300/40 focus-visible:border-white/40 hover:shadow-[0_0_50px_-12px_rgba(190,242,100,0.4)]"
    >
      <MenuVideo src={video} />
      <span className="block text-[clamp(2.6rem,5.2vw,4.4rem)] font-extrabold leading-[0.92] tracking-[-0.045em] text-white [text-shadow:0_2px_40px_rgba(0,0,0,0.35)]">
        {title}
      </span>
    </Link>
  );
}

const INTEGRATIONS = [
  { title: "Opus 5.5 Integration", href: "/docs", video: "/menu/editor-example.mp4" },
  { title: "Facial Tracking", href: "/builder?type=clipping", video: "/menu/face-detect-sample.mp4" },
  { title: "Campaigns", href: "/docs/launch", video: "/menu/clippers.mp4" },
  { title: "Solana", href: "/docs/launch", video: "/menu/hero-bg.mp4" },
] as const;

function IntegrationCard({ title, href, video, featured, onClick }: { title: string; href: string; video: string; featured?: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group relative isolate flex flex-col justify-end overflow-hidden rounded-2xl border border-white/10 outline-none transition-all duration-300 hover:border-lime-300/40 focus-visible:border-white/40 hover:shadow-[0_0_50px_-12px_rgba(190,242,100,0.4)] ${featured ? "min-h-[300px] p-6 sm:col-span-2 sm:row-span-2" : "min-h-[140px] p-4"}`}
    >
      <MenuVideo src={video} />
      <span className={`block font-extrabold leading-[0.95] tracking-[-0.04em] text-white [text-shadow:0_2px_40px_rgba(0,0,0,0.35)] ${featured ? "text-[clamp(2.4rem,4.6vw,3.8rem)]" : "text-[clamp(1.2rem,2vw,1.6rem)]"}`}>
        {title}
      </span>
    </Link>
  );
}

type MenuId = "features" | "solutions";

function MegaMenuTrigger({ label, id, active, onEnter }: { label: string; id: MenuId; active: boolean; onEnter: (id: MenuId) => void }) {
  return (
    <button
      type="button"
      onMouseEnter={() => onEnter(id)}
      onFocus={() => onEnter(id)}
      className="flex items-center gap-1 rounded px-3 py-1 text-white/80 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
    >
      {label}
      <ChevronDown className={`size-3 text-white/40 transition-transform duration-200 ${active ? "rotate-180 text-white/70" : ""}`} />
    </button>
  );
}

export function Navigation() {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-black">
      <nav
        className="relative mx-auto grid max-w-[1600px] grid-cols-[auto_1fr_auto] items-center gap-2.5 px-6 py-4 sm:px-10"
        style={INTER}
        onMouseLeave={() => setOpenMenu(null)}
      >
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <Image src={velloLogo} alt="Solcameo" priority className="h-7 w-auto sm:h-8" />
        </Link>

        {/* Centered nav — logo left, account right, everything else pinned to
            the middle (opus.pro layout) instead of clustered next to the logo. */}
        <div className="hidden items-center justify-center gap-1 text-[13.5px] font-medium text-white lg:flex">
          <MegaMenuTrigger label="Features" id="features" active={openMenu === "features"} onEnter={setOpenMenu} />
          <MegaMenuTrigger label="Solutions" id="solutions" active={openMenu === "solutions"} onEnter={setOpenMenu} />
          {PLAIN_ITEMS.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              onMouseEnter={() => setOpenMenu(null)}
              className="flex items-center gap-1.5 rounded px-3 py-1 text-white/80 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {label}
            </Link>
          ))}
          <NodeMenuDivider />
          <NodeMenuBanner compact onClick={() => setOpenMenu(null)} />
        </div>

        <div className="flex items-center gap-3 justify-self-end">
          <button type="button" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} className="flex size-9 flex-col items-center justify-center gap-1 rounded-md border border-white/20 text-white lg:hidden">
            <span className="h-px w-4 bg-current" /><span className="h-px w-4 bg-current" />
          </button>
          <AccountPill />
        </div>
        {mobileOpen && <div className="col-span-3 grid gap-1 border-t border-white/10 pt-4 lg:hidden">
          {PLAIN_ITEMS.map(({ label, href }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm text-white/85 hover:bg-white/10">{label}</Link>)}
          <div className="mt-3 border-t border-[#a88e61]/25 pt-4"><NodeMenuBanner onClick={() => setMobileOpen(false)} /></div>
        </div>}

        {/* Full-width mega-menu panel — flush against the nav row (no gap) so
            the mouse-leave boundary above covers trigger + panel as one shape.
            Dark-tinted glass (never white) so white text keeps contrast over
            any section scrolled beneath it. Premium treatment: gradient
            hairline border, lime aurora glow, top sheen, tiles that light up
            on hover. */}
        <div
          className={`absolute inset-x-0 top-full z-30 transition-all duration-200 ${
            openMenu ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1.5 opacity-0"
          }`}
        >
          <div className="mx-auto max-w-[1100px] px-6 pt-2.5 sm:px-10">
            <div className="rounded-[22px] bg-gradient-to-b from-white/25 via-white/[0.07] to-lime-300/20 p-px shadow-[0_50px_120px_-30px_rgba(0,0,0,0.95),0_0_80px_-30px_rgba(190,242,100,0.35)]">
              <div className="relative overflow-hidden rounded-[21px] bg-[#09090b]/95 backdrop-blur-2xl">
                <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_80%_at_0%_0%,rgba(190,242,100,0.10),transparent_60%),radial-gradient(50%_70%_at_100%_100%,rgba(255,255,255,0.06),transparent_60%)]" />
                <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(80%_80%_at_50%_0%,#000,transparent)]" />
                <div className="relative">
                  {openMenu === "features" && (
                    <div className="grid gap-3 p-3 sm:grid-cols-2">
                      {FEATURE_CARDS.map((c) => (
                        <FeatureVideoCard key={c.title} {...c} onClick={() => setOpenMenu(null)} />
                      ))}
                    </div>
                  )}
                  {openMenu === "solutions" && (
                    <div className="grid gap-3 p-3 sm:grid-cols-4">
                      <IntegrationCard featured title="Higgsfield Genjutsu Integration" href="/docs" video="/menu/influencers.mp4" onClick={() => setOpenMenu(null)} />
                      {INTEGRATIONS.map((c) => (
                        <IntegrationCard key={c.title} {...c} onClick={() => setOpenMenu(null)} />
                      ))}
                    </div>
                  )}
                  <div className="border-t border-[#a88e61]/25 p-3"><NodeMenuBanner onClick={() => setOpenMenu(null)} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}

/** Nav CTA — signed out: "Start Now" glass pill opening the in-page auth
 *  modal (same form as /login, no route change). Signed in: a single
 *  "Open the App" pill straight to /home — no dropdown. */
function AccountPill() {
  const { authenticated, profile } = useSupabaseAuth();
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);
  if (!authenticated || !profile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setAuthOpen(true)}
          className="cursor-pointer rounded-full bg-white px-3.5 py-1.5 text-[13px] font-medium text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors hover:bg-white/90"
        >
          Start Now
        </button>
        <LoginModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={() => router.push("/home")}
      className="flex cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-white/25 bg-white/15 px-4 py-1.5 text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors hover:bg-white/25"
    >
      <span className="text-[13px] font-medium">Open the App</span>
    </button>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function isLikelyVideoUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────
 * HERO ENTRANCE STORYBOARD
 *
 * Only the hero's own content animates — nav/shell stay put.
 * Every beat: slide up + blur-to-sharp + fade, spring settle.
 *
 *    0ms   blank — hero content not yet visible
 *  100ms   eyebrow (avatar stack + label) slides up, unblurs
 *  280ms   headline slides up, unblurs
 *  460ms   subline slides up, unblurs
 *  640ms   CTA row (link form + free-videos pill) slides up, unblurs
 * ───────────────────────────────────────────────────────── */
const HERO_TIMING = {
  eyebrow:  100,  // ms — avatar stack + eyebrow label
  headline: 280,  // ms — main h1
  sub:      460,  // ms — supporting line
  cta:      640,  // ms — form + secondary CTA
};

const HERO_ENTER = {
  offsetY: 22,     // slides UP into place
  blur: 10,        // px — starts soft, sharpens on arrival
  spring: { type: "spring" as const, stiffness: 320, damping: 30 },
};

/** Shared slide-up + unblur wrapper for one hero beat. `on` = stage >= N. */
function HeroReveal({ on, reduced, children, className }: { on: boolean; reduced: boolean; children: React.ReactNode; className?: string }) {
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: HERO_ENTER.offsetY, filter: `blur(${HERO_ENTER.blur}px)` }}
      animate={{
        opacity: on ? 1 : 0,
        y: on ? 0 : HERO_ENTER.offsetY,
        filter: on ? "blur(0px)" : `blur(${HERO_ENTER.blur}px)`,
      }}
      transition={HERO_ENTER.spring}
    >
      {children}
    </motion.div>
  );
}

/** Lead capture — fire-and-forget, never blocks the clip flow. Shows up in the
 *  admin Leads page, tagged by where on the page the link was pasted. */
function captureVideoLead(url: string, source: string) {
  void fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, source }),
  }).catch(() => {});
}

/** Paste-a-YouTube-link pill form (hero + closing CTA). Accepts a dropped link
 *  too; the submit button stays disabled until the value looks like a video URL. */
function ClipLinkForm({ id, onSubmit, cta = "Clip it", ctaShort, closing = false }: { id: string; onSubmit: (url: string) => void; cta?: string; ctaShort?: string; closing?: boolean }) {
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const valid = isLikelyVideoUrl(url.trim());
  return (
    <div className="w-full">
    {closing && <label htmlFor={id} className="mb-2 block pl-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-[#c6e685]">Your video link</label>}
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(url.trim()); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (dropped) setUrl(dropped.trim());
      }}
      className={`w-full border p-1.5 backdrop-blur-xl transition-colors ${closing
        ? "rounded-[28px] bg-[#1a231b] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_22px_55px_-28px_rgba(0,0,0,0.85)] focus-within:border-[#c6e685]/75 sm:rounded-full"
        : "rounded-[22px] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-30px_rgba(0,0,0,0.8)] focus-within:border-white/35"} ${
        dragOver ? "border-[#c6e685]/70 bg-white/[0.1]" : closing ? "border-[#c6e685]/35" : "border-white/15"
      }`}
    >
      <div className="flex items-center gap-2">
        {!closing && <label htmlFor={id} className="sr-only">YouTube link</label>}
        <span className="ml-2 hidden size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/60 min-[380px]:flex sm:ml-3" aria-hidden>
          <LinkIcon className="size-4" />
        </span>
        <input
          id={id}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder={closing ? "Paste video link" : "Paste a YouTube link"}
          className={`min-w-0 flex-1 bg-transparent py-3 pl-3 text-left text-[16px] text-white outline-none min-[380px]:pl-0 ${closing ? "placeholder:text-white/55" : "placeholder:text-white/40"}`}
          style={HERO_FONT}
        />
        <button
          type="submit"
          disabled={!valid}
          className={`${PILL_BASE} ${PILL_VARIANT.solid} group shrink-0 px-4 py-3 text-[14.5px] font-semibold disabled:cursor-not-allowed sm:px-5 ${closing ? "!rounded-[22px] !bg-[#c6e685] hover:!bg-[#d8ecaa] disabled:opacity-60 sm:!rounded-full" : "!rounded-[16px] disabled:opacity-40"}`}
        >
          {ctaShort ? (
            <>
              <span className="sm:hidden">{ctaShort}</span>
              <span className="hidden sm:inline">{cta}</span>
            </>
          ) : cta}
          <ArrowRight className="ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </button>
      </div>
    </form>
    </div>
  );
}

export function Hero({
  eyebrow = "Higgsfield Genjutsu now available",
  title = "Your AI creates, you earn",
  sub = "Vello Agents turns a YouTube link into captioned shorts and posts them to TikTok, Reels, and YouTube.",
}: {
  eyebrow?: string;
  title?: string;
  sub?: string;
} = {}) {
  const [modalUrl, setModalUrl] = useState<string | null>(null);
  const [leadOpen, setLeadOpen] = useState(false);
  // Hero = the clip-a-link flow only. The website Launch funnel is hidden from
  // the hero (still reachable via /api/launch + LaunchModal elsewhere).
  const reducedMotion = useReducedMotion() ?? false;

  // Single stage integer drives the entrance cascade (see storyboard above).
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), HERO_TIMING.eyebrow),
      setTimeout(() => setStage(2), HERO_TIMING.headline),
      setTimeout(() => setStage(3), HERO_TIMING.sub),
      setTimeout(() => setStage(4), HERO_TIMING.cta),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const submit = (v: string) => {
    captureVideoLead(v, "hero_video_link");
    setModalUrl(v);
  };

  return (
    <div className="relative z-10 mx-auto flex max-w-[1600px] flex-col items-center px-5 pt-11 text-center sm:px-10 sm:pt-20">
      <HeroReveal on={stage >= 1} reduced={reducedMotion} className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:flex-nowrap sm:gap-3.5">
        {/* Overlapping stack of AI-influencer faces to the eyebrow's left —
            same stable pravatar portraits as AiInfluencerArt. */}
        <div className="flex -space-x-2.5">
          {[32, 47, 12, 26, 5].map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img}
              src={`https://i.pravatar.cc/64?img=${img}`}
              alt=""
              loading="lazy"
              className="size-7 rounded-full border-2 border-black object-cover ring-1 ring-white/20 sm:size-8"
            />
          ))}
        </div>
        <p className="text-[12px] font-semibold uppercase leading-snug tracking-[0.14em] text-white/75 sm:text-[14px] sm:tracking-[0.22em]" style={HERO_FONT}>
          {eyebrow}
        </p>
      </HeroReveal>

      <HeroReveal on={stage >= 2} reduced={reducedMotion} className="w-full">
        <h1
          className="mx-auto mt-5 w-full max-w-[15ch] whitespace-normal text-balance text-center text-[clamp(3rem,11vw,6.6rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:mt-6 sm:max-w-[18ch]"
          style={HERO_FONT}
        >
          {title}
        </h1>
      </HeroReveal>

      <HeroReveal on={stage >= 3} reduced={reducedMotion}>
        <p className="mx-auto mt-5 max-w-[34rem] text-balance text-[16px] leading-[1.5] text-white/70 sm:mt-6 sm:max-w-[48rem] sm:text-[19px]" style={HERO_FONT}>
          {sub}
        </p>
      </HeroReveal>

      <HeroReveal on={stage >= 4} reduced={reducedMotion} className="mt-7 flex w-full max-w-[640px] flex-col items-center gap-3 sm:mt-9">
        {/* Launch form — one primary input, one outcome CTA. The optional
            long-form link is progressive disclosure (a text button reveals it)
            so the default read is a single field, like the best converting
            paste-a-link tools. Segmented Website / Video-link switch sits
            below, quiet. */}
        <ClipLinkForm id="hero-url" onSubmit={submit} />

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-white/55" style={HERO_FONT}>
          <span>No card. First 3 clips free.</span>
          <span className="hidden h-3 w-px bg-white/15 min-[400px]:block" aria-hidden />
          <span>Posts to TikTok · Reels · Shorts</span>
        </div>
      </HeroReveal>

      <LeadMagnetModal open={leadOpen} onClose={() => setLeadOpen(false)} />

      <AnimatePresence>
        {modalUrl && <ClipFetchModal key={modalUrl} url={modalUrl} onClose={() => setModalUrl(null)} />}
      </AnimatePresence>
    </div>
  );
}

type VideoInfo = { title: string; author: string; thumbnailUrl: string; durationSeconds?: number };

// Kept in sync with FILTER_PRESET_IDS.length in lib/builder/filterStyles.ts —
// a real, verifiable number (vintage/warm/cool/bw/vivid/cinematic/hd/moody/
// filmic/matte), not a marketing guess.
const VIDEO_STYLE_COUNT = 10;

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Derive an honest clip-count estimate from the real duration (one clip per
 *  ~90s of source, clamped 3-10 — 10 is the platform's own per-run ceiling,
 *  same number the homepage headline promises). Falls back to "up to 10"
 *  when duration is unknown (non-yt-dlp source / lookup failed). */
function estimateClips(durationSeconds: number | undefined): { n: number; approx: boolean } {
  if (!durationSeconds || durationSeconds <= 0) return { n: 10, approx: true };
  return { n: Math.max(3, Math.min(10, Math.round(durationSeconds / 90))), approx: false };
}

/** Post-submit "we're on it" modal: shows a brief fetch animation, pulls the
 *  video's real title/duration/thumbnail (yt-dlp metadata-only lookup, oEmbed
 *  fallback), then offers "Clip now" — which is the actual signup gate. This
 *  is a landing-page conversion beat, not a real clip job: nothing is queued
 *  until the visitor signs up and presses Start in the builder. */
function ClipFetchModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [phase, setPhase] = useState<"fetching" | "ready">("fetching");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [mounted, setMounted] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const router = useRouter();
  const { authenticated } = useSupabaseAuth();
  const marketStats = useQuery(api.influencers.getMarketStats, {}) as { totalAgents?: number } | undefined;

  // Portal straight to <body> — the hero it's triggered from has `overflow-
  // hidden` (it clips the hero's own decorative glow/carousel edge fades),
  // and several ancestor sections use framer-motion `style={{ x, filter }}`
  // transforms for the scroll effects elsewhere on the page. A `transform`
  // or `filter` on ANY ancestor creates a new containing block for
  // `position: fixed`, which silently re-scopes "fixed" to that ancestor's
  // box instead of the real viewport — the modal was rendering, just
  // clipped/hidden behind later content instead of covering the screen.
  // Rendering at the document root sidesteps every ancestor stacking
  // context/containing-block issue at once, guaranteed.
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Small floor so the fetch animation always reads, even on a fast response.
      const [res] = await Promise.all([
        fetch(`/api/video/info?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => null),
        new Promise((r) => setTimeout(r, 1100)),
      ]);
      if (cancelled) return;
      if (res?.ok) setInfo({ title: res.title, author: res.author, thumbnailUrl: res.thumbnailUrl, durationSeconds: res.durationSeconds });
      setPhase("ready");
    })();
    return () => { cancelled = true; };

  }, [url]);

  const clips = estimateClips(info?.durationSeconds);

  // Once Privy reports authenticated (login() itself gives no completion
  // callback), continue straight into the guided builder flow with the link
  // already queued — no re-pasting, no re-explaining.
  useEffect(() => {
    if (!authenticated) return;
    // Straight to the AI Clipper builder. It used to hop through /studio/build,
    // which is influencer-only and forwarded as type=influencer — so a pasted
    // YouTube link minted an AI Influencer instead of a clipper.
    const params = new URLSearchParams({ type: "clipping", q: `Clip this video: ${url}` });
    router.push(`/builder?${params.toString()}`);
  }, [authenticated, router, url]);

  const clipNow = () => {
    if (authenticated) return; // effect above is already navigating
    // Full auth form (Google + email/password), not the bare Privy modal —
    // Privy's own popup offers only Google + "Continue with a wallet", which
    // dead-ends email users and scares non-crypto visitors at the exact
    // conversion moment. The authenticated effect above resumes the queued
    // link either way.
    setAuthOpen(true);
  };

  if (!mounted) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, y: 10, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="w-full max-w-[440px] overflow-hidden rounded-3xl border border-white/15 bg-neutral-950 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
        style={INTER}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            {phase === "fetching" && <Loader2 className="size-3 animate-spin" />}
            {phase === "fetching" ? "Fetching your video" : "Ready to clip"}
          </span>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-3">
          {phase === "fetching" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 className="size-7 animate-spin text-white/70" />
              <p className="max-w-[260px] truncate text-[13px] text-white/50">{url}</p>
            </div>
          ) : (
            <>
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-900">
                {info?.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.thumbnailUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-white/30">
                    <Scissors className="size-8" />
                  </div>
                )}
                <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                {typeof info?.durationSeconds === "number" && (
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white/85 backdrop-blur-sm">
                    {fmtDuration(info.durationSeconds)}
                  </span>
                )}
              </div>
              <p className="mt-3 line-clamp-2 text-[15px] font-medium leading-snug text-white">
                {info?.title || "Your video is ready to clip"}
              </p>
              {info?.author && <p className="mt-0.5 text-[12.5px] text-white/45">{info.author}</p>}

              {/* Real-ish run breakdown — clip count is derived from the actual
                  duration when known; style count and live-agent count are real,
                  verifiable numbers (see VIDEO_STYLE_COUNT / getMarketStats). */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2.5 text-center">
                  <p className="text-[16px] font-bold text-white">{clips.approx ? "≤" : ""}{clips.n}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-white/40">Clips</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2.5 text-center">
                  <p className="text-[16px] font-bold text-white">{VIDEO_STYLE_COUNT}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-white/40">Styles</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2.5 text-center">
                  <p className="text-[16px] font-bold text-white">
                    {typeof marketStats?.totalAgents === "number" ? marketStats.totalAgents.toLocaleString() : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-white/40">Agents live</p>
                </div>
              </div>

              <p className="mt-3 text-[12px] leading-relaxed text-white/45">
                We&apos;ll transcribe the audio, find the {clips.n} most-quotable moments, cut them to 9:16, burn in captions
                + a hook, and queue them to post — you just pick the account.
              </p>

              <button
                onClick={clipNow}
                disabled={authenticated}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#f6f4ec] px-5 py-3 text-[14px] font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-white disabled:opacity-70"
              >
                {authenticated ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
                {authenticated ? "Opening your builder…" : "Clip now"}
              </button>
              <p className="mt-2.5 text-center text-[11.5px] text-white/35">
                First 3 videos free — no card needed.
              </p>
            </>
          )}
        </div>
      </motion.div>
      <LoginModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </motion.div>,
    document.body,
  );
}

/** Mount-gate for offscreen media. The landing page used to keep ~21 muted
 *  looping <video> elements decoding at once (hero rail ×16 + style tiles ×5),
 *  which pegged low-end GPUs/CPUs. This reports whether the element is near
 *  the viewport so callers mount the <video> ONLY then — posters everywhere
 *  else. IO's rects include CSS transforms, so it tracks the moving marquee. */
function useNearViewport<T extends HTMLElement>(rootMargin = "200px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const obs = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);
  return { ref, near };
}

/* ── Social proof — feature pills + agent strip + platform row ──────────────
   Sits directly below the hero carousel on the same black field, so the two
   read as one continuous surface. A row of capability pills (first one lit
   solid, the rest glass), then a small "used by" line, a strip of AI-agent
   avatars with their platform + follower count, and a bottom row of the
   platforms Vello actually posts to. */

const CAPABILITIES = [
  { label: "Long to shorts", Icon: Scissors },
  { label: "Auto captions", Icon: Captions },
  { label: "Auto hook", Icon: MessageSquareText },
  { label: "Trending audio", Icon: AudioLines },
  { label: "Smart reframe", Icon: Crop },
  { label: "Auto-posting", Icon: Share2 },
] as const;

function CapabilityRow() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-6">
      {CAPABILITIES.map(({ label, Icon }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-white/65"
          style={INTER}
        >
          <Icon className="size-3.5" />
          {label}
        </span>
      ))}
    </div>
  );
}

// Real client logos, bg-removed + recolored solid white (ffmpeg colorkey +
// lutrgb from the raw white-bg source in app/company/) so every mark sits
// directly on the black section — no card, no white box. Order verified
// against a contact-sheet render of app/company/1.jpg..17.jpg (do not reorder
// without re-checking — file order isn't alphabetical by name).
const CLIENT_LOGOS: { name: string; src: StaticImageData }[] = [
  { name: "keedsflix", src: logo1 },
  { name: "Southern Finance", src: logo2 },
  { name: "Kemari AI", src: logo3 },
  { name: "Legaloh Gifts", src: logo4 },
  { name: "AiMan Cloudworks", src: logo5 },
  { name: "Shopify", src: logo6 },
  { name: "Alamien Studios", src: logo7 },
  { name: "Noir", src: logo8 },
  { name: "Sekenje", src: logo9 },
  { name: "Tutorpal", src: logo10 },
  { name: "Genius", src: logo11 },
  { name: "Medikal.ai", src: logo12 },
  { name: "Jobtepi", src: logo13 },
  { name: "Heavenlife", src: logo14 },
  { name: "Arye Tech", src: logo15 },
  { name: "Zulabs", src: logo16 },
  { name: "SYX", src: logo17 },
];

function LogoChip({ name, src }: { name: string; src: StaticImageData }) {
  return (
    <div className="flex h-16 w-[148px] shrink-0 items-center justify-center px-3 opacity-80 transition-opacity hover:opacity-100">
      <Image src={src} alt={name} className="h-9 w-auto max-w-full object-contain" />
    </div>
  );
}

// Two opposite-scrolling rows (top left-to-right, bottom right-to-left) so the
// wall reads as living rather than a static grid. Each row uses a disjoint
// half of CLIENT_LOGOS, repeated 4x (not just doubled) — a single double-up of
// a ~8-item half-row was narrower than most desktop viewports, so the track
// ran out of tiles and showed blank space before it looped back to 0%. The
// translate keyframe still only goes to -50%, so any REPEAT count keeps a
// seamless loop as long as it's even — 4x just makes the physical strip wide
// enough to never run dry.
function AgentStrip() {
  const half = Math.ceil(CLIENT_LOGOS.length / 2);
  const repeat = <T,>(arr: T[]) => [...arr, ...arr, ...arr, ...arr];
  const rowTop = repeat(CLIENT_LOGOS.slice(0, half));
  const rowBottom = repeat(CLIENT_LOGOS.slice(half));
  return (
    <div className="mt-10 space-y-5 overflow-hidden">
      <div className="flex w-max gap-4 mach-marquee-right px-6">
        {rowTop.map((l, i) => (
          <LogoChip key={`${l.name}-${i}`} {...l} />
        ))}
      </div>
      <div className="flex w-max gap-4 mach-marquee-left px-6">
        {rowBottom.map((l, i) => (
          <LogoChip key={`${l.name}-${i}`} {...l} />
        ))}
      </div>
    </div>
  );
}

export function SocialProof() {
  return (
    <section className="relative z-10 bg-black pb-24 pt-0 text-white sm:pb-32">
      <CapabilityRow />

      <Reveal className="mt-24 text-center sm:mt-28">
        <p className="text-[15px] text-white/45" style={INTER}>
          Used by thousands of media agencies &amp; brands
        </p>
        <AgentStrip />
      </Reveal>
    </section>
  );
}

/* ── Testimonial marquee ──────────────────────────────────────────────────
   Replaces the old "agents around the world" map. Two opposite-scrolling rows
   of quote cards on a black field, premium/dark like the reference — quotes
   are attributed by ROLE (solo creator, agency operator, etc.), not specific
   named people or companies, since no real testimonial statements exist yet
   to quote verbatim. */
type Testimonial = { quote: string; role: string; initial: string; gradient: string };
const TESTIMONIALS: Testimonial[] = [
  { quote: "It used to take days to make clips. Now it takes minutes, and it never stops.", role: "Clipping agency operator", initial: "C", gradient: "from-violet-500 to-fuchsia-500" },
  { quote: "Set the vibe once and every clip out of the run matches it. Wild how consistent it stays.", role: "Solo creator, 4 accounts", initial: "S", gradient: "from-sky-500 to-blue-600" },
  { quote: "Thirty accounts, one dashboard. This is the tool we needed for the whole roster.", role: "Media agency, 18 clients", initial: "M", gradient: "from-orange-500 to-rose-500" },
  { quote: "Posts everywhere the second the render finishes. No more copy-pasting into five apps.", role: "UGC creator", initial: "U", gradient: "from-emerald-500 to-teal-600" },
  { quote: "The only clipper that actually feels agentic. It runs while I sleep.", role: "Content ops lead", initial: "O", gradient: "from-pink-500 to-purple-600" },
  { quote: "We stopped hiring freelance editors after the first week. It just kept up.", role: "Agency founder", initial: "A", gradient: "from-cyan-500 to-sky-600" },
];

// Distinct, non-impersonating avatar per card (dicebear identicon — same
// service already used for wallet avatars elsewhere in this app). Roles stay
// anonymous (no real names/photos): there's no real Vello testimonial data
// yet, so attributing a quote to a real person/photo would misrepresent them
// as endorsing the product.
function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}&backgroundColor=18181b`;
}

function TestimonialCard({ quote, role, initial }: Testimonial) {
  return (
    <div className="flex h-[190px] w-[340px] shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-xl">
      <p className="text-[15px] leading-relaxed text-white/90" style={INTER}>&ldquo;{quote}&rdquo;</p>
      <div className="flex items-center gap-2.5">
        <img src={avatarUrl(initial + role)} alt="" className="size-9 shrink-0 rounded-full ring-1 ring-white/10" />
        <span className="text-[13px] font-medium text-white/55" style={INTER}>{role}</span>
      </div>
    </div>
  );
}

export function TestimonialMarquee() {
  const repeat = <T,>(arr: T[]) => [...arr, ...arr, ...arr, ...arr];
  const row = repeat(TESTIMONIALS);
  // Bottom padding is intentionally huge: CaseStudies' ScrollVideo card
  // (case-studies.tsx) pulls itself UP with a large negative top-margin to
  // straddle the seam between this section and that one — this reserves the
  // empty room that pull-up needs so it lands on the seam instead of
  // overlapping these testimonial cards.
  return (
    <section className="relative overflow-hidden bg-[#0a0a0f] pb-[260px] pt-12 md:pb-[340px] md:pt-16">
      <Reveal className="mx-auto max-w-3xl px-6 text-center sm:px-10">
        <h2 className="text-[clamp(1.8rem,3.6vw,2.8rem)] font-medium tracking-[-0.02em] text-white" style={INTER}>
          A partner to your growth
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/45" style={INTER}>
          The shorts agent creators and agencies actually stick with.
        </p>
      </Reveal>

      <div className="relative mt-14">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#0a0a0f] to-transparent sm:w-40" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#0a0a0f] to-transparent sm:w-40" />
        <div className="flex w-max gap-4 mach-marquee-right px-6">
          {row.map((t, i) => (
            <TestimonialCard key={`${t.role}-${i}`} {...t} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── "How it works" — builder demo ──────────────────────────────────────────
   A framed product mockup of the Vello builder (see ./builder-demo): on the
   left, an n8n-style flow that builds an AI influencer step by step; on the
   right, a copilot chat driving it. Both animate in sync. */

const FEATURES = [
  {
    lead: "Prompt to creator",
    body: "Describe the creator you want, or drop in a video. Vello builds the persona, face, and voice as a drag-and-drop flow you can tweak.",
  },
  {
    lead: "Generate and post",
    body: "It renders short videos in the agent's own look, then auto-posts them to TikTok, YouTube, and Instagram.",
  },
  {
    lead: "It doesn't stop",
    body: "Every day it clips, posts, and checks the numbers again, no editor, no scheduler, no you.",
  },
] as const;

/* ── Edit-style bento grid — real generated videos, one per editing style,
   not illustrations. 3 equal tiles on top, wide + narrow tile below,
   matching the reference bento layout. Each tile autoplays a real clip
   pulled from the live feed. ────────────────────────────────────────────── */
/** `ytId` = the source YouTube Short behind landing/styles/<key>.mp4 on R2. */
type EditStyle = { key: string; title: string; body: string; ytId: string };

// Each tile plays a HAND-PICKED YouTube Short (muted, looping, cover-cropped)
// instead of a random live-feed clip, so every style always shows its best
// example.
const EDIT_STYLES: EditStyle[] = [
  { key: "genz", title: "Gen Z Editing", body: "Whip zooms, meme fonts, and jump cuts timed to the beat.", ytId: "1Z7pndpbRxY" },
  { key: "podcast", title: "Podcast Clips", body: "Waveform, guest name tags, and clean captions from raw VOD.", ytId: "jYm4LwLmiIo" },
  { key: "series", title: "AI Influencer Series", body: "A cartoon or photoreal persona, same face every episode.", ytId: "2PiiZ8vjZns" },
  { key: "cinematic", title: "Cinematic B-Roll", body: "Moody color grade, letterboxed frame, minimal captions — for brand and story content.", ytId: "uuHMzna5FqA" },
  { key: "reaction", title: "Reaction & Brain Rot", body: "Split-screen chaos, emoji overlays, zoom punches on every beat.", ytId: "PkGxPhGdqyE" },
];

/** Self-hosted loops for the edit-style tiles — each is the hand-picked YouTube
 *  Short re-encoded to a short, silent, faststart mp4 on R2. A YouTube iframe
 *  can't hide its own chrome (title bar, logo, "tap to play" when autoplay is
 *  blocked), so the tiles play these through a bare <video> instead. */
const STYLE_MEDIA_BASE = "https://pub-558d21b4a9744345b66a8b9e97b25be6.r2.dev/landing/styles";

/** One edit-style tile: a muted, looping, control-less video that autoplays
 *  inline. It only mounts near the viewport (poster otherwise), so the five
 *  tiles never decode while out of view. `contain` fits the full 9:16 clip in a
 *  phone frame over a blurred copy of its own poster. */
function StyleVideoTile({ styleKey, fit = "cover" }: { styleKey: string; fit?: "cover" | "contain" }) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const src = `${STYLE_MEDIA_BASE}/${styleKey}.mp4`;
  const poster = `${STYLE_MEDIA_BASE}/${styleKey}.jpg`;
  const media = (className: string) =>
    near ? (
      <video
        src={src}
        poster={poster}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        tabIndex={-1}
        className={`pointer-events-none ${className}`}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={poster} alt="" loading="lazy" className={className} />
    );

  if (fit === "contain") {
    return (
      <div ref={ref} className="relative h-[280px] overflow-hidden rounded-[6px] bg-neutral-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt="" loading="lazy" aria-hidden className="absolute -inset-6 size-[calc(100%+3rem)] scale-110 object-cover blur-2xl saturate-150" />
        <div aria-hidden className="absolute inset-0 bg-black/30" />
        <div className="absolute left-1/2 top-1/2 h-[calc(100%-28px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[4px] border border-white/25 bg-black/40 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.35)]" style={{ aspectRatio: "9 / 16" }}>
          {media("absolute inset-0 size-full object-cover")}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative h-[280px] overflow-hidden rounded-[6px] bg-neutral-900">
      {media("absolute inset-0 size-full object-cover")}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
    </div>
  );
}

export function HowItWorks() {
  return (
    <section className="bg-[#f4f3ef] px-6 py-20 text-neutral-900 sm:px-10 sm:py-28" style={INTER}>
      <div className="mx-auto max-w-[1180px]">
        <Reveal>
          <h2
            className="mx-auto max-w-5xl text-center text-[clamp(1.6rem,3.2vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.02em] text-neutral-900"
            style={INTER}
          >
            One video in. 100 viral clips out.
            <span className="block font-normal text-neutral-400 lg:whitespace-nowrap">AI finds the moments, cuts them, posts everywhere.</span>
          </h2>
        </Reveal>

        <div className="mx-auto mt-14 max-w-5xl">
          {/* Top row — 3 equal style tiles */}
          <RevealGroup className="grid gap-5 sm:grid-cols-3">
            {EDIT_STYLES.slice(0, 3).map((style) => (
              <RevealItem key={style.key}>
                <StyleVideoTile styleKey={style.key} fit={style.key === "genz" ? "contain" : "cover"} />
                <h3 className="mt-4 text-[17px] font-bold tracking-tight text-neutral-900">{style.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500">{style.body}</p>
              </RevealItem>
            ))}
          </RevealGroup>

          {/* Bottom row — wide + narrow tile */}
          <RevealGroup className="mt-5 grid gap-5 sm:grid-cols-[1.6fr_1fr]">
            {EDIT_STYLES.slice(3).map((style) => (
              <RevealItem key={style.key}>
                <StyleVideoTile styleKey={style.key} fit={style.key === "reaction" ? "contain" : "cover"} />
                <h3 className="mt-4 text-[17px] font-bold tracking-tight text-neutral-900">{style.title}</h3>
                <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-neutral-500">{style.body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>

        <RevealGroup className="mx-auto mt-14 grid max-w-5xl gap-x-12 gap-y-8 text-[15px] leading-relaxed text-neutral-500 md:grid-cols-3">
          {FEATURES.map((f) => (
            <RevealItem key={f.lead}>
              <p>
                <span className="font-semibold text-neutral-900">{f.lead}.</span> {f.body}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>

      </div>
    </section>
  );
}

/* ── Director models — AI Clipping / AI Influencer ───────────────────────────
   Own full-bleed BLACK section (not nested in HowItWorks' cream one) so it
   matches the reference exactly: no card container at all — just the image
   (lightly rounded, not the old rounded-3xl/2xl pillow look) directly on the
   page background, with the label + blurb sitting plainly underneath it. */
/** Animated editing timeline — playhead sweeping across clip segments with a
 *  waveform track and cut markers, ending in a stacked short-form export. */
function AiClippingArt() {
  const clips = [
    { w: 26, tint: "bg-lime-300/60" },
    { w: 14, tint: "bg-lime-300/35" },
    { w: 32, tint: "bg-lime-300/50" },
    { w: 18, tint: "bg-lime-300/30" },
  ];
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_15%_10%,#1a1d14_0%,#0a0a0c_55%,#050506_100%)]">
      <style>{`
        @keyframes clipPlayhead { 0% { left: 4%; } 100% { left: 96%; } }
        @keyframes clipWave { 0%,100% { opacity: .5; transform: scaleY(.6); } 50% { opacity: 1; transform: scaleY(1); } }
        @keyframes clipPop { 0%,72% { opacity: 0; transform: translateY(6px) scale(.94); } 84%,100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes vibeGlow { 0%,100% { opacity: .35; } 50% { opacity: .7; } }
        @media (prefers-reduced-motion: reduce) {
          .clip-anim, .swarm-anim { animation: none !important; opacity: 1 !important; }
        }
      `}</style>
      <div aria-hidden className="clip-anim absolute inset-0" style={{ animation: "vibeGlow 4s ease-in-out infinite", background: "radial-gradient(40%_60%_at_20%_50%,rgba(163,230,53,0.18),transparent_70%)" }} />

      <div className="relative z-10 flex w-[78%] items-center gap-5">
        {/* editing timeline */}
        <div className="relative flex-1 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-red-400/70" />
            <span className="size-1.5 rounded-full bg-yellow-300/60" />
            <span className="size-1.5 rounded-full bg-lime-300/70" />
            <span className="ml-auto text-[8px] font-semibold uppercase tracking-[0.14em] text-white/40">Timeline</span>
          </div>

          {/* video track — clip segments with cut gaps */}
          <div className="flex h-7 items-stretch gap-[3px]">
            {clips.map((c, i) => (
              <div key={i} className={`rounded-[3px] ${c.tint}`} style={{ width: `${c.w}%` }} />
            ))}
          </div>

          {/* audio waveform track */}
          <div className="mt-[5px] flex h-4 items-center gap-[2px]">
            {[0.5, 0.9, 0.4, 0.7, 1, 0.6, 0.8, 0.3, 0.9, 0.5, 0.7, 0.4, 1, 0.6, 0.8, 0.5, 0.3, 0.7, 0.9, 0.4, 0.6, 0.8].map((h, i) => (
              <div key={i} className="clip-anim w-[3px] rounded-full bg-lime-300/40" style={{ height: `${h * 100}%`, animation: `clipWave ${1.4 + (i % 4) * 0.2}s ease-in-out infinite`, animationDelay: `${i * 0.07}s` }} />
            ))}
          </div>

          {/* sweeping playhead */}
          <div aria-hidden className="clip-anim absolute inset-y-2 w-px bg-lime-300 shadow-[0_0_8px_rgba(163,230,53,0.8)]" style={{ animation: "clipPlayhead 4.5s linear infinite" }}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-sm bg-lime-300" />
          </div>
        </div>

        {/* exported vertical clips popping out */}
        <div className="relative h-[92px] w-[64px] shrink-0">
          {[2, 1, 0].map((i) => (
            <div
              key={i}
              className="clip-anim absolute inset-0 flex flex-col justify-end rounded-md border border-lime-300/30 bg-gradient-to-b from-white/[0.06] to-black/60 p-1.5"
              style={{ transform: `translate(${i * -7}px, ${i * -5}px)`, animation: "clipPop 4.5s ease-out infinite", animationDelay: `${i * 0.15}s` }}
            >
              <div className="h-1 w-3/4 rounded-full bg-white/30" />
              <div className="mt-1 h-1 w-1/2 rounded-full bg-lime-300/60" />
            </div>
          ))}
          <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.14em] text-lime-300/80">Clips out</span>
        </div>
      </div>
    </div>
  );
}

/** Network graph of AI influencer accounts — real creator portraits as nodes
 *  linked back to a central Vello brain, pulsing like a live social graph. */
function AiInfluencerArt() {
  // pravatar serves real-person portrait photos; fixed ids keep faces stable
  const nodes = [
    { img: 32, x: 14, y: 22, size: 44, delay: 0 },
    { img: 47, x: 78, y: 16, size: 40, delay: 0.4 },
    { img: 12, x: 88, y: 62, size: 46, delay: 0.8 },
    { img: 26, x: 20, y: 74, size: 38, delay: 1.2 },
    { img: 5, x: 62, y: 84, size: 42, delay: 1.6 },
    { img: 68, x: 40, y: 12, size: 34, delay: 2.0 },
  ];
  return (
    <div className="relative flex size-full items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_85%_15%,#141a10_0%,#0a0a0c_55%,#050506_100%)]">
      <style>{`
        @keyframes nodeFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes nodePing { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes linkDash { to { stroke-dashoffset: -14; } }
      `}</style>
      <div aria-hidden className="swarm-anim absolute inset-0" style={{ animation: "vibeGlow 5s ease-in-out infinite", background: "radial-gradient(40%_60%_at_80%_40%,rgba(163,230,53,0.14),transparent_70%)" }} />

      {/* network links from every node to the center hub */}
      <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {nodes.map((n, i) => (
          <line
            key={i}
            x1="50" y1="50" x2={n.x} y2={n.y}
            stroke="rgba(163,230,53,0.28)" strokeWidth="0.4"
            strokeDasharray="2 2.5"
            className="swarm-anim"
            style={{ animation: "linkDash 2.6s linear infinite", animationDelay: `${i * 0.3}s` }}
          />
        ))}
      </svg>

      {/* central hub */}
      <div className="relative z-10 flex size-14 items-center justify-center rounded-full border border-lime-300/50 bg-black/70 shadow-[0_0_24px_rgba(163,230,53,0.25)]">
        <span aria-hidden className="swarm-anim absolute inset-0 rounded-full border border-lime-300/40" style={{ animation: "nodePing 2.8s ease-out infinite" }} />
        <img src="/vello-mark-lime.png" alt="" className="size-7 object-contain" />
      </div>

      {/* influencer nodes — real portraits */}
      {nodes.map((n, i) => (
        <div
          key={i}
          className="swarm-anim absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${n.x}%`, top: `${n.y}%`, animation: "nodeFloat 3.6s ease-in-out infinite", animationDelay: `${n.delay}s` }}
        >
          <img
            src={`https://i.pravatar.cc/96?img=${n.img}`}
            alt=""
            loading="lazy"
            className="rounded-full border-2 border-lime-300/40 object-cover shadow-[0_0_14px_rgba(163,230,53,0.2)]"
            style={{ width: n.size, height: n.size }}
          />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-black bg-lime-300" />
        </div>
      ))}

      <span className="absolute bottom-3 right-3 rounded-full border border-white/10 bg-black/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/50 backdrop-blur-sm">
        30 personas live
      </span>
    </div>
  );
}

function DirectorModels() {
  return (
    <section className="bg-black px-6 py-20 sm:px-10 sm:py-28" style={INTER}>
      <div className="mx-auto max-w-[1180px]">
        <p className="text-center text-[12px] font-semibold uppercase tracking-[0.24em] text-white/40">
          ✦ Two products, one goal: views
        </p>
        <h2 className="mx-auto mt-3 max-w-2xl text-center text-[clamp(1.5rem,3vw,2.3rem)] font-medium leading-[1.15] tracking-[-0.02em] text-white">
          Pick how you want to grow.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[14.5px] leading-relaxed text-white/50">
          Vello AI video tools turn your footage into daily clips, or launch creator agents that make their own. Most teams run both.
        </p>

        <div className="mx-auto mt-12 grid max-w-5xl gap-x-5 gap-y-10 md:grid-cols-2">
          {/* AI Clipping */}
          <div className="group">
            <Link href="/clipping" className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/10 transition-colors group-hover:border-lime-300/40">
                <AiClippingArt />
              </div>
            </Link>
            <h3 className="mt-5 text-[19px] font-bold text-white">Shorts Agent</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-white/50">
              Drop in any long video and the AI editor does the rest: it finds the strongest moments, cuts them into short-form clips, and burns in captions, hooks, and music that match the vibe you set.
            </p>
            <div className="mt-4">
              <Link
                href="/clipping"
                className="rounded text-[13px] font-medium text-white/60 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
              >
                Explore Shorts Agent <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>

          {/* AI Influencer */}
          <div className="group">
            <Link href="/ai-influencer" className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/70">
              <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/10 transition-colors group-hover:border-lime-300/40">
                <AiInfluencerArt />
              </div>
            </Link>
            <h3 className="mt-5 text-[19px] font-bold text-white">Creator Agents</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-white/50">
              Spin up a network of AI-run creator personas, each with its own face, niche, voice, and posting schedule. They film, post, and grow their audiences around the clock while you direct from one chair.
            </p>
            <div className="mt-4">
              <Link
                href="/ai-influencer"
                className="rounded text-[13px] font-medium text-white/60 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
              >
                Explore Creator Agents <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── AI Editor — sits directly below AI Influencer ────────────────────────────
   Eyebrow icon + big bold headline + subtext, then one framed dark editor
   screenshot underneath — matches the reference's "AI EDITOR" layout. */
export function AiEditorSection() {
  return (
    <section className="bg-black px-6 pb-20 pt-0 sm:px-10 sm:pb-28" style={INTER}>
      <div className="mx-auto max-w-[1180px]">
        <p className="flex items-center justify-center gap-1.5 text-center text-[12px] font-semibold uppercase tracking-[0.24em] text-white/40">
          <Scissors className="size-3.5" /> AI Editor
        </p>
        <h3 className="relative mx-auto mt-4 whitespace-nowrap text-center text-[clamp(1.5rem,5.4vw,4.2rem)] font-bold leading-[1.1] tracking-[-0.02em] text-white">
          One timeline. Your hands or ours.
        </h3>
        <p className="mx-auto mt-4 max-w-xl text-center text-[16px] leading-relaxed text-white/50">
          Fine-tune every cut yourself, or hand the whole edit to Vello. Same timeline, same output quality, zero switching cost.
        </p>

        <div className="relative mx-auto mt-12 max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-neutral-900 to-black p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
          <div className="relative aspect-[2400/1486] w-full overflow-hidden rounded-2xl">
            <Image src={aiEditorIllustration} alt="Vello's AI editor — full manual control or AI-driven, in one timeline" fill className="object-cover" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Proof / scale reveal ─────────────────────────────────────────────────────
   The fleet story, told AFTER the single-agent hook has already landed: a real,
   checkable number (Cliphauz — also the first tab in CaseStudies) instead of an
   abstract "swarm of agents" pitch. Sits between the how-it-works loop and the
   pillars grid, cream-on-black so it reads as a distinct beat, not a repeat. */
/* ── Fastlane scroll ──────────────────────────────────────────────────────
   Scroll-linked (not viewport-trigger) race: a car sprints left→right as the
   section scrolls, while two headlines cross-fade in the exact same centered
   spot ("Stop putting off your marketing" → "Do it in the Fastlane"). Pinned
   via `position: sticky` for the scroll room; framer-motion's useScroll ties
   every value directly to scroll progress within that room, so it tracks the
   scrollbar 1:1 in both directions (not a one-shot play-once animation). No
   car photo asset exists in the repo and there's no way to pull one in from
   the web in this session, so the car is a large emoji + CSS motion-blur/
   speed-lines instead of a stock photo. */
function FastlaneScroll() {
  const sectionRef = useRef<HTMLElement>(null);
  // `target: sectionRef` scopes scrollYProgress to THIS section's own scroll
  // range only — it's driven purely by vertical scroll position (there's no
  // horizontal-scroll input in this layout at all), and is exactly 0 before
  // the section enters the pinned range and exactly 1 after it leaves, so the
  // effect can never fire from scrolling that happens anywhere else on the page.
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });

  // Three synced phases inside the pinned scroll range — deliberately WIDE
  // (240vh of actual scroll room: h-[340vh] section minus the 100vh sticky
  // viewport) so the animated portion can't be blown past in one fast
  // trackpad/wheel flick, which is what made it look "stuck on the final
  // frame" before — the active window was so short (~68vh of scroll) that a
  // single scroll gesture could skip straight from 0 to past 0.68.
  //  1. 0.00-0.62  car sprints edge-to-edge, headline A holds centered.
  //  2. 0.62-0.74  car is already gone; A -> B crossfades (sequential, never
  //                both visible at once) in that exact same spot.
  //  3. 0.74-1.00  animation is DONE: car gone, B fully shown, nothing moves
  //                — the section keeps pinning through this whole stretch so
  //                the finished frame holds perfectly still under the user's
  //                scroll input (this is the "make it static" part).
  // Once scrollYProgress hits 1 the container's extra scroll room is used up
  // and `sticky` releases on its own — normal document flow then carries the
  // already-finished text up and off with the page like any other content.
  // No JS y-transform for that exit; it's what `position: sticky` does by
  // definition once its scroll room runs out.
  const carX = useTransform(
    scrollYProgress,
    [0, 0.08, 0.2, 0.34, 0.46, 0.56, 0.62],
    ["-40vw", "-26vw", "0vw", "40vw", "90vw", "134vw", "150vw"],
  );
  const carBlur = useTransform(scrollYProgress, [0, 0.06, 0.56, 0.62], [0, 4, 4, 0]);
  const carFilter = useTransform(carBlur, (b) => `blur(${b}px)`);
  const streakOpacity = useTransform(scrollYProgress, [0, 0.06, 0.56, 0.62], [0, 1, 1, 0]);

  // Strictly sequential — A fades fully to 0 BEFORE B starts rising from 0,
  // both AFTER the car has finished (0.62+), so text changes only once the
  // car has visibly passed. B then holds at full opacity for the rest of the
  // pin (0.74-1) — it never fades out on its own; it just rides off normally
  // once the pin naturally releases. A subtle scale (0.97→1) rides along with
  // each fade for a bit more polish than a flat opacity cut.
  const textAOpacity = useTransform(scrollYProgress, [0, 0.06, 0.56, 0.63], [0, 1, 1, 0]);
  const textAScale = useTransform(scrollYProgress, [0, 0.06], [0.97, 1]);
  const textBOpacity = useTransform(scrollYProgress, [0.67, 0.74, 1], [0, 1, 1]);
  const textBScale = useTransform(scrollYProgress, [0.67, 0.74], [0.97, 1]);

  return (
    <section ref={sectionRef} className="relative h-[340vh] bg-[#f4f3ef]">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        {/* Speed lines — a few horizontal streaks trailing the car, only visible
            while it's mid-flight (not parked at either edge). */}
        <motion.div aria-hidden style={{ opacity: streakOpacity }} className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[2px] bg-gradient-to-r from-transparent via-neutral-400/50 to-transparent"
              style={{ marginLeft: `${i * 6}vw`, width: `${34 - i * 6}vw` }}
            />
          ))}
        </motion.div>

        {/* Centered cross-fading headline — both lines occupy the exact SAME
            spot always; only opacity/scale animate, position never moves. */}
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6">
          <motion.h2
            style={{ opacity: textAOpacity, scale: textAScale }}
            className="absolute max-w-2xl text-center text-[clamp(1.8rem,4.4vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.02em] text-neutral-900"
          >
            Stop hiding your best content.
          </motion.h2>
          <motion.h2
            style={{ opacity: textBOpacity, scale: textBScale }}
            className="absolute max-w-3xl text-center text-[clamp(2.4rem,6.4vw,5rem)] font-medium leading-[1.1] tracking-[-0.02em] text-neutral-900"
          >
            Make it shine.
          </motion.h2>
        </div>

        {/* The car — real photo, sprinting the full width on scroll. */}
        <motion.div
          aria-hidden
          style={{ x: carX, filter: carFilter }}
          className="absolute top-1/2 z-0 w-[420px] -translate-y-1/2 select-none sm:w-[620px] md:w-[760px]"
        >
          <Image src={fastlaneCar} alt="" className="h-auto w-full drop-shadow-[0_20px_30px_rgba(0,0,0,0.2)]" priority={false} />
        </motion.div>
      </div>
    </section>
  );
}

// Manrope — loaded app-wide as --font-manrope (see app/layout.tsx's font
// variable list); used for this whole section instead of Inter.
const MANROPE = { fontFamily: "var(--font-manrope)" } as const;

/* ── How it works — locked image + normal-scroll text + full-height line ────
   Text sits in normal document flow, one real section per step, generously
   spaced so each gets real scroll room. The IMAGE is locked in one spot
   (sticky, centered) and slow-blur-crossfades to the next step's photo as its
   text section crosses the middle of the screen (each text row reports
   "I'm centered now" via onViewportEnter, no continuous scroll math needed).
   The vertical line spans the full viewport height (sticky top-0 h-screen)
   and fills top-to-bottom with real scroll progress across the section. */
const HOW_STEPS = [
  {
    n: "01",
    title: "Drop a video link",
    body: "Paste a link or upload a file. Vello pulls the source and gets to work instantly.",
    image: howStep1,
  },
  {
    n: "02",
    title: "AI finds the viral moments",
    body: "Every moment gets scored for hook strength, pacing, and payoff. The best ones get cut.",
    image: howStep2,
  },
  {
    n: "03",
    title: "Captions, hooks, and style burned in",
    body: "Auto Captions, Auto Hook, and your chosen look apply to every clip automatically.",
    image: howStep3,
  },
  {
    n: "04",
    title: "Posted everywhere, automatically",
    body: "Clips publish straight to TikTok, Reels, Shorts, and X on schedule. No copy-pasting.",
    image: howStep4,
  },
] as const;

/** One step's TEXT row — its own real copy, permanently in the DOM, always
 *  fully visible (no entrance/exit animation). Reports when it crosses the
 *  middle of the screen so the locked image knows which photo to show. Tall
 *  min-height gives each step real scroll room for the blur crossfade + line
 *  fill to play out slowly instead of skipping past in one flick. */
function HowStepText({ step, index, onCenter }: { step: (typeof HOW_STEPS)[number]; index: number; onCenter: (i: number) => void }) {
  return (
    <motion.div
      style={{ gridColumn: 3, gridRow: index + 1 }}
      className="flex min-h-[70vh] flex-col justify-center"
      onViewportEnter={() => onCenter(index)}
      // margin shrinks the trigger zone to a thin band at screen-center; amount
      // must be reachable against that band (a tall min-h-[70vh] row can never
      // have 50% of ITSELF inside a ~10vh band, so "amount: 0.5" never fired —
      // that's why the image was stuck. "some" = any overlap with the band.
      viewport={{ amount: "some", margin: "-45% 0px -45% 0px" }}
    >
      <p className="font-mono text-[15px] text-neutral-400">{step.n}</p>
      <h3 className="mt-3 max-w-sm text-[clamp(1.5rem,2.6vw,2.1rem)] font-bold leading-tight tracking-[-0.01em] text-neutral-950">
        {step.title}
      </h3>
      <p className="mt-4 max-w-md text-[18px] leading-relaxed text-neutral-500">{step.body}</p>
    </motion.div>
  );
}

/** "How it works" — the image is LOCKED in place (sticky, centered) and
 *  slow-blur-crossfades to the active step's photo; text scrolls normally
 *  beside it in real document flow, generously spaced; the line spans the
 *  full screen height and fills with real scroll progress. */
export function HowItWorksScroll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const step = HOW_STEPS[active];
  // Fill is tied directly to real scroll position (not the discrete step
  // index) — it moves continuously with the scrollbar instead of jumping
  // between 4 fixed points. wrapRef's top lines up with where the sticky line
  // locks in (top-0), so "start" here already matches step 1 being in view.
  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ["start start", "end end"] });
  const fillScaleY = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section className="bg-[#f4f3ef] px-6 py-24 sm:px-10 sm:py-32" style={MANROPE}>
      <h2 className="text-center text-[clamp(2rem,5vw,3.4rem)] font-bold tracking-[-0.02em] text-neutral-950">
        How it works
      </h2>

      <div
        ref={wrapRef}
        className="relative mx-auto mt-32 grid w-full max-w-6xl grid-cols-[1.35fr_2px_1fr] gap-x-10 gap-y-24 sm:mt-40 sm:gap-x-16 sm:gap-y-40"
      >
        {/* Locked image slot — sticky centered, spans every row's grid area;
            content slow-blur-crossfades between steps as `active` changes. */}
        <div className="relative aspect-[8/5] self-center sticky top-1/2 -translate-y-1/2" style={{ gridColumn: 1, gridRow: "1 / -1" }}>
          <div className="relative size-full overflow-hidden rounded-3xl border border-black/[0.06] shadow-[0_20px_50px_-24px_rgba(0,0,0,0.3)]">
            {/* No AnimatePresence/exit — that "mode=wait" gap was a blank beat
                before the next image faded in. The new image appears INSTANTLY
                (full opacity/size from frame one, swapped via `key`); only its
                blur transitions smoothly from blurred to sharp. */}
            <motion.div
              key={step.n}
              initial={{ filter: "blur(18px)" }}
              animate={{ filter: "blur(0px)" }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0"
            >
              <Image src={step.image} alt={step.title} fill className="object-cover" />
            </motion.div>
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </div>
        </div>

        {/* Fill line — sticky top-0, full screen height, top-to-bottom. The
            generous mt-32/40 above the grid gives the headline clearance
            before this locks in, so it starts right at step 1, not overlapping
            the heading. Spans every row's grid area. */}
        <div className="relative h-screen w-px sticky top-0" style={{ gridColumn: 2, gridRow: "1 / -1" }}>
          <div aria-hidden className="absolute inset-y-0 w-px bg-neutral-200" />
          <motion.div
            aria-hidden
            style={{ scaleY: fillScaleY }}
            className="absolute inset-x-0 top-0 h-full w-px origin-top bg-gradient-to-b from-lime-600 via-lime-500 to-lime-300 shadow-[0_0_12px_2px_rgba(132,204,22,0.7)]"
          />
        </div>

        {HOW_STEPS.map((step, i) => (
          <HowStepText key={step.n} step={step} index={i} onCenter={setActive} />
        ))}
      </div>
    </section>
  );
}

/* ── Pixel-roots separator ───────────────────────────────────────────────────
   A slim 8-bit band that sits BELOW the full-screen hero: a green "ground" line
   dissolving into pixelated roots trailing down into the cream section. Only
   comes into view once you scroll past the hero. Deterministic sine-hash (no
   Math.random) so SSR/client match, but varied per-column so it never repeats. */
function PixelRoots() {
  const COLS = 340;
  const ROWS = 12;
  const CELL = 7; // px — small pixels
  const SHADES = ["#2f7a44", "#3a8a3f", "#4f9c46", "#5aa24a", "#6cb536", "#8fd14f"];
  // Deterministic pseudo-random in [0,1) — varied but stable across renders.
  const rand = (i: number, seed: number) => {
    const x = Math.sin(i * 91.73 + seed * 47.29) * 43758.5453;
    return x - Math.floor(x);
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < COLS; i++) {
    const solid = 1 + Math.floor(rand(i, 1) * 2); // 1–2 solid ground cells
    const trail = solid + 1 + Math.floor(rand(i, 2) * 4); // dense-ish roots
    const strand = rand(i, 3) > 0.86 ? ROWS : 0; // occasional long thin strand
    for (let r = 0; r < ROWS; r++) {
      let on = false;
      if (r < solid) on = true; // ground line (row 0 always on)
      else if (r < trail && rand(i, 10 + r) > 0.4) on = true; // sparse trailing roots
      else if (strand && rand(i, 30 + r) > 0.72) on = true; // deep stray pixels
      if (!on) continue;
      cells.push(
        <span
          key={`${i}-${r}`}
          style={{
            position: "absolute",
            left: i * CELL,
            top: r * CELL,
            width: CELL,
            height: CELL,
            background: SHADES[Math.floor(rand(i, r + 5) * SHADES.length)],
            opacity: Math.max(0.32, 1 - r * 0.07),
          }}
        />,
      );
    }
  }
  return (
    <div aria-hidden className="pointer-events-none relative w-full overflow-hidden bg-[#f4f3ef]" style={{ height: ROWS * CELL }}>
      {/* soft shadow just under the ground line for depth */}
      <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-black/12 to-transparent" />
      <div className="absolute left-0 top-0" style={{ imageRendering: "pixelated" }}>{cells}</div>
    </div>
  );
}

/* ── Final CTA — the closing beat: launch a brand in 100+ countries. Reused by the
   /clipping and AI-influencer pages so the close is identical site-wide. */
export function FinalCta() {
  return <GlobalLaunch />;
}

export function CofounderLanding() {
  return (
    <main className="relative bg-[#f4f3ef] text-neutral-900 antialiased">
      {/* ── Announcement bar — minimal lime strip, dismissible ── */}
      <AnnouncementBar />

      {/* Sticky nav lives OUTSIDE the hero section on purpose — the hero below
          is overflow-hidden (clips its decorative glow/carousel edge fades),
          and `sticky` gets clipped to the bounds of an overflow-hidden
          ancestor, which would un-stick the header the moment you scroll past
          the hero instead of keeping it pinned for the whole page. */}
      <Navigation />

      {/* ── Hero — solid black, centered, OpusClip-style ── */}
      <section className="relative overflow-hidden bg-black text-white">
        {/* Faint ambient glow behind the headline, matching the reference's soft
            top-center light — pure black elsewhere. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[60vh] [background:radial-gradient(60%_60%_at_50%_0%,rgba(255,255,255,0.07),transparent_70%)]"
        />

        {/* Temporarily hidden: live agent-activity notification stack */}
        {/* <FloatingTasks /> */}
        <Hero />
        <FeatureShowcaseCarousel />
      </section>

      {/* ── Social proof — continues the black hero surface ── */}
      <SocialProof />

      {/* ── Product router — AI Clipping / AI Influencer, the page's fork.
          Sits right after social proof so a visitor self-selects a product
          within the first two scrolls. Deep product detail lives on /clipping
          and /ai-influencer, not here. ── */}
      <DirectorModels />

      {/* Pixel-art ground separator — black products section → cream. */}
      <PixelRoots />

      {/* ── What the output looks like — real clips, one per editing style ── */}
      <HowItWorks />

      {/* ── Proof / scale reveal — fleet story, told after the hook already landed ── */}
      <FastlaneScroll />

      {/* ── Five pillars — "Everything it takes to go viral" ── */}
      <GrowSection />

      {/* ── Testimonial marquee ── */}
      <TestimonialMarquee />

      {/* ── Case studies ── */}
      <CaseStudies />

      {/* ── Final CTA — the registration close ── */}
      <FinalCta />

      {/* Temporarily hidden: "A new hope for work" manifesto
      <div className="relative bg-[#0a0a0f]">
        <Manifesto />
      </div> */}

      {/* ── Footer ── */}
      <Footer />

      {/* ── Live support chat (AI-answered, persisted for the admin Live Chat tab) ── */}
      <LiveChatWidget />
    </main>
  );
}
