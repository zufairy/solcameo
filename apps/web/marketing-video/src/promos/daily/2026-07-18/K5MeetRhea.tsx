/**
 * K5 — "Meet Rhea" · persona showcase (pillar 9) · Daybreak Pro · 30s / 900f.
 * An AI skincare creator: her vibe + vertical, real agent clip in a phone frame,
 * output cadence, then the delegation reveal + a dark monthly report card.
 * Grounded: mint in 15 · 40+/wk, every one different, quality-gated · ~$1,200/mo,
 * $50/mo agent pays its own rent. No fabricated follower counts.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import {
  D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, useIn,
  display, mono, geist,
} from "./dk";

const Tile: React.FC<{ at: number; hue: string }> = ({ at, hue }) => {
  const s = useIn(at, 18);
  return (
    <div style={{
      width: 176, height: 176, borderRadius: 18, opacity: s, transform: `scale(${0.86 + s * 0.14})`,
      background: hue, border: `1px solid ${D.line}`, position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(255,255,255,0.35), rgba(255,255,255,0))" }} />
      <div style={{ position: "absolute", bottom: 10, left: 12, fontFamily: mono, fontSize: 13, color: "rgba(255,255,255,0.9)" }}>▶ clip</div>
    </div>
  );
};

export const K5MeetRhea: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)` }}>

      {/* S1 · MEET HER */}
      <Sect from={0} to={200}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>PERSONA · AI SKINCARE CREATOR</Tag></Rise>
          <Line at={20} size={124} maxWidth={1500}
            words={[{ t: "Meet" }, { t: "Rhea.", c: D.lime, serif: true }]} />
          <Rise at={60}>
            <div style={{ fontFamily: geist, fontSize: 36, color: D.sub }}>Soft-morning skincare. A very consistent posting habit.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · THE PROFILE */}
      <Sect from={200} to={470}>
        {/* phone with real agent footage */}
        <Rise at={214} style={{ position: "absolute", left: 170, top: 190 }}>
          <div style={{ width: 300, height: 620, borderRadius: 44, background: D.ink, padding: 12, boxShadow: "0 30px 60px rgba(32,38,28,0.30)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={60} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>MADE ON VELLO</div>
            </div>
          </div>
        </Rise>

        {/* profile card */}
        <div style={{ position: "absolute", left: 560, top: 190, width: 1180 }}>
          <Rise at={240}>
            <Card style={{ padding: 40 }}>
              {/* header */}
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: 90, height: 90, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: D.ink }}>Rhea</div>
                  <div style={{ fontFamily: mono, fontSize: 20, color: D.faint }}>@rhea.skin</div>
                </div>
                <div style={{ fontFamily: mono, fontSize: 16, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "10px 18px", letterSpacing: 2 }}>✓ AGENT</div>
              </div>
              {/* stat strip */}
              <div style={{ display: "flex", gap: 46, marginTop: 26, paddingTop: 22, borderTop: `1px solid ${D.line}` }}>
                {[["41", "clips last week"], ["4", "platforms, auto-posted"], ["100%", "quality-gated"]].map(([n, l], i) => (
                  <div key={i}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 46, color: D.ink }}>{n}</div>
                    <div style={{ fontFamily: geist, fontSize: 19, color: D.sub }}>{l}</div>
                  </div>
                ))}
              </div>
              {/* clip grid */}
              <div style={{ display: "flex", gap: 20, marginTop: 28 }}>
                {["#E8C9D6", "#CBE3D2", "#D9D2EC", "#F0DCC0", "#CDE0EC", "#E5D3C4"].map((h, i) => (
                  <Tile key={i} at={280 + i * 12} hue={h} />
                ))}
              </div>
              <div style={{ fontFamily: geist, fontSize: 24, color: D.sub, marginTop: 24 }}>
                40+ clips a week — <span style={{ color: D.ink, fontWeight: 600 }}>every one different.</span>
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* S3 · THE REVEAL + REPORT */}
      <Sect from={470} to={690}>
        <div style={{ position: "absolute", top: 110, width: "100%", textAlign: "center" }}>
          <Line at={482} size={64} maxWidth={1600}
            words={[{ t: "You" }, { t: "built" }, { t: "her" }, { t: "in" }, { t: "fifteen", c: D.lime, serif: true }, { t: "minutes.", c: D.lime, serif: true }]} />
          <Rise at={528}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub, marginTop: 18 }}>
              She finds the campaigns, films, clips, posts — and reports back.
            </div>
          </Rise>
        </div>
        <Rise at={560} style={{ position: "absolute", top: 380, left: 0, width: "100%", display: "flex", justifyContent: "center" }}>
          <Card dark style={{ padding: "38px 52px", width: 1140 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>RHEA · MONTHLY REPORT</div>
              <div style={{ fontFamily: mono, fontSize: 15, color: D.limeBright, border: `1px solid ${D.limeBright}55`, borderRadius: 99, padding: "6px 14px" }}>YOU APPROVE</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 30 }}>
              {[["168", "clips shipped"], ["~$1,200", "earned, gross"], ["$50", "rent — paid by her"], ["+", "cleared her own way"]].map(([n, l], i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 50, color: i === 1 ? D.limeBright : "#fff" }}>{n}</div>
                  <div style={{ fontFamily: geist, fontSize: 19, color: "rgba(255,255,255,0.68)", marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
        </Rise>
      </Sect>

      <Vignette />
      <DayOutro at={690} headline={[{ t: "You're" }, { t: "the" }, { t: "manager.", c: D.lime, serif: true }]} />
    </AbsoluteFill>
  );
};

const W = 1920;
