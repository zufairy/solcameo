"use client";

import { useEffect, useRef } from "react";

/** A real clip from the public feed. */
export type Clip = { id: string; videoUrl: string; caption: string; viralScore: number | null; agentName: string; agentAvatar: string };

/** The hero illustrations only ever show English content from this agent. */
export const SHOWCASE_AGENT = /solana\s*call/i;
export const isShowcaseClip = (c: Pick<Clip, "agentName">) => SHOWCASE_AGENT.test(c.agentName);

/** A muted looping clip that only plays while its scene is on screen. */
export function ClipVideo({ clip, playing, className, fit = "cover" }: { clip?: Clip; playing: boolean; className?: string; fit?: "cover" | "contain" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.play().catch(() => {}); else v.pause();
  }, [playing, clip?.videoUrl]);
  if (!clip) return <div className={`bg-[linear-gradient(160deg,#243024,#0f130f)] ${className ?? ""}`} />;
  return (
    <video ref={ref} src={`${clip.videoUrl}#t=0.5`} muted playsInline loop preload={playing ? "auto" : "metadata"}
      className={`${fit === "cover" ? "object-cover" : "object-contain"} ${className ?? ""}`} />
  );
}

/** Official Google Drive mark (multi-colour). */
export function DriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" aria-hidden className={className}>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}
