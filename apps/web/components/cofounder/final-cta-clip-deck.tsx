"use client";

import { memo, useRef } from "react";
import Image from "next/image";
import { motion, useInView, useReducedMotion } from "framer-motion";
import podcastImage from "@/assets/case-agency.png";
import creatorImage from "@/assets/case-influencer.jpg";
import storyImage from "@/assets/case-event.jpeg";

const CLIPS = [
  { image: podcastImage, label: "PODCAST", number: "01", position: "50% center", tilt: -13, turn: -7, delay: 0.2 },
  { image: creatorImage, label: "CREATOR", number: "02", position: "center", tilt: 0, turn: 0, delay: 0 },
  { image: storyImage, label: "STORY", number: "03", position: "center", tilt: 13, turn: 7, delay: 0.4 },
] as const;

export const FinalCtaClipDeck = memo(function FinalCtaClipDeck() {
  const deckRef = useRef<HTMLDivElement>(null);
  const inView = useInView(deckRef, { amount: 0.2 });
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <div
      ref={deckRef}
      role="img"
      aria-label="One long video becomes three vertical clips in podcast, creator, and story styles"
      className="relative mx-auto mt-10 h-[310px] w-full max-w-[1080px] overflow-hidden rounded-[28px] border border-white/10 bg-[#182019] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] sm:mt-14 sm:h-[440px] sm:rounded-[36px]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_50%_65%,rgba(178,212,112,0.16),transparent_52%),linear-gradient(135deg,#202a21,#131814_75%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div aria-hidden className="absolute inset-x-5 top-5 flex items-center justify-between gap-3 text-[9px] font-semibold tracking-[0.16em] text-white/65 sm:inset-x-10 sm:top-8 sm:text-[11px]">
        <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 backdrop-blur-sm">ONE SOURCE VIDEO</span>
        <span className="flex items-center gap-2 text-[#d6eba8]"><span className="size-1.5 rounded-full bg-[#c6e685]" /> THREE DISTINCT CUTS</span>
      </div>

      <div aria-hidden className="absolute inset-x-0 bottom-0 top-[54px] flex items-center justify-center [perspective:1000px] sm:top-[62px]">
        {CLIPS.map((clip, index) => (
          <motion.div
            key={clip.number}
            className={`relative h-[188px] w-[88px] shrink-0 overflow-hidden rounded-[15px] border border-white/30 bg-[#252e27] shadow-[0_24px_45px_-16px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.24)] min-[380px]:h-[210px] min-[380px]:w-[107px] sm:h-[342px] sm:w-[192px] sm:rounded-[25px] ${index === 1 ? "z-10 -mx-3 h-[218px] w-[110px] min-[380px]:h-[238px] min-[380px]:w-[126px] sm:-mx-6 sm:h-[370px] sm:w-[220px]" : "z-0"}`}
            animate={inView && !reducedMotion
              ? { y: [0, index === 1 ? -8 : -5, 0], rotateY: clip.tilt, rotateZ: clip.turn }
              : { y: 0, rotateY: clip.tilt, rotateZ: clip.turn }}
            transition={inView && !reducedMotion
              ? { duration: 5.2 + index * 0.35, repeat: Infinity, ease: "easeInOut", delay: clip.delay }
              : { duration: 0.25 }}
          >
            <Image src={clip.image} alt="" fill sizes="(max-width: 639px) 33vw, 220px" className="object-cover" style={{ objectPosition: clip.position }} />
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/85" />
            <div className="absolute inset-x-2 top-2 flex items-center justify-between text-[8px] font-semibold tracking-[0.14em] text-white/90 sm:inset-x-4 sm:top-4 sm:text-[10px]">
              <span>VELLO / {clip.number}</span><span className="size-1.5 rounded-full bg-[#c6e685]" />
            </div>
            <div className="absolute inset-x-2 bottom-3 text-left sm:inset-x-4 sm:bottom-6">
              <p className="text-[9px] font-bold leading-tight tracking-[0.03em] text-white sm:text-[15px]">
                {index === 0 ? <>THE MOMENT<br /><span className="text-[#c6e685]">LANDS</span></> : index === 1 ? <>MAKE EVERY<br /><span className="text-[#c6e685]">SECOND COUNT</span></> : <>A STORY<br /><span className="text-[#c6e685]">WORTH SHARING</span></>}
              </p>
              <div className="mt-2 flex items-center gap-1.5 sm:mt-4">
                <span className="h-0.5 w-1/3 rounded-full bg-[#c6e685]" /><span className="h-0.5 flex-1 rounded-full bg-white/35" />
              </div>
              <p className="mt-1.5 text-[7px] font-semibold tracking-[0.14em] text-white/75 sm:mt-2 sm:text-[9px]">{clip.label} CUT</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div aria-hidden className="absolute bottom-5 left-7 hidden rounded-xl border border-white/15 bg-[#1a231b]/85 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md lg:block">
        <p className="text-[9px] font-semibold tracking-[0.16em] text-[#c6e685]">SMART REFRAME</p>
        <p className="mt-1 text-xs text-white/70">Every clip, vertical-ready</p>
      </div>
      <div aria-hidden className="absolute bottom-5 right-7 hidden rounded-xl border border-white/15 bg-[#1a231b]/85 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md lg:block">
        <p className="text-[9px] font-semibold tracking-[0.16em] text-[#c6e685]">CAPTIONS BURNED IN</p>
        <p className="mt-1 text-xs text-white/70">Ready for every feed</p>
      </div>
    </div>
  );
});
