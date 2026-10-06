"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GalleryHorizontal, ImagePlus, Video } from "lucide-react";
import { GenerateTab } from "./GenerateTab";
import { GEN_PAGE_BG } from "./ui";
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
  mintAddress, sessionId, avatarUrl, agentName, mode, onModeChange,
}: {
  mintAddress?: string; sessionId?: string; avatarUrl?: string; agentName?: string; mode: GenerateMode; onModeChange: (m: GenerateMode) => void;
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
    <div className="flex min-h-full flex-1 flex-col" style={GEN_PAGE_BG}>
      <div className="sticky top-0 z-20 flex justify-center px-4 pb-2 pt-5 [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
        <div role="tablist" aria-label="Generate" className="relative flex gap-0.5 rounded-xl border border-white/[0.1] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {MODES.map((m) => {
            const on = mode === m.id;
            const Icon = m.icon;
            return (
              <button key={m.id} role="tab" aria-selected={on} onClick={() => onModeChange(m.id)}
                className={`relative flex items-center gap-2 rounded-lg px-5 py-2 text-[13px] font-semibold tracking-tight transition-colors ${on ? "text-black" : "text-zinc-400 hover:text-white"}`}>
                {on && <motion.span layoutId="generate-mode-pill" className="absolute inset-0 rounded-lg bg-[linear-gradient(180deg,#e8ff6a,#d4f53c_55%,#b9dc22)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_6px_18px_-6px_rgba(212,245,60,0.65)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <Icon className="relative size-4" /><span className="relative">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col [&>*]:flex-1">
        {mode === "photo" && <GenerateTab mintAddress={mintAddress} sessionId={sessionId} avatarUrl={avatarUrl} agentName={agentName} characterImages={characterImages} />}
        {mode === "video" && <VideosTab mintAddress={mintAddress} agentName={agentName} characterImages={characterImages} />}
        {mode === "carousel" && <PhotoCarouselTab mintAddress={mintAddress} sessionId={sessionId} agentName={agentName} avatarUrl={avatarUrl} />}
      </div>
    </div>
  );
}
