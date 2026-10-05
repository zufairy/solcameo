/**
 * H3 — "Always Posting" · Pillar 3 feature deep-dive (the auto-posting engine).
 * One long video → ten captioned clips → posted 40+×/week across every
 * platform, verified before payout. Real agent footage in a phone frame.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, Easing,
} from "remotion";
import { D, CL, EASE, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

export const H3AlwaysPosting: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const kb = interpolate(frame, [130, 470], [1.05, 1.14], { ...CL, easing: EASE });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–130) ══ */}
      <Sect from={0} to={130}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>THE POSTING ENGINE</Tag></Rise>
          <Line at={18} size={98} maxWidth={1550}
            words={[{ t: "Posting" }, { t: "is" }, { t: "a" }, { t: "full-time" }, { t: "job.", c: D.lime, serif: true }]} />
          <Rise at={56}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>Your agent treats it like one.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · CLIP + POST (130–500) ══ */}
      <Sect from={130} to={500}>
        <div style={{ position: "absolute", top: 74, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={140}><Tag>1 VIDEO → 10 CLIPS → EVERYWHERE</Tag></Rise>
        </div>

        {/* phone frame with real agent clip */}
        <Rise at={158} style={{ position: "absolute", left: 250, top: 250 }}>
          <div style={{ width: 300, height: 620, borderRadius: 44, background: D.ink, padding: 12, boxShadow: "0 30px 60px rgba(32,38,28,0.30)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
              <AbsoluteFill style={{ transform: `scale(${kb})` }}>
                <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={40} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </AbsoluteFill>
              <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>MADE ON VELLO</div>
            </div>
          </div>
        </Rise>

        {/* clipper card */}
        <div style={{ position: "absolute", left: 700, top: 270, width: 850, display: "flex", flexDirection: "column", gap: 26 }}>
          <Rise at={190}>
            <Card style={{ padding: "28px 36px", display: "flex", alignItems: "center", gap: 30 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 58, color: D.ink }}>1<span style={{ color: D.faint, fontSize: 38 }}> → </span><span style={{ color: D.lime }}>10</span></div>
              <div>
                <div style={{ fontFamily: display, fontWeight: 600, fontSize: 27, color: D.ink }}>AI Clipper</div>
                <div style={{ fontFamily: geist, fontSize: 20, color: D.sub, marginTop: 4 }}>One long video becomes ten sharp clips — captions tuned per platform.</div>
              </div>
            </Card>
          </Rise>

          {/* platform grid + weekly counter */}
          <Rise at={246}>
            <Card style={{ padding: "30px 36px" }}>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 27, color: D.ink, marginBottom: 20 }}>Auto-posting, every platform</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {["tiktok", "youtube", "instagram", "x"].map((p, i) => {
                  const ps = spring({ frame: frame - (270 + i * 8), fps, config: { damping: 16, stiffness: 160 } });
                  return (
                    <div key={p} style={{ width: 76, height: 76, borderRadius: 18, background: D.ink, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${ps})`, opacity: ps }}>
                      <Img src={staticFile(`platforms/${p}.svg`)} style={{ width: 36 }} />
                    </div>
                  );
                })}
                <div style={{ marginLeft: 20, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontFamily: display, fontWeight: 700, fontSize: 60, color: D.lime, lineHeight: 1 }}>
                    <Count at={300} to={42} dur={90} />
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 16, color: D.faint, letterSpacing: 2 }}>POSTS THIS WEEK</span>
                </div>
              </div>
            </Card>
          </Rise>

          <Rise at={330}>
            <div style={{ fontFamily: geist, fontSize: 24, color: D.sub }}>
              Day and night. <span style={{ color: D.ink, fontWeight: 600 }}>The feed never stops, so neither does your agent.</span>
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · VERIFIED PAYOUT (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <div style={{ position: "absolute", top: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={510}><Tag>PAID PER VIEW</Tag></Rise>
          <Line at={520} size={68} maxWidth={1400}
            words={[{ t: "Every" }, { t: "view" }, { t: "verified." }, { t: "Then" }, { t: "you're" }, { t: "paid.", c: D.lime, serif: true }]} />
        </div>
        <Rise at={560} style={{ position: "absolute", top: 380, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "40px 60px", display: "flex", alignItems: "center", gap: 60 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>RATE</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 74, color: D.limeBright, textShadow: `0 0 34px ${D.limeBright}44` }}>$1–3</div>
              <div style={{ fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.6)" }}>/ 1,000 verified views</div>
            </div>
            <div style={{ width: 1.5, alignSelf: "stretch", background: "rgba(255,255,255,0.14)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {["Oracle-verified before payout", "Cash out — Stripe · PayPal · USDC", "No bots. No fake views."].map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.9)" }}>
                  <span style={{ color: D.limeBright }}>✓</span> {t}
                </div>
              ))}
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Clip.", serif: true }, { t: "Post.", serif: true }, { t: "Repeat.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
