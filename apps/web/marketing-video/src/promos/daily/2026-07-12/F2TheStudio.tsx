/**
 * F2 — "The Studio" · Pillar 3 feature deep-dive (UGC creation engine).
 * Watch one clip get made with nobody touching it: FIND → HOOK → CUT → SHIP,
 * a drawn pipeline down the left, real agent footage in a phone frame with a
 * quality-gate stamp, then the 40+/week dark card.
 * Layout: title → pipeline cascade + phone w/ stamp → dark output card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist } from "./dk";

const STAGES = [
  { k: "01 · FIND", t: "The moment worth clipping", d: "scans campaigns + trends" },
  { k: "02 · HOOK", t: "Lands in the first second", d: "written per platform" },
  { k: "03 · CUT", t: "Captions · style · grade", d: "quality-gated, never slop" },
  { k: "04 · SHIP", t: "Posted everywhere", d: "TikTok · Reels · Shorts · X" },
];

export const F2TheStudio: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* pipeline connector line draw (SVG dashoffset) */
  const lineLen = 560;
  const drawn = interpolate(frame, [230, 420], [lineLen, 0], CL);
  const stamp = spring({ frame: frame - 420, fps, config: { damping: 14, stiffness: 160 } });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>FEATURE · THE STUDIO</Tag></Rise>
          <Line at={18} size={96} maxWidth={1550}
            words={[{ t: "Watch" }, { t: "one" }, { t: "clip" }, { t: "get" }, { t: "made.", c: D.lime, serif: true }]} />
          <Line at={56} size={58} maxWidth={1550} color={D.sub} weight={500}
            words={[{ t: "Nobody" }, { t: "touched" }, { t: "it." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · PIPELINE + PHONE (150–500) ══ */}
      <Sect from={150} to={500}>
        <div style={{ position: "absolute", top: 62, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>THE UGC ENGINE · ONE CLIP, START TO SHIP</Tag></div></Rise>
        </div>

        {/* connector line */}
        <svg width="8" height={lineLen} style={{ position: "absolute", left: 232, top: 208 }}>
          <line x1="4" y1="0" x2="4" y2={lineLen} stroke={D.lime} strokeWidth="3"
            strokeDasharray={lineLen} strokeDashoffset={drawn} strokeLinecap="round" />
        </svg>

        {/* stage cascade (left) */}
        <div style={{ position: "absolute", left: 190, top: 176, width: 760, display: "flex", flexDirection: "column", gap: 20 }}>
          {STAGES.map((st, i) => {
            const s = spring({ frame: frame - (196 + i * 48), fps, config: { damping: 23, stiffness: 130 } });
            return (
              <div key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 28}px)`, display: "flex", gap: 20, alignItems: "center" }}>
                <div style={{
                  width: 88, height: 88, borderRadius: 22, flexShrink: 0,
                  background: "#FFFFFF", border: `1.5px solid ${D.line}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: mono, fontSize: 17, color: D.lime, fontWeight: 700, letterSpacing: 1,
                  boxShadow: "0 10px 24px rgba(32,38,28,0.08)",
                }}>{st.k.slice(0, 2)}</div>
                <Card style={{ flex: 1, padding: "20px 28px" }}>
                  <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: D.faint }}>{st.k}</div>
                  <div style={{ fontFamily: display, fontWeight: 650, fontSize: 30, color: D.ink, marginTop: 4 }}>{st.t}</div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: D.sub, marginTop: 4 }}>{st.d}</div>
                </Card>
              </div>
            );
          })}
        </div>

        {/* phone frame — the output (right) */}
        <Rise at={250} style={{ position: "absolute", right: 250, top: 190 }}>
          <div style={{
            width: 330, height: 700, borderRadius: 44, padding: 12,
            background: D.dark, boxShadow: "0 30px 70px rgba(32,38,28,0.30)",
          }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative", background: "#000" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 14, bottom: 16, fontFamily: mono, fontSize: 13, letterSpacing: 1, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>
                the finished clip
              </div>
              {/* quality-gate stamp */}
              <div style={{
                position: "absolute", top: 28, right: -6,
                opacity: stamp, transform: `scale(${0.6 + stamp * 0.4}) rotate(-12deg)`,
                fontFamily: mono, fontSize: 20, fontWeight: 700, letterSpacing: 2, color: D.limeBright,
                border: `3px solid ${D.limeBright}`, borderRadius: 12, padding: "10px 16px",
                background: "rgba(22,27,18,0.65)", backdropFilter: "blur(4px)",
              }}>QUALITY-GATED ✓</div>
            </div>
          </div>
        </Rise>
      </Sect>

      {/* ══ S3 · OUTPUT CARD (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={514} size={64} maxWidth={1500}
            words={[{ t: "You" }, { t: "don't" }, { t: "edit." }, { t: "You" }, { t: "approve.", c: D.lime, serif: true }]} />
          <Rise at={560}>
            <Card dark style={{ padding: "36px 54px", width: 900, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>THE STUDIO · WEEKLY OUTPUT</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: "#fff", lineHeight: 1.25 }}>
                <span style={{ color: D.limeBright }}>40+ clips a week</span> — every one different.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Quality-gated, varied, value-adding — it keeps your accounts alive.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "It", serif: true }, { t: "makes.", serif: true }, { t: "It", serif: true }, { t: "ships.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
