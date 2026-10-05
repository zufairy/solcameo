"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GalleryHorizontal, ImagePlus, Video } from "lucide-react";
import { GenerateTab } from "./GenerateTab";
import { VideosTab } from "../videos/VideosTab";
import { PhotoCarouselTab } from "../carousel/PhotoCarouselTab";
import type { SavedCharacter } from "@/lib/character/types";

export type GenerateMode = "photo" | "video" | "carousel";

const MODES = [
  { id: "photo" as const, label: "Photo", icon: ImagePlus },
  { id: "video" as const, label: "Video", icon: Video },
  { id: "carousel" as const, label: "Carousel", icon: GalleryHorizontal },
];

/** One page for every generator: Photo / Video / Carousel behind a glass switch. */
export function GenerateHub({
  mintAddress, sessionId, avatarUrl, mode, onModeChange,
}: {
  mintAddress?: string; sessionId?: string; avatarUrl?: string; mode: GenerateMode; onModeChange: (m: GenerateMode) => void;
}) {
  // The AI influencer the user built in the Character tab, offered as a selectable face in every mode.
  const [character, setCharacter] = useState<SavedCharacter | null>(null);
  useEffect(() => {
    if (!mintAddress) return;
    let live = true;
    fetch(`/api/character?mint=${encodeURIComponent(mintAddress)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { character?: SavedCharacter | null } | null) => { if (live) setCharacter(d?.character ?? null); })
      .catch(() => { /* no character yet */ });
    return () => { live = false; };
  }, [mintAddress]);

  const characterImages = useMemo(() => {
    if (!character) return [];
    const seen = new Set<string>();
    return [character.image, ...character.candidates]
      .filter((c) => c?.url && !seen.has(c.url) && seen.add(c.url))
      .slice(0, 12)
      .map((c, i) => ({ url: c.url, label: i === 0 ? "Influencer" : "Take" }));
  }, [character]);

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 flex justify-center px-4 pb-1 pt-5">
        <div role="tablist" aria-label="Generate" className="relative flex gap-1 rounded-full border border-white/[0.08] bg-black/50 p-1 backdrop-blur-xl">
          {MODES.map((m) => {
            const on = mode === m.id;
            const Icon = m.icon;
            return (
              <button key={m.id} role="tab" aria-selected={on} onClick={() => onModeChange(m.id)}
                className={`relative flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold transition-colors ${on ? "text-black" : "text-zinc-400 hover:text-white"}`}>
                {on && <motion.span layoutId="generate-mode-pill" className="absolute inset-0 rounded-full bg-[#D4F53C] shadow-[0_6px_20px_-8px_rgba(212,245,60,0.7)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <Icon className="relative size-4" /><span className="relative">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "photo" && <GenerateTab mintAddress={mintAddress} sessionId={sessionId} avatarUrl={avatarUrl} characterImages={characterImages} />}
        {mode === "video" && <VideosTab mintAddress={mintAddress} characterImages={characterImages} />}
        {mode === "carousel" && <PhotoCarouselTab mintAddress={mintAddress} sessionId={sessionId} />}
      </div>
    </div>
  );
}
