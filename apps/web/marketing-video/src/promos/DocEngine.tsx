/**
 * DocEngine — premium fast-paced documentary engine.
 * Full-bleed stock footage cut on VO sentence boundaries (waveform-synced),
 * cinematic letterbox, duotone grade, giant synced captions, Vello reveal.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, random, Easing,
} from "remotion";
import { display, mono, serif } from "../lib/fonts";

const INK = "#0A0C08", VOLT = "#C6F222", WHITE = "#F7F8F2";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export type Cue = { s: number; e: number; t: string };
export type DocConfig = {
  title: string; chapter: string;
  cues: readonly Cue[] | Cue[]; media: string[]; dur: number;
  revealAt: number; // cue index where Vello reveal begins
};

const FPS = 30;
const f = (sec: number) => Math.round(sec * FPS) + 24; // VO offset 0.8s

/* grade + grain + letterbox */
const Finish: React.FC<{ dark?: boolean }> = ({ dark }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 115% 95% at 50% 45%, transparent 55%, rgba(4,6,3,0.55) 100%)" }} />
      {Array.from({ length: 34 }, (_, i) => {
        const x = random(`g${i}${Math.floor(frame / 2)}`) * 1920;
        const y = random(`h${i}${Math.floor(frame / 2)}`) * 1080;
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: 2, height: 2, background: "rgba(255,255,255,0.09)" }} />;
      })}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 92, background: INK }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 92, background: INK }} />
    </AbsoluteFill>
  );
};

/* one footage shot for a cue */
const Shot: React.FC<{ from: number; to: number; src: string; brand?: boolean }> = ({ from, to, src, brand }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to + 3) return null;
  const z = interpolate(frame, [from, to], [1.05, 1.16], { ...CL, easing: Easing.out(Easing.quad) });
  const flash = interpolate(frame, [from, from + 3], [0.55, 0], CL);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${z})`, filter: "saturate(0.82) contrast(1.07) brightness(0.92)" }}>
        <Loop durationInFrames={168} layout="none">
          <OffthreadVideo muted src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
        </Loop>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(10,12,7,0.30) 0%, rgba(10,12,7,0.12) 40%, rgba(10,12,7,0.62) 100%)` }} />
      {brand && <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 55%, ${VOLT}14, transparent 65%)` }} />}
      <AbsoluteFill style={{ background: "#000", opacity: flash }} />
    </AbsoluteFill>
  );
};

/* synced caption: words finish by ~55% of the cue */
const Caption: React.FC<{ cue: Cue; from: number; to: number; big?: boolean; brand?: boolean }> = ({ cue, from, to, big, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || frame > to + 4) return null;
  const words = cue.t.split(" ");
  const span = Math.max(to - from, 10);
  const stagger = Math.max(1.2, (span * 0.5) / Math.max(words.length, 1));
  const isNum = /^[\d$]/.test(cue.t);
  const size = big || isNum ? 108 : Math.min(84, 2300 / Math.max(...cue.t.split(" ").map((w) => w.length), 8));
  const o = interpolate(frame, [to - 1, to + 4], [1, 0], CL);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: isNum ? "center" : "flex-end", paddingBottom: isNum ? 0 : 150, opacity: o }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${size * 0.06}px ${size * 0.22}px`, justifyContent: "center", maxWidth: 1620, fontFamily: display, fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: -size * 0.028, textAlign: "center", textShadow: "0 4px 30px rgba(0,0,0,0.75)" }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - (from + i * stagger), fps, config: { damping: 15, stiffness: 220, mass: 0.6 } });
          const key = /[\d$×%]|VELLO|vello|feed|own|gold|machine|window|unique|sleeps/i.test(w);
          return (
            <span key={i} style={{
              display: "inline-block", opacity: s,
              transform: `translateY(${(1 - s) * size * 0.3}px) scale(${1.18 - 0.18 * s})`,
              filter: `blur(${(1 - s) * 5}px)`,
              color: key ? VOLT : brand ? WHITE : WHITE,
              textShadow: key ? `0 0 ${size * 0.45}px ${VOLT}55, 0 4px 30px rgba(0,0,0,0.75)` : undefined,
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const DocFilm: React.FC<{ cfg: DocConfig }> = ({ cfg }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const total = durationInFrames;
  const revealCue = cfg.cues[cfg.revealAt];
  const revealF = f(revealCue.s);
  const gs = spring({ frame: frame - revealF, fps, config: { damping: 12, stiffness: 170 } });
  const ctaFrom = f(cfg.cues[cfg.cues.length - 1].e) + 6;
  const ctaS = spring({ frame: frame - ctaFrom, fps, config: { damping: 14, stiffness: 150 } });
  const prog = frame / total;

  return (
    <AbsoluteFill style={{ background: INK }}>
      {/* footage track */}
      {cfg.cues.map((c, i) => {
        const from = f(c.s) - (i === 0 ? 24 : 0);
        const to = i < cfg.cues.length - 1 ? f(cfg.cues[i + 1].s) : f(c.e) + 8;
        return <Shot key={i} from={from} to={to} src={cfg.media[i]} brand={i >= cfg.revealAt} />;
      })}

      {/* caption track */}
      {cfg.cues.map((c, i) => {
        if (i === cfg.revealAt) return null; // reveal cue handled separately
        return <Caption key={i} cue={c} from={f(c.s)} to={f(c.e) + Math.min(10, (i < cfg.cues.length - 1 ? f(cfg.cues[i + 1].s) : 9999) - f(c.e))} brand={i > cfg.revealAt} />;
      })}

      {/* VELLO reveal */}
      {frame >= revealF && frame < f(revealCue.e) + 12 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${VOLT}20, rgba(10,12,7,0.72) 62%)` }} />
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 240, transform: `scale(${gs}) rotate(${(1 - gs) * -14}deg)`, opacity: gs, filter: `drop-shadow(0 0 55px ${VOLT}88)` }} />
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 110, letterSpacing: -4, color: WHITE, opacity: gs, textShadow: "0 6px 40px rgba(0,0,0,0.7)" }}>
            vello
          </div>
          <div style={{ fontFamily: mono, fontSize: 24, letterSpacing: 8, color: VOLT, opacity: gs, textTransform: "uppercase" }}>the AI influencer network</div>
        </AbsoluteFill>
      )}

      {/* CTA end card */}
      {frame >= ctaFrom && (
        <AbsoluteFill style={{ background: INK, alignItems: "center", justifyContent: "center", gap: 38 }}>
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${VOLT}16, transparent 58%)` }} />
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 210, opacity: ctaS, transform: `scale(${0.86 + 0.14 * ctaS})`, filter: `drop-shadow(0 0 ${45 + Math.sin(frame / 9) * 16}px ${VOLT}77)` }} />
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 58, color: WHITE, opacity: ctaS }}>{cfg.title}</div>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 42, color: INK, background: VOLT, borderRadius: 999, padding: "20px 52px", boxShadow: `0 9px 0 #86B60E, 0 0 70px ${VOLT}44`, opacity: ctaS, transform: `translateY(${(1 - ctaS) * 26}px)` }}>
            Claim your agent → vello.gg
          </div>
        </AbsoluteFill>
      )}

      {/* chrome */}
      <Finish />
      <div style={{ position: "absolute", top: 34, left: 60, fontFamily: mono, fontSize: 19, letterSpacing: 5, color: `${WHITE}99`, textTransform: "uppercase" }}>
        {cfg.chapter}
      </div>
      <div style={{ position: "absolute", top: 34, right: 60, fontFamily: mono, fontSize: 19, letterSpacing: 3, color: `${WHITE}66` }}>
        {String(Math.floor(frame / fps / 60)).padStart(2, "0")}:{String(Math.floor((frame / fps) % 60)).padStart(2, "0")} / VELLO FILMS
      </div>
      <div style={{ position: "absolute", bottom: 40, left: 60, right: 60, height: 3, background: "rgba(255,255,255,0.14)" }}>
        <div style={{ width: `${prog * 100}%`, height: "100%", background: VOLT, boxShadow: `0 0 14px ${VOLT}` }} />
      </div>
    </AbsoluteFill>
  );
};
