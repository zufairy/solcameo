/**
 * V5 — "Stop Posting. Start Deploying." · brand manifesto (30s, 16:9).
 * Angle: emotional anthem. Huge kinetic type, one statement per beat,
 * glyph reveal finale. The slowest, boldest cut of the five.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { SwarmBackground } from "../swarm/SwarmBackground";
import { Particles } from "../components/Particles";
import { GlowPulse } from "../components/GlowPulse";
import {
  SW, swTextGlow, CLAMP, SPRING_POP, display, mono,
  KineticText, Plate, Pop, Chip, VoltLine, Outro, Finish,
} from "./kit";

/* one full-screen statement that lives for [at, out] */
const Statement: React.FC<{
  at: number; out: number;
  words: { t: string; color?: string }[];
  size?: number; sub?: string; eyebrow?: string;
}> = ({ at, out, words, size = 124, sub, eyebrow }) => {
  const frame = useCurrentFrame();
  if (frame < at - 4 || frame > out + 20) return null;
  const o = interpolate(frame, [out - 2, out + 14], [1, 0], CLAMP);
  const drift = interpolate(frame, [at, out + 14], [0, -26], CLAMP);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o, transform: `translateY(${drift}px)`, gap: 38 }}>
      {eyebrow && (
        <Pop at={at}>
          <div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 10, textTransform: "uppercase", color: SW.faint }}>{eyebrow}</div>
        </Pop>
      )}
      <KineticText start={at + 4} stagger={6} size={size} weight={700} maxWidth={1620} words={words} />
      {sub && (
        <Pop at={at + words.length * 6 + 16}>
          <div style={{ fontFamily: mono, fontSize: 26, letterSpacing: 5, color: SW.sub }}>{sub}</div>
        </Pop>
      )}
    </AbsoluteFill>
  );
};

export const V5Manifesto: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* glyph finale */
  const glyphS = spring({ frame: frame - 592, fps, config: { damping: 14, mass: 1.1 }, from: 0, to: 1 });
  const ringT = interpolate(frame, [600, 660], [0, 1], CLAMP);
  const glyphOut = interpolate(frame, [700, 724], [1, 0], CLAMP);

  return (
    <AbsoluteFill style={{ background: SW.bg }}>
      <SwarmBackground intensity={0.4} />
      <Particles count={20} color={SW.voltSoft} opacity={0.28} />

      <Statement
        at={6} out={130} eyebrow="a manifesto"
        words={[
          { t: "Stop" }, { t: "posting.", color: SW.red },
        ]}
      />
      <Statement
        at={138} out={262}
        words={[
          { t: "Start" }, { t: "deploying.", color: SW.volt },
        ]}
      />
      <Statement
        at={270} out={414} size={92}
        words={[
          { t: "The" }, { t: "grind" }, { t: "was" }, { t: "never" },
          { t: "the" }, { t: "talent.", color: SW.volt },
        ]}
        sub="3–4 clips an hour. 18 posts a day. For what?"
      />
      <Statement
        at={422} out={578} size={92}
        words={[
          { t: "Machines" }, { t: "grind.", color: SW.volt },
          { t: "You" }, { t: "direct.", color: SW.volt },
        ]}
        sub="persona · taste · judgment — still yours"
      />

      {/* ── GLYPH FINALE ── */}
      {frame >= 588 && frame < 730 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: glyphOut }}>
          <GlowPulse at={592} color={SW.volt} size={1500} intensity={0.55} />
          {/* expanding rings */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: 260 + ringT * (500 + i * 260),
                height: 260 + ringT * (500 + i * 260),
                borderRadius: 999,
                border: `1.5px solid ${SW.volt}${["44", "2e", "1c"][i]}`,
                opacity: 1 - ringT * 0.7,
              }}
            />
          ))}
          <div
            style={{
              width: 230, height: 230, borderRadius: 56, overflow: "hidden",
              transform: `scale(${glyphS}) rotate(${(1 - glyphS) * -14}deg)`,
              opacity: glyphS,
              boxShadow: `0 0 110px ${SW.volt}66, 0 30px 60px rgba(0,0,0,0.6)`,
            }}
          >
            <Img src={staticFile("brand/vellosquare.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", bottom: 200 }}>
            <KineticText
              start={620} stagger={5} size={58} weight={600}
              words={[
                { t: "This" }, { t: "is" }, { t: "how" }, { t: "creators" },
                { t: "scale", color: SW.volt }, { t: "now." },
              ]}
            />
          </div>
        </AbsoluteFill>
      )}

      <Outro at={734} cta="Start deploying — free for 30 days" />
      <Finish />
    </AbsoluteFill>
  );
};
