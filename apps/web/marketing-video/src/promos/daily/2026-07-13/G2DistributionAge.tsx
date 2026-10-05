/**
 * G2 — "The Distribution Age" · Pillar 7 manifesto/brand anthem.
 * A film about leverage: talent was never the bottleneck — distribution was.
 * Pure editorial statements, serif-heavy, one full-bleed footage passage
 * (cofounder-bg, Ken Burns), staggered "It finds. It clips. It posts." slam,
 * dark owner card. No side-by-side layouts — full-screen typography film.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const SLAM = ["It finds.", "It clips.", "It posts.", "It reports back — with earnings."];

export const G2DistributionAge: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const kb = interpolate(frame, [140, 340], [1.05, 1.16], CL); // Ken Burns

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · THE CLAIM (0–140) ══ */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>A FILM ABOUT LEVERAGE</Tag></Rise>
          <div style={{
            fontFamily: serif, fontStyle: "italic", fontWeight: 500, fontSize: 96, color: D.ink,
            letterSpacing: -2, textAlign: "center", maxWidth: 1560, lineHeight: 1.1,
            opacity: interpolate(frame, [14, 34], [0, 1], CL),
            transform: `translateY(${interpolate(frame, [14, 40], [30, 0], CL)}px)`,
          }}>
            Talent was never the bottleneck.
          </div>
          <Line at={56} size={84} maxWidth={1500}
            words={[{ t: "Distribution", c: D.lime }, { t: "was." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · HISTORY OVER FOOTAGE (140–340) ══ */}
      <Sect from={140} to={340}>
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <OffthreadVideo src={staticFile("site/cofounder-bg.mp4")} muted
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kb})` }} />
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(247,246,241,0.82) 0%, rgba(247,246,241,0.62) 100%)" }} />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Line at={156} size={70} maxWidth={1460}
            words={[{ t: "Reach" }, { t: "belonged" }, { t: "to" }, { t: "whoever" }, { t: "owned" }, { t: "the" }, { t: "channel.", serif: true }]} />
          <Line at={226} size={70} maxWidth={1460} color={D.sub}
            words={[{ t: "Then" }, { t: "to" }, { t: "whoever" }, { t: "could" }, { t: "post" }, { t: "the" }, { t: "most.", serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S3 · THE TURN (340–520) ══ */}
      <Sect from={340} to={520}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
          <Line at={352} size={80} maxWidth={1500}
            words={[{ t: "Now" }, { t: "posting" }, { t: "itself" }, { t: "is" }, { t: "delegated.", c: D.lime, serif: true }]} />
          <div style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
            {SLAM.map((t, i) => {
              const s = spring({ frame: frame - (398 + i * 24), fps, config: { damping: 22, stiffness: 135 } });
              const last = i === SLAM.length - 1;
              return (
                <div key={i} style={{
                  opacity: s, transform: `translateY(${(1 - s) * 26}px)`,
                  fontFamily: display, fontWeight: last ? 700 : 600, fontSize: last ? 54 : 44,
                  color: last ? D.ink : D.sub, letterSpacing: -1,
                }}>
                  {last ? <>It reports back — <span style={{ color: D.lime, fontFamily: serif, fontStyle: "italic" }}>with earnings.</span></> : t}
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      </Sect>

      {/* ══ S4 · OWNER CARD (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={64} maxWidth={1560}
            words={[{ t: "You're" }, { t: "not" }, { t: "the" }, { t: "editor" }, { t: "anymore.", serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 54px", width: 900, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>THE DISTRIBUTION AGE</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: "#fff", lineHeight: 1.25 }}>
                You're the <span style={{ color: D.limeBright }}>owner</span>.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.85)" }}>Get paid to post — without posting. 40+ clips a week, every view verified.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Own", serif: true }, { t: "the", serif: true }, { t: "reach.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
