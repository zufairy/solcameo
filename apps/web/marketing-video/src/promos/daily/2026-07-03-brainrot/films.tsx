/**
 * films.tsx — the 5 MELTDOWN brainrot films, driven by one engine.
 * Each film: cold-open slams → Veo footage pass 1 → stat barrage →
 * Veo pass 2 → punchline slams → end card. 900f @ 30fps, 16:9.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  R, CL, display, mono, Slam, Mega, Punch, KBurns, Cap, Flash, Stat, N, EndCard, Dirt, useShake,
} from "./rk";

type W = { t: string; c?: string }[];
type FilmCfg = {
  veo: string;
  img?: [string, string]; // Ken Burns stills instead of video
  open: [W, W];
  caps1: { at: number; out: number; words: W }[];
  stats: { at: number; big: React.ReactNode; sub: string; dark?: boolean; rotate?: number; x: number; y: number }[];
  statLine: W;
  caps2: { at: number; out: number; words: W }[];
  crop2: "left" | "right" | "center";
  punch: [W, W, W];
  end: W;
};

const Film: React.FC<{ cfg: FilmCfg }> = ({ cfg }) => {
  const frame = useCurrentFrame();
  const sh1 = useShake(22, 16);
  const sh2 = useShake(600, 14);

  return (
    <AbsoluteFill style={{ background: R.ink }}>
      {/* ── COLD OPEN (0–44) ── */}
      {frame < 46 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translate(${sh1.x}px, ${sh1.y}px)` }}>
          <Slam at={0} out={22}><Mega size={150} words={cfg.open[0]} /></Slam>
          <Slam at={22} out={46}><Mega size={130} words={cfg.open[1]} /></Slam>
        </AbsoluteFill>
      )}
      <Flash at={20} dur={4} />

      {/* ── VEO PASS 1 (44–224) ── */}
      {cfg.img
        ? <KBurns src={cfg.img[0]} from={44} to={224} zooms={[80, 140, 196]} />
        : <Punch src={cfg.veo} from={44} to={224} zooms={[80, 140, 196]} />}
      {frame >= 44 && frame <= 224 && (
        <AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      )}
      {cfg.caps1.map((c, i) => <Cap key={i} at={c.at} out={c.out} words={c.words} />)}
      <Flash at={222} dur={4} />

      {/* ── STAT BARRAGE (226–418) ── */}
      {frame >= 226 && frame < 420 && (
        <AbsoluteFill>
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(ellipse 70% 60% at 50% 45%, ${R.lime}18, transparent 70%)`,
          }} />
          {cfg.stats.map((s, i) => (
            <div key={i} style={{ position: "absolute", left: s.x, top: s.y }}>
              <Stat at={s.at} big={s.big} sub={s.sub} dark={s.dark} rotate={s.rotate ?? (i % 2 === 0 ? -2.5 : 2)} />
            </div>
          ))}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 110, display: "flex", justifyContent: "center" }}>
            <Slam at={356}><Mega size={78} words={cfg.statLine} /></Slam>
          </div>
        </AbsoluteFill>
      )}
      <Flash at={418} dur={4} />

      {/* ── VEO PASS 2 (420–598) ── */}
      {cfg.img
        ? <KBurns src={cfg.img[1]} from={420} to={598} zooms={[456, 526]} baseScale={1.2} pan={40} />
        : <Punch src={cfg.veo} from={420} to={598} startFrom={40} zooms={[456, 526]} baseScale={1.32} crop={cfg.crop2} />}
      {frame >= 420 && frame <= 598 && (
        <AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      )}
      {cfg.caps2.map((c, i) => <Cap key={i} at={c.at} out={c.out} words={c.words} />)}
      <Flash at={598} dur={4} />

      {/* ── PUNCHLINE SLAMS (600–742) ── */}
      {frame >= 600 && frame < 744 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translate(${sh2.x}px, ${sh2.y}px)` }}>
          <Slam at={600} out={648}><Mega size={160} words={cfg.punch[0]} /></Slam>
          <Slam at={648} out={696}><Mega size={160} words={cfg.punch[1]} /></Slam>
          <Slam at={696} out={744}><Mega size={124} words={cfg.punch[2]} /></Slam>
        </AbsoluteFill>
      )}
      <Flash at={742} dur={4} />

      {/* ── END CARD (744–900) ── */}
      {frame >= 744 && <EndCard at={748} line={cfg.end} />}

      <Dirt />
    </AbsoluteFill>
  );
};

const L = (t: string) => ({ t, c: R.lime });

/* ── B1 · NIGHT SHIFT ── */
export const B1NightShift: React.FC = () => (
  <Film cfg={{
    veo: "veo/b1_sleep.mp4",
    open: [[{ t: "HE'S" }, L("ASLEEP.")], [{ t: "HIS" }, { t: "AGENT" }, L("ISN'T.")]],
    caps1: [
      { at: 56, out: 116, words: [{ t: "POSTING." }, L("47"), { t: "CLIPS" }, { t: "OVERNIGHT" }] },
      { at: 116, out: 172, words: [{ t: "VERIFIED" }, { t: "VIEWS." }, L("REAL"), L("PAYOUTS.") ] },
      { at: 172, out: 222, words: [{ t: "THE" }, { t: "ROBOTS" }, { t: "RUN" }, { t: "THE" }, L("NIGHT"), L("SHIFT") ] },
    ],
    stats: [
      { at: 238, big: <><N at={240} to={47} /> CLIPS</>, sub: "while he slept", x: 190, y: 200 },
      { at: 292, big: "$3/1K", sub: "per verified view — bounty rate", dark: true, x: 1030, y: 330 },
    ],
    statLine: [{ t: "HE" }, { t: "WAKES" }, { t: "UP" }, { t: "TO" }, { t: "A" }, L("DASHBOARD.")],
    caps2: [
      { at: 430, out: 510, words: [{ t: "NOT" }, { t: "A" }, L("TO-DO"), L("LIST") ] },
      { at: 510, out: 596, words: [{ t: "NO" }, { t: "ALARM." }, { t: "NO" }, L("GRIND.") ] },
    ],
    crop2: "left",
    punch: [[L("GO"), { t: "BACK" }], [{ t: "TO" }, L("SLEEP.")], [{ t: "THE" }, { t: "AGENT" }, { t: "HAS" }, { t: "IT." }]],
    end: [{ t: "SLEEP." }, { t: "EARN." }, L("REPEAT.")],
  }} />
);

/* ── B2 · THE CLIP GOBLIN ── */
export const B2ClipGoblin: React.FC = () => (
  <Film cfg={{
    veo: "veo/b2_goblin.mp4",
    open: [[{ t: "YOU" }, { t: "CLIP" }, L("3/HR.")], [{ t: "IT" }, { t: "DOES" }, L("10"), { t: "PER" }, { t: "VIDEO." }]],
    caps1: [
      { at: 56, out: 116, words: [{ t: "IT" }, L("EATS"), { t: "LONG" }, { t: "VIDEOS" }] },
      { at: 116, out: 172, words: [{ t: "SPITS" }, { t: "OUT" }, L("TEN"), { t: "CLIPS" }] },
      { at: 172, out: 222, words: [{ t: "REFRAMED." }, { t: "CAPTIONED." }, L("HOOK-TESTED.") ] },
    ],
    stats: [
      { at: 238, big: <>1 → 10</>, sub: "clips per source video", x: 210, y: 210 },
      { at: 292, big: "0 MISSED", sub: "submission windows. not once.", dark: true, x: 950, y: 340 },
    ],
    statLine: [{ t: "IT" }, { t: "DOES" }, { t: "NOT" }, L("SLEEP.")],
    caps2: [
      { at: 430, out: 510, words: [{ t: "POSTED" }, L("EVERYWHERE") ] },
      { at: 510, out: 596, words: [{ t: "ON" }, { t: "TIME." }, L("EVERY"), L("TIME.") ] },
    ],
    crop2: "right",
    punch: [[{ t: "STOP" }, { t: "CLIPPING" }], [L("MANUALLY.")], [{ t: "YOU'RE" }, { t: "RACING" }, { t: "A" }, L("GOBLIN.")]],
    end: [{ t: "CLIP." }, { t: "POST." }, L("PAID.")],
  }} />
);

/* ── B3 · THE SWARM ── */
export const B3Swarm: React.FC = () => (
  <Film cfg={{
    veo: "veo/b3_swarm.mp4",
    open: [[L("200"), { t: "VIDEOS." }], [{ t: "ONE" }, L("DAY.")]],
    caps1: [
      { at: 56, out: 116, words: [{ t: "EVERY" }, { t: "ONE" }, { t: "A" }, L("DIFFERENT"), { t: "CREATOR" }] },
      { at: 116, out: 172, words: [{ t: "DIFFERENT" }, { t: "FACE." }, { t: "DIFFERENT" }, L("VOICE.") ] },
      { at: 172, out: 222, words: [{ t: "THIS" }, { t: "IS" }, { t: "NOT" }, { t: "A" }, { t: "CONTENT" }, L("FARM") ] },
    ],
    stats: [
      { at: 238, big: <><N at={240} to={200} />/DAY</>, sub: "cost per video: cents", x: 200, y: 210 },
      { at: 292, big: "IT'S A SWARM", sub: "unique by construction — anti-slop", dark: true, x: 880, y: 350 },
    ],
    statLine: [{ t: "BRANDS" }, { t: "DROP" }, { t: "A" }, L("BOUNTY.")],
    caps2: [
      { at: 430, out: 510, words: [{ t: "THE" }, { t: "SWARM" }, L("FLOODS"), { t: "EVERY" }, { t: "PLATFORM" }] },
      { at: 510, out: 596, words: [{ t: "PAID" }, { t: "PER" }, L("VERIFIED"), { t: "VIEW" }] },
    ],
    crop2: "center",
    punch: [[{ t: "THE" }, { t: "FEED" }], [{ t: "BELONGS" }, { t: "TO" }], [{ t: "THE" }, L("SWARM.")]],
    end: [{ t: "RELEASE" }, { t: "THE" }, L("SWARM.")],
  }} />
);

/* ── B4 · CAPPUCCINA ── */
export const B4Cappuccina: React.FC = () => (
  <Film cfg={{
    veo: "veo/b4_capp.mp4",
    img: ["veo/b4_capp_1.png", "veo/b4_capp_2.png"],
    open: [[{ t: "MEET" }, L("CAPPUCCINA.")], [{ t: "SHE'S" }, { t: "A" }, { t: "CUP" }, { t: "OF" }, L("COFFEE.")]],
    caps1: [
      { at: 56, out: 116, words: [{ t: "RING" }, { t: "LIGHT." }, { t: "POSTING" }, L("SCHEDULE.") ] },
      { at: 116, out: 172, words: [{ t: "BRAND" }, { t: "DEAL." }, L("YES."), L("REALLY.") ] },
      { at: 172, out: 222, words: [{ t: "SHE" }, { t: "ANSWERS" }, { t: "HER" }, L("COMMENTS") ] },
    ],
    stats: [
      { at: 238, big: "3×", sub: "engagement vs human creators", x: 260, y: 210 },
      { at: 292, big: "PAID AT 00:00", sub: "USDC · on-chain · verified", dark: true, x: 900, y: 350 },
    ],
    statLine: [{ t: "FOLLOWERS" }, { t: "FOLLOW" }, L("SOMEONE.")],
    caps2: [
      { at: 430, out: 510, words: [{ t: "SHE" }, { t: "IS" }, { t: "NOT" }, L("REAL") ] },
      { at: 510, out: 596, words: [{ t: "HER" }, { t: "MONEY" }, L("IS.") ] },
    ],
    crop2: "left",
    punch: [[{ t: "BUILD" }], [{ t: "YOUR" }, { t: "OWN" }], [L("INFLUENCER.")]],
    end: [{ t: "NOT" }, { t: "REAL." }, { t: "STILL" }, L("PAID.")],
  }} />
);

/* ── B5 · RENT DAY ── */
export const B5RentDay: React.FC = () => (
  <Film cfg={{
    veo: "veo/b5_rent.mp4",
    open: [[{ t: "YOUR" }, { t: "AGENT" }], [{ t: "PAYS" }, { t: "ITS" }, { t: "OWN" }, L("RENT.")]],
    caps1: [
      { at: 56, out: 116, words: [{ t: "FREE" }, { t: "MONTH." }, { t: "NO" }, L("CARD.") ] },
      { at: 116, out: 172, words: [{ t: "THEN" }, L("$50/MO"), { t: "—" }, { t: "FROM" }, { t: "ITS" }, { t: "EARNINGS" }] },
      { at: 172, out: 222, words: [{ t: "NOT" }, { t: "YOUR" }, L("WALLET.") ] },
    ],
    stats: [
      { at: 238, big: "$50/MO", sub: "deducted from agent earnings first", x: 210, y: 210 },
      { at: 292, big: "~25K VIEWS", sub: "break-even · week one for a clipper", dark: true, x: 950, y: 350 },
    ],
    statLine: [{ t: "THE" }, { t: "ROBOT" }, { t: "PAYS" }, L("YOU.")],
    caps2: [
      { at: 430, out: 510, words: [{ t: "IT" }, { t: "WORKS." }, { t: "IT" }, L("EARNS.") ] },
      { at: 510, out: 596, words: [{ t: "IT" }, { t: "COVERS" }, { t: "ITS" }, L("SUBSCRIPTION.") ] },
    ],
    crop2: "right",
    punch: [[{ t: "RENT" }, { t: "DAY" }], [{ t: "IS" }], [L("AGENT"), { t: "DAY." }]],
    end: [{ t: "IT" }, { t: "PAYS" }, { t: "ITS" }, { t: "OWN" }, L("RENT.")],
  }} />
);
