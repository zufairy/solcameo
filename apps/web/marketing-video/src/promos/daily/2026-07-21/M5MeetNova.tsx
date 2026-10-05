/**
 * M5 · "Meet Nova" — Pillar 9 (persona showcase).
 * A new named agent: a gadget/tech reviewer. Profile page + real vello_clip3
 * footage in a phone frame + delegation reveal + dark monthly report card.
 * Distinct from Rhea (skincare, K5) and Juno (day-in-the-life, G4): different
 * niche, cooler palette accents, tech-review clip grid. No fabricated followers.
 */
import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

const Tile: React.FC<{ at: number; hue: string; label: string }> = ({ at, hue, label }) => {
  const s = useIn(at, 18);
  return (
    <div style={{
      width: 168, height: 168, borderRadius: 16, opacity: s, transform: `scale(${0.86 + s * 0.14})`,
      background: hue, border: `1px solid ${D.line}`, position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(255,255,255,0.28), rgba(255,255,255,0))" }} />
      <div style={{ position: "absolute", bottom: 10, left: 12, fontFamily: mono, fontSize: 12, color: "rgba(255,255,255,0.92)" }}>▶ {label}</div>
    </div>
  );
};

export const M5MeetNova: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)` }}>

      {/* S1 · MEET HER (0–200) */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag color={D.lime}>PERSONA · AI TECH REVIEWER</Tag></Rise>
          <Line at={20} size={128} maxWidth={1500}
            words={[{ t: "Meet" }, { t: "Nova.", c: D.lime, serif: true }]} />
          <Rise at={62}>
            <div style={{ fontFamily: geist, fontSize: 36, color: D.sub }}>She reviews gadgets. She isn't real.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · PROFILE (200–470) */}
      <Sect from={200} to={470}>
        {/* phone with real agent footage */}
        <Rise at={214} style={{ position: "absolute", left: 170, top: 200 }}>
          <div style={{ width: 300, height: 620, borderRadius: 44, background: D.ink, padding: 12, boxShadow: "0 30px 60px rgba(32,38,28,0.30)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={120} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>MADE ON VELLO</div>
            </div>
          </div>
        </Rise>

        {/* profile card */}
        <div style={{ position: "absolute", left: 560, top: 200, width: 1180 }}>
          <Rise at={240}>
            <Card style={{ padding: 40 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: 90, height: 90, borderRadius: 99, background: `linear-gradient(135deg, ${D.skyDeep}, ${D.limeBright})`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: D.ink }}>Nova</div>
                  <div style={{ fontFamily: mono, fontSize: 20, color: D.faint }}>@nova.reviews · EN</div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 16, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "10px 18px", letterSpacing: 2 }}>✓ AGENT</div>
              </div>
              <div style={{ display: "flex", gap: 46, marginTop: 26, paddingTop: 22, borderTop: `1px solid ${D.line}` }}>
                {[["41", "clips last week"], ["4", "platforms, auto-posted"], ["100%", "quality-gated"]].map(([n, l], i) => (
                  <div key={i}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink }}>{n}</div>
                    <div style={{ fontFamily: geist, fontSize: 19, color: D.sub }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 28 }}>
                {[["#1E2430", "unboxing"], ["#26303A", "hands-on"], ["#2B2436", "vs test"], ["#1F2E2A", "top 5"], ["#302A20", "specs"], ["#242A34", "verdict"]].map(([h, l], i) => (
                  <Tile key={i} at={280 + i * 12} hue={h} label={l} />
                ))}
              </div>
              <div style={{ fontFamily: geist, fontSize: 24, color: D.sub, marginTop: 24 }}>
                40+ clips a week — <span style={{ color: D.ink, fontWeight: 600 }}>every one different.</span>
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* S3 · REVEAL + REPORT (470–720) */}
      <Sect from={470} to={720}>
        <div style={{ position: "absolute", top: 108, width: "100%", textAlign: "center" }}>
          <Line at={482} size={62} maxWidth={1600}
            words={[{ t: "Built" }, { t: "in" }, { t: "fifteen", c: D.lime, serif: true }, { t: "minutes.", c: D.lime, serif: true }, { t: "Never" }, { t: "off." }]} />
          <Rise at={528}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub, marginTop: 18 }}>
              She never sleeps, never burns out, never asks for a day off.
            </div>
          </Rise>
        </div>
        <Rise at={560} style={{ position: "absolute", top: 384, left: 0, width: "100%", display: "flex", justifyContent: "center" }}>
          <Card dark style={{ padding: "38px 52px", width: 1200 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>NOVA · LAST MONTH</div>
              <div style={{ fontFamily: mono, fontSize: 15, color: D.limeBright, border: `1px solid ${D.limeBright}55`, borderRadius: 99, padding: "6px 14px" }}>REPORTS BACK</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 30 }}>
              {[["168", "clips shipped"], ["96,400", "verified views"], ["~$1,200", "earned, gross"], ["$50", "rent — paid by her"]].map(([n, l], i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: i === 2 ? D.limeBright : "#fff" }}>{n}</div>
                  <div style={{ fontFamily: geist, fontSize: 18, color: "rgba(255,255,255,0.68)", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* S4 · CTA (720–900) */}
      <Sect from={720} to={900}>
        <EndCard at={732} kicker={[{ t: "Launch" }, { t: "yours.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
