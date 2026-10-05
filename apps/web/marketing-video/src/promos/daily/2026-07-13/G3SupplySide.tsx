/**
 * G3 — "Supply Side" · Pillar 8 market/investor angle.
 * Demand isn't the question — supply is. A stat triptych (73% of brands /
 * $40.5B→$152B / 3× engagement) told as three vertical panels sliding in,
 * each with its own micro-animation (needle, climbing bar pair, multiplier
 * pulse), then "every agent minted is inventory" + dark supply card.
 * Distinct layout: full-height 3-panel poster — no left/right split.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist, serif } from "./dk";

export const G3SupplySide: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const barA = interpolate(frame, [250, 330], [0, 86], CL);   // 73% arc fill
  const b1 = interpolate(frame, [290, 370], [0, 74], CL);     // $40.5B bar
  const b2 = interpolate(frame, [330, 430], [0, 250], CL);    // $152B bar
  const mult = spring({ frame: frame - 380, fps, config: { damping: 13, stiffness: 150 } });

  const PANEL: React.CSSProperties = { flex: 1, padding: "44px 40px", display: "flex", flexDirection: "column", gap: 14 };

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>THE MARKET · 2026</Tag></Rise>
          <Line at={18} size={92} maxWidth={1560}
            words={[{ t: "Demand" }, { t: "isn't" }, { t: "the" }, { t: "question." }]} />
          <div style={{
            fontFamily: serif, fontStyle: "italic", fontSize: 84, color: D.lime, letterSpacing: -1,
            opacity: interpolate(frame, [58, 78], [0, 1], CL),
            transform: `translateY(${interpolate(frame, [58, 84], [26, 0], CL)}px)`,
          }}>
            Supply is.
          </div>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · STAT TRIPTYCH (150–520) ══ */}
      <Sect from={150} to={520}>
        <div style={{ position: "absolute", top: 66, width: "100%", textAlign: "center" }}>
          <Rise at={160}><div style={{ display: "inline-block" }}><Tag>THREE NUMBERS BRANDS ALREADY KNOW</Tag></div></Rise>
        </div>
        <div style={{ position: "absolute", left: 130, right: 130, top: 160, bottom: 250, display: "flex", gap: 26 }}>
          {/* Panel A — 73% */}
          {[0, 1, 2].map((idx) => {
            const s = spring({ frame: frame - (185 + idx * 40), fps, config: { damping: 24, stiffness: 120 } });
            return (
              <div key={idx} style={{ display: "contents" }}>
                {idx === 0 && (
                  <div style={{ opacity: s, transform: `translateY(${(1 - s) * 46}px)`, flex: 1, display: "flex" }}>
                    <Card style={PANEL}>
                      <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>BUYING TODAY</div>
                      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 128, color: D.ink, lineHeight: 1 }}>
                        <Count at={230} to={73} dur={80} suffix="%" />
                      </div>
                      <div style={{ position: "relative", height: 16, borderRadius: 99, background: D.paper2, border: `1px solid ${D.line}`, overflow: "hidden" }}>
                        <div style={{ position: "absolute", inset: 0, width: `${barA}%`, background: `linear-gradient(90deg, ${D.lime}, ${D.limeBright})` }} />
                      </div>
                      <div style={{ fontFamily: geist, fontSize: 22, color: D.sub, lineHeight: 1.4 }}>of brands already buy creator content.</div>
                    </Card>
                  </div>
                )}
                {idx === 1 && (
                  <div style={{ opacity: s, transform: `translateY(${(1 - s) * 46}px)`, flex: 1, display: "flex" }}>
                    <Card style={PANEL}>
                      <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>CREATOR ECONOMY</div>
                      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 62, color: D.ink, lineHeight: 1.05 }}>
                        $40.5B → <span style={{ color: D.lime }}>$152B</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 26, height: 260, marginTop: 8 }}>
                        {[{ h: b1, l: "2024", c: D.faint }, { h: b2, l: "2030 (proj.)", c: D.lime }].map((b, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                            <div style={{ width: "100%", height: b.h, borderRadius: "12px 12px 4px 4px", background: i ? `linear-gradient(180deg, ${D.limeBright}, ${D.lime})` : "#D8D6CB" }} />
                            <span style={{ fontFamily: mono, fontSize: 14, color: b.c }}>{b.l}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </div>
                )}
                {idx === 2 && (
                  <div style={{ opacity: s, transform: `translateY(${(1 - s) * 46}px)`, flex: 1, display: "flex" }}>
                    <Card style={PANEL}>
                      <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: D.faint }}>AI-LED CREATORS</div>
                      <div style={{
                        fontFamily: display, fontWeight: 700, fontSize: 150, color: D.lime, lineHeight: 1,
                        transform: `scale(${0.8 + mult * 0.2})`, transformOrigin: "left center", opacity: Math.min(1, mult + 0.0001),
                      }}>3×</div>
                      <div style={{ fontFamily: geist, fontSize: 22, color: D.sub, lineHeight: 1.4 }}>the engagement of traditional accounts.</div>
                      <div style={{ fontFamily: mono, fontSize: 14, color: D.faint, marginTop: "auto" }}>SOURCE · VELLO CASE DATA</div>
                    </Card>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", bottom: 130, width: "100%", display: "flex", justifyContent: "center" }}>
          <Line at={430} size={54} maxWidth={1560}
            words={[{ t: "Every" }, { t: "agent" }, { t: "minted" }, { t: "is" }, { t: "inventory", c: D.lime, serif: true }, { t: "in" }, { t: "this" }, { t: "market." }]} />
        </div>
      </Sect>

      {/* ══ S3 · SUPPLY CARD (520–690) ══ */}
      <Sect from={520} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={532} size={64} maxWidth={1500}
            words={[{ t: "The" }, { t: "supply" }, { t: "side" }, { t: "is" }, { t: "being" }, { t: "minted", c: D.lime, serif: true }, { t: "now.", serif: true }]} />
          <Rise at={572}>
            <Card dark style={{ padding: "36px 54px", width: 940, textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 18 }}>NEW SUPPLY · PER AGENT</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 50, color: "#fff", lineHeight: 1.25 }}>
                Minted in <span style={{ color: D.limeBright }}>15 minutes</span>. Posts everywhere.
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "26px 0 18px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Finds campaigns · 40+ clips a week · earns $1–3 per 1K verified views.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Mint", serif: true }, { t: "the", serif: true }, { t: "supply.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
