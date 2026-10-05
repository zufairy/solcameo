"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import velloLogo from "@/assets/lo.png";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./club.module.css";

const Scene = dynamic(() => import("./club-scene"), {
  ssr: false,
  loading: () => <div className={styles.sceneFallback} aria-hidden="true"><div className={styles.fallbackCard}><span>VELLO <b>BLACK</b></span><strong>1B</strong><small>BY INVITATION. BY ACHIEVEMENT.</small></div></div>,
});
const MotionContext = createContext({ paused: false, toggle: () => {} });

export function ClubExperience({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const targets = el.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.visible = "true"; observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    targets.forEach(target => {
      if (target.getBoundingClientRect().top < window.innerHeight || reduced.matches) target.dataset.visible = "true";
      else observer.observe(target);
    });
    el.dataset.enhanced = "true";
    const visibility = () => { el.dataset.hidden = String(document.hidden); };
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <MotionContext.Provider value={{ paused, toggle: () => setPaused(value => !value) }}><div ref={root} className={styles.experience} data-paused={paused}>{children}</div></MotionContext.Provider>;
}

export function ClubNavigation() {
  const [open, setOpen] = useState(false);
  const { paused, toggle } = useContext(MotionContext);
  return <header className={styles.header}>
    <div className={styles.navInner}>
      <Link href="/home" className={styles.brand} aria-label="Vello home"><Image src={velloLogo} alt="Vello" priority /><span /> <b>BLACK</b></Link>
      <nav className={`${styles.navLinks} ${open ? styles.navOpen : ""}`} aria-label="Club navigation">
        <Link href="/home" onClick={() => setOpen(false)}>Home</Link>
        {[["The club", "#club"], ["The tiers", "#tiers"], ["The privileges", "#privileges"], ["The world", "#world"], ["Your recognition", "#recognition"]].map(([label, href]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>)}
      </nav>
      <div className={styles.navActions}>
        <button className={styles.motionButton} onClick={toggle} type="button" aria-label={paused ? "Play animations" : "Pause animations"} aria-pressed={paused}><svg viewBox="0 0 16 16" aria-hidden="true">{paused ? <path d="M5 3l7 5-7 5Z" /> : <path d="M5 3v10M11 3v10" />}</svg></button>
        <a href="#admission" className={styles.navCta}>The way in <span aria-hidden="true">↗</span></a>
        <button className={styles.menuButton} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close club menu" : "Open club menu"} type="button"><span /><span /></button>
      </div>
    </div>
  </header>;
}

export function MembershipVisual({ mode = "card" }: { mode?: "card" | "globe" | "stack" | "mark" | "syndicate" }) {
  const { paused } = useContext(MotionContext);
  return <Scene mode={mode} paused={paused} />;
}

/** A static, cropped-to-just-the-mark stamp — no WebGL. Reuses `mode="mark"`'s
 *  own loading-fallback crop (already proven to isolate just the icon, no
 *  wordmark), for spots like the hardware engraving where a full three.js
 *  context per instance is unnecessary: a small stamped/engraved logo doesn't
 *  need to be interactive, and this sidesteps a real issue found in testing —
 *  a heavily CSS-3D-rotated ancestor (the drive mockup's own perspective
 *  transform) made that particular IntersectionObserver-gated canvas'
 *  visibility state flicker, freezing its render loop mid-assembly. */
export function EngravedMark({ className }: { className?: string }) {
  return (
    <span className={[styles.fallbackMarkCrop, className].filter(Boolean).join(" ")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={velloLogo.src} alt="" className={styles.fallbackMark} />
    </span>
  );
}

/** Live network reach for the hero — the honest FOMO: real total views on
 *  Vello right now, against the one number that opens the club. */
export function NetworkPulse() {
  const totals = useQuery(api.platformStats.live);
  const views = totals?.totalViews;
  return <div className={styles.networkPulse}>
    <span className={styles.pulseDot} aria-hidden="true" />
    <span>LIVE</span>
    <b>{views === undefined || views === null ? "—" : views.toLocaleString("en-US")}</b>
    <span>views generated on Vello · the first Black seat is still open</span>
  </div>;
}

const TIER_LADDER = [
  { label: "Member", need: "0+", color: "#6BFFB8" },
  { label: "Silver", need: "100K", color: "#8FE3FF" },
  { label: "Gold", need: "1M", color: "#FFC94A" },
  { label: "Platinum", need: "10M", color: "#D6A6FF" },
  { label: "Vello Black", need: "1B", color: "#E8C77A" },
];

/** The ladder the stack illustrates — each tier and the views that unlock it. */
export function TierLadder() {
  return <ol className={styles.tierLadder} id="tiers">{TIER_LADDER.map((t, i) => <li key={t.label} style={{ ["--tier" as string]: t.color }}><span>0{i + 1}</span><b>{t.label}</b><em>{t.need}{t.need === "0+" ? "" : "+"} views</em></li>)}</ol>;
}

const briefPanels = [
  { name: "Overview", title: "Global consumer launch", detail: "A brand with a worldwide audience. An operator with the systems to reach it.", rows: [["Campaign volume", "500 videos"], ["Distribution", "4 markets"], ["Mandate", "Creative + execution"]] },
  { name: "Scope", title: "Run the whole operation", detail: "Build the content engine, manage agents, oversee quality, and report on performance.", rows: [["Your role", "Lead operator"], ["Production", "Agent-powered"], ["Reporting", "Weekly insights"]] },
  { name: "Selection", title: "Introductions with intent", detail: "Vello matches a brief to proven member expertise. The right fit opens the conversation.", rows: [["Access", "Black members"], ["Selection", "Performance + fit"], ["Terms", "Agreed per campaign"]] },
];

export function DealBrief() {
  const [selected, setSelected] = useState(0);
  const panel = briefPanels[selected];
  return <div className={styles.dealStack}>
    <div className={styles.dealShadowOne} /><div className={styles.dealShadowTwo} />
    <div className={styles.dealCard}>
      <div className={styles.dealTop}><span>VELLO SYNDICATE</span><span className={styles.privateLabel}>PRIVATE MANDATE</span></div>
      <div className={styles.dealValue}><span>ILLUSTRATIVE MONTHLY RETAINER</span><strong>$50,000<small>/ mo</small></strong></div>
      <div className={styles.dealTabs} role="tablist" aria-label="Campaign brief">
        {briefPanels.map((item, i) => <button key={item.name} type="button" role="tab" id={`brief-tab-${i}`} aria-selected={selected === i} aria-controls={`brief-panel-${i}`} tabIndex={selected === i ? 0 : -1} onClick={() => setSelected(i)} onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = (i + (event.key === "ArrowRight" ? 1 : 2)) % 3; setSelected(next); document.getElementById(`brief-tab-${next}`)?.focus(); }
        }}>{item.name}</button>)}
      </div>
      <div className={styles.dealPanel} key={panel.name} role="tabpanel" id={`brief-panel-${selected}`} aria-labelledby={`brief-tab-${selected}`}><h3>{panel.title}</h3><p>{panel.detail}</p><dl>{panel.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div>
      <div className={styles.dealBottom}><span className={styles.smallSeal}>V/B</span><p>Introduced by Vello.<br /><b>Operated by you.</b></p><span aria-hidden="true">↗</span></div>
    </div>
  </div>;
}

const experiences = [
  { label: "Private dinners", heading: "A smaller table. A bigger conversation.", text: "Intimate, invitation-only evenings with creators, founders, and operators. The kind of introductions that rarely happen in a public group chat." },
  { label: "Global gatherings", heading: "Your circle, without borders.", text: "Member meetups and curated experiences around the world's creative capitals. Arrive in a new city with a reason to be there—and people worth meeting." },
  { label: "Operator sessions", heading: "The playbooks behind the performance.", text: "Closed-door sessions to exchange systems, compare strategies, and work through the problems that come with serious scale." },
];

export function WorldExperiences() {
  const [selected, setSelected] = useState(0);
  return <div className={styles.worldExperiences}>
    <div className={styles.experienceTabs} aria-label="Club experiences">{experiences.map((experience, i) => <button type="button" key={experience.label} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>0{i + 1}</span>{experience.label}<span aria-hidden="true">↗</span></button>)}</div>
    <div className={styles.experienceDescription} key={selected} aria-live="polite"><h3>{experiences[selected].heading}</h3><p>{experiences[selected].text}</p></div>
  </div>;
}

export function ClubQuestions() {
  const questions = [
    ["How do I get invited?", "Build with Vello and reach one billion cumulative verified views. Vello reviews the milestone and account before extending a personal invitation to Black membership."],
    ["Can I buy my way in?", "No. The 1B Club is earned through verified performance. Membership is by invitation, with no public checkout for access."],
    ["Are brand retainers guaranteed?", "No. Syndicate introductions depend on available briefs, your expertise, and the brand's selection. The $50,000 / 500-video brief is an illustration of the programme, not an available offer or a promise of income."],
    ["What is included in the membership?", "The club vision includes private events, curated deal flow, an operator network, podcast and editorial opportunities, a personal vello.black portfolio, and a physical milestone award. Specific benefits, destinations, and fulfilment are confirmed with your invitation."],
  ];
  return <div className={styles.faq}>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>;
}
