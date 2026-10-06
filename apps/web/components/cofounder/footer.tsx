import Image from "next/image";
import Link from "next/link";
import { Lock, Heart } from "lucide-react";
import cofounderBg from "@/public/cofounder-bg.png";

/* ── Footer ──────────────────────────────────────────────────────────────────
   Editorial, light footer: a big muted wordline + docs/link columns and socials
   on the left, a pixel-art promo card on the right, and a pixel-grass sign-off
   band across the bottom. */

const INTER = { fontFamily: "var(--font-inter)" } as const;

const DOCS = [
  { label: "How to start", href: "/docs/start" },
  { label: "How to create", href: "/docs/build" },
  { label: "How to launch", href: "/docs/launch" },
  { label: "How to grow", href: "/docs/grow" },
];

const COL_ONE = [
  { label: "Homepage", href: "/" },
  { label: "About Vello", href: "/about" },
  {
    label: "Funding Opportunities",
    href: "mailto:syakir@vello.gg?subject=Investment%20Enquiry&body=Hi%20Vello%20team%2C%0A%0AI%27d%20like%20to%20talk%20about%20investing%20in%20Vello.%0A%0A",
  },
  { label: "Careers", href: "/hiring" },
];
const COL_TWO = [
  // Product + comparison links in every footer — crawlable internal links with
  // the same labels as the nav (sitelink signal).
  { label: "Shorts Agent", href: "/clipping" },
  { label: "Creator Agents", href: "/ai-influencer" },
  { label: "Blog", href: "/blog" },
  { label: "Vello Agents vs OpusClip", href: "/vs/opusclip" },
  { label: "Privacy Policy", href: "/docs" },
  { label: "Terms of Service", href: "/docs" },
  { label: "Docs", href: "/docs" },
];

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/** Chunky pixel-grass silhouette + sign-off band. */
function PixelGrass() {
  const COLS = 64;
  // Deterministic blade heights (30–100% of the strip) — no Math.random so SSR
  // and client match.
  const blades = Array.from({ length: COLS }, (_, i) => 34 + ((i * 41) % 67));
  return (
    <div className="mt-20">
      <div className="flex h-9 items-end" aria-hidden>
        {blades.map((h, i) => (
          <div
            key={i}
            className="flex-1"
            style={{ height: `${h}%`, background: i % 5 === 0 ? "#8fd14f" : i % 2 === 0 ? "#6cb536" : "#7cc142" }}
          />
        ))}
      </div>
      <div className="bg-[#6cb536] py-3.5 text-center">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/95">
          Made with <Heart className="size-3.5 fill-white/95 text-white/95" aria-label="love" /> by the Vello team
        </p>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-[#f4f3ef] text-neutral-900" style={INTER}>
      <div className="mx-auto max-w-[1280px] px-6 pt-24 sm:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_0.6fr]">
          {/* Left — wordline, docs, links, socials, badges */}
          <div>
            <h2 className="max-w-md text-[clamp(1.9rem,3.4vw,2.9rem)] font-normal leading-[1.05] tracking-[-0.02em] text-neutral-400">
              One video in,<br className="hidden sm:block" /> hundreds of clips <span className="text-neutral-950">cut, captioned, and posted.</span>
            </h2>

            {/* Docs tabs — one frosted-glass container grouping every "How to" link.
                Hidden on mobile (the same links live in the columns below). */}
            <div className="mt-8 hidden flex-wrap items-center gap-0.5 rounded-xl border border-black/[0.08] bg-white/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-xl sm:inline-flex">
              <span className="px-3 py-1 text-[13px] font-medium text-neutral-400">How to</span>
              {DOCS.map((d) => (
                <span key={d.href} className="flex items-center">
                  <span aria-hidden className="mx-0.5 h-3.5 w-px bg-black/10" />
                  <Link
                    href={d.href}
                    className="rounded-lg px-3 py-1 text-[13px] font-medium text-neutral-700 outline-none transition-colors hover:bg-black/[0.05] hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-400"
                  >
                    {d.label}
                  </Link>
                </span>
              ))}
            </div>

            {/* Link columns */}
            <div className="mt-8 grid max-w-md grid-cols-2 gap-x-8 gap-y-3 text-[15px]">
              {[COL_ONE, COL_TWO].map((col, ci) => (
                <ul key={ci} className="space-y-3">
                  {col.map((l) => {
                    const cls =
                      "rounded text-neutral-700 outline-none transition-colors hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-400";
                    // mailto/external links open natively; internal ones use Link.
                    const external = l.href.startsWith("mailto:") || l.href.startsWith("http");
                    return (
                      <li key={l.label}>
                        {external ? (
                          <a href={l.href} className={cls}>
                            {l.label}
                          </a>
                        ) : (
                          <Link href={l.href} className={cls}>
                            {l.label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>

            {/* Socials */}
            <div className="mt-8 flex items-center gap-2.5">
              <a
                href="https://x.com/velloagents"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Vello on X"
                className="grid size-10 place-items-center rounded-xl border border-black/[0.08] bg-white text-neutral-800 shadow-sm outline-none transition-colors hover:border-black/20 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                <XIcon className="size-4" />
              </a>
              <a
                href="https://www.linkedin.com/company/velloagents"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Vello on LinkedIn"
                className="grid size-10 place-items-center rounded-xl border border-black/[0.08] bg-white text-neutral-800 shadow-sm outline-none transition-colors hover:border-black/20 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                <LinkedinIcon className="size-[18px]" />
              </a>
            </div>

            {/* Badges + legal */}
            <div className="mt-8 space-y-2 text-[13px] text-neutral-400">
              <p className="flex items-center gap-2">
                Automate with
                <span className="inline-flex items-center gap-1 rounded-md border border-black/[0.08] bg-white px-1.5 py-0.5 font-semibold text-neutral-700 shadow-sm">
                  <Lock className="size-3" /> SOC 2
                </span>
                compliant security
              </p>
              <p>Copyright © 2026 Vello Agents. Long videos into viral shorts, posted daily.</p>
            </div>
          </div>

          {/* Right — promo card. The artwork fills the entire card as a
              background; the copy overlays the bottom on a soft gradient. */}
          <div className="relative min-h-[440px] overflow-hidden rounded-3xl border border-black/[0.08] bg-emerald-950 shadow-[0_28px_70px_-30px_rgba(0,0,0,0.3)] lg:min-h-full">
            <Image src={cofounderBg} alt="" aria-hidden fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" style={{ objectPosition: "center 55%" }} />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-emerald-950/90 via-emerald-900/55 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
              <p className="max-w-sm text-[clamp(1.05rem,1.6vw,1.35rem)] font-medium leading-snug text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.35)]">
                Vello Agents never stops posting.
                <span className="text-white/70"> Turn one video into ten clips, captioned and scheduled automatically.</span>
              </p>
              <Link
                href="/builder"
                className="mt-4 inline-flex items-center rounded-lg bg-white px-3.5 py-2 text-[13px] font-semibold text-neutral-900 shadow-sm outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-900"
              >
                Start Now
              </Link>
            </div>
          </div>
        </div>
      </div>

      <PixelGrass />
    </footer>
  );
}
