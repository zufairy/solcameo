import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { canonicalUrl } from "@/lib/seo";
import { ClubExperience, ClubNavigation, ClubQuestions, DealBrief, EngravedMark, MembershipVisual, NetworkPulse, TierLadder, WorldExperiences } from "./club-experience";
import styles from "./club.module.css";

export const metadata: Metadata = {
  title: { absolute: "The 1B Club — Vello Black" },
  description: "One billion views opens a different world. Discover Vello Black: private events, curated brand opportunities, a global operator circle, and recognition you can hold.",
  alternates: { canonical: canonicalUrl("/1b-club") },
  openGraph: { title: "The 1B Club — Vello Black", description: "Earn your place. Expand your world.", url: canonicalUrl("/1b-club"), images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello Black — The 1B Club" }] },
};

function Arrow() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16 16 4M4 4h12v12" stroke="currentColor" strokeWidth="1.2" /></svg>; }
function SectionLabel({ number, children }: { number: string; children: React.ReactNode }) { return <div className={styles.sectionLabel}><span>{number}</span><span>{children}</span></div>; }

const people = [
  { src: "portrait-1.webp", alt: "Portrait of a smiling man", word: "Independent minds." },
  { src: "portrait-2.webp", alt: "Portrait of a woman outdoors", word: "Extraordinary ambition." },
  { src: "team.webp", alt: "A creative team working together", word: "Shared momentum." },
  { src: "portrait-3.webp", alt: "Portrait of a creative professional", word: "A different perspective." },
  { src: "portrait-4.webp", alt: "Portrait of a smiling woman", word: "A wider world." },
];
const keys = ["esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "⌫", "tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "↵", "⇧", "A", "S", "D", "F", "G", "H", "J", "K", "L", "V", "⇧", "ctrl", "fn", "⌘", "alt", "", "", "", "", "←", "↓", "↑", "→"];

export default function OneBClubPage() {
  return <ClubExperience><div className={styles.page}>
    <ClubNavigation />
    <section className={styles.hero} id="club">
      <div className={styles.heroAtmosphere} aria-hidden="true" />
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span className={styles.tinyDiamond} /> THE 1B CLUB <span className={styles.labelDivider} /> BY INVITATION ONLY</div>
          <h1>A billion views.<br /><em>A different world.</em></h1>
          <p>You built the reach. Now enter the circle.<br />Vello Black is the private world for the operators<br className={styles.desktopBreak} /> who take Vello to one billion verified views.</p>
          <div className={styles.heroActions}><a href="#privileges" className={styles.solidButton}>Discover your privileges <Arrow /></a><a href="#admission" className={styles.quietLink}>How to earn your place <span>↗</span></a></div>
          <div className={styles.heroFootnote}><span className={styles.miniMonogram}>VB</span><span>Achievement is the invitation.<br /><b>Everything after it is possibility.</b></span></div>
        </div>
        <div className={styles.heroObject}>
          <span className={styles.objectEdition}>FIVE TIERS / ONE SUMMIT</span>
          <MembershipVisual mode="stack" />
          <div className={styles.objectCaption}><span>EVERY TIER. ONE INVITATION AT THE TOP.</span><span className={styles.objectHint}>HOVER TO FAN THE TIERS <span>↗</span></span></div>
        </div>
      </div>
      <NetworkPulse />
      <TierLadder />
      <div className={styles.heroRule}><div><span>THE THRESHOLD</span><strong>1,000,000,000 <small>verified views</small></strong></div><div><span>THE MEMBERSHIP</span><strong>Earned. Never bought.</strong></div><a href="#people">A world beyond the dashboard <span>↓</span></a></div>
    </section>

    <section className={styles.peopleSection} id="people">
      <div className={styles.sectionIntro} data-reveal><SectionLabel number="01">THE COMPANY YOU KEEP</SectionLabel><div className={styles.introSplit}><h2>Reach changes your numbers.<br /><em>The right circle changes everything.</em></h2><p>A private network of creators, founders, and operators who understand what it takes. People to build with. People to learn from. People worth knowing.</p></div></div>
      <div className={styles.peopleWindow} aria-label="Editorial portraits of creative people"><div className={styles.peopleTrack}>{[0, 1].map(copy => <div key={copy} className={styles.peopleGroup} aria-hidden={copy === 1 ? true : undefined}>{people.map((person, index) => <figure key={person.src} className={`${styles.person} ${index === 2 ? styles.personWide : ""}`}><Image src={`/1b-club/${person.src}`} alt={copy === 1 ? "" : person.alt} fill sizes="(max-width: 700px) 55vw, 24vw" /><figcaption>{person.word}</figcaption></figure>)}</div>)}</div></div>
      <div className={styles.peopleCaption}><span>THE THINKERS. THE BUILDERS. THE ONES WHO DO.</span><span>Editorial photography / The spirit of the club</span></div>
    </section>

    <section className={styles.privileges} id="privileges">
      <div className={styles.syndicateScene} aria-hidden="true"><MembershipVisual mode="syndicate" /></div>
      <div className={styles.sectionIntro} data-reveal><SectionLabel number="02">THE PRIVILEGES</SectionLabel><h2>Let your performance<br /><em>open bigger doors.</em></h2></div>
      <div className={styles.syndicateGrid}>
        <div className={styles.featureCopy} data-reveal><span className={styles.featureIndex}>I — DEAL FLOW & OPPORTUNITY</span><h3>The Vello<br /><em>Syndicate.</em></h3><p className={styles.featureLead}>You built the engine.<br />Now put it behind bigger brands.</p><p>When a major brand needs an operator for a high-volume campaign, Vello connects the brief to its Black members. You bring the execution. We bring the introduction.</p><div className={styles.featureLines}><span>Curated brand introductions</span><span>High-performance campaign mandates</span><span>Retainer opportunities matched to your expertise</span></div><a href="#admission" className={styles.quietLink}>Built for proven operators <Arrow /></a></div>
        <div className={styles.dealVisual} data-reveal><DealBrief /><p className={styles.visualNote}>Example opportunity. Campaigns, selection, and fees vary by brief.</p></div>
      </div>
    </section>

    <section className={styles.privateEvents}>
      <div className={styles.eventPhoto}><Image src="/1b-club/private-dinner.webp" alt="Guests sharing an evening at an intimate formal dinner" fill sizes="(max-width: 800px) 100vw, 55vw" /><div className={styles.photoShade} /><span className={styles.photoIndex}>THE OFFLINE CHAPTER</span><p>A seat at the table.<br /><em>A world of possibility.</em></p></div>
      <div className={styles.eventCopy} data-reveal><span className={styles.featureIndex}>II — INVITATION-ONLY EXPERIENCES</span><h2>Some rooms<br />are worth<br /><em>the flight.</em></h2><p>Private dinners. Global gatherings. Conversations that continue long after the evening ends. Your membership puts you in the room with people building at your level.</p><WorldExperiences /></div>
    </section>

    <section className={styles.worldSection} id="world">
      <div className={styles.worldCopy} data-reveal><SectionLabel number="03">A WORLDWIDE CIRCLE</SectionLabel><h2>One club.<br /><em>No borders.</em></h2><p>From a private table in London to a new connection in Singapore. The vision is global. The circle stays personal.</p><div className={styles.cityList}><span>LONDON</span><span>NEW YORK</span><span>DUBAI</span><span>SINGAPORE</span><span>TOKYO</span></div><small>Illustrative destinations. Member programming is announced privately.</small></div>
      <div className={styles.worldVisual}><MembershipVisual mode="globe" /><div className={styles.worldCoordinates}><span>THE WORLD IS YOUR NETWORK</span><span>EST. AT ONE BILLION VIEWS</span></div></div>
    </section>

    <section className={styles.recognitionSection} id="recognition">
      <div className={styles.sectionIntro} data-reveal><SectionLabel number="04">NAME. STATUS. RECOGNITION.</SectionLabel><div className={styles.introSplit}><h2>You earned it.<br /><em>Let the world know.</em></h2><p>A signature presence online. Something extraordinary on your desk. Recognition that lives beyond a number on a screen.</p></div></div>
      <div className={styles.recognitionGrid}>
        <article className={styles.portfolioFeature} data-reveal>
          <div className={styles.portfolioPreview} aria-label="Example Vello Black member portfolio"><div className={styles.browserBar}><span><i /><i /><i /></span><b>vello.black/yourname</b><span>↗</span></div><div className={styles.profileArt}><span>V / B</span><div className={styles.profileOrbit} /><strong>Your name.<br /><em>Your legacy.</em></strong><div className={styles.profileStats}><span>1B+<small>VERIFIED VIEWS</small></span><span>BLACK<small>MEMBER STATUS</small></span></div></div><span className={styles.previewLabel}>PORTFOLIO CONCEPT</span></div>
          <div className={styles.recognitionCopy}><span className={styles.featureIndex}>THE SIGNATURE ADDRESS</span><h3>A link that says more.</h3><p>Your own <strong>vello.black/yourname</strong> portfolio. Your work, your verified milestone, and your Black member identity—one distinctive digital business card.</p></div>
        </article>
        <article className={styles.awardFeature} data-reveal>
          <div className={styles.awardStage} aria-label="Illustration of a bespoke engraved one billion views milestone plaque"><div className={styles.awardLight} /><div className={styles.plaque}><span className={styles.plaqueShineSweep} aria-hidden="true" /><span>V E L L O &nbsp; B L A C K</span><div className={styles.plaqueMarkWrap} aria-hidden="true"><span className={styles.plaqueGlowRing} /><div className={styles.plaqueMark}><MembershipVisual mode="mark" /></div></div><div className={styles.plaqueEngraving}>1B</div><span className={styles.plaqueRule} /><small>PRESENTED TO</small><strong>YOUR NAME</strong><p>ONE BILLION VERIFIED VIEWS</p><span className={styles.plaqueSerial}>A REMARKABLE ACHIEVEMENT. A PERMANENT MARK.</span></div><span className={styles.previewLabel}>MILESTONE AWARD CONCEPT</span></div>
          <div className={styles.recognitionCopy}><span className={styles.featureIndex}>THE BILLION-VIEW PLAQUE</span><h3>A milestone you can hold.</h3><p>A bespoke, individually engraved award. Made for the studio, the office, and the moment you share what it took to get here.</p></div>
        </article>
      </div>
      <article className={styles.hardwareFeature} data-reveal><div className={styles.hardwareCopy}><span className={styles.featureIndex}>THE OPERATOR EDITION</span><h3>Tools with<br /><em>your name on them.</em></h3><p>A considered welcome collection: a custom mechanical keyboard mapped for Vello, or a matte-black engraved drive. Beautiful objects built for people who make things happen.</p><span className={styles.hardwareNote}>BESPOKE HARDWARE / PERSONAL ENGRAVING</span></div><div className={styles.hardwareStage} aria-label="Illustration of an engraved black drive and a custom Vello keyboard"><div className={styles.drive}><div className={styles.driveMarkWrap} aria-hidden="true"><EngravedMark /></div><span>VELLO / BLACK</span><strong>Made for<br /><em>your next billion.</em></strong><small>OPERATOR EDITION</small><i /></div><div className={styles.keyboard}><div className={styles.keyGrid}>{keys.map((key, i) => <span key={i} className={key === "V" ? styles.velloKey : ""}>{key}</span>)}</div><div className={styles.keyboardBrand}>VELLO BLACK <span>OPERATOR / 001</span></div></div></div></article>
    </section>

    <section className={styles.voiceSection}>
      <div className={styles.voiceGraphic} aria-hidden="true"><span>ON THE RECORD</span><div className={styles.waveform}>{Array.from({ length: 61 }, (_, i) => <i key={i} style={{ height: `${18 + Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.21)) * 105}px`, animationDelay: `${i * -0.09}s` }} />)}</div><div><b>VELLO</b><span>CONVERSATIONS<br />BEHIND THE BILLION</span></div></div>
      <div className={styles.voiceCopy} data-reveal><span className={styles.featureIndex}>V — A BIGGER PLATFORM</span><h2>Your story.<br /><em>More people listening.</em></h2><p>Podcast conversations. Member spotlights. Editorial features. You know how to create attention. We help put the person behind the performance in front of it.</p><div className={styles.voiceTags}><span>PODCAST ACCESS</span><span>MEMBER FEATURES</span><span>AMPLIFIED VISIBILITY</span></div></div>
    </section>

    <section className={styles.admission} id="admission">
      <div className={styles.admissionTop} data-reveal><SectionLabel number="05">THE WAY IN</SectionLabel><span className={styles.admissionBadge}>INVITATION ONLY</span></div>
      <div className={styles.admissionGrid}><div data-reveal><h2>A billion is<br /><em>just the beginning.</em></h2><p>Build something the world watches.<br />We&apos;ll make sure the right doors open next.</p><Link href="/builder" className={styles.solidButton}>Begin your journey <Arrow /></Link><Link href="/tournament" className={styles.admissionSecondary}>Explore the leaderboard <span>↗</span></Link></div><div className={styles.admissionSteps} data-reveal>{[["01", "Build your reach", "Create, distribute, and grow with your Vello agents."], ["02", "Cross one billion", "Reach one billion cumulative verified views on Vello."], ["03", "Receive your invitation", "Following verification and review, your next chapter opens."]].map(([number, title, text]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div></div>
      <ClubQuestions />
    </section>
    <footer className={styles.footer}><div className={styles.footerTop}><Link href="/home" className={styles.footerBrand} aria-label="Vello Black — home"><span className={styles.footerMark}><EngravedMark /></span></Link><span>THE 1B CLUB<br />BY INVITATION. BY ACHIEVEMENT.</span><span className={styles.footerLinks}><Link href="/home">Home</Link><Link href="/agents">Marketplace</Link><Link href="/tournament">Leaderboard</Link><a href="#club">Back to the top ↑</a></span></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Vello. All rights reserved.</span><span>Club benefits are confirmed with your invitation.</span><a href="https://unsplash.com" target="_blank" rel="noreferrer">Photography: Unsplash</a></div></footer>
  </div></ClubExperience>;
}
