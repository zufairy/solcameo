/**
 * V7 — "THE SWARM" · intense documentary word-slam film (38s, 16:9).
 * Style: ink × volt two-tone poster cuts, giant kinetic type synced to VO,
 * footage pops and full-bleed b-roll, premium GenZ glow + grain.
 * Logo: public/brand/vello-glyph.png (the real 3D square glyph).
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, random, Easing,
} from "remotion";
import { display, mono } from "../lib/fonts";

const INK = "#0A0C07";
const INK2 = "#11150C";
const VOLT = "#C6F222";
const VOLT_D = "#9BD400";
const WHITE = "#F7F8F2";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const F = (sec: number) => Math.round(sec * 30) + 24; // VO offset 0.8s

/* ── film grain + vignette + glow pulse ── */
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 110% 95% at 50% 50%, transparent 58%, rgba(0,0,0,0.42) 100%)" }} />
      {Array.from({ length: 40 }, (_, i) => {
        const x = random(`gx${i}${Math.floor(frame / 2)}`) * 1920;
        const y = random(`gy${i}${Math.floor(frame / 2)}`) * 1080;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: 2, height: 2, background: "rgba(255,255,255,0.10)" }} />;
      })}
    </AbsoluteFill>
  );
};

/* ── giant word-slam line ── */
const Slam: React.FC<{
  at: number; out: number; words: { t: string; volt?: boolean }[];
  size?: number; onVolt?: boolean; stagger?: number; align?: "center" | "left";
  shakeAt?: number;
}> = ({ at, out, words, size = 150, onVolt = false, stagger = 3, align = "center", shakeAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at - 2 || frame > out + 8) return null;
  const o = interpolate(frame, [out - 1, out + 6], [1, 0], CL);
  const shake = shakeAt !== undefined
    ? interpolate(frame, [shakeAt, shakeAt + 2, shakeAt + 4, shakeAt + 7], [0, 10, -7, 0], CL) : 0;
  const base = onVolt ? INK : WHITE;
  const acc = onVolt ? INK : VOLT;
  return (
    <AbsoluteFill style={{ alignItems: align === "center" ? "center" : "flex-start", justifyContent: "center", padding: align === "left" ? "0 140px" : "0 90px", opacity: o, transform: `translate(${shake}px,0)` }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${size * 0.04}px ${size * 0.22}px`, justifyContent: align === "center" ? "center" : "flex-start", maxWidth: 1720, fontFamily: display, fontWeight: 700, fontSize: size, lineHeight: 0.98, letterSpacing: -size * 0.03, textTransform: "uppercase" }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - (at + i * stagger), fps, config: { damping: 14, stiffness: 210, mass: 0.7 } });
          return (
            <span key={i} style={{
              display: "inline-block", opacity: s,
              transform: `scale(${1.35 - 0.35 * s}) translateY(${(1 - s) * size * 0.25}px)`,
              filter: `blur(${(1 - s) * 7}px)`,
              color: w.volt ? acc : base,
              textShadow: w.volt && !onVolt ? `0 0 ${size * 0.5}px ${VOLT}66, 0 0 ${size * 0.16}px ${VOLT}88` : `0 4px 30px rgba(0,0,0,0.35)`,
            }}>{w.t}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ── background block (ink / volt / footage) with hard cut ── */
const Block: React.FC<{ at: number; out: number; color?: string; video?: string; dim?: number; children?: React.ReactNode; zoom?: boolean }> =
  ({ at, out, color = INK, video, dim = 0.55, children, zoom = true }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > out + 8) return null;
  const z = zoom ? interpolate(frame, [at, out], [1.02, 1.12], { ...CL, easing: Easing.out(Easing.quad) }) : 1;
  return (
    <AbsoluteFill style={{ background: color, opacity: interpolate(frame, [out + 1, out + 7], [1, 0], CL) }}>
      {video && (
        <AbsoluteFill style={{ transform: `scale(${z})` }}>
          <Loop durationInFrames={170} layout="none">
            <OffthreadVideo muted src={staticFile(video)} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
          </Loop>
          <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(10,12,7,${dim}) 0%, rgba(10,12,7,${dim + 0.15}) 100%)` }} />
        </AbsoluteFill>
      )}
      {children}
    </AbsoluteFill>
  );
};

/* ── cutout media pop (rotated polaroid window) ── */
const PopMedia: React.FC<{ at: number; out: number; src: string; video?: boolean; x: number; y: number; w: number; h: number; rot?: number }> =
  ({ at, out, src, video, x, y, w, h, rot = -4 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > out + 6) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 190, mass: 0.8 } });
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w, height: h,
      transform: `rotate(${rot + (1 - s) * 10}deg) scale(${s})`,
      opacity: Math.min(s * 1.2, 1) * interpolate(frame, [out, out + 5], [1, 0], CL),
      borderRadius: 18, overflow: "hidden",
      border: `4px solid ${WHITE}`,
      boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 60px ${VOLT}22`,
    }}>
      {video ? (
        <Loop durationInFrames={170} layout="none">
          <OffthreadVideo muted src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
        </Loop>
      ) : (
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </div>
  );
};

/* ── mono ticker strip ── */
const Ticker: React.FC<{ at: number; out: number; text: string; y?: number }> = ({ at, out, text, y = 985 }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > out) return null;
  const xx = -((frame - at) * 6) % 1400;
  return (
    <div style={{ position: "absolute", top: y, left: 0, right: 0, overflow: "hidden", opacity: 0.85 }}>
      <div style={{ whiteSpace: "nowrap", transform: `translateX(${xx}px)`, fontFamily: mono, fontSize: 24, letterSpacing: 5, color: VOLT, textShadow: `0 0 18px ${VOLT}66` }}>
        {Array(8).fill(text).join("   ·   ")}
      </div>
    </div>
  );
};

const AV = ["gen/agent-influencer.png", "gen/agent-clipper.png", "gen/agent-trader.png", "gen/agent-anime.png", "gen/swarm.png", "gen/hero-economy.png"];

export const V7SwarmDoc: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* logo stinger springs */
  const gAt = F(29.9);
  const gs = spring({ frame: frame - gAt, fps, config: { damping: 12, stiffness: 170, mass: 1 } });
  const ring = interpolate(frame, [gAt + 2, gAt + 40], [0, 1], CL);
  const ctaS = spring({ frame: frame - F(31.2), fps, config: { damping: 15, stiffness: 160 } });

  return (
    <AbsoluteFill style={{ background: INK, fontFamily: display }}>

      {/* 1 · wake up — park footage */}
      <Block at={0} out={F(2.55)} video="doc/park.mp4" dim={0.6}>
        <Ticker at={4} out={F(2.55)} text="THE SWARM · A VELLO FILM · 2026" y={64} />
      </Block>
      <Slam at={F(0.05)} out={F(2.55)} size={132} stagger={4}
        words={[{ t: "There's" }, { t: "a" }, { t: "new" }, { t: "workforce", volt: true }, { t: "waking" }, { t: "up." }]} />

      {/* 2 · doesn't sleep — volt flip */}
      <Block at={F(2.55)} out={F(3.85)} color={VOLT} zoom={false} />
      <Slam at={F(2.62)} out={F(3.85)} size={165} onVolt stagger={2}
        words={[{ t: "It" }, { t: "doesn't" }, { t: "sleep." }]} />

      {/* 3 · doesn't scroll — ink + vertical agent clip pop */}
      <Block at={F(3.85)} out={F(5.28)} color={INK} zoom={false} />
      <PopMedia at={F(3.95)} out={F(5.28)} src="doc/agent_vert.mp4" video x={1345} y={165} w={370} h={660} rot={5} />
      <Slam at={F(3.9)} out={F(5.28)} size={150} align="left" stagger={2}
        words={[{ t: "It" }, { t: "doesn't" }, { t: "scroll.", volt: true }]} />

      {/* 4 · IT SHIPS — volt slam + shake */}
      <Block at={F(5.28)} out={F(6.55)} color={VOLT} zoom={false} />
      <Slam at={F(5.34)} out={F(6.55)} size={230} onVolt stagger={3} shakeAt={F(5.55)}
        words={[{ t: "It" }, { t: "ships." }]} />

      {/* 5 · 200 a day — launch footage */}
      <Block at={F(6.55)} out={F(8.5)} video="doc/launch_a.mp4" dim={0.62} />
      <Slam at={F(6.62)} out={F(8.5)} size={118} stagger={3}
        words={[{ t: "200", volt: true }, { t: "videos" }, { t: "a" }, { t: "day" }]} />

      {/* 6 · every face unique — avatar rapid grid */}
      <Block at={F(8.5)} out={F(12.35)} color={INK2} zoom={false}>
        {AV.map((a, i) => (
          <PopMedia key={i} at={F(8.7 + i * 0.42)} out={F(12.35)} src={a}
            x={[90, 1500, 240, 1390, 120, 1520][i]} y={[130, 110, 620, 590, 380, 380][i]}
            w={300} h={300} rot={[-6, 5, 4, -5, 7, -8][i]} />
        ))}
      </Block>
      <Slam at={F(8.7)} out={F(10.55)} size={112} stagger={3}
        words={[{ t: "Every" }, { t: "face" }, { t: "unique.", volt: true }]} />
      <Slam at={F(10.6)} out={F(12.35)} size={112} stagger={3}
        words={[{ t: "Every" }, { t: "view" }, { t: "verified.", volt: true }]} />

      {/* 7 · old internet argues → swarm farms the feed — b-roll rapid cuts */}
      <Block at={F(12.35)} out={F(14.1)} video="doc/clipper_a.mp4" dim={0.6} />
      <Block at={F(14.1)} out={F(15.7)} video="doc/arena_b.mp4" dim={0.55} />
      <Block at={F(15.7)} out={F(17.5)} video="doc/clipper_b.mp4" dim={0.5} />
      <Slam at={F(12.45)} out={F(14.9)} size={104} stagger={2}
        words={[{ t: "While" }, { t: "the" }, { t: "old" }, { t: "internet" }, { t: "argues…" }]} />
      <Slam at={F(15.0)} out={F(17.5)} size={112} stagger={2}
        words={[{ t: "the" }, { t: "swarm", volt: true }, { t: "is" }, { t: "farming", volt: true }, { t: "the" }, { t: "feed." }]} />

      {/* 8 · paid per view — volt money block */}
      <Block at={F(17.5)} out={F(21.1)} color={VOLT} zoom={false} />
      <Slam at={F(17.65)} out={F(21.1)} size={170} onVolt stagger={3}
        words={[{ t: "$3" }, { t: "/" }, { t: "1,000" }, { t: "views." }]} />
      <Ticker at={F(17.65)} out={F(21.1)} text="VERIFIED ON-CHAIN · PAID IN USDC · ORACLE CHECKED" y={950} />

      {/* 9 · 30K case — clipper_c window + countup */}
      <Block at={F(21.1)} out={F(26.5)} color={INK} zoom={false} />
      <PopMedia at={F(21.3)} out={F(26.5)} src="doc/clipper_c.mp4" video x={1170} y={520} w={620} h={350} rot={4} />
      <div style={{ position: "absolute", left: 130, top: 300, opacity: frame >= F(21.2) && frame <= F(25.0) ? interpolate(frame, [F(24.55), F(24.95)], [1, 0], CL) : 0 }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 300, letterSpacing: -14, color: VOLT, textShadow: `0 0 90px ${VOLT}55`, lineHeight: 0.9 }}>
          ${Math.floor(interpolate(frame, [F(21.4), F(23.6)], [0, 30], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) }))}K
        </div>
        <div style={{ fontFamily: mono, fontSize: 30, letterSpacing: 6, color: WHITE, marginTop: 14 }}>A MONTH · ONE OPERATOR</div>
      </div>
      <Slam at={F(24.95)} out={F(26.5)} size={135} align="left" stagger={3}
        words={[{ t: "Zero" }, { t: "editors.", volt: true }]} />

      {/* 10 · not the future / this is tuesday */}
      <Block at={F(26.5)} out={F(28.8)} color={INK2} zoom={false} />
      <Slam at={F(26.6)} out={F(28.8)} size={104} stagger={2}
        words={[{ t: "This" }, { t: "isn't" }, { t: "the" }, { t: "future" }, { t: "of" }, { t: "content." }]} />
      <Block at={F(28.8)} out={F(29.9)} color={VOLT} zoom={false} />
      <Slam at={F(28.86)} out={F(29.9)} size={185} onVolt stagger={2} shakeAt={F(29.05)}
        words={[{ t: "This" }, { t: "is" }, { t: "Tuesday." }]} />

      {/* 11 · logo stinger + CTA */}
      {frame >= gAt && (
        <AbsoluteFill style={{ background: INK, alignItems: "center", justifyContent: "center" }}>
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 44%, ${VOLT}18, transparent 55%)` }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              position: "absolute", left: "50%", top: "44%",
              width: 300 + ring * (480 + i * 300), height: 300 + ring * (480 + i * 300),
              transform: "translate(-50%,-50%)", borderRadius: 999,
              border: `1.5px solid ${VOLT}${["55", "33", "1e"][i]}`, opacity: 1 - ring * 0.65,
            }} />
          ))}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40, marginTop: -60 }}>
            <div style={{ transform: `scale(${gs}) rotate(${(1 - gs) * -16}deg)`, opacity: gs, filter: `drop-shadow(0 0 ${50 + Math.sin(frame / 9) * 18}px ${VOLT}77)` }}>
              <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 300 }} />
            </div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 130, letterSpacing: -5, color: WHITE, opacity: gs, transform: `translateY(${(1 - gs) * 30}px)` }}>
              vello
            </div>
            <div style={{
              opacity: ctaS, transform: `translateY(${(1 - ctaS) * 30}px) scale(${0.94 + ctaS * 0.06})`,
              fontFamily: display, fontWeight: 700, fontSize: 44, color: INK,
              background: VOLT, borderRadius: 999, padding: "22px 58px",
              boxShadow: `0 10px 0 ${VOLT_D}, 0 0 80px ${VOLT}55`,
            }}>
              Deploy the swarm → vello.gg
            </div>
          </div>
        </AbsoluteFill>
      )}
      <Grain />
    </AbsoluteFill>
  );
};
