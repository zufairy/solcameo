/**
 * P3 — "Open a Bounty" · Pillar 2 / demand-side (brand POV).
 * Post one bounty → a swarm of unique AI creators floods every platform →
 * you pay only for verified views. The brand never negotiates with a creator.
 * Layout: composer UI → swarm-of-posts cascade → draining pool. 30s · 900f.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist } from "./dk";

const PLATS = ["tiktok", "youtube", "instagram", "x"];
const HANDLES = ["@coco.brews", "@mattefit", "@nova.rides", "@kera.eats", "@lofi.den", "@pulse.gg", "@ashe.style", "@drift.co", "@mimi.makes", "@volt.club", "@sana.cafe", "@echo.labs"];

const PostChip: React.FC<{ i: number; at: number; x: number; y: number }> = ({ i, at, x, y }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 18, stiffness: 150 } });
  const bob = Math.sin((frame - at) / 26 + i) * 5;
  return (
    <div style={{
      position: "absolute", left: x, top: y + bob, width: 220,
      opacity: s, transform: `scale(${0.9 + s * 0.1}) translateY(${(1 - s) * 24}px)`,
      background: D.card, borderRadius: 16, border: `1px solid ${D.line}`,
      boxShadow: "0 12px 26px rgba(32,38,28,0.12)", padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
        <div style={{ fontFamily: geist, fontWeight: 600, fontSize: 15, color: D.ink, flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>{HANDLES[i % HANDLES.length]}</div>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: D.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Img src={staticFile(`platforms/${PLATS[i % PLATS.length]}.svg`)} style={{ width: 12, filter: "invert(1)" }} />
        </div>
      </div>
      <div style={{ marginTop: 8, height: 54, borderRadius: 10, background: `linear-gradient(135deg, ${D.paper2}, ${["#e7efd8", "#dfeaf4", "#efe6dd"][i % 3]})` }} />
      <div style={{ marginTop: 6, fontFamily: mono, fontSize: 12, color: D.lime, letterSpacing: 1 }}>● LIVE · {(3 + (i * 7) % 40)}.{(i * 3) % 9}K views</div>
    </div>
  );
};

export const P3Bounty: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* swarm grid positions */
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) cells.push({ x: 150 + c * 268, y: 288 + r * 158 });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · POST ONE BOUNTY (0–200) ══ */}
      <Sect from={0} to={200}>
        <div style={{ position: "absolute", top: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={8}><Tag>FOR BRANDS</Tag></Rise>
          <Line at={16} size={92} maxWidth={1500}
            words={[{ t: "Post" }, { t: "one" }, { t: "bounty.", c: D.lime, serif: true }]} />
        </div>
        <Rise at={70} style={{ position: "absolute", left: 0, right: 0, top: 400, display: "flex", justifyContent: "center" }}>
          <Card style={{ padding: 40, width: 820 }}>
            <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: D.faint, borderBottom: `1px solid ${D.line}`, paddingBottom: 16 }}>NEW CAMPAIGN BOUNTY</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 26 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 2 }}>REWARD POOL</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 64, color: D.ink }}>$2,000<span style={{ fontSize: 30, color: D.sub }}> USDC</span></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 2 }}>RATE</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 64, color: D.lime }}>$3<span style={{ fontSize: 26, color: D.sub }}> /1k views</span></div>
              </div>
            </div>
            <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 2 }}>TARGET</div>
              {PLATS.map((p, i) => {
                const ps = spring({ frame: frame - (110 + i * 7), fps, config: { damping: 16, stiffness: 160 } });
                return (
                  <div key={p} style={{ width: 54, height: 54, borderRadius: 14, background: D.ink, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${ps})`, opacity: ps }}>
                    <Img src={staticFile(`platforms/${p}.svg`)} style={{ width: 26, filter: "invert(1)" }} />
                  </div>
                );
              })}
              <div style={{ marginLeft: "auto", fontFamily: display, fontWeight: 700, fontSize: 24, color: "#0A0C08", background: D.limeBright, borderRadius: 999, padding: "14px 30px" }}>Open bounty →</div>
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S2 · THE SWARM FLOODS (200–480) ══ */}
      <Sect from={200} to={480}>
        <div style={{ position: "absolute", top: 70, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Rise at={210}><Tag>THE SWARM PICKS IT UP</Tag></Rise>
          <Line at={218} size={54} maxWidth={1600}
            words={[{ t: "Hundreds" }, { t: "of" }, { t: "creators." }, { t: "Every" }, { t: "one" }, { t: "unique.", c: D.lime, serif: true }]} />
        </div>
        {cells.map((c, i) => <PostChip key={i} i={i} at={246 + i * 6} x={c.x} y={c.y} />)}
        <Rise at={410} style={{ position: "absolute", left: 0, right: 0, top: 780, textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 22, color: D.lime, letterSpacing: 2 }}>
            <Count at={410} to={127} dur={50} /> VIDEOS LIVE · POSTED IN THE FIRST 24 HOURS
          </div>
        </Rise>
      </Sect>

      {/* ══ S3 · PAY FOR VIEWS (480–700) ══ */}
      <Sect from={480} to={700}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Line at={492} size={62} maxWidth={1400}
            words={[{ t: "You" }, { t: "pay" }, { t: "for" }, { t: "views" }, { t: "—" }, { t: "never" }, { t: "promises.", c: D.lime, serif: true }]} />
          <div style={{ display: "flex", gap: 40 }}>
            <Card style={{ padding: "36px 44px", width: 420 }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: D.faint }}>POOL REMAINING</div>
              <Count at={540} to={2000} prefix="$" dur={70} style={{ fontFamily: display, fontWeight: 700, fontSize: 72, color: D.ink }} />
              <div style={{ marginTop: 14, height: 10, borderRadius: 99, background: D.paper2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${interpolate(frame, [560, 660], [100, 38], CL)}%`, background: D.limeBright, borderRadius: 99 }} />
              </div>
              <div style={{ fontFamily: mono, fontSize: 14, color: D.sub, marginTop: 10 }}>drains only as verified views land</div>
            </Card>
            <Card dark style={{ padding: "36px 44px", width: 420 }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: "rgba(255,255,255,0.5)" }}>VERIFIED VIEWS DELIVERED</div>
              <Count at={560} to={640000} dur={90} style={{ fontFamily: display, fontWeight: 700, fontSize: 72, color: D.limeBright }} />
              <div style={{ marginTop: 16, fontFamily: geist, fontSize: 20, color: "rgba(255,255,255,0.75)" }}>No agency. No contracts. No negotiation.</div>
            </Card>
          </div>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={694} headline={[{ t: "Creators" }, { t: "on", serif: true }, { t: "demand.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
