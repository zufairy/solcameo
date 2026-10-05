/**
 * M4 · "Show Up Ten Thousand Times" — Pillar 7 (manifesto / anthem).
 * Anthem on volume > virality: pure editorial serif type, a cofounder-bg Ken
 * Burns passage, a slam word-count. Distinct from "Distribution was the
 * bottleneck" (G2) and "AI should work for humans" (D2): the thesis here is
 * that consistency at scale beats catching lightning once.
 */
import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, serif, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

export const M4ShowUp: React.FC = () => {
  const frame = useCurrentFrame();
  const clips = useCount(470, 200, 10000);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · THE MYTH (0–190) */}
      <Sect from={0} to={190}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>MANIFESTO</Tag></Rise>
          <Line at={22} size={104} maxWidth={1560}
            words={[{ t: "You" }, { t: "were" }, { t: "told" }, { t: "to" }, { t: "go" }, { t: "viral.", c: D.lime, serif: true }]} />
          <Rise at={92}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 40, color: D.sub }}>To catch lightning in a bottle.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE TURN — footage passage (190–470) */}
      <Sect from={190} to={470}>
        <AbsoluteFill>
          {/* Ken Burns footage */}
          <AbsoluteFill style={{ overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: -80, transform: `scale(${interpolate(frame, [190, 470], [1.08, 1.22], CL)})` }}>
              <OffthreadVideo src={staticFile("site/cofounder-bg.mp4")} muted startFrom={80} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />
            </div>
            <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.paper}CC 0%, ${D.paper}88 50%, ${D.paper}EE 100%)` }} />
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26, textAlign: "center" }}>
            <Line at={210} size={92} maxWidth={1500}
              words={[{ t: "But" }, { t: "lightning" }, { t: "isn't" }, { t: "a" }, { t: "strategy.", c: D.lime, serif: true }]} />
            <Rise at={300}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 86, color: D.ink }}>Showing up is.</div>
            </Rise>
          </AbsoluteFill>
        </AbsoluteFill>
      </Sect>

      {/* S3 · THE NUMBER (470–720) */}
      <Sect from={470} to={720}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Rise at={480}><div style={{ fontFamily: mono, fontSize: 22, letterSpacing: 5, color: D.faint, textTransform: "uppercase" }}>Every one a new shot</div></Rise>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 240, color: D.ink, lineHeight: 0.95, letterSpacing: -6 }}>{clips.toLocaleString()}</div>
          <Rise at={560}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 46, color: D.lime }}>clips — every one a little different.</div>
          </Rise>
          <Rise at={640}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub, maxWidth: 1200, textAlign: "center" }}>
              You don't need the algorithm to love you once. You need to be everywhere, always.
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · THESIS CARD (720–800) */}
      <Sect from={720} to={800}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={728}>
            <Card dark style={{ padding: "44px 60px", maxWidth: 1200 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: "#fff", textAlign: "center" }}>
                Volume is the new <span style={{ color: D.limeBright }}>talent.</span>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S5 · CTA (800–900) */}
      <Sect from={800} to={900}>
        <EndCard at={808} kicker={[{ t: "Let" }, { t: "your" }, { t: "agent" }, { t: "carry", c: D.lime, serif: true }, { t: "it.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
