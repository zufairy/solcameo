/**
 * J5 — "Zero Followers" · Pillar 10 objection-killer.
 * Objection: "but I have zero followers." Answer: short-form is discovery —
 * the feed is the audience; every clip competes on its own; volume × verified
 * views is the game. Distinct layout: a giant editorial "0" that flips from
 * liability to irrelevance, then clip cards streaming into a feed column with
 * independent view counters, then a dark verdict card. Pure type + counters.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist, serif } from "./dk";

const CLIPS = [
  { name: "clip_014", views: 18400, plat: "TikTok" },
  { name: "clip_022", views: 2100, plat: "Shorts" },
  { name: "clip_031", views: 44900, plat: "Reels" },
  { name: "clip_037", views: 7300, plat: "TikTok" },
  { name: "clip_040", views: 23300, plat: "X" },
];

export const J5ZeroFollowers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const zeroIn = spring({ frame: frame - 30, fps, config: { damping: 20, stiffness: 100, mass: 1.2 } });
  const strike = interpolate(frame, [150, 178], [0, 1], CL);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · THE OBJECTION (0–230) ══ */}
      <Sect from={0} to={230} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 65%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={8} style={{ position: "absolute", top: 120 }}>
            <Tag>THE OBJECTION</Tag>
          </Rise>
          <div style={{ position: "relative", marginTop: -20 }}>
            <div style={{
              fontFamily: display, fontWeight: 700, fontSize: 560, lineHeight: 1, color: D.ink,
              letterSpacing: -20, opacity: zeroIn, transform: `scale(${0.85 + zeroIn * 0.15})`,
            }}>0</div>
            {/* strike-through */}
            <div style={{
              position: "absolute", top: "51%", left: "-6%", height: 14, borderRadius: 8,
              width: `${strike * 112}%`, background: D.limeBright,
              boxShadow: `0 8px 30px rgba(163,230,53,0.5)`, transform: "rotate(-7deg)",
            }} />
          </div>
          <div style={{ position: "absolute", bottom: 130 }}>
            <Line at={64} size={56} maxWidth={1500} color={D.sub} weight={500}
              words={[{ t: "“But" }, { t: "I" }, { t: "have" }, { t: "zero" }, { t: "followers.”" }]} />
          </div>
          <div style={{ position: "absolute", bottom: 60, opacity: interpolate(frame, [186, 206], [0, 1], CL) }}>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 44, color: D.ink }}>Perfect.</div>
          </div>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE FEED IS THE AUDIENCE (230–560) ══ */}
      <Sect from={230} to={560}>
        {/* left: the argument */}
        <div style={{ position: "absolute", left: 150, top: 240, width: 780 }}>
          <Rise at={246}><Tag>HOW SHORT-FORM ACTUALLY WORKS</Tag></Rise>
          <div style={{ marginTop: 30 }}>
            <Line at={258} size={76} align="left" maxWidth={760}
              words={[{ t: "The" }, { t: "feed" }, { t: "is" }, { t: "the" }, { t: "audience.", c: D.lime, serif: true }]} />
          </div>
          <Rise at={310}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub, marginTop: 28, lineHeight: 1.5, maxWidth: 700 }}>
              Discovery is per-clip, not per-account. Every post competes on its own — follower count zero or a million.
            </div>
          </Rise>
          <Rise at={368}>
            <div style={{ marginTop: 34, display: "flex", gap: 14, flexWrap: "wrap" }}>
              {["no audience needed", "40+ clips / week", "$1–3 / 1K verified views"].map((c, i) => (
                <span key={i} style={{ fontFamily: mono, fontSize: 18, color: i === 2 ? "#0A0C08" : D.ink, background: i === 2 ? D.limeBright : "#fff", border: `1.5px solid ${i === 2 ? D.limeBright : D.line}`, borderRadius: 999, padding: "12px 24px", boxShadow: "0 8px 18px rgba(32,38,28,0.08)" }}>{c}</span>
              ))}
            </div>
          </Rise>
        </div>

        {/* right: feed column — clips with independent view counters */}
        <div style={{ position: "absolute", right: 150, top: 170, width: 660, display: "flex", flexDirection: "column", gap: 15 }}>
          <Rise at={266}>
            <div style={{ fontFamily: mono, fontSize: 14, letterSpacing: 3, color: D.faint, marginBottom: 2 }}>YOUR AGENT'S WEEK · FOLLOWERS: 0</div>
          </Rise>
          {CLIPS.map((c, i) => {
            const at = 282 + i * 34;
            const s = spring({ frame: frame - at, fps, config: { damping: 23, stiffness: 135 } });
            return (
              <div key={i} style={{ opacity: s, transform: `translateX(${(1 - s) * 44}px)` }}>
                <Card style={{ padding: "18px 28px", display: "flex", alignItems: "center", gap: 20 }}>
                  <span style={{ width: 46, height: 46, borderRadius: 12, background: i % 2 ? D.paper2 : D.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 15, color: i % 2 ? D.sub : D.limeBright }}>▶</span>
                  <span style={{ fontFamily: mono, fontSize: 17, color: D.sub, width: 110 }}>{c.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 15, color: D.faint, width: 78 }}>{c.plat}</span>
                  <span style={{ marginLeft: "auto", fontFamily: display, fontWeight: 700, fontSize: 30, color: D.lime }}>
                    <Count at={at + 12} to={c.views} dur={60} /> <span style={{ fontFamily: mono, fontSize: 14, color: D.faint, fontWeight: 400 }}>views</span>
                  </span>
                </Card>
              </div>
            );
          })}
          <Rise at={470}>
            <div style={{ textAlign: "right", fontFamily: mono, fontSize: 17, letterSpacing: 2, color: D.sub, marginTop: 6 }}>
              EACH ONE FOUND ITS OWN CROWD
            </div>
          </Rise>
        </div>
      </Sect>

      {/* ══ S3 · VERDICT (560–690) ══ */}
      <Sect from={560} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={572} size={62} maxWidth={1560}
            words={[{ t: "Views,", serif: true }, { t: "verified.", c: D.lime, serif: true }, { t: "Not" }, { t: "followers." }]} />
          <Rise at={608}>
            <Card dark style={{ padding: "34px 54px", width: 980, textAlign: "center" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 42, color: "#fff", lineHeight: 1.3 }}>
                You don't bring an audience.<br />
                <span style={{ color: D.limeBright, fontStyle: "italic" }}>You bring volume.</span>
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "22px 0 16px" }} />
              <div style={{ fontFamily: geist, fontSize: 21, color: "rgba(255,255,255,0.85)" }}>Free for 30 days · no card · cancel in one click</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Zero", serif: true }, { t: "is", serif: true }, { t: "enough.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
