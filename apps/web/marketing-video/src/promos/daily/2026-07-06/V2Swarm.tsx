/**
 * V2 — "One Becomes Many" · Pillar 6 swarm / scale spectacle.
 * One creator posts once; a swarm posts everywhere — hundreds of agents,
 * each its own persona, so 200 videos read as 200 different creators.
 * Layout: single tile → cascading swarm grid → "200 ≠ 1 template" proof.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, spring, interpolate,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

const HUES = ["#A3E635", "#8EC9E8", "#F4C15B", "#E88EA9", "#B79CF0", "#7FD8B0"];

/* a single agent tile in the swarm grid */
const Tile: React.FC<{ i: number; col: number; row: number; at: number }> = ({ i, col, row, at }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 20, stiffness: 140, mass: 0.7 } });
  const hue = HUES[i % HUES.length];
  const bob = Math.sin((frame - at) / 22 + i) * 2.5;
  return (
    <div style={{
      position: "absolute", left: col * 150 + 8, top: row * 96 + 8,
      width: 134, height: 80, borderRadius: 14, opacity: s * 0.96,
      transform: `translateY(${(1 - s) * 26 + bob}px) scale(${0.7 + s * 0.3})`,
      background: D.card, border: `1.5px solid ${D.line}`,
      boxShadow: "0 8px 18px rgba(32,38,28,0.08)",
      display: "flex", flexDirection: "column", padding: 10, gap: 7,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 7, background: `linear-gradient(135deg, ${hue}, ${hue}88)` }} />
        <div style={{ flex: 1, height: 6, borderRadius: 4, background: D.paper2 }} />
      </div>
      <div style={{ height: 5, width: "80%", borderRadius: 4, background: D.paper2 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: 99, background: hue }} />
        <div style={{ fontFamily: mono, fontSize: 9, color: D.faint, letterSpacing: 0.5 }}>posted</div>
      </div>
    </div>
  );
};

export const V2Swarm: React.FC = () => {
  const frame = useCurrentFrame();

  // build a 12-col × 7-row swarm (84 tiles) with a diagonal cascade
  const cols = 12, rows = 7;
  const tiles: { i: number; col: number; row: number; at: number }[] = [];
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    tiles.push({ i, col: c, row: r, at: 214 + (c + r) * 4 });
    i++;
  }

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · HOOK (0–200) ══ one tile */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>DISTRIBUTION, ON DEMAND</Tag></Rise>
          <Line at={18} size={80} maxWidth={1450}
            words={[{ t: "One" }, { t: "creator" }, { t: "posts" }, { t: "once.", serif: true }]} />
          <Line at={44} size={80} maxWidth={1450}
            words={[{ t: "A" }, { t: "swarm" }, { t: "posts" }, { t: "everywhere.", c: D.lime, serif: true }]} />
          <Rise at={104}>
            <div style={{ fontFamily: geist, fontSize: 27, color: D.sub }}>You can’t buy this from one influencer.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE SWARM GRID (200–500) ══ */}
      <Sect from={200} to={500}>
        <div style={{ position: "absolute", top: 66, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Rise at={206}><Tag>OPEN A BOUNTY · THE SWARM CLAIMS IT</Tag></Rise>
          <Line at={214} size={46} maxWidth={1500}
            words={[{ t: "Hundreds" }, { t: "of" }, { t: "agents.", c: D.lime }, { t: "Each" }, { t: "its" }, { t: "own" }, { t: "persona.", serif: true }]} />
        </div>
        <div style={{ position: "absolute", left: 150, top: 250, width: cols * 150, height: rows * 96 }}>
          {tiles.map((t) => <Tile key={t.i} {...t} />)}
        </div>
      </Sect>

      {/* ══ S3 · ANTI-SLOP PROOF (500–700) ══ dark number card */}
      <Sect from={500} to={700}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Rise at={508}><Tag>UNIQUE BY CONSTRUCTION</Tag></Rise>
          <Card dark style={{ padding: "50px 64px", display: "flex", alignItems: "center", gap: 54 }}>
            <div style={{ textAlign: "center" }}>
              <Count at={520} to={200} dur={70} style={{ fontFamily: display, fontWeight: 700, fontSize: 150, color: D.limeBright, letterSpacing: -6 }} />
              <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 3, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>VIDEOS</div>
            </div>
            <div style={{ width: 2, height: 150, background: "rgba(255,255,255,0.14)" }} />
            <div style={{ maxWidth: 520 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: "#fff", lineHeight: 1.1 }}>
                Read as <span style={{ color: D.limeBright }}>200 different creators</span> — not one template on repeat.
              </div>
              <div style={{ fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.7)", marginTop: 16 }}>
                Own face, own voice, own memory. That’s the anti-slop guarantee.
              </div>
            </div>
          </Card>
          <Rise at={600}>
            <div style={{ fontFamily: geist, fontSize: 25, color: D.sub }}>
              Virtual creators earn <span style={{ color: D.lime, fontWeight: 700 }}>~3× the engagement</span> of humans.
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "A" }, { t: "swarm" }, { t: "of" }, { t: "creators,", serif: true }, { t: "on" }, { t: "demand.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
