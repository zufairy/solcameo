"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import cofounderBg from "@/public/cofounder-bg.png";

/* Animated hero backdrop — a looping 8-bit pixel-art scene (Higgsfield). The
   static PNG is the poster (instant first paint + fallback) and is shown outright
   to reduced-motion users so nothing moves for them. */
export function HeroBackground() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);

  // React's `muted` JSX attr doesn't reliably set the DOM property, so muted
  // autoplay can get blocked. Force muted + play() on mount to guarantee it runs.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    const p = v.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, []);

  if (reduce) {
    return (
      <Image
        src={cofounderBg}
        alt=""
        aria-hidden
        priority
        fill
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "70% 50%" }}
      />
    );
  }

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster={cofounderBg.src}
      aria-hidden
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: "70% 50%" }}
    >
      <source src="/hero-bg.mp4" type="video/mp4" />
    </video>
  );
}
