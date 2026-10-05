"use client";

import { useState, type ReactNode } from "react";
import { socialProfileUrl, type ConnectedSocialIdentity } from "@/lib/socialProfileUrl";

// Brand tints for the per-platform badge background.
export const PLATFORM_TINT: Record<string, string> = {
  tiktok: "bg-zinc-900",
  instagram: "bg-gradient-to-br from-fuchsia-500 to-amber-400",
  youtube: "bg-red-600",
  facebook: "bg-blue-600",
  linkedin: "bg-sky-700",
  x: "bg-zinc-900",
  threads: "bg-zinc-800",
  // Brand-accurate tints for the remaining upload-post platforms — each was
  // falling through to a plain grey first-letter badge (see uploadPost.ts ids).
  bluesky: "bg-[#0A7AFF]",
  reddit: "bg-[#FF4500]",
  pinterest: "bg-[#E60023]",
  telegram: "bg-[#229ED9]",
  discord: "bg-[#5865F2]",
  google_business: "bg-[#4285F4]",
};

// Real brand logos via the Simple Icons CDN (white glyph on the brand tint).
// Slugs map our platform ids → Simple Icons names.
export const PLATFORM_ICON_SLUG: Record<string, string> = {
  tiktok: "tiktok",
  instagram: "instagram",
  youtube: "youtube",
  facebook: "facebook",
  linkedin: "linkedin",
  x: "x",
  threads: "threads",
  // Verified present on the Simple Icons CDN (bluesky/reddit/pinterest/telegram/
  // discord all resolve). Google Business has no Simple Icons entry, so it uses
  // the official Google "G" glyph on a Google-blue tint — a real brand logo
  // instead of a bare letter. Any missing slug still degrades to the letter.
  bluesky: "bluesky",
  reddit: "reddit",
  pinterest: "pinterest",
  telegram: "telegram",
  discord: "discord",
  google_business: "google",
};

// Official inline logos for brands the Simple Icons CDN no longer serves
// (TikTok + Threads were pulled over trademark policy → were falling back to a
// plain letter). Glyph scales to half the badge (h-1/2 w-1/2) so one badge works
// at any size.
export const INLINE_LOGO: Record<string, ReactNode> = {
  tiktok: (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="currentColor" aria-hidden="true">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  ),
  threads: (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="currentColor" aria-hidden="true">
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.781 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.668-1.614 1.643-3.602 1.104-4.818-.314-.709-.882-1.301-1.643-1.753-.189 1.344-.625 2.435-1.302 3.255-.905 1.094-2.184 1.69-3.804 1.77-1.226.06-2.401-.231-3.31-.818-1.075-.696-1.703-1.756-1.768-2.985-.063-1.196.408-2.301 1.328-3.111.876-.773 2.119-1.225 3.583-1.31a13.998 13.998 0 0 1 3.02.142c-.126-.742-.375-1.332-.745-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.99.232-2.721 1.32l-1.738-1.21c.98-1.452 2.568-2.252 4.478-2.252h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Z" />
    </svg>
  ),
};

/** Which of our platform ids we can render a brand logo for. */
export function isKnownPlatform(id: string): boolean {
  return id in PLATFORM_TINT;
}

const PLATFORM_DISPLAY_NAME: Record<string, string> = {
  tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn",
  x: "X", threads: "Threads", bluesky: "Bluesky", reddit: "Reddit", pinterest: "Pinterest", telegram: "Telegram",
  discord: "Discord", google_business: "Google Business",
};
function platformLabelFor(id: string): string {
  return PLATFORM_DISPLAY_NAME[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Brand logo badge: inline SVG for TikTok/Threads, Simple Icons CDN otherwise,
 *  graceful first-letter fallback if the CDN icon fails. `className` overrides the
 *  size/ring (defaults to a size-7 badge). The glyph scales to the badge. */
export function PlatformBadge({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const inline = INLINE_LOGO[id];
  const slug = PLATFORM_ICON_SLUG[id];
  return (
    <span
      className={`relative shrink-0 flex items-center justify-center rounded-full overflow-hidden text-white font-bold ${PLATFORM_TINT[id] ?? "bg-zinc-500"} ${className ?? "size-7 text-[11px]"}`}
    >
      {inline ? (
        inline
      ) : slug && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.simpleicons.org/${slug}/white`}
          alt={label}
          className="h-1/2 w-1/2 object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-[0.6em] leading-none">{label.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/**
 * Premium overlapping cluster of the brand logos for an agent's CONNECTED social
 * accounts — e.g. Instagram + X render as two circles stacked over each other.
 * Dynamic: renders nothing when no known platforms are connected. Designed to sit
 * as an `absolute top-1.5 right-1.5` overlay on a card cover image.
 */
export function ConnectedPlatformStack({
  platforms,
  accounts,
  max = 4,
  badgeClassName = "size-6",
  className,
  ringClassName = "ring-black/40",
}: {
  platforms?: string[] | null;
  /** Real per-platform connected identity (from influencers.connectedSocialAccounts),
   *  keyed by platform id. When a badge's platform resolves a real profile URL from
   *  this (see lib/socialProfileUrl), the badge becomes a clickable link that opens
   *  that actual account in a new tab — hover affordance included. Omit this prop to
   *  keep the old non-interactive badge-only look (every existing caller does, so
   *  nothing else changes behavior). */
  accounts?: Record<string, ConnectedSocialIdentity> | null;
  /** Show at most this many badges; the rest collapse into a "+N" chip. */
  max?: number;
  /** Size/appearance of each badge (the ring + shadow are added here). */
  badgeClassName?: string;
  className?: string;
  /** Separating ring between overlapping badges. Default suits a dark cover-image
   *  overlay; pass a card-background match (e.g. `ring-[#161618]`) on a solid panel. */
  ringClassName?: string;
}) {
  // Dedupe + keep only platforms we can render a logo for, in a stable order.
  const seen = new Set<string>();
  const list = (platforms ?? []).filter((p) => {
    if (!isKnownPlatform(p) || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  if (list.length === 0) return null;

  const shown = list.slice(0, max);
  const extra = list.length - shown.length;

  return (
    <div className={`flex items-center -space-x-1.5 ${className ?? ""}`} aria-label="Connected accounts">
      {shown.map((id, i) => {
        const url = accounts ? socialProfileUrl(id, accounts[id] ?? {}) : null;
        const badge = <PlatformBadge id={id} label={id} className={`${badgeClassName} text-[10px]`} />;
        const ringWrap = `rounded-full ring-2 ${ringClassName} shadow-[0_2px_6px_rgba(0,0,0,0.45)]`;
        return url ? (
          <a
            key={id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${platformLabelFor(id)} profile`}
            aria-label={`Open ${platformLabelFor(id)} profile in a new tab`}
            // stopPropagation: these badges sit inside cards that are themselves
            // clickable (a sibling <Link> to the agent's own page) — a click here
            // must open the social profile, not also fire the card's navigation.
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: shown.length - i }} // first platform sits on TOP of the stack
            className={`${ringWrap} cursor-pointer transition-transform duration-200 hover:z-10 hover:scale-110 focus-visible:z-10 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-white/60`}
          >
            {badge}
          </a>
        ) : (
          <span key={id} style={{ zIndex: shown.length - i }} className={ringWrap}>
            {badge}
          </span>
        );
      })}
      {extra > 0 && (
        <span
          style={{ zIndex: 0 }}
          className={`flex items-center justify-center rounded-full bg-black/70 text-white font-semibold ring-2 ${ringClassName} shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${badgeClassName} text-[9px]`}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
