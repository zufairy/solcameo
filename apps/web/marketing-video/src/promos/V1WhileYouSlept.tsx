/**
 * V1 — "While You Slept" · consumer hook film (30s, 16:9).
 * Angle: the money made overnight. Night shift → morning payout → CTA.
 */
import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { Moon, Sunrise, Clapperboard, Send, BadgeCheck } from "lucide-react";
import { SwarmBackground } from "../swarm/SwarmBackground";
import { Particles } from "../components/Particles";
import { GlowPulse } from "../components/GlowPulse";
import { CountUp } from "../components/CountUp";
import {
  SW, swTextGlow, CLAMP, SPRING_POP, display, mono,
  KineticText, Plate, Pop, Chip, VoltLine, Outro, Finish,
} from "./kit";

const W = 1920, H = 1080;
const PLATFORMS = ["tiktok", "youtube", "instagram", "x"] as const;

/* clip cards that fire from the core to a platform dock */
const ClipShot: React.FC<{ at: number; lane: number }> = ({ at, lane }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 26], [0, 1], {
    ...CLAMP,
    easing: (x) => 1 - Math.pow(1 - x, 2.4),
  });
  if (frame < at || t >= 1) return null;
  const x0 = W / 2, y0 = 585;
  const x1 = 424 + lane * 358, y1 = 942;
  const x = x0 + (x1 - x0) * t;
  const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 130;
  return (
    <div
      style={{
        position: "absolute", left: x - 34, top: y - 22, width: 68, height: 44,
        borderRadius: 9, background: SW.cardHi,
        border: `1.5px solid ${SW.volt}88`,
        boxShadow: `0 0 22px ${SW.volt}44`,
        opacity: 1 - t * 0.25,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <Clapperboard size={22} color={SW.volt} strokeWidth={2.2} />
    </div>
  );
};

export const V1WhileYouSlept: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* section fades */
  const hookOut = interpolate(frame, [126, 146], [1, 0], CLAMP);
  const workIn = interpolate(frame, [140, 158], [0, 1], CLAMP);
  const workOut = interpolate(frame, [412, 432], [1, 0], CLAMP);
  const payIn = interpolate(frame, [426, 444], [0, 1], CLAMP);
  const payOut = interpolate(frame, [700, 724], [1, 0], CLAMP);

  /* overnight clock 23:00 → 07:00 across the work section */
  const clockT = interpolate(frame, [170, 400], [0, 1], CLAMP);
  const hour = (23 + clockT * 8) % 24;
  const hh = String(Math.floor(hour)).padStart(2, "0");
  const mm = String(Math.floor((hour % 1) * 60)).padStart(2, "0");

  const corePulse = 1 + Math.sin(frame / 9) * 0.05;
  const shots = Array.from({ length: 26 }, (_, i) => ({
    at: 182 + i * 8.6,
    lane: i % 4,
  }));

  return (
    <AbsoluteFill style={{ background: SW.bg }}>
      <SwarmBackground intensity={0.42} />
      <Particles count={22} color={SW.voltSoft} opacity={0.3} />

      {/* ── HOOK ── */}
      {frame < 150 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: hookOut, gap: 40 }}>
          <Pop at={4}>
            <Chip size={22}><Moon size={20} style={{ marginRight: 4 }} /> 11:42 PM — YOU LOG OFF</Chip>
          </Pop>
          <KineticText
            start={16} stagger={5} size={116} weight={700} maxWidth={1500}
            words={[
              { t: "You" }, { t: "went" }, { t: "to" }, { t: "bed." },
              { t: "Your" }, { t: "agent", color: SW.volt }, { t: "went" }, { t: "to" }, { t: "work.", color: SW.volt },
            ]}
          />
        </AbsoluteFill>
      )}

      {/* ── NIGHT SHIFT ── */}
      {frame >= 140 && frame < 440 && (
        <AbsoluteFill style={{ opacity: Math.min(workIn, workOut) }}>
          {/* header: overnight clock */}
          <div style={{ position: "absolute", top: 72, width: "100%", display: "flex", justifyContent: "center", gap: 28 }}>
            <Chip size={22} color={SW.sub}>NIGHT SHIFT</Chip>
            <div style={{ fontFamily: mono, fontSize: 30, color: SW.white, letterSpacing: 4, alignSelf: "center", textShadow: swTextGlow(SW.volt, 18) }}>
              {hh}:{mm}
            </div>
          </div>

          {/* the working core */}
          <GlowPulse at={168} color={SW.volt} size={1200} intensity={0.4} />
          <div style={{ position: "absolute", left: W / 2 - 120, top: 465, width: 240, height: 240 }}>
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 999,
                background: `radial-gradient(circle at 38% 32%, ${SW.voltSoft}, ${SW.volt} 45%, ${SW.voltDeep} 100%)`,
                boxShadow: `0 0 90px ${SW.volt}77, 0 0 220px ${SW.volt}33`,
                transform: `scale(${corePulse})`,
              }}
            />
            <div style={{ position: "absolute", inset: -34, borderRadius: 999, border: `1.5px dashed ${SW.volt}55`, transform: `rotate(${frame * 1.1}deg)` }} />
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 700, fontSize: 54, color: "#0A0C08" }}>
              v
            </div>
          </div>

          {/* stats stack (left) */}
          <div style={{ position: "absolute", left: 150, top: 400, display: "flex", flexDirection: "column", gap: 26 }}>
            {[
              { at: 200, label: "BOUNTIES FOUND", v: 3, suffix: "" },
              { at: 250, label: "CLIPS CUT", v: 41, suffix: "" },
              { at: 300, label: "POSTS PUBLISHED", v: 38, suffix: "" },
            ].map((s, i) => (
              <Pop key={i} at={s.at}>
                <Plate style={{ padding: "26px 36px", width: 380 }} glowColor={SW.volt}>
                  <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: 4, color: SW.sub }}>{s.label}</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: SW.white, marginTop: 6 }}>
                    <CountUp value={s.v} start={s.at + 6} duration={34} />
                  </div>
                </Plate>
              </Pop>
            ))}
          </div>

          {/* verified line (right) */}
          <div style={{ position: "absolute", right: 150, top: 430, display: "flex", flexDirection: "column", gap: 26, alignItems: "flex-end" }}>
            <Pop at={330}>
              <Plate style={{ padding: "26px 36px", width: 420 }} glowColor={SW.emerald}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 19, letterSpacing: 4, color: SW.emerald }}>
                  <BadgeCheck size={22} color={SW.emerald} /> VERIFIED VIEWS
                </div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: SW.white, marginTop: 6 }}>
                  <CountUp value={57204} start={336} duration={60} />
                </div>
              </Plate>
            </Pop>
            <Pop at={372}>
              <Chip size={20} color={SW.emerald}><Send size={18} style={{ marginRight: 4 }} /> SUBMITTED BEFORE EVERY DEADLINE</Chip>
            </Pop>
          </div>

          {/* platform docks + flying clips */}
          <div style={{ position: "absolute", bottom: 66, width: "100%", display: "flex", justifyContent: "center", gap: 290 }}>
            {PLATFORMS.map((p, i) => (
              <Pop key={p} at={176 + i * 7}>
                <div
                  style={{
                    width: 96, height: 96, borderRadius: 24, background: SW.card,
                    border: `1.5px solid ${SW.border}`,
                    boxShadow: "inset 0 1.5px 0 rgba(255,255,255,0.07), 0 5px 0 rgba(0,0,0,0.5)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Img src={staticFile(`platforms/${p}.svg`)} style={{ width: 46, opacity: 0.92 }} />
                </div>
              </Pop>
            ))}
          </div>
          {shots.map((s, i) => <ClipShot key={i} at={s.at} lane={s.lane} />)}
        </AbsoluteFill>
      )}

      {/* ── MORNING PAYOUT ── */}
      {frame >= 426 && frame < 730 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: Math.min(payIn, payOut) }}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 70% 55% at 50% 100%, ${SW.amber}12, transparent 60%)`,
              opacity: interpolate(frame, [560, 640], [0, 1], CLAMP),
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
            <Pop at={434}>
              <Chip size={22} color={SW.amber}><Sunrise size={20} style={{ marginRight: 4 }} /> 07:00 AM — YOU WAKE UP</Chip>
            </Pop>
            <Pop at={452}>
              <div style={{ fontFamily: mono, fontSize: 24, letterSpacing: 6, color: SW.sub, textTransform: "uppercase" }}>
                earned while you slept
              </div>
            </Pop>
            <div
              style={{
                fontFamily: display, fontWeight: 700, fontSize: 250, letterSpacing: -8,
                color: SW.volt, textShadow: swTextGlow(SW.volt, 60),
                transform: `scale(${spring({ frame: frame - 462, fps, config: SPRING_POP, from: 0.8, to: 1 })})`,
                opacity: spring({ frame: frame - 462, fps, config: SPRING_POP, from: 0, to: 1 }),
              }}
            >
              <CountUp value={114.2} decimals={2} prefix="$" start={470} duration={70} />
            </div>
            <VoltLine at={540} width={620} />
            <KineticText
              start={560} stagger={4} size={62} weight={600} maxWidth={1400}
              words={[
                { t: "It" }, { t: "found." }, { t: "It" }, { t: "clipped." }, { t: "It" }, { t: "posted." },
                { t: "It" }, { t: "collected.", color: SW.volt },
              ]}
            />
          </div>
        </AbsoluteFill>
      )}

      <Outro at={734} cta="Deploy an AI clipper — free for 30 days" />
      <Finish />
    </AbsoluteFill>
  );
};
