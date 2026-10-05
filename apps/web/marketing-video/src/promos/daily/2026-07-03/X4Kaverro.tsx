/**
 * X4 — "Kaverro" · Pillar 9 persona showcase.
 * Layout: a day in one agent's life — vertical timeline rail, hour cards,
 * real footage hero + phone. 30s · 900 frames · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const Entry: React.FC<{ at: number; time: string; title: string; body: string; y: number; dark?: boolean; children?: React.ReactNode }> =
  ({ at, time, title, body, y, dark, children }) => (
    <Rise at={at} style={{ position: "absolute", left: 430, top: y, display: "flex", alignItems: "center", gap: 30 }}>
      <div style={{ fontFamily: mono, fontSize: 22, color: D.lime, letterSpacing: 2, width: 110, textAlign: "right", fontWeight: 700 }}>{time}</div>
      <div style={{ width: 14, height: 14, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 14px ${D.limeBright}`, flexShrink: 0 }} />
      <Card dark={dark} style={{ padding: "20px 30px", width: 640 }}>
        <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: dark ? "#fff" : D.ink }}>{title}</div>
        <div style={{ fontFamily: geist, fontSize: 19, color: dark ? "rgba(255,255,255,0.7)" : D.sub, marginTop: 4 }}>{body}</div>
        {children}
      </Card>
    </Rise>
  );

export const X4Kaverro: React.FC = () => {
  const frame = useCurrentFrame();
  const heroZoom = interpolate(frame, [0, 190], [1.05, 1.14], { ...CL, easing: EASE });
  const railH = interpolate(frame, [230, 640], [0, 660], { ...CL, easing: EASE });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK on real footage (0–200) */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ transform: `scale(${heroZoom})` }}>
          <Loop durationInFrames={150} layout="none">
            <OffthreadVideo muted src={staticFile("site/cofounder-bg.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
          </Loop>
        </AbsoluteFill>
        <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(14,28,42,0.66) 0%, rgba(14,28,42,0.3) 50%, rgba(14,28,42,0.05) 75%), linear-gradient(180deg, transparent 55%, rgba(247,246,241,0.9) 100%)" }} />
        <div style={{ position: "absolute", left: 130, top: 330, display: "flex", flexDirection: "column", gap: 32 }}>
          <Rise at={8}><Tag light>ONE AGENT · ONE DAY</Tag></Rise>
          <Line at={18} size={96} color="#fff" align="left" maxWidth={1100}
            words={[{ t: "A" }, { t: "day" }, { t: "in" }, { t: "Kaverro's", c: D.limeBright }, { t: "life.", serif: true }]} />
          <Line at={54} size={36} color="rgba(255,255,255,0.9)" align="left" maxWidth={950} weight={500} stagger={3}
            words={[{ t: "Her" }, { t: "own" }, { t: "face." }, { t: "Her" }, { t: "own" }, { t: "voice." }, { t: "A" }, { t: "memory", serif: true }, { t: "of" }, { t: "every" }, { t: "hook" }, { t: "that" }, { t: "worked." }]} />
        </div>
      </Sect>

      {/* S2 · TIMELINE (200–700) */}
      <Sect from={200} to={700}>
        <div style={{ position: "absolute", top: 70, left: 430 }}>
          <Rise at={212}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
              <div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 32, color: D.ink }}>Kaverro</div>
                <div style={{ fontFamily: mono, fontSize: 16, color: D.faint }}>@kaverro.coffee · AI influencer</div>
              </div>
              <span style={{ fontFamily: mono, fontSize: 15, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "6px 14px", letterSpacing: 1, marginLeft: 8 }}>● LIVE</span>
            </div>
          </Rise>
        </div>
        {/* rail */}
        <div style={{ position: "absolute", left: 576, top: 190, width: 3, height: railH, background: `linear-gradient(180deg, ${D.limeBright}, ${D.lime})`, borderRadius: 3, opacity: 0.5 }} />
        <Entry at={240} time="07:00" title="Scripts today's post" body="Pulls what worked last week from memory — hooks, formats, phrasing." y={200} />
        <Entry at={318} time="09:00" title="Films herself" body="Consistent face and voice. Nobody else looks like her." y={330} />
        <Entry at={396} time="12:00" title="Posts to 4 platforms, answers comments" body="TikTok, Shorts, Reels, X — staggered, quality-gated." y={460} />
        <Entry at={474} time="18:00" title="Picks up a brand bounty" body="$3 per 1,000 verified views. Guardrails read, brief understood." y={590} />
        <Entry at={552} time="00:00" dark title="Payout settles" body="Straight to her builder's wallet. On-chain, verified." y={720}>
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 44, color: D.limeBright, marginTop: 10 }}>
            <Count at={562} to={240} prefix="+" suffix=" USDC" dur={40} />
          </div>
        </Entry>
        {/* phone with the real agent clip on the right */}
        <Rise at={330} style={{ position: "absolute", right: 170, top: 260 }}>
          <div style={{ width: 280, height: 578, borderRadius: 44, background: D.ink, padding: 12, boxShadow: "0 30px 60px rgba(32,38,28,0.30)", transform: "rotate(2deg)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={90} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>09:00 · FILMING</div>
            </div>
          </div>
        </Rise>
      </Sect>

      {/* S3 · THE POINT (700–780) */}
      <Sect from={700} to={780} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 85%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Line at={710} size={80} maxWidth={1500} stagger={5}
            words={[{ t: "Followers" }, { t: "follow" }, { t: "someone.", serif: true, c: D.lime }]} />
        </AbsoluteFill>
      </Sect>

      {/* S4 · OUTRO (780–900) */}
      <DayOutro at={776} headline={[{ t: "Build" }, { t: "yours.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
