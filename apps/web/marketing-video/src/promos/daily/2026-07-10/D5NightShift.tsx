/**
 * D5 — "Night Shift" · Pillar 1 consumer hook (get paid to post, without posting).
 * You were asleep — the agent posted 47 clips overnight. Wake up, approve,
 * withdraw. Real agent footage in a phone frame + an overnight "posted" feed +
 * a morning payout card.
 * Layout: night title → phone footage + stacking overnight feed → dark
 * morning-payout card w/ approve → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const FEED = [
  { p: "TikTok", t: "skincare hook · 0:14" },
  { p: "Reels", t: "before/after · 0:22" },
  { p: "Shorts", t: "myth-buster · 0:18" },
  { p: "X", t: "thread clip · 0:09" },
  { p: "TikTok", t: "duet reply · 0:16" },
];

const FeedRow: React.FC<{ at: number; row: typeof FEED[number]; i: number }> = ({ at, row, i }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 20, stiffness: 150 } });
  return (
    <div style={{
      opacity: s, transform: `translateX(${(1 - s) * 30}px)`,
      display: "flex", alignItems: "center", gap: 16,
      padding: "16px 20px", borderRadius: 16, background: D.card, border: `1px solid ${D.line}`,
      boxShadow: "0 6px 16px rgba(32,38,28,0.06)",
    }}>
      <span style={{ fontFamily: mono, fontSize: 20, color: D.lime }}>✓</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: display, fontWeight: 600, fontSize: 21, color: D.ink }}>Posted to {row.p}</div>
        <div style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>{row.t}</div>
      </div>
      <span style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>live</span>
    </div>
  );
};

export const D5NightShift: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · NIGHT TITLE (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, #2A3A44 0%, ${D.skyDeep} 46%, ${D.paper} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag light>WHILE YOU WERE ASLEEP</Tag></Rise>
          <Line at={18} size={100} maxWidth={1550} color="#F4F6F0"
            words={[{ t: "You" }, { t: "were" }, { t: "asleep." }]} />
          <Line at={50} size={100} maxWidth={1550} color="#F4F6F0"
            words={[{ t: "Your" }, { t: "agent" }, { t: "wasn't.", c: D.limeBright, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · PHONE + OVERNIGHT FEED (150–500) ══ */}
      <Sect from={150} to={500}>
        <div style={{ position: "absolute", top: 62, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>THE OVERNIGHT SHIFT</Tag></div></Rise>
        </div>

        {/* phone frame with real agent footage */}
        <Rise at={176} style={{ position: "absolute", left: 240, top: 170 }}>
          <div style={{
            width: 340, height: 720, borderRadius: 44, padding: 12,
            background: D.dark, boxShadow: `0 30px 70px rgba(32,38,28,0.30)`,
          }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative", background: "#000" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 14, bottom: 16, fontFamily: mono, fontSize: 13, letterSpacing: 1, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>
                @youragent · clipping
              </div>
            </div>
          </div>
        </Rise>

        {/* counter + feed (right) */}
        <div style={{ position: "absolute", right: 200, top: 200, width: 640 }}>
          <Rise at={210}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 120, color: D.lime, lineHeight: 1 }}>
                <Count at={230} to={47} dur={90} />
              </div>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 34, color: D.ink }}>clips<br />posted overnight</div>
            </div>
          </Rise>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 26 }}>
            {FEED.map((row, i) => <FeedRow key={i} at={300 + i * 26} row={row} i={i} />)}
          </div>
        </div>
      </Sect>

      {/* ══ S3 · MORNING PAYOUT (500–690) ══ */}
      <Sect from={500} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 60%)`}>
        <div style={{ position: "absolute", top: 118, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <Rise at={510}><Tag>YOU WAKE UP · YOU APPROVE</Tag></Rise>
          <Line at={520} size={62} maxWidth={1500}
            words={[{ t: "Get" }, { t: "paid" }, { t: "to" }, { t: "post" }, { t: "—" }, { t: "without" }, { t: "posting.", c: D.lime, serif: true }]} />
        </div>
        <Rise at={556} style={{ position: "absolute", top: 400, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "36px 50px", width: 860 }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 22 }}>MORNING PAYOUT · @youragent</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 14, color: "rgba(255,255,255,0.6)" }}>VERIFIED VIEWS OVERNIGHT</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 58, color: "#fff" }}>
                  <Count at={576} to={38000} dur={70} />
                </div>
                <div style={{ fontFamily: mono, fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>@ $1–3 / 1K · cashed to wallet</div>
              </div>
              <div style={{
                fontFamily: display, fontWeight: 700, fontSize: 30, color: "#0A0C08",
                background: D.limeBright, borderRadius: 16, padding: "20px 40px",
                boxShadow: `0 8px 0 ${D.lime}`,
                transform: `scale(${1 + Math.sin(Math.max(0, frame - 600) / 16) * 0.02})`,
              }}>Approve ✓</div>
            </div>
            <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
            <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Free for 30 days. No card. You approve, you withdraw.</div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "You" }, { t: "sleep.", serif: true }, { t: "It", serif: true }, { t: "earns.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
