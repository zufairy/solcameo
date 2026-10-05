/**
 * J4 — "Paper Trail" · Pillar 4 proof/case studies (the receipts wall).
 * Ignore the hype, read the paper trail: three stamped exhibits — 10K users in
 * 7 days, Cliphauz $30K/mo, $12K creator cash-outs in 30 days. Distinct
 * layout: evidence-dossier documents slamming in at slight angles with mono
 * EXHIBIT stamps, then a dark verdict card. Editorial, mostly type.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist, serif } from "./dk";

const EXHIBITS = [
  {
    tag: "EXHIBIT A", at: 190, rot: -2.2, x: -530,
    big: 10000, pre: "", suf: "", label: "users in the first 7 days",
    sub: "launch traction · organic",
  },
  {
    tag: "EXHIBIT B", at: 300, rot: 1.6, x: 0,
    big: 30000, pre: "$", suf: "/mo", label: "Cliphauz — clipping revenue",
    sub: "42K clips · zero editors",
  },
  {
    tag: "EXHIBIT C", at: 410, rot: -1.4, x: 530,
    big: 12000, pre: "$", suf: "", label: "creator cash-outs · first 30 days",
    sub: "paid to Stripe / PayPal / USDC",
  },
];

export const J4PaperTrail: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–170) ══ */}
      <Sect from={0} to={170} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>PROOF · NOT PITCH</Tag></Rise>
          <Line at={18} size={98} maxWidth={1560}
            words={[{ t: "Ignore" }, { t: "the" }, { t: "hype.", serif: true }]} />
          <Line at={52} size={98} maxWidth={1560}
            words={[{ t: "Read" }, { t: "the" }, { t: "paper" }, { t: "trail.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE EXHIBITS (170–560) ══ */}
      <Sect from={170} to={560} bg={D.paper2}>
        {/* faint dossier rule lines */}
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: 40, alignItems: "center" }}>
            {EXHIBITS.map((e, i) => {
              const s = spring({ frame: frame - e.at, fps, config: { damping: 19, stiffness: 120, mass: 1.05 } });
              const stamp = spring({ frame: frame - (e.at + 22), fps, config: { damping: 14, stiffness: 220 } });
              return (
                <div key={i} style={{
                  opacity: s,
                  transform: `translateY(${(1 - s) * 90}px) rotate(${e.rot * s}deg) scale(${0.9 + s * 0.1})`,
                }}>
                  <Card style={{ width: 480, height: 560, padding: "44px 40px", position: "relative", display: "flex", flexDirection: "column" }}>
                    {/* punched holes */}
                    <div style={{ position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 240 }}>
                      {[0, 1].map((h) => <span key={h} style={{ width: 16, height: 16, borderRadius: 99, background: D.paper2, border: `1.5px solid ${D.line}` }} />)}
                    </div>
                    <div style={{
                      alignSelf: "flex-start", marginTop: 16,
                      opacity: stamp, transform: `scale(${1.6 - stamp * 0.6}) rotate(-6deg)`,
                      fontFamily: mono, fontSize: 21, fontWeight: 700, letterSpacing: 4,
                      color: D.lime, border: `3px solid ${D.lime}`, borderRadius: 10, padding: "8px 18px",
                    }}>{e.tag}</div>
                    <div style={{ marginTop: "auto" }}>
                      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 76, color: D.ink, lineHeight: 1, letterSpacing: -2.5 }}>
                        {e.pre}<Count at={e.at + 30} to={e.big} dur={55} />
                        {e.suf && <span style={{ fontSize: 40, color: D.sub, letterSpacing: 0 }}>{e.suf}</span>}
                      </div>
                      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 30, color: D.ink, marginTop: 18, lineHeight: 1.3 }}>{e.label}</div>
                      <div style={{ height: 1.5, background: D.line, margin: "22px 0 16px" }} />
                      <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: D.sub }}>{e.sub}</div>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
        <Rise at={500} style={{ position: "absolute", bottom: 54, width: "100%", textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 4, color: D.sub }}>
            RATES IN THE OPEN · <span style={{ color: D.lime }}>$1–3 / 1,000 VERIFIED VIEWS</span>
          </div>
        </Rise>
      </Sect>

      {/* ══ S3 · VERDICT (560–690) ══ */}
      <Sect from={560} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={572} size={64} maxWidth={1500}
            words={[{ t: "Receipts,", serif: true }, { t: "not" }, { t: "promises.", c: D.lime, serif: true }]} />
          <Rise at={606}>
            <Card dark style={{ padding: "34px 54px", width: 960, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>THE PATTERN</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 44, color: "#fff", lineHeight: 1.3 }}>
                Every number here is <span style={{ color: D.limeBright, fontStyle: "italic" }}>a payout that already happened.</span>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Start", serif: true }, { t: "your", serif: true }, { t: "own", serif: true }, { t: "file.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
