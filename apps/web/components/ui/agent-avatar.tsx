"use client";

import { useState } from "react";
import { createAvatar } from "@dicebear/core";
import * as personas from "@dicebear/personas";

/**
 * Agent profile image with a graceful fallback.
 *
 * Renders `<img src={url}>` when the URL is a usable http(s)/data URL and the
 * browser can load it. If that fails, it tries any saved alternate images.
 * When no saved image works (onError — e.g. a host that answers 402/404), use
 * a deterministic generated portrait (dicebear, seeded by `seed` or `name`, so
 * the same agent always gets the same face everywhere). If even that fails it
 * renders the agent's initial on a gradient — never a broken-image icon.
 *
 * `className` is applied to BOTH the <img> and the fallback box so sizing,
 * rounding and rings stay identical across states.
 */
/**
 * Deterministic generated portrait for an agent — same seed, same face.
 * Rendered LOCALLY (dicebear npm) into a data URI: zero network requests, no
 * third-party rate limits (api.dicebear.com throttles a page with 60+ agents),
 * ~6KB per avatar. Memoized per seed for the life of the tab.
 */
const generatedCache = new Map<string, string>();
export function fallbackAvatarUrl(seed: string): string {
  const hit = generatedCache.get(seed);
  if (hit) return hit;
  const uri = createAvatar(personas, {
    seed,
    backgroundColor: ["1f2126", "2a2d34", "3a3d46"],
    backgroundType: ["gradientLinear"],
  }).toDataUri();
  generatedCache.set(seed, uri);
  return uri;
}

export function AgentAvatar({
  url,
  alternateUrls,
  name,
  seed,
  className = "",
  initialClassName = "text-4xl",
  alt,
}: {
  url?: string | null;
  /** Other saved images to try if the primary avatar is unavailable. */
  alternateUrls?: readonly string[] | null;
  name?: string | null;
  /** Stable identity key (mint address preferred). Defaults to `name`. */
  seed?: string | null;
  className?: string;
  initialClassName?: string;
  alt?: string;
}) {
  // Track which URLs failed, so a new URL (e.g. after an avatar regen) gets a
  // fresh attempt without an effect + extra render.
  const [failed, setFailed] = useState<Record<string, true>>({});

  const candidates = [url, ...(alternateUrls ?? [])].filter((candidate): candidate is string =>
    typeof candidate === "string" && (/^https?:\/\//i.test(candidate) || candidate.startsWith("data:")));
  // Try the saved portrait first, then any saved stills. Do not permanently
  // block a host: a previously quota-restricted legacy host may recover.
  const primary = candidates.find((candidate) => !failed[candidate]) ?? null;

  const seedKey = (seed ?? name ?? "").trim();
  const generated = seedKey ? fallbackAvatarUrl(seedKey) : null;
  const src = primary ?? (generated && !failed[generated] ? generated : null);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? name ?? ""}
        className={className}
        onError={() => setFailed((f) => (f[src] ? f : { ...f, [src]: true }))}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900 ${className}`}
      role="img"
      aria-label={alt ?? name ?? ""}
    >
      <span className={`font-black leading-none text-white/60 ${initialClassName}`}>
        {name?.trim()?.[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}
