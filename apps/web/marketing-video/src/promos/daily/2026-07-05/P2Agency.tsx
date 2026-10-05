/**
 * P2 — "The Agency" · Pillar 4 proof / single case study.
 * The $30K/mo clipping agency: 3 people, 0 editors, 42,000 clips a month.
 * Layout: editorial big-number hero + metric breakdown + a climbing month bar.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const Metric: React.FC<{ at: number; big: React.ReactNode; cap: string; y: number }> = ({ at, big, cap, y }) => (
  <Rise at={at} style={{ position: "absolute", left: 0, top: y }}>
    <Card style={{ padding: "24px 30px", width: 470, display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink, letterSpacing: -2, minWidth: 176 }}>{big}</div>
      <div style={{ fontFamily: geist, fontSize: 19, color: D.sub, lineHeight: 1.3 }}>{cap}</div>
    </Card>
  </Rise>
);

export const P2Agency: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heroZoom = interpolate(frame, [0, 190], [1.05, 1.15], { ...CL, easing: EASE });

  /* month bars */
  const bars = [22, 34, 41, 55, 63, 78, 92, 100];

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · HOOK on real footage (0–185) ══ */}
      <Sect from={0} to={185}>
        <AbsoluteFill style={{ transform: `scale(${heroZoom})` }}>
          <Loop durationInFrames={150} layout="none">
            <OffthreadVideo muted src={staticFile("site/cofounder-bg.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
          </Loop>
        </AbsoluteFill>
        <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(14,24,34,0.72) 0%, rgba(14,24,34,0.30) 55%, rgba(14,24,34,0.05) 100%)" }} />
        <div style={{ position: "absolute", left: 120, top: 340, display: "flex", flexDirection: "column", gap: 30 }}>
          <Rise at={8}><Tag light>CASE STUDY · CLIPPING AGENCY</Tag></Rise>
          <Line at={18} size={104} color="#fff" align="left" maxWidth={1100}
            words={[{ t: "Three" }, { t: "people." }, { t: "Zero" }, { t: "editors.", c: D.limeBright, serif: true }]} />
          <Line at={62} size={40} color="rgba(255,255,255,0.9)" align="left" weight={500} stagger={3} maxWidth={900}
            words={[{ t: "They" }, { t: "didn't" }, { t: "hire." }, { t: "They" }, { t: "deployed.", c: D.limeBright }]} />
        </div>
      </Sect>

      {/* ══ S2 · THE BIG NUMBER (185–470) ══ */}
      <Sect from={185} to={470}>
        <div style={{ position: "absolute", left: 130, top: 150 }}>
          <Rise at={196}><Tag>MONTHLY REVENUE</Tag></Rise>
          <Rise at={206}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 280, color: D.ink, letterSpacing: -12, lineHeight: 0.9, marginTop: 20 }}>
              $<Count at={214} to={30} dur={70} />K
            </div>
          </Rise>
          <Rise at={300}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 44, color: D.lime, marginTop: 4 }}>every month — run by software.</div>
          </Rise>
        </div>
        <div style={{ position: "absolute", left: 1320, top: 250, width: 470 }}>
          <Metric at={250} big={<><Count at={256} to={42} dur={60} />,000</>} cap="clips made & posted per month" y={0} />
          <Metric at={288} big="200/day" cap="sustained by the agent swarm" y={140} />
          <Metric at={326} big="0" cap="human editors on payroll" y={280} />
        </div>
      </Sect>

      {/* ══ S3 · THE MONTH CLIMB (470–700) ══ */}
      <Sect from={470} to={700}>
        <div style={{ position: "absolute", top: 96, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Rise at={480}><Tag>ONE MONTH, COMPOUNDING</Tag></Rise>
          <Line at={490} size={58} maxWidth={1500}
            words={[{ t: "Every" }, { t: "clip" }, { t: "makes" }, { t: "the" }, { t: "next" }, { t: "one" }, { t: "better.", c: D.lime }]} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 380, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 34, height: 340 }}>
          {bars.map((h, i) => {
            const s = spring({ frame: frame - (520 + i * 8), fps, config: { damping: 20, stiffness: 120 } });
            const last = i === bars.length - 1;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 92, height: h * 3 * s, borderRadius: "12px 12px 4px 4px",
                  background: last ? D.limeBright : `linear-gradient(180deg, ${D.ink}, #2f3a26)`,
                  boxShadow: last ? `0 0 40px ${D.limeBright}66` : "none",
                }} />
                <div style={{ fontFamily: mono, fontSize: 15, color: D.faint }}>W{i + 1}</div>
              </div>
            );
          })}
        </div>
        <Rise at={640} style={{ position: "absolute", left: 0, right: 0, top: 750, textAlign: "center" }}>
          <div style={{ fontFamily: geist, fontSize: 26, color: D.sub }}>This is what a content team costs now.</div>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "Deploy," }, { t: "don't", serif: true }, { t: "hire.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
