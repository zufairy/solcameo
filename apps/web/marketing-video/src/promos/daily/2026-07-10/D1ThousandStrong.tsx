/**
 * D1 — "Thousand Strong" · Pillar 6 swarm/scale spectacle.
 * One brief → a swarm of clipper agents floods every platform. Aggregate
 * verified-views counter. Distribution at the scale of software.
 * Layout: title → multiplying chip-field over platform columns → dark
 * "one brief → a swarm" pay-per-view card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const PLATFORMS = ["TikTok", "Reels", "Shorts", "X"];

/* a single agent chip in the swarm grid */
const Chip: React.FC<{ at: number; x: number; y: number; i: number }> = ({ at, x, y, i }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 18, stiffness: 150, mass: 0.7 } });
  const bob = Math.sin((frame - at) / 22 + i * 0.6) * 3;
  return (
    <div style={{
      position: "absolute", left: x, top: y + bob,
      width: 26, height: 26, borderRadius: 8,
      background: i % 7 === 0 ? D.limeBright : `${D.lime}${i % 3 === 0 ? "cc" : "88"}`,
      border: `1px solid ${D.lime}`,
      opacity: s * 0.92, transform: `scale(${0.5 + s * 0.5})`,
      boxShadow: i % 7 === 0 ? `0 0 14px ${D.limeBright}88` : "none",
    }} />
  );
};

export const D1ThousandStrong: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glyphS = spring({ frame: frame - 160, fps, config: { damping: 20, stiffness: 120 } });

  /* build the swarm grid coords: 24 cols × 9 rows over the lower canvas */
  const cols = 24, rows = 9;
  const chips: { x: number; y: number; at: number; i: number }[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      chips.push({
        x: 210 + c * 60, y: 430 + r * 52,
        at: 250 + (r * cols + c) * 1.1, i: idx++,
      });
    }
  }

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–160) ══ */}
      <Sect from={0} to={160}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>A SWARM ON DEMAND</Tag></Rise>
          <Line at={18} size={104} maxWidth={1550}
            words={[{ t: "One" }, { t: "brief." }]} />
          <Line at={46} size={104} maxWidth={1550}
            words={[{ t: "A" }, { t: "thousand" }, { t: "clippers.", c: D.lime, serif: true }]} />
          <Rise at={92}>
            <div style={{ fontFamily: geist, fontSize: 29, color: D.sub }}>You open a bounty. The swarm shows up.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE SWARM FIELD (160–500) ══ */}
      <Sect from={160} to={500}>
        {/* header */}
        <div style={{ position: "absolute", top: 66, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Rise at={170}><Tag>ONE AGENT → MANY</Tag></Rise>
          <Line at={182} size={54} maxWidth={1500}
            words={[{ t: "Each" }, { t: "one" }, { t: "finds," }, { t: "clips," }, { t: "and" }, { t: "posts", c: D.lime }, { t: "40+/week." }]} />
        </div>

        {/* platform column labels */}
        <div style={{ position: "absolute", top: 380, left: 210, width: 1500, display: "flex", justifyContent: "space-between" }}>
          {PLATFORMS.map((p, i) => (
            <Rise key={i} at={210 + i * 8}>
              <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 2, color: D.faint, textTransform: "uppercase" }}>{p}</div>
            </Rise>
          ))}
        </div>

        {/* the multiplying chip field */}
        {chips.map((ch) => <Chip key={ch.i} at={ch.at} x={ch.x} y={ch.y} i={ch.i} />)}

        {/* aggregate counter chip — centered above the grid */}
        <div style={{ position: "absolute", top: 232, left: 0, width: "100%", display: "flex", justifyContent: "center" }}>
          <Rise at={330}>
            <Card style={{ padding: "18px 40px", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: D.faint }}>AGGREGATE VERIFIED VIEWS · THIS WEEK</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 60, color: D.lime, marginTop: 4 }}>
                <Count at={340} to={2400000} dur={150} suffix="" />
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · PAY PER VIEW CARD (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <div style={{ position: "absolute", top: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={510}><Tag>DISTRIBUTION AT THE SCALE OF SOFTWARE</Tag></Rise>
          <Line at={520} size={62} maxWidth={1500}
            words={[{ t: "Brands" }, { t: "pay" }, { t: "per" }, { t: "verified", c: D.lime }, { t: "view", c: D.lime }, { t: "—" }, { t: "not" }, { t: "per" }, { t: "post." }]} />
        </div>
        <Rise at={556} style={{ position: "absolute", top: 400, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "40px 54px", width: 900 }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 24 }}>ONE BRIEF · A SWARM OF CLIPPERS</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {[
                { pre: "", to: 1000, suf: "+", cap: "agents can answer" },
                { pre: "$", to: 3, suf: "", cap: "per 1K verified views" },
                { pre: "", to: 40, suf: "+/wk", cap: "posts, each agent" },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: i === 1 ? D.limeBright : "#fff" }}>
                    <Count at={576} to={m.to} dur={70} prefix={m.pre} suffix={m.suf} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>{m.cap}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "28px 0 20px" }} />
            <div style={{ textAlign: "center", fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.88)" }}>
              A swarm of creators on demand. You don't hire — you deploy.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Deploy", serif: true }, { t: "the", serif: true }, { t: "swarm.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
