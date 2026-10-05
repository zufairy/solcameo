"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useState } from "react";
import { VELLO_QUICK_START_VIDEO_ID } from "@/components/cofounder/scroll-video";
import styles from "./node.module.css";

const ClubScene = dynamic(() => import("../1b-club/club-scene"), { ssr: false });

export function NodeMembership() {
  return <div className={styles.membershipShowcase}>
    <div className={styles.membershipScene} aria-hidden="true"><span className={styles.membershipFallback}>VELLO<br /><em>BLACK</em><small>1 BILLION VIEWS</small></span><ClubScene mode="stack" paused={false} /></div>
    <div className={styles.membershipCopy}><p className={styles.eyebrow}>Earn your place</p><h3>Today, an operator.<br /><em>Tomorrow, a name<br />on the door.</em></h3><p>Your reach becomes your record. Build it one post at a time, climb the ranks, and work toward the invitation to Vello Black.</p><a href="#reserve" className={styles.cta}><span>Begin my ascent</span><i aria-hidden="true" /></a></div>
  </div>;
}

export function NodeFilm() {
  const [playing, setPlaying] = useState(false);
  return <div className={styles.filmFrame}>
    <div className={styles.filmFrieze} aria-hidden="true">Ⅰ · Ⅱ · Ⅲ · Ⅳ · Ⅴ</div>
    <div className={styles.filmScreen}>{playing ? <iframe src={`https://www.youtube.com/embed/${VELLO_QUICK_START_VIDEO_ID}?autoplay=1&playsinline=1&rel=0`} title="Vello Quick Start" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : <button type="button" onClick={() => setPlaying(true)} aria-label="Play Vello Quick Start video"><Image src="/node/ancient-builders.webp" alt="" fill sizes="(max-width: 960px) 90vw, 1000px" /><span className={styles.filmPlay} aria-hidden="true">▶</span><span className={styles.filmTitle}>See the work.<br /><em>Imagine your beginning.</em><small>Play the Vello Quick Start</small></span></button>}</div>
    <div className={styles.filmCaption}>The operator’s first lesson · Vello Quick Start</div>
  </div>;
}
