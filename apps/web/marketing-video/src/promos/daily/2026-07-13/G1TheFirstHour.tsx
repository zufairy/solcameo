/**
 * G1 — "The First Hour" · Pillar 6 swarm/scale spectacle (time-lapse angle).
 * A brand brief drops; we watch the swarm's first sixty minutes as a giant
 * timecode + live event feed: claims, first clip shipped, platforms lighting
 * up, views verifying. Distinct layout: huge mono clock left, cascading
 * event feed right, platform chips, dark T+60 status card.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist } from "./dk";

const EVENTS = [
  { m: "00:01", t: "Brief drops", d: "$2 / 1K verified views" },
  { m: "00:04", t: "agent · atlas claims", d: "hooks drafted per platform" },
  { m: "00:11", t: "First clip ships", d: "→ TikTok" },
  { m: "00:19", t: "agent · mira claims", d: "cut + captions running" },
  { m: "00:26", t: "Clips live", d: "→ Reels · Shorts" },
  { m: "00:38", t: "Thread posted", d: "→ X" },
  { m: "00:52", t: "Views verifying", d: "counted on-chain, per view" },
];

export const G1TheFirstHour: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* clock runs 00:00 → 60:00 across the feed section */
  const mins = interpolate(frame, [170, 500], [0, 60], CL);
  const mm = String(Math.floor(mins)).padStart(2, "0");
  const ss = String(Math.floor((mins % 1) * 60)).padStart(2, "0");

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>ONE BRIEF · SIXTY MINUTES</Tag></Rise>
          <Line at={18} size={96} maxWidth={1560}
            words={[{ t: "A" }, { t: "brief" }, { t: "drops." }, { t: "Then" }, { t: "what?", c: D.lime, serif: true }]} />
          <Line at={56} size={56} maxWidth={1500} color={D.sub} weight={500}
            words={[{ t: "Watch" }, { t: "the" }, { t: "first" }, { t: "hour." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · CLOCK + EVENT FEED (150–520) ══ */}
      <Sect from={150} to={520}>
        {/* giant timecode (left) */}
        <div style={{ position: "absolute", left: 150, top: 250, width: 660 }}>
          <Rise at={166}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3.5, color: D.faint }}>ELAPSED · SINCE THE BRIEF</div>
          </Rise>
          <Rise at={176}>
            <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 190, letterSpacing: -4, color: D.ink, lineHeight: 1, marginTop: 14 }}>
              {mm}<span style={{ color: D.lime }}>:</span>{ss}
            </div>
          </Rise>
          <Rise at={220}>
            <Card style={{ padding: "24px 32px", marginTop: 38, width: 520 }}>
              <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: D.faint }}>AGENTS ON THE BRIEF</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <Count at={240} to={18} dur={220} style={{ fontFamily: display, fontWeight: 700, fontSize: 96, color: D.lime, lineHeight: 1.15 }} />
                <span style={{ fontFamily: geist, fontSize: 20, color: D.sub }}>each clip different</span>
              </div>
            </Card>
          </Rise>
          <Rise at={300}>
            <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
              {["TikTok", "Reels", "Shorts", "X"].map((p, i) => {
                const s = spring({ frame: frame - (320 + i * 22), fps, config: { damping: 20, stiffness: 140 } });
                return (
                  <div key={p} style={{
                    opacity: s, transform: `scale(${0.7 + s * 0.3})`,
                    fontFamily: mono, fontSize: 18, letterSpacing: 2, color: D.ink,
                    background: "#fff", border: `1.5px solid ${D.line}`, borderRadius: 999, padding: "12px 24px",
                    boxShadow: "0 8px 18px rgba(32,38,28,0.08)",
                  }}>
                    <span style={{ color: D.lime, marginRight: 8 }}>●</span>{p}
                  </div>
                );
              })}
            </div>
          </Rise>
        </div>

        {/* event feed (right) */}
        <div style={{ position: "absolute", right: 150, top: 170, width: 840, display: "flex", flexDirection: "column", gap: 15 }}>
          {EVENTS.map((e, i) => {
            const at = 190 + i * 42;
            const s = spring({ frame: frame - at, fps, config: { damping: 23, stiffness: 130 } });
            return (
              <div key={i} style={{ opacity: s, transform: `translateX(${(1 - s) * 40}px)` }}>
                <Card style={{ padding: "16px 26px", display: "flex", alignItems: "center", gap: 22 }}>
                  <span style={{ fontFamily: mono, fontSize: 19, fontWeight: 700, color: D.lime, width: 78 }}>{e.m}</span>
                  <span style={{ fontFamily: display, fontWeight: 650, fontSize: 27, color: D.ink, flex: 1 }}>{e.t}</span>
                  <span style={{ fontFamily: mono, fontSize: 15, color: D.sub }}>{e.d}</span>
                </Card>
              </div>
            );
          })}
        </div>
      </Sect>

      {/* ══ S3 · T+60 STATUS CARD (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={64} maxWidth={1500}
            words={[{ t: "Minutes.", serif: true }, { t: "Not" }, { t: "weeks.", c: D.lime, serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 54px", width: 920, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>T+60:00 · BRIEF STATUS</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: "#fff", lineHeight: 1.25 }}>
                <span style={{ color: D.limeBright }}>14 clips live</span> across 4 platforms.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Each one different. Each view verified. Brands pay per view — not per post.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "The", serif: true }, { t: "swarm", serif: true }, { t: "is", serif: true }, { t: "fast.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
