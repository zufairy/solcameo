/**
 * N1 — "Kaverro Rising" · Pillar 9 persona showcase.
 * One named AI-influencer agent you OWN: it picked a niche, wrote the scripts,
 * filmed itself, posted 60× this week — you're the manager, it reports back
 * with earnings. Distinct from the roster/squad angle: a single creator's arc.
 * Layout: title → persona card + niche/output stats cascade → dark
 * "reports back with earnings" manager card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const BEATS = [
  { k: "NICHE", v: "Skincare & beauty", s: "picked it itself" },
  { k: "THIS WEEK", v: "60 clips posted", s: "TikTok · Reels · Shorts · X" },
  { k: "VERIFIED VIEWS", v: "412,000", s: "@ $1–3 / 1,000" },
];

const StatRow: React.FC<{ at: number; b: typeof BEATS[number] }> = ({ at, b }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 21, stiffness: 150 } });
  return (
    <div style={{
      opacity: s, transform: `translateX(${(1 - s) * 34}px)`,
      display: "flex", alignItems: "center", gap: 22,
      padding: "20px 26px", borderRadius: 18, background: D.card, border: `1px solid ${D.line}`,
      boxShadow: "0 8px 20px rgba(32,38,28,0.06)",
    }}>
      <div style={{ width: 130, fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.faint }}>{b.k}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.ink }}>{b.v}</div>
        <div style={{ fontFamily: geist, fontSize: 17, color: D.sub }}>{b.s}</div>
      </div>
    </div>
  );
};

export const N1KaverroRising: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24 }}>
          <Rise at={8}><Tag>MEET YOUR INFLUENCER</Tag></Rise>
          <Line at={18} size={112} maxWidth={1550}
            words={[{ t: "Meet" }, { t: "Kaverro.", c: D.lime, serif: true }]} />
          <Line at={52} size={54} maxWidth={1400} color={D.sub} weight={500}
            words={[{ t: "Not" }, { t: "a" }, { t: "person" }, { t: "—" }, { t: "an" }, { t: "agent" }, { t: "you" }, { t: "own." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · PERSONA CARD + STATS (150–520) ══ */}
      <Sect from={150} to={520}>
        <div style={{ position: "absolute", top: 60, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>ONE AGENT · A FULL CONTENT TEAM</Tag></div></Rise>
        </div>

        {/* persona card (left) */}
        <Rise at={176} style={{ position: "absolute", left: 190, top: 175 }}>
          <Card style={{ width: 470, padding: 0, overflow: "hidden" }}>
            <div style={{ position: "relative", height: 430, background: D.paper2 }}>
              <Img src={staticFile("gen/agent-influencer.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 18, top: 18 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 14, letterSpacing: 2, color: "#fff", background: "rgba(10,12,8,0.55)", borderRadius: 999, padding: "8px 14px", backdropFilter: "blur(6px)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: D.limeBright }} /> LIVE · POSTING
                </div>
              </div>
            </div>
            <div style={{ padding: "22px 26px" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>@kaverro</div>
              <div style={{ fontFamily: geist, fontSize: 18, color: D.sub, marginTop: 2 }}>face-consistent · quality-gated · yours</div>
            </div>
          </Card>
        </Rise>

        {/* stats cascade (right) */}
        <div style={{ position: "absolute", right: 190, top: 200, width: 660, display: "flex", flexDirection: "column", gap: 16 }}>
          {BEATS.map((b, i) => <StatRow key={i} at={220 + i * 30} b={b} />)}
          <Rise at={340} style={{ marginTop: 8 }}>
            <div style={{ fontFamily: geist, fontSize: 23, color: D.ink }}>
              Fashion hauls at breakfast. Myth-busters at midnight. <b style={{ color: D.lime }}>Every clip verified.</b>
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · YOU'RE THE MANAGER (520–700) ══ */}
      <Sect from={520} to={700} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={534} size={62} maxWidth={1500}
            words={[{ t: "You're" }, { t: "the" }, { t: "manager." }, { t: "It" }, { t: "reports" }, { t: "back", serif: true }, { t: "with" }, { t: "earnings.", c: D.lime, serif: true }]} />
          <Rise at={580}>
            <Card dark style={{ padding: "34px 50px", width: 820 }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 20 }}>WEEKLY REPORT · @kaverro</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>POSTED</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: "#fff" }}><Count at={598} to={60} dur={60} suffix="×" /></div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: mono, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>VERIFIED VIEWS</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: "#fff" }}><Count at={606} to={412000} dur={70} /></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: mono, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>CASHED OUT</div>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, color: D.limeBright }}>$<Count at={614} to={824} dur={72} /></div>
                </div>
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "24px 0 16px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>You approve. You withdraw. Free for 30 days — no card.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={700} headline={[{ t: "Your" }, { t: "influencer.", serif: true }, { t: "Your" }, { t: "payout.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
