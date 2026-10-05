/**
 * H1 — "The Other Clipper" · Pillar 1 consumer hook (contrarian strike).
 * Two clippers, same night: one still grinding manually, one asleep while
 * their Vello agent clips + posts 40× and cashes out per verified view.
 * Layout: title → split-screen (manual vs agent) → punchline → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

/* a slow, tedious manual step that ticks in and gets a grey check */
const ManualStep: React.FC<{ at: number; label: string; y: number }> = ({ at, label, y }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 26, stiffness: 90 } });
  const done = interpolate(frame, [at + 34, at + 44], [0, 1], CL);
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: y, opacity: s,
      transform: `translateY(${(1 - s) * 18}px)`,
      display: "flex", alignItems: "center", gap: 16,
      padding: "16px 22px", borderRadius: 14, background: "rgba(32,38,28,0.035)",
      border: `1px solid ${D.line}`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: 6, border: `2px solid ${D.faint}`,
        background: done ? D.faint : "transparent", display: "flex", alignItems: "center",
        justifyContent: "center", color: "#F7F6F1", fontSize: 14, fontFamily: display, fontWeight: 700,
      }}>{done > 0.5 ? "✓" : ""}</span>
      <span style={{ fontFamily: geist, fontSize: 23, color: D.sub, fontWeight: 500 }}>{label}</span>
    </div>
  );
};

/* a fast posted-clip chip cascading on the agent side */
const PostChip: React.FC<{ at: number; plat: string; y: number }> = ({ at, plat, y }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 18, stiffness: 170 } });
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: y, opacity: s,
      transform: `translateX(${(1 - s) * 30}px) scale(${0.96 + s * 0.04})`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 22px", borderRadius: 14,
      background: "#fff", border: `1.5px solid ${D.lime}33`,
      boxShadow: "0 10px 24px rgba(32,38,28,0.10)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 10px ${D.limeBright}` }} />
        <span style={{ fontFamily: mono, fontSize: 18, color: D.lime, letterSpacing: 1 }}>POSTED → {plat}</span>
      </div>
      <span style={{ fontFamily: mono, fontSize: 16, color: D.faint }}>✓ verified</span>
    </div>
  );
};

export const H1OtherClipper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–130) ══ */}
      <Sect from={0} to={130}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>SAME NIGHT · TWO CLIPPERS</Tag></Rise>
          <Line at={18} size={104} maxWidth={1500}
            words={[{ t: "One" }, { t: "grinds." }, { t: "One" }, { t: "sleeps.", c: D.lime, serif: true }]} />
          <Rise at={54}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub, maxWidth: 1000, textAlign: "center" }}>
              Guess which one still gets paid.
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · SPLIT SCREEN (130–470) ══ */}
      <Sect from={130} to={470}>
        {/* center divider line draw */}
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <line x1="960" y1="120" x2="960" y2="960" stroke={D.line} strokeWidth="2"
            strokeDasharray="840" strokeDashoffset={interpolate(frame, [140, 190], [840, 0], CL)} />
        </svg>

        {/* LEFT — manual */}
        <div style={{ position: "absolute", left: 120, top: 150, width: 700 }}>
          <Rise at={148}>
            <div style={{ fontFamily: mono, fontSize: 21, letterSpacing: 4, color: D.faint, marginBottom: 14 }}>THE MANUAL WAY</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.sub, marginBottom: 30 }}>
              still awake at 2AM
            </div>
          </Rise>
          <div style={{ position: "relative", height: 420 }}>
            <ManualStep at={196} label="Scrub the timeline" y={0} />
            <ManualStep at={252} label="Cut one clip" y={80} />
            <ManualStep at={308} label="Type the captions" y={160} />
            <ManualStep at={364} label="Upload. Wait. Repeat." y={240} />
          </div>
          <Rise at={420}>
            <div style={{ fontFamily: mono, fontSize: 22, color: D.faint, letterSpacing: 1 }}>
              1 clip · 1 platform · hours gone
            </div>
          </Rise>
        </div>

        {/* RIGHT — agent */}
        <div style={{ position: "absolute", left: 1090, top: 150, width: 720 }}>
          <Rise at={158}>
            <div style={{ fontFamily: mono, fontSize: 21, letterSpacing: 4, color: D.lime, marginBottom: 14 }}>THE VELLO AGENT</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink, marginBottom: 30 }}>
              working while you sleep
            </div>
          </Rise>
          <div style={{ position: "relative", height: 300 }}>
            <PostChip at={206} plat="TIKTOK" y={0} />
            <PostChip at={240} plat="YOUTUBE" y={72} />
            <PostChip at={274} plat="INSTAGRAM" y={144} />
            <PostChip at={308} plat="X" y={216} />
          </div>
          {/* dark earnings card — the money moment */}
          <Rise at={360} style={{ marginTop: 24 }}>
            <Card dark style={{ padding: "26px 34px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>PAID OVERNIGHT</div>
                <div style={{ fontFamily: mono, fontSize: 15, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>$1–3 / 1,000 verified views</div>
              </div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: D.limeBright, textShadow: `0 0 34px ${D.limeBright}44` }}>
                <Count at={372} to={40} suffix=" posts" />
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · PUNCHLINE (470–690) ══ */}
      <Sect from={470} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 80%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={486} size={78} maxWidth={1400} stagger={4}
            words={[{ t: "You're" }, { t: "not" }, { t: "competing" }, { t: "with" }, { t: "clippers." }]} />
          <Line at={540} size={90} maxWidth={1400} stagger={5}
            words={[{ t: "You're" }, { t: "competing" }, { t: "with" }, { t: "software.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Pick", serif: true }, { t: "your", serif: true }, { t: "side.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
