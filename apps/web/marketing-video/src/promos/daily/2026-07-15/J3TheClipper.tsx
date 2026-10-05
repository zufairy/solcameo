/**
 * J3 — "The Clipper" · Pillar 3 feature deep-dive: the AI Clipper.
 * One long video in → the clipper reads the timeline, hook moments light up
 * on a scrubber, then three vertical clips punch out into phone frames (one
 * carrying real vello_clip3 footage). Distinct layout: full-width waveform
 * timeline with sweeping playhead + marker pops, then a phone-trio row.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist } from "./dk";

/* deterministic waveform bars */
const BARS = Array.from({ length: 72 }, (_, i) =>
  0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.53) * 0.4));

const HOOKS = [
  { x: 0.18, t: "00:42", label: "HOOK · payoff line" },
  { x: 0.47, t: "03:12", label: "HOOK · hot take" },
  { x: 0.78, t: "07:58", label: "HOOK · reveal" },
];

export const J3TheClipper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const TL_W = 1560;
  /* playhead sweeps the timeline 200→430 */
  const head = interpolate(frame, [200, 430], [0, 1], CL);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–160) ══ */}
      <Sect from={0} to={160} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>FEATURE · THE AI CLIPPER</Tag></Rise>
          <Line at={18} size={94} maxWidth={1600}
            words={[{ t: "One" }, { t: "upload." }, { t: "A" }, { t: "week", c: D.lime, serif: true }, { t: "of", serif: true }, { t: "posts.", serif: true }]} />
          <Line at={60} size={52} maxWidth={1400} color={D.sub} weight={500}
            words={[{ t: "Feed" }, { t: "it" }, { t: "one" }, { t: "long" }, { t: "video." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · TIMELINE SCAN (160–450) ══ */}
      <Sect from={160} to={450}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
          <Rise at={172}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3.5, color: D.faint }}>SOURCE · interview_full.mp4 · 08:31</div>
          </Rise>
          {/* waveform timeline */}
          <Rise at={182}>
            <Card style={{ width: TL_W, padding: "40px 40px 30px", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 180 }}>
                {BARS.map((h, i) => {
                  const pos = i / BARS.length;
                  const scanned = pos <= head;
                  const nearHook = HOOKS.some((hk) => Math.abs(pos - hk.x) < 0.035);
                  return (
                    <div key={i} style={{
                      flex: 1, height: `${h * 100}%`, borderRadius: 4,
                      background: scanned ? (nearHook ? D.limeBright : D.ink) : D.line,
                      transition: "none",
                    }} />
                  );
                })}
              </div>
              {/* playhead */}
              <div style={{
                position: "absolute", top: 26, bottom: 60, width: 3, borderRadius: 2,
                left: 40 + head * (TL_W - 80), background: D.lime,
                boxShadow: `0 0 18px ${D.limeBright}`,
                opacity: frame > 195 && frame < 440 ? 1 : 0,
              }} />
              {/* hook markers pop when the head passes */}
              {HOOKS.map((hk, i) => {
                const hitAt = 200 + hk.x * 230;
                const s = spring({ frame: frame - hitAt, fps, config: { damping: 16, stiffness: 180 } });
                return (
                  <div key={i} style={{
                    position: "absolute", left: 40 + hk.x * (TL_W - 80) - 90, top: -34,
                    opacity: s, transform: `translateY(${(1 - s) * 18}px) scale(${0.8 + s * 0.2})`,
                    fontFamily: mono, fontSize: 15, letterSpacing: 1.5, color: "#0A0C08",
                    background: D.limeBright, borderRadius: 999, padding: "9px 18px",
                    boxShadow: `0 12px 26px rgba(101,163,13,0.35)`, width: 200, textAlign: "center",
                  }}>{hk.t} · {hk.label.split("·")[1]}</div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontFamily: mono, fontSize: 14, color: D.faint }}>
                <span>00:00</span><span style={{ color: D.lime, letterSpacing: 2 }}>READING EVERY SECOND</span><span>08:31</span>
              </div>
            </Card>
          </Rise>
          <Rise at={392}>
            <div style={{ fontFamily: display, fontWeight: 650, fontSize: 40, color: D.ink }}>
              <span style={{ color: D.lime }}>3 hooks</span> a human editor would <span style={{ fontStyle: "italic" }}>miss</span>
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S3 · CLIPS OUT (450–690) ══ */}
      <Sect from={450} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
          <Line at={460} size={58} maxWidth={1500}
            words={[{ t: "Cut" }, { t: "vertical." }, { t: "Captioned." }, { t: "Shipped.", c: D.lime, serif: true }]} />
          <div style={{ display: "flex", gap: 44, alignItems: "center" }}>
            {HOOKS.map((hk, i) => {
              const at = 496 + i * 18;
              const s = spring({ frame: frame - at, fps, config: { damping: 22, stiffness: 130 } });
              return (
                <div key={i} style={{
                  opacity: s, transform: `translateY(${(1 - s) * 60}px) rotate(${(i - 1) * 2.5}deg)`,
                  width: 240, height: 424, borderRadius: 32, overflow: "hidden", position: "relative",
                  border: `4px solid ${D.ink}`, background: D.dark,
                  boxShadow: "0 30px 60px rgba(32,38,28,0.28)",
                }}>
                  {i === 1 ? (
                    <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      background: i === 0
                        ? `linear-gradient(200deg, ${D.skyDeep} 0%, ${D.dark} 78%)`
                        : `linear-gradient(160deg, #2A331F 0%, ${D.dark} 70%)`,
                    }}>
                      <div style={{ position: "absolute", left: 18, right: 18, top: "42%", fontFamily: display, fontWeight: 700, fontSize: 25, color: "#fff", lineHeight: 1.25 }}>
                        {i === 0 ? "the payoff, up front" : "“nobody says this part out loud”"}
                      </div>
                    </div>
                  )}
                  <div style={{ position: "absolute", left: 12, top: 12, fontFamily: mono, fontSize: 12.5, color: "#fff", background: "rgba(0,0,0,0.5)", borderRadius: 99, padding: "5px 12px" }}>{hk.t}</div>
                  <div style={{ position: "absolute", left: 12, bottom: 12, fontFamily: mono, fontSize: 12.5, color: D.limeBright, background: "rgba(0,0,0,0.55)", borderRadius: 99, padding: "5px 12px" }}>
                    {["→ TikTok", "→ Reels", "→ Shorts"][i]}
                  </div>
                </div>
              );
            })}
          </div>
          <Rise at={575}>
            <Card dark style={{ padding: "26px 46px", width: 1000, textAlign: "center" }}>
              <div style={{ fontFamily: display, fontWeight: 650, fontSize: 33, color: "#fff", lineHeight: 1.3 }}>
                Quality-gated. Varied. <span style={{ color: D.limeBright, fontStyle: "italic" }}>Keeps your accounts alive.</span>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "The", serif: true }, { t: "clipper", serif: true }, { t: "never", serif: true }, { t: "sleeps.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
