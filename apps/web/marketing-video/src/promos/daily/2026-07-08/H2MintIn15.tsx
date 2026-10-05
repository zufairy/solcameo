/**
 * H2 — "Mint in 15" · Pillar 2 product walkthrough (feature: Build → Studio).
 * Describe a creator → persona assembles → a 15:00 countdown collapses to
 * 00:00 → the agent is live and working. Time-collapse product flow.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

/* typed prompt bubble */
const Prompt: React.FC<{ at: number; text: string }> = ({ at, text }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 22, stiffness: 130 } });
  const chars = Math.floor(interpolate(frame, [at + 4, at + 4 + text.length * 0.9], [0, text.length], CL));
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
      <div style={{
        maxWidth: 640, padding: "20px 26px", borderRadius: 22, borderBottomRightRadius: 6,
        background: D.ink, color: "#F4F6F0", fontFamily: geist, fontSize: 26, lineHeight: 1.4,
      }}>{text.slice(0, chars)}<span style={{ opacity: chars < text.length ? 0.6 : 0 }}>▍</span></div>
    </div>
  );
};

/* persona attribute chip that snaps in */
const AttrChip: React.FC<{ at: number; k: string; v: string }> = ({ at, k, v }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 16, stiffness: 160 } });
  return (
    <div style={{
      opacity: s, transform: `scale(${0.9 + s * 0.1})`,
      display: "flex", flexDirection: "column", gap: 4,
      padding: "16px 22px", borderRadius: 16, background: D.paper2, border: `1px solid ${D.line}`,
    }}>
      <span style={{ fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.faint }}>{k}</span>
      <span style={{ fontFamily: display, fontWeight: 600, fontSize: 24, color: D.ink }}>{v}</span>
    </div>
  );
};

export const H2MintIn15: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* countdown 15:00 → 00:00 across S3 */
  const cdT = interpolate(frame, [470, 610], [15 * 60, 0], CL);
  const mm = Math.max(0, Math.floor(cdT / 60));
  const ss = Math.max(0, Math.floor(cdT % 60));
  const cd = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–120) ══ */}
      <Sect from={0} to={120}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>BUILD · STUDIO</Tag></Rise>
          <Line at={18} size={100} maxWidth={1500}
            words={[{ t: "Launch" }, { t: "a" }, { t: "creator" }, { t: "in" }, { t: "15", c: D.lime }, { t: "minutes.", c: D.lime, serif: true }]} />
          <Rise at={58}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>No cameras. No editors. No hiring.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · DESCRIBE → PERSONA (120–470) ══ */}
      <Sect from={120} to={470}>
        <div style={{ position: "absolute", top: 80, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Rise at={130}><Tag>01 · DESCRIBE</Tag></Rise>
          <Line at={140} size={60} maxWidth={1400}
            words={[{ t: "Just" }, { t: "say" }, { t: "what" }, { t: "you" }, { t: "want.", c: D.lime }]} />
        </div>

        {/* chat panel */}
        <div style={{ position: "absolute", left: 150, top: 320, width: 700 }}>
          <Card style={{ padding: 34, display: "flex", flexDirection: "column", gap: 20, minHeight: 400 }}>
            <div style={{ display: "flex", gap: 22, fontFamily: mono, fontSize: 15, letterSpacing: 2, color: D.faint, borderBottom: `1px solid ${D.line}`, paddingBottom: 14 }}>
              <span style={{ color: D.ink, fontWeight: 700 }}>BUILD</span><span>STUDIO</span><span>CAMPAIGNS</span><span>EARN</span>
            </div>
            <Prompt at={190} text="A calm skincare creator. Speaks English + Malay. Soft, honest, science-y." />
            <Rise at={300}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: D.paper2, borderRadius: 16, padding: "16px 20px" }}>
                <div style={{ width: 46, height: 46, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 22, color: D.ink }}>Building persona…</div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>voice · memory · face · tone</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 26, color: D.lime }}>✦</span>
              </div>
            </Rise>
          </Card>
        </div>

        {/* persona assembly */}
        <div style={{ position: "absolute", right: 150, top: 320, width: 700 }}>
          <Rise at={250}>
            <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: 3, color: D.faint, marginBottom: 18 }}>02 · IT ASSEMBLES</div>
          </Rise>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <AttrChip at={286} k="NAME" v="Lumi" />
            <AttrChip at={312} k="VOICE" v="Warm · low" />
            <AttrChip at={338} k="LANGUAGES" v="EN · MS" />
            <AttrChip at={364} k="MEMORY" v="Persistent" />
          </div>
          <Rise at={400} style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 18, color: D.lime, letterSpacing: 1 }}>
              <span style={{ fontSize: 22 }}>✓</span> Consistent face &amp; voice, every clip
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · COUNTDOWN → LIVE (470–690) ══ */}
      <Sect from={470} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 82%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={478}>
            <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 5, color: D.faint }}>TIME TO A WORKING AGENT</div>
          </Rise>
          <div style={{
            fontFamily: mono, fontWeight: 700, fontSize: frame > 600 ? 210 : 200,
            color: cd === "00:00" ? D.lime : D.ink, letterSpacing: -4,
            textShadow: cd === "00:00" ? `0 0 50px ${D.limeBright}55` : "none",
            transition: "color 0.3s",
          }}>{cd}</div>
          <Rise at={612}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 54, height: 54, borderRadius: 14 }} />
              <span style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink }}>
                Lumi is live — clipping, posting, earning.
              </span>
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Describe.", serif: true }, { t: "Mint.", serif: true }, { t: "Earn.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
