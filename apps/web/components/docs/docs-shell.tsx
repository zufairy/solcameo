"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import velloLogo from "@/assets/solcameo-dark.png";
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

/* ════════ Vello Docs — shared reading shell ════════
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
          <Image src={velloLogo} alt="Solcameo" priority className="h-5 w-auto sm:h-6" />
        </Link>

        <div className="flex items-center gap-2.5">
          {/* Segmented section nav — How to · Start · Build · Sell · Scale */}
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
        How to launch & earn
        <br />
        with Vello
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

/** Framed pixel-art figure — used on pages that want the hero artwork. */
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
