"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import brandLogo from "@/assets/solcameo-dark.png";
import { AccountButton } from "@/components/layout/account-button";
import { WalletButton } from "@/components/layout/wallet-button";
import {
  CHAPTERS,
  NUMBERED,
  OVERVIEW,
  chapterBySlug,
  hrefForChapter,
  type DocChapter,
} from "./docs-config";

/* ════════ Solcameo Docs: shared reading shell ════════
   Warm-monochrome, three-column layout reused by every docs route:
   • left   — sticky table of contents (overview link + four numbered chapters)
   • centre — eyebrow pill, light display heading, lead, then anchored sections
   • right  — a pulsing vertical progress bar that tracks reading + flashes on scroll
   Scroll-spy lights the current chapter's active section; the nav mirrors
   /landing exactly. One lime accent over neutral greys. */

const INTER = { fontFamily: "var(--font-inter)" } as const;
const ACCENT = "#84cc16";

/* ── Top navigation — light frosted variant of the /landing nav ────────────── */
function Navigation({ slug }: { slug: string }) {
  const { authenticated, user } = usePrivy();
  const walletOnly = authenticated && !(user?.linkedAccounts ?? []).some(
    (account) => account.type === "google_oauth" || account.type === "email",
  );
  return (
    <header className="z-30 h-14 shrink-0 border-b border-black/[0.06] bg-[#f4f3ef]/85 backdrop-blur-xl">
      <nav
        className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-2.5 px-6 sm:px-10"
        style={INTER}
      >
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-lime-500/60"
        >
          <Image src={brandLogo} alt="Solcameo" priority className="h-5 w-auto sm:h-6" />
        </Link>

        <div className="flex items-center gap-2.5">
          {/* Segmented section nav: Overview · Start · Create · Launch · Grow */}
          <div className="hidden items-center rounded-lg border border-black/[0.07] bg-white px-1 py-1 text-[13px] font-medium text-neutral-600 shadow-[0_1px_2px_rgba(0,0,0,0.03)] lg:flex">
            {CHAPTERS.map((c, i) => {
              const active = c.slug === slug;
              return (
                <span key={c.nav} className="flex items-center">
                  {i > 0 && <span aria-hidden className="mx-0.5 h-3.5 w-px bg-black/10" />}
                  <Link
                    href={hrefForChapter(c.slug)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "rounded-md px-3 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime-500/60",
                      active
                        ? "bg-neutral-900 text-white"
                        : "text-[#6f6f6f] hover:text-neutral-900",
                    ].join(" ")}
                  >
                    {c.nav}
                  </Link>
                </span>
              );
            })}
          </div>

          <Link
            href="/pricing"
            className="hidden rounded-lg px-3 py-1.5 text-[13px] font-medium text-neutral-600 transition-colors hover:text-neutral-900 sm:inline-flex"
          >
            Pricing
          </Link>
          {walletOnly ? <WalletButton /> : <AccountButton light />}
        </div>
      </nav>
    </header>
  );
}

/* ── Left — table of contents ───────────────────────────────────────────────
   The current chapter's items are in-page anchors lit by scroll-spy; every
   other chapter's items route to that page (with a hash). */
function Sidebar({ slug, activeId }: { slug: string; activeId: string }) {
  const overviewActive = slug === OVERVIEW.slug;
  return (
    <nav aria-label="Documentation contents" style={INTER}>
      <Link
        href={hrefForChapter(OVERVIEW.slug)}
        className={[
          "block border-l-2 pl-5 text-[15px] font-medium leading-snug transition-colors",
          overviewActive
            ? "border-neutral-900 text-neutral-900"
            : "border-black/10 text-[#6f6f6f] hover:text-neutral-900",
        ].join(" ")}
      >
        Launch an AI character
        <br />
        with Solcameo
      </Link>

      <div className="mt-9 space-y-8">
        {NUMBERED.map((group) => {
          const isCurrent = group.slug === slug;
          return (
            <div key={group.slug}>
              <div className="pl-5">
                <Link
                  href={hrefForChapter(group.slug)}
                  className="text-[15px] font-semibold tracking-tight text-neutral-900 transition-colors hover:text-neutral-600"
                >
                  {group.title}
                </Link>
              </div>

              <ul className="mt-3.5 space-y-[2px]">
                {group.sections.map((item) => {
                  const active = isCurrent && item.id === activeId;
                  const href = isCurrent
                    ? `#${item.id}`
                    : `${hrefForChapter(group.slug)}#${item.id}`;
                  return (
                    <li key={item.id}>
                      <a
                        href={href}
                        aria-current={active ? "true" : undefined}
                        className={[
                          "group flex items-center gap-3 rounded-md py-1.5 pl-5 pr-2 text-[14px] transition-colors duration-300 ease-out",
                          active ? "text-neutral-900" : "text-[#6f6f6f] hover:text-neutral-900",
                        ].join(" ")}
                      >
                        <span
                          aria-hidden
                          className={[
                            "size-[13px] shrink-0 rounded-full border transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out",
                            active
                              ? "scale-110 border-transparent"
                              : "scale-100 border-neutral-300 bg-transparent group-hover:border-neutral-400",
                          ].join(" ")}
                          style={
                            active
                              ? {
                                  backgroundColor: ACCENT,
                                  boxShadow: `0 0 0 3px ${ACCENT}1f, 0 0 11px 1px ${ACCENT}73`,
                                }
                              : undefined
                          }
                        />
                        <span
                          className={[
                            "transition-colors duration-300",
                            active ? "font-medium" : "",
                          ].join(" ")}
                        >
                          {item.label}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Right — pulsing scroll-progress bar ─────────────────────────────────────
   A slim vertical track whose accent fill grows with reading progress. The
   leading tip breathes continuously and flashes on each scroll. */
function ProgressRail({ progress, scrolling }: { progress: number; scrolling: boolean }) {
  const pct = Math.round(progress * 100);
  return (
    <div
      aria-hidden
      className={`fixed top-[120px] hidden h-fit w-10 flex-col items-center gap-3 xl:flex ${
        scrolling ? "docs-rail-scrolling" : ""
      }`}
      style={{ right: "max(40px, calc((100vw - 1300px) / 2))" }}
    >
      <div className="relative h-[420px] w-[3px]">
        <div
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: "rgba(38,38,38,0.10)" }}
        />
        <div
          className="absolute inset-x-0 top-0 rounded-full transition-[height] duration-200 ease-out"
          style={{ height: `${pct}%`, backgroundColor: ACCENT }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 transition-[top] duration-200 ease-out"
          style={{ top: `${pct}%` }}
        >
          <span
            className="docs-rail-tip block size-[11px] -translate-y-1/2 rounded-full"
            style={{ backgroundColor: ACCENT, boxShadow: `0 0 12px 2px ${ACCENT}59` }}
          />
        </div>
      </div>
      <span className="font-mono text-[10px] tabular-nums text-neutral-400">
        {String(pct).padStart(2, "0")}
      </span>
    </div>
  );
}

/* ── Inter-chapter footer nav — previous / next ─────────────────────────────── */
function ChapterFooter({ chapter }: { chapter: DocChapter }) {
  const idx = CHAPTERS.findIndex((c) => c.slug === chapter.slug);
  const prev = idx > 0 ? CHAPTERS[idx - 1] : undefined;
  const next = idx < CHAPTERS.length - 1 ? CHAPTERS[idx + 1] : undefined;
  if (!prev && !next) return null;
  return (
    <div className="mt-16 grid gap-3 border-t border-black/[0.07] pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          href={hrefForChapter(prev.slug)}
          className="group rounded-xl border border-black/[0.07] bg-white/70 px-4 py-3 transition-colors hover:bg-white"
        >
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            ← Previous
          </span>
          <span className="mt-1 block text-[14px] font-medium text-neutral-900">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={hrefForChapter(next.slug)}
          className="group rounded-xl border border-black/[0.07] bg-white/70 px-4 py-3 text-right transition-colors hover:bg-white sm:col-start-2"
        >
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
            Next →
          </span>
          <span className="mt-1 block text-[14px] font-medium text-neutral-900">{next.title}</span>
        </Link>
      )}
    </div>
  );
}

/* ── Reading-column primitives (used by the page files) ─────────────────────── */
export function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 pt-12 first:pt-0">
      {kicker && (
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400">
          {kicker}
        </p>
      )}
      <h2 className="text-[clamp(1.2rem,1.9vw,1.55rem)] font-medium tracking-tight text-neutral-900">
        {title}
      </h2>
      <div className="mt-3.5 space-y-3.5 text-[14px] leading-[1.7] text-neutral-600">{children}</div>
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 rounded-xl border border-black/[0.07] bg-white/70 p-4 pl-5">
      <p className="flex gap-3 text-[13px] leading-relaxed text-neutral-600">
        <span
          aria-hidden
          className="mt-[3px] h-[15px] w-[3px] shrink-0 rounded-full"
          style={{ backgroundColor: ACCENT }}
        />
        <span>{children}</span>
      </p>
    </div>
  );
}

export function Bullets({ items }: { items: [string, string][] }) {
  return (
    <ul className="my-5 space-y-3">
      {items.map(([term, desc]) => (
        <li key={term} className="flex gap-3.5">
          <span aria-hidden className="mt-[9px] size-[5px] shrink-0 rounded-full bg-neutral-400" />
          <span>
            <span className="font-medium text-neutral-900">{term}</span>
            <span className="text-neutral-400">: </span>
            {desc}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ordered, numbered steps — for "do this, then this" sequences. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="my-5 space-y-3.5">
      {items.map((node, i) => (
        <li key={i} className="flex gap-3.5">
          <span
            aria-hidden
            className="mt-[1px] grid size-[20px] shrink-0 place-items-center rounded-full border border-black/[0.08] bg-white font-mono text-[11px] text-neutral-500"
          >
            {i + 1}
          </span>
          <span>{node}</span>
        </li>
      ))}
    </ol>
  );
}

/** Inline doc link, styled for the warm theme. */
export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 transition-colors hover:decoration-neutral-500"
    >
      {children}
    </Link>
  );
}

/* ── The shell — page files render <DocsShell slug lead>…sections…</DocsShell> ── */
export function DocsShell({
  slug,
  lead,
  figure,
  children,
}: {
  slug: string;
  lead: ReactNode;
  figure?: ReactNode;
  children: ReactNode;
}) {
  const chapter = chapterBySlug(slug) ?? OVERVIEW;
  const sectionIds = chapter.sections.map((s) => s.id);

  const [activeId, setActiveId] = useState<string>(sectionIds[0] ?? "");
  const [progress, setProgress] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll-spy — light the section nearest the top of the scroll container as it
  // passes through. The IntersectionObserver root IS the body scroll container,
  // so spying tracks the inner scroll, not the (locked) document.
  useEffect(() => {
    const root = scrollRef.current;
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (!root || sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root, rootMargin: "-12% 0px -72% 0px", threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
    // sectionIds is derived from the static slug, so this runs once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Reading progress for the rail + a transient "scrolling" flag (drives the rail
  // flash and the scrollbar's flowing wave), driven by the container's scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const total = el.scrollHeight - el.clientHeight;
      const p = total > 0 ? el.scrollTop / total : 0;
      setProgress(Math.min(1, Math.max(0, p)));

      setScrolling(true);
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current);
      scrollStopTimer.current = setTimeout(() => setScrolling(false), 450);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (scrollStopTimer.current) clearTimeout(scrollStopTimer.current);
    };
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f4f3ef] text-neutral-900 antialiased" style={INTER}>
      {/* Fixed-height header — sits outside the scroll container, so it never moves. */}
      <Navigation slug={slug} />

      {/* The body scroll container — the ONLY thing that scrolls. Custom wave
          scrollbar; `docs-scrolling` toggles the flowing animation while moving. */}
      <div
        ref={scrollRef}
        className={`docs-scroll-area flex-1 scroll-smooth overflow-y-auto ${scrolling ? "docs-scrolling" : ""}`}
      >
        <div className="mx-auto grid max-w-[1380px] grid-cols-1 gap-x-12 px-6 pb-32 pt-8 sm:px-10 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_40px]">
          {/* The 260px column reserves layout space; the nav is fixed to the
              viewport with its OWN scrollbar, so it scrolls independently and
              never mixes with the body scroll. left aligns to this first column. */}
          <aside className="hidden lg:block">
            <div
              className="docs-scroll fixed top-[88px] w-[260px] overflow-y-auto pr-2"
              style={{
                left: "max(40px, calc((100vw - 1380px) / 2 + 40px))",
                maxHeight: "calc(100vh - 112px)",
              }}
            >
              <Sidebar slug={slug} activeId={activeId} />
            </div>
          </aside>

          <article className="mx-auto w-full max-w-[720px]">
            <span className="inline-flex items-center rounded-full border border-black/[0.09] bg-white px-3.5 py-1 text-[13px] font-medium text-neutral-500">
              {chapter.eyebrow}
            </span>

            <h1 className="mt-6 text-[clamp(2.1rem,4.4vw,3.1rem)] font-medium leading-[1.07] tracking-[-0.02em] text-neutral-900">
              {chapter.title}
            </h1>

            <div className="mt-6 space-y-4 text-[15px] leading-[1.7] text-neutral-600">{lead}</div>

            {figure}

            {children}

            <ChapterFooter chapter={chapter} />
          </article>

          <ProgressRail progress={progress} scrolling={scrolling} />
        </div>
      </div>
    </div>
  );
}

/** Framed figure for chapter art. Pass a static image, or use <DocVisual> for the brand illustrations. */
export function DocFigure({
  src,
  alt,
  caption,
}: {
  src: import("next/image").StaticImageData;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="mt-12">
      <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.18)]">
        <div className="relative aspect-[16/9] overflow-hidden rounded-xl ring-1 ring-inset ring-black/[0.06]">
          <Image src={src} alt={alt} fill sizes="(max-width: 768px) 100vw, 720px" className="object-cover object-center" />
        </div>
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-[13px] text-neutral-400">{caption}</figcaption>
      )}
    </figure>
  );
}

/* ── Brand illustrations: dark Solcameo panels drawn in code (crisp at any size, no image weight) ── */
const PANEL_BG = "[background-image:radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:16px_16px]";
const chip = "rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-zinc-200";
const LIME = "#d7ff00";

function SolanaBars({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 397.7 311.7" className={className} aria-hidden>
      <defs>
        <linearGradient id="docSolGrad" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientTransform="matrix(1 0 0 -1 0 314)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" /><stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path fill="url(#docSolGrad)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
      <path fill="url(#docSolGrad)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
      <path fill="url(#docSolGrad)" d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}

export function DocVisual({ kind, caption }: { kind: "hero" | "start" | "create" | "launch" | "grow"; caption?: string }) {
  return (
    <figure className="mt-12">
      <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.18)]">
        <div className={`relative aspect-[16/9] overflow-hidden rounded-xl bg-[#08090b] text-white ring-1 ring-inset ring-black/10 ${PANEL_BG}`}>
          <span aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-56 w-80 -translate-x-1/2 rounded-full bg-[#d7ff00]/[0.12] blur-3xl" />
          {kind === "hero" && (
            <div className="absolute inset-0 grid place-items-center text-center">
              <div className="flex flex-col items-center px-6">
                <Image src="/brand/solcameo-mark.png" alt="" width={96} height={96} className="size-16 drop-shadow-[0_0_28px_rgba(200,240,42,0.45)] sm:size-24" priority />
                <p className="mt-4 text-[clamp(1.1rem,3vw,2rem)] font-semibold leading-tight tracking-tight">Launch an AI character.<br /><span style={{ color: LIME }}>With its own coin.</span></p>
                <div className="mt-4 flex flex-wrap justify-center gap-2"><span className={chip}>Meteora bonding curve</span><span className={chip}>1B fixed supply</span><span className={chip}>Locked liquidity</span></div>
              </div>
              <SolanaBars className="absolute bottom-4 right-5 w-10 opacity-90 sm:w-14" />
            </div>
          )}
          {kind === "start" && (
            <div className="absolute inset-0 flex items-center justify-center px-5">
              <div className="grid w-full max-w-[560px] grid-cols-4 gap-2.5 sm:gap-3">
                {[["01", "Sign in", "Google or wallet"], ["02", "Wallet", "Embedded or Phantom"], ["03", "Add SOL", "Deposit or faucet"], ["04", "Explore", "Meet the market"]].map(([n, t, d], i) => (
                  <div key={n} className="relative rounded-lg border border-white/12 bg-white/[0.05] p-2.5 sm:p-3.5">
                    <p className="font-mono text-[10px] text-zinc-500">{n}</p>
                    <p className="mt-1 text-[11px] font-semibold sm:text-sm">{t}</p>
                    <p className="mt-0.5 hidden text-[10px] text-zinc-400 sm:block">{d}</p>
                    {i === 0 && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-lg" style={{ background: LIME }} />}
                  </div>
                ))}
              </div>
            </div>
          )}
          {kind === "create" && (
            <div className="absolute inset-0 flex items-center justify-center px-5">
              <div className="w-full max-w-[520px]">
                <div className="rounded-lg border border-white/12 bg-white/[0.06] p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">Describe your character</p>
                  <p className="mt-1.5 text-[13px] font-medium sm:text-sm">A tiny knight cat who films misty adventures<span className="ml-0.5 animate-pulse" style={{ color: LIME }}>|</span></p>
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  {["from-amber-300/70 to-orange-600/60", "from-lime-300/80 to-emerald-600/60", "from-sky-300/70 to-indigo-600/60"].map((g, i) => (
                    <div key={g} className={`size-14 rounded-md bg-gradient-to-br sm:size-[72px] ${g} ${i === 1 ? "ring-2 ring-[#d7ff00] shadow-[0_0_22px_-4px_rgba(215,255,0,0.6)]" : "ring-1 ring-white/15"}`} />
                  ))}
                  <span className="ml-auto rounded-md px-4 py-2.5 text-xs font-bold text-black" style={{ background: LIME }}>Generate ✦</span>
                </div>
              </div>
            </div>
          )}
          {kind === "launch" && (
            <div className="absolute inset-0 flex flex-col justify-center gap-4 px-6 sm:px-10">
              <svg viewBox="0 0 400 120" className="h-auto w-full" aria-hidden>
                <path d="M0 112 C90 108 170 96 240 66 S350 14 400 8" fill="none" stroke={LIME} strokeWidth="3" strokeLinecap="round" />
                <path d="M0 112 C90 108 170 96 240 66 S350 14 400 8 V120 H0Z" fill="rgba(215,255,0,0.12)" />
                <line x1="318" y1="0" x2="318" y2="120" stroke="rgba(255,255,255,0.35)" strokeDasharray="4 5" />
                <text x="324" y="14" fill="#e4e4e7" fontSize="10" fontWeight="600">Graduates</text>
              </svg>
              <div>
                <div className="flex h-2.5 overflow-hidden rounded-full"><span style={{ width: "40%", background: LIME }} /><span style={{ width: "10%", background: "#7C4DFF" }} /><span style={{ width: "30%", background: "#52525b" }} /><span style={{ width: "20%", background: "#00FFD1" }} /></div>
                <div className="mt-2 flex justify-between text-[10px] text-zinc-400 sm:text-xs"><span>Creator 40%</span><span>Content 10%</span><span>Platform 30%</span><span>Meteora 20%</span></div>
              </div>
            </div>
          )}
          {kind === "grow" && (
            <div className="absolute inset-0 grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-6">
              <div className="flex flex-col justify-center gap-2">
                <div className="ml-auto max-w-[85%] rounded-md border border-white/12 bg-white/[0.07] px-2.5 py-1.5 text-[11px] sm:text-xs">give her a storm to cross</div>
                <div className="max-w-[90%] rounded-md border px-2.5 py-1.5 text-[11px] sm:text-xs" style={{ borderColor: "rgba(215,255,0,0.5)", background: "rgba(215,255,0,0.08)" }}><span className="block text-[9px] font-semibold uppercase tracking-wider" style={{ color: LIME }}>Proposed</span>The Storm Crossing</div>
                <div className="ml-auto rounded-md border border-white/12 bg-white/[0.07] px-2.5 py-1.5 text-[11px] sm:text-xs">yes!!</div>
              </div>
              <div className="flex flex-col justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] p-2.5 sm:p-3">
                <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-400">Leaderboard · earnings</p>
                {[["1", "$LUNA", "+312%"], ["2", "$KAI", "+148%"], ["3", "$MOCHI", "+96%"]].map(([r, t, v]) => (
                  <div key={t} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2 py-1.5 text-[11px] sm:text-xs"><span className="font-mono text-zinc-500">{r}</span><span className="font-semibold">{t}</span><span className="ml-auto font-semibold tabular-nums" style={{ color: LIME }}>{v}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {caption && <figcaption className="mt-3 text-center text-[13px] text-neutral-400">{caption}</figcaption>}
    </figure>
  );
}
