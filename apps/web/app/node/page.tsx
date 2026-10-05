import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { nodeDisplay as display, nodeLabel as label, nodeBody as body, inter } from "@/lib/siteFonts";
import { canonicalUrl } from "@/lib/seo";
import NodeSky from "./node-sky";
import { NodeJourney } from "./node-journey";
import { NodeFilm, NodeMembership } from "./node-showcase";
import { NodePaths } from "./node-paths";
import pathStyles from "./node-paths.module.css";
import solanaLogo from "@/assets/logos/solana.svg";
import { ApplyForm, Countdown, Experience, HeroStats, LiveLedger, NodeNav, SocialProof, StickyCta, Tilt } from "./node-experience";
import { Icon, type IconName } from "./node-icons";
import styles from "./node.module.css";

const NodeConstellation = dynamic(() => import("./node-constellation"));
const NodeGlobe = dynamic(() => import("./node-globe"), { loading: () => <div className={styles.globe} aria-hidden="true" /> });


export const metadata: Metadata = {
  title: { absolute: "Become a Global Content Node, Vello Operators Call" },
  description: "Join the Vello Operators Call, every Friday at 9pm on webinar. Learn how to mint an agent, deploy it as a global content node and climb the ladder to Vello Black.",
  alternates: { canonical: canonicalUrl("/node") },
  openGraph: { title: "Vello Operators Call, Become a Global Content Node", description: "Every Friday, 9pm via webinar. Reserve your seat.", url: canonicalUrl("/node"), images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello Operators Call" }] },
};

const TIERS = [
  { name: "Member", views: "0", note: "The count begins." },
  { name: "Silver", views: "100K", note: "Verified reach." },
  { name: "Gold", views: "1M", note: "Certified creator." },
  { name: "Platinum", views: "10M", note: "The elite circle." },
  { name: "Vello Black", views: "1B", note: "By invitation only." },
];

function Star({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1c.6 5.6 2.4 9.4 11 11-8.6 1.6-10.4 5.4-11 11-.6-5.6-2.4-9.4-11-11C9.6 10.4 11.4 6.6 12 1Z" fill="currentColor" /></svg>;
}

/** One header pattern for every section: eyebrow between hairlines, serif title with an italic accent, optional lede. */
function Head({ eyebrow, children, lede, light = false }: { eyebrow: string; children: React.ReactNode; lede?: string; light?: boolean }) {
  return <header className={`${styles.head} ${light ? styles.headLight : ""}`}>
    <p className={styles.eyebrow} data-reveal><i aria-hidden="true" /><span>{eyebrow}</span><i aria-hidden="true" /></p>
    <h2 className={styles.h2} data-reveal>{children}</h2>
    {lede ? <p className={styles.lede} data-reveal>{lede}</p> : null}
  </header>;
}

/** Hand-painted sky: displaced ellipses that drift at three depths. */
function Sky() {
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: string, o: number) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} opacity={o} />;
  return <div className={styles.sky} aria-hidden="true">
    <svg width="0" height="0" className={styles.defs}><defs>
      <filter id="paint" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.026" numOctaves="3" seed="7" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G" /><feGaussianBlur stdDeviation="1.6" /></filter>
      <filter id="swirl" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.012" numOctaves="2" seed="3" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="140" xChannelSelector="R" yChannelSelector="B" /></filter>
    </defs></svg>
    <div className={styles.skyGlow} />
    <svg className={`${styles.cloudLayer} ${styles.cl1}`} viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice"><g filter="url(#swirl)" opacity=".26"><path d="M-100 160C200 60 420 260 700 150S1180 40 1700 170" stroke="#d7e6f7" strokeWidth="34" fill="none" strokeLinecap="round" /><path d="M-100 330C260 230 520 420 880 310S1300 240 1700 340" stroke="#8db3de" strokeWidth="46" fill="none" strokeLinecap="round" /><path d="M-100 520C300 430 600 600 960 500S1380 450 1700 540" stroke="#cfe0f3" strokeWidth="30" fill="none" strokeLinecap="round" /></g></svg>
    <svg className={`${styles.cloudLayer} ${styles.cl2}`} viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice"><g filter="url(#paint)">{blob(250, 120, 220, 70, "#fff4dc", .85)}{blob(420, 170, 170, 55, "#ffd89a", .8)}{blob(1250, 90, 260, 64, "#fff0d2", .8)}{blob(1420, 150, 190, 52, "#f7c07a", .75)}{blob(860, 250, 300, 60, "#e9f1fb", .6)}</g></svg>
    <svg className={`${styles.cloudLayer} ${styles.cl3}`} viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice"><g filter="url(#paint)">{blob(120, 560, 280, 90, "#ffd9a0", .9)}{blob(360, 620, 260, 70, "#f4b574", .8)}{blob(1330, 580, 300, 86, "#ffe0ae", .9)}{blob(1520, 640, 240, 70, "#f0a866", .8)}{blob(760, 650, 340, 60, "#fbeacb", .7)}</g></svg>
    <div className={styles.grain} />
  </div>;
}

const STEPS: [IconName, string, string, string][] = [
  ["mint", "I", "Mint", "Bring a Vello agent into the world. It is yours, with its own name, face, accounts and record."],
  ["deploy", "II", "Deploy", "Connect its channels and set it to work. It finds the moments worth keeping and publishes them, relentlessly."],
  ["earn", "III", "Earn", "Reach is counted honestly and rewarded. Every view a node earns is a step toward its next rank."],
];
const PERKS: [IconName, string, string][] = [
  ["badge", "Founding operator status", "Early nodes are marked on the network as the ones who were here first."],
  ["call", "A seat at every Friday call", "Live sessions with the team and the operators ahead of you on the ladder."],
  ["compass", "Priority onboarding", "Hands-on help to mint, connect and deploy your first node."],
  ["key", "First access", "New agent skills, templates and features reach operators before anyone else."],
  ["circle", "The operator circle", "A private room with the people actually running the network."],
  ["crown", "A path to Vello Black", "Recognition, membership cards and invitations as you climb each rank."],
];
const AGENDA: [IconName, string, string][] = [
  ["pulse", "The state of the network", "Live numbers, the week\u2019s leaders and what is working right now."],
  ["build", "A node, built in front of you", "From mint to first post, the whole path, with nothing skipped."],
  ["climb", "How operators climb", "The habits that separate the top of the ladder from the rest."],
  ["chat", "The open floor", "Bring your questions. Ask the operators who are already out ahead."],
];
const MARQUEE = ["Mint an agent", "Deploy a node", "Earn while the world sleeps", "Grow your business", "Climb the ladder", "Join the founding operators", "Every Friday \u00b7 9PM"];

export default function NodePage() {
  return <div className={`${display.variable} ${label.variable} ${body.variable} ${inter.variable}`}><Experience><NodeNav /><div className={styles.page}>
    {/* ───── The invitation ───── */}
    <section className={styles.hero} id="top">
      <div className={styles.heroBg} aria-hidden="true">
        <Sky />
        <div className={styles.historicalHero}><Image src="/node/ancient-builders.webp" alt="" fill sizes="(max-width: 600px) 150vh, 100vw" preload /></div>
        <NodeSky />
        <NodeConstellation />
        <div className={styles.heroWaves}>{[0, 1, 2].map(i => <span key={i} style={{ animationDelay: `${i * -2.6}s` }} />)}</div>
        <div className={styles.skyShade} />
      </div>
      <div className={styles.heroInner}>
        <p className={styles.pill} style={{ ["--d" as string]: "0s" }}><i aria-hidden="true" />Every Friday &middot; 9pm &middot; Live webinar</p>
        <h1 className={styles.title}>{["Vello", "Operators", "Call"].map((w, i) => <span key={w} style={{ ["--d" as string]: `${0.12 + i * 0.14}s` }}>{w}</span>)}</h1>
        <p className={styles.sub} style={{ ["--d" as string]: "0.6s" }}>Become a global content node.</p>
        <p className={styles.heroCopy} style={{ ["--d" as string]: "0.75s" }}>A weekly live call for people building with Vello agents. Mint one, put it to work, and join a network that never sleeps.</p>
        <div className={styles.heroActions} style={{ ["--d" as string]: "0.9s" }}>
          <a href="#reserve" className={styles.cta}><span>Reserve your seat</span><i aria-hidden="true" /></a>
          <a href="#watch" className={styles.ghost}><span aria-hidden="true">&#9654;</span>Watch the film</a>
        </div>
        <div className={styles.heroCd} style={{ ["--d" as string]: "1.05s" }}>
          <Countdown />
          <SocialProof />
        </div>
        <p className={styles.builtOn} style={{ ["--d" as string]: "1.2s" }}>Built on <Image src={solanaLogo} alt="Solana" width={20} height={20} /> Solana</p>
      </div>
      <HeroStats />
      <a href="#node" className={styles.scrollCue} aria-label="Scroll to learn more"><span /></a>
    </section>

    <div className={styles.marquee} aria-hidden="true"><div>{Array.from({ length: 2 }, (_, k) => <p key={k}>{MARQUEE.map((t) => <span key={t}><Star />{t}</span>)}</p>)}</div></div>

    {/* ───── What is a node ───── */}
    <section className={styles.parchment} id="node">
      <div className={styles.wrap}>
        <Head eyebrow="Chapter I" lede="One operator, one agent, one more point of light on the map. Each node studies what travels, cuts long videos into short ones, and posts them to the accounts it has been given, every day, in every time zone.">A node is an agent that <em>works while the world sleeps.</em></Head>
        <div className={styles.steps3}>
          {STEPS.map(([icon, n, h, p], i) => <article key={n} className={styles.card} data-reveal data-spot style={{ ["--i" as string]: i }}>
            <div className={styles.cardTop}><span className={styles.cardIcon}><Icon name={icon} /></span><span className={styles.cardNo}>{n}</span></div>
            <h3>{h}</h3><p>{p}</p>
          </article>)}
        </div>
      </div>
    </section>

    {/* ───── Live ledger ───── */}
    <section className={styles.dusk} id="ledger">
      <div className={styles.wrap}>
        <Head light eyebrow="Chapter II" lede="This is not a promise. It is a ledger, read live from the network. Every number below was a stranger&rsquo;s decision to begin, and the founding hour does not last.">The network, <em>this very hour.</em></Head>
        <div data-reveal><LiveLedger /></div>
      </div>
    </section>

    {/* ───── Choose a path ───── */}
    <section className={`${styles.parchment} ${pathStyles.section}`} id="paths">
      <div className={styles.wrap}>
        <Head eyebrow="Chapter III · The crossroads" lede="Two roads open. Curate the moments that matter, or create a character the world remembers. Both begin with a niche. Both grow through content.">Choose your <em>path.</em></Head>
        <NodePaths clippers={<div className={pathStyles.content}>
          <div className={pathStyles.pathCopy}>
            <p className={pathStyles.inscription}>Path I · The curator</p>
            <h3>One niche.<br />Grow accounts.<br /><em>Start earning.</em></h3>
            <p>Build an Agent Clipper around a subject you understand: fitness, gaming, business, or something entirely your own. Clip consistently in that same niche to grow your connected accounts into channels people return to.</p>
            <ol className={pathStyles.steps}>
              <li><span>I</span><div><h4>Choose your territory</h4><p>One niche, one audience, one clear reason to follow.</p></div></li>
              <li><span>II</span><div><h4>Clip your niche. Grow your accounts.</h4><p>Use your own or authorized footage. Your agent finds moments, cuts shorts and publishes to the channels you connect. Keep refining what resonates.</p></div></li>
              <li><span>III</span><div><h4>Join campaigns that fit</h4><p>Match your channel to relevant campaign briefs. Submit eligible content and earn according to each campaign’s approval and payout terms.</p></div></li>
            </ol>
            <div className={pathStyles.actions}><Link href="/builder?type=clipping" className={styles.cta}><span>Build my clipper</span><i aria-hidden="true" /></Link><a href="#reserve">Learn with us on Friday ↗</a></div>
          </div>
          <div className={pathStyles.clipExample}>
            <p className={pathStyles.inscription}>An illustrative operator playbook</p>
            <div className={pathStyles.nicheSeal}><span>I</span><h4>The niche<br /><em>builders</em></h4><small>Same niche · Every post</small></div>
            <div className={pathStyles.clipStrip}>{[["01", "Clip one niche", "Keep your feed focused."], ["02", "Grow accounts", "Build a returning audience."], ["03", "Start earning", "Join campaigns that fit."]].map(([n,h,p]) => <div key={n}><Image src="/node/ancient-builders.webp" alt="" fill sizes="(max-width: 600px) 28vw, 160px" /><span>{n}</span><b>{h}</b><p>{p}</p><i aria-hidden="true" /></div>)}</div>
            <p className={pathStyles.exampleNote}>A focused channel, not a random feed. Build trust first; join campaigns that make sense for that audience.</p>
            <Link href="/market" className={pathStyles.referenceLink}>Explore campaign opportunities ↗</Link>
          </div>
        </div>} influencers={<div className={pathStyles.content}>
          <div className={pathStyles.pathCopy}>
            <p className={pathStyles.inscription}>Path II · The creator</p>
            <h3>Create a character.<br /><em>Build its world.</em></h3>
            <p>We help you create an AI influencer with a recognizable look, voice and point of view, then grow it through a consistent stream of content. Give people someone they remember and a reason to come back.</p>
            <ol className={pathStyles.steps}>
              <li><span>I</span><div><h4>Define the identity</h4><p>Choose a niche, personality, visual references and voice. Make the character recognizable from one frame.</p></div></li>
              <li><span>II</span><div><h4>Create a repeatable series</h4><p>Keep the character consistent across original clips, recurring formats and the social channels you connect.</p></div></li>
              <li><span>III</span><div><h4>Grow through content</h4><p>Review audience response, refine the series and build toward suitable collaborations and campaign opportunities.</p></div></li>
            </ol>
            <div className={pathStyles.actions}><Link href="/builder?type=influencer" className={styles.cta}><span>Create my influencer</span><i aria-hidden="true" /></Link><a href="#reserve">Build with us on Friday ↗</a></div>
          </div>
          <div className={pathStyles.references}>
            <p className={pathStyles.inscription}>A reference from the wider creator world</p>
            <div className={pathStyles.referenceGrid}>
              <a href="/node/references/ross-creator-profile.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open the full Derek Mercer profile reference"><Image src="/node/references/ross-creator-profile.jpg" alt="Derek Mercer profile and recurring character videos, as shown in Ross’s X post" width={1170} height={2532} sizes="(max-width: 600px) 35vw, 200px" /></a>
              <figure><a href="/node/references/ross-content-grid.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open the full character reference sheet"><Image src="/node/references/ross-content-grid.jpg" alt="Character reference sheet showing the same hairstyle, outfit and appearance across multiple angles" width={1536} height={1024} sizes="(max-width: 600px) 48vw, 350px" /></a><figcaption>One identity. Many angles. A look viewers recognize.</figcaption><p>A character sheet gives each new piece of content the same visual starting point.</p></figure>
            </div>
            <p className={pathStyles.exampleNote}>Images from <a href="https://x.com/rossark0/status/2105362314761552051" target="_blank" rel="noopener noreferrer">@rossark0’s post ↗</a>. External inspiration, not a Vello customer result. The metrics shown are from the source screenshot; growth and earnings vary.</p>
          </div>
        </div>} />
        <p className={pathStyles.closing}>You do not need a fleet to begin. You need a direction.</p>
      </div>
    </section>

    {/* ───── Perks ───── */}
    <section className={styles.parchment} id="perks">
      <div className={styles.wrap}>
        <Head eyebrow="Chapter IV">What founding operators <em>receive.</em></Head>
        <div className={styles.perksGrid}>
          <figure className={styles.engraving} data-reveal>
            <Image src="/market-hero.jpg" alt="An engraving of a philosopher and an automaton trading at a table" width={1200} height={760} sizes="(max-width: 960px) 100vw, 40vw" />
            <figcaption>The founding operators, as history will draw them.</figcaption>
          </figure>
          <div className={styles.perks}>
            {PERKS.map(([icon, h, p], i) =>
              <Tilt key={h} className={styles.perk}><article className={styles.card} data-reveal data-spot style={{ ["--i" as string]: i % 2 }}><span className={styles.cardIcon}><Icon name={icon} /></span><h3>{h}</h3><p>{p}</p></article></Tilt>)}
          </div>
        </div>
      </div>
    </section>

    {/* ───── The road ───── */}
    <section className={styles.road} id="road">
      <div className={styles.wrap}>
        <Head light eyebrow="Chapter V">From first mint to <em>the last rung.</em></Head>
        <NodeJourney />
      </div>
    </section>

    <section className={`${styles.parchment} ${styles.filmSection}`} id="watch">
      <div className={styles.wrap}>
        <Head eyebrow="The moving picture" lede="Watch the Vello Quick Start. See how an idea becomes content, then bring your own niche to the network.">Every great work <em>begins with a first step.</em></Head>
        <NodeFilm />
      </div>
    </section>

    {/* ───── The world ───── */}
    <section className={styles.world} id="world">
      <div className={styles.wrap}>
        <div className={styles.worldGrid}>
          <div className={styles.worldCopy}>
            <p className={`${styles.eyebrow} ${styles.eyebrowLeft}`} data-reveal><span>Chapter VI</span><i aria-hidden="true" /></p>
            <h2 className={`${styles.h2} ${styles.h2Light} ${styles.cityTitle}`} data-reveal>A node in <em>every city.</em></h2>
            <p className={`${styles.lede} ${styles.ledeLight} ${styles.ledeLeft}`} data-reveal>The sun is always up somewhere. A global network never closes, never rests, and is never in one place. Your city could be the next light on the map.</p>
            <a href="#reserve" className={`${styles.cta} ${styles.ctaGold}`} data-reveal><span>Light up your city</span><i aria-hidden="true" /></a>
          </div>
          <div className={styles.globeWrap} data-reveal><NodeGlobe /></div>
        </div>
      </div>
    </section>

    {/* ───── The ladder ───── */}
    <section className={styles.parchment} id="ladder">
      <div className={styles.wrap}>
        <Head eyebrow="Chapter VII" lede="Five ranks, measured only in verified views. Four of them are earned in the open. The fifth is a different world entirely.">The ladder, and the <em>door at the top.</em></Head>
        <NodeMembership />
        <div className={styles.ladder}>
          {TIERS.map((t, i) => <article key={t.name} className={`${styles.rung} ${i === 4 ? styles.black : ""}`} data-reveal data-spot style={{ ["--i" as string]: i }}>
            <span className={styles.rungNo}>{["I", "II", "III", "IV", "V"][i]}</span>
            <h3>{t.name}</h3>
            <b>{t.views}<small>views</small></b>
            <p>{t.note}</p>
            {i === 4 && <><span className={styles.foil} aria-hidden="true" /><Link href="/1b-club" className={styles.rungLink}>Glimpse the 1B Club &rarr;</Link></>}
          </article>)}
        </div>
        <blockquote className={styles.quote} data-reveal>&ldquo;Every operator on the last rung once stood exactly where you stand now, with an empty counter and an open invitation.&rdquo;</blockquote>
      </div>
    </section>

    {/* ───── The programme ───── */}
    <section className={styles.dusk} id="program">
      <div className={styles.wrap}>
        <Head light eyebrow="Chapter VIII">What happens <em>on Friday.</em></Head>
        <ol className={styles.agenda}>
          {AGENDA.map(([icon, h, p], i) =>
            <li key={h} data-reveal data-spot style={{ ["--i" as string]: i }}><span className={styles.agendaNo}>{["I", "II", "III", "IV"][i]}</span><span className={styles.agendaIcon}><Icon name={icon} /></span><div><h3>{h}</h3><p>{p}</p></div></li>)}
        </ol>
      </div>
    </section>

    {/* ───── Reserve ───── */}
    <section className={styles.reserve} id="reserve">
      <Sky />
      <div className={styles.historicalFooter} aria-hidden="true"><Image src="/node/ancient-builders.webp" alt="" fill sizes="(max-width: 600px) 1800px, 100vw" /></div>
      <div className={styles.wrap}>
        <div className={styles.reserveCard} data-reveal>
          <p className={`${styles.eyebrow} ${styles.eyebrowInk}`}><i aria-hidden="true" /><span>Your invitation</span><i aria-hidden="true" /></p>
          <h2 className={`${styles.h2} ${styles.h2Ink}`}>Take your <em>seat.</em></h2>
          <p className={`${styles.lede} ${styles.ledeInk}`}>Every Friday at 9pm, on webinar. Register once; we will send your link before the next call.</p>
          <div className={styles.reserveCd}><Countdown /></div>
          <SocialProof light />
          <ApplyForm />
        </div>
      </div>
      <footer className={styles.foot}>
        <div className={styles.footInner}>
          <Image src="/vello-logo-white.png" alt="Vello" width={92} height={28} />
          <nav aria-label="Footer"><Link href="/">Home</Link><Link href="/builder">Builder</Link><Link href="/market">Market</Link><Link href="/1b-club">1B Club</Link></nav>
          <p>&copy; {new Date().getFullYear()} Vello Agents &middot; <Link href="/">velloagents.com</Link></p>
        </div>
      </footer>
    </section>
    <StickyCta />
  </div></Experience></div>;
}
