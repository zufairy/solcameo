/**
 * J1 — "The Group Chat" · Pillar 1 consumer hook (confession/receipts format).
 * Friday night: the group chat notices you're posting 6×/day. Reveal: it's the
 * agent. Distinct layout: a messaging thread — bubbles cascading left/right in
 * a centered chat panel with typing indicator — then a dark receipts card.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, Count, display, mono, geist } from "./dk";

const MSGS = [
  { me: false, who: "dre", t: "bro how are you posting 6 times a day??", at: 170 },
  { me: false, who: "sam", t: "fr I saw you on tiktok AND shorts today", at: 215 },
  { me: false, who: "dre", t: "when do you even sleep", at: 258 },
  { me: true, who: "you", t: "I'm not posting.", at: 315 },
  { me: true, who: "you", t: "my agent is.", at: 355, lime: true },
  { me: false, who: "sam", t: "…your what", at: 400 },
  { me: true, who: "you", t: "it finds paid campaigns, clips, posts. I just approve.", at: 440 },
];

const Bubble: React.FC<{ m: typeof MSGS[0]; frame: number; fps: number }> = ({ m, frame, fps }) => {
  const s = spring({ frame: frame - m.at, fps, config: { damping: 24, stiffness: 150, mass: 0.8 } });
  return (
    <div style={{
      display: "flex", justifyContent: m.me ? "flex-end" : "flex-start",
      opacity: s, transform: `translateY(${(1 - s) * 26}px) scale(${0.92 + s * 0.08})`,
    }}>
      <div style={{ maxWidth: 560 }}>
        <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: 2, color: D.faint, margin: m.me ? "0 20px 5px 0" : "0 0 5px 20px", textAlign: m.me ? "right" : "left", textTransform: "uppercase" }}>{m.who}</div>
        <div style={{
          fontFamily: geist, fontSize: 27, lineHeight: 1.32, padding: "16px 26px",
          borderRadius: m.me ? "24px 24px 6px 24px" : "24px 24px 24px 6px",
          background: m.me ? (m.lime ? D.limeBright : D.ink) : "#fff",
          color: m.me ? (m.lime ? "#0A0C08" : "#fff") : D.ink,
          fontWeight: m.lime ? 650 : 450,
          border: m.me ? "none" : `1.5px solid ${D.line}`,
          boxShadow: m.me ? "0 14px 30px rgba(32,38,28,0.18)" : "0 10px 24px rgba(32,38,28,0.07)",
        }}>{m.t}</div>
      </div>
    </div>
  );
};

export const J1TheGroupChat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* typing indicator dots before the reveal */
  const typingOn = frame > 282 && frame < 313;
  const dot = (i: number) => 0.35 + 0.65 * Math.abs(Math.sin((frame - i * 5) / 9));

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–150) ══ */}
      <Sect from={0} to={150} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 70%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={8}><Tag>FRIDAY · 11:42 PM</Tag></Rise>
          <Line at={18} size={96} maxWidth={1560}
            words={[{ t: "The" }, { t: "group" }, { t: "chat" }, { t: "noticed.", c: D.lime, serif: true }]} />
          <Line at={58} size={54} maxWidth={1400} color={D.sub} weight={500}
            words={[{ t: "Six" }, { t: "posts" }, { t: "a" }, { t: "day" }, { t: "will" }, { t: "do" }, { t: "that." }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · THE THREAD (150–560) ══ */}
      <Sect from={150} to={560}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Card style={{ width: 900, height: 830, padding: "30px 44px", display: "flex", flexDirection: "column", background: D.paper2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 18, borderBottom: `1.5px solid ${D.line}`, marginBottom: 22 }}>
              <div style={{ width: 44, height: 44, borderRadius: 99, background: D.ink, color: "#fff", fontFamily: display, fontWeight: 700, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>3</div>
              <div style={{ fontFamily: display, fontWeight: 650, fontSize: 26, color: D.ink }}>the boys</div>
              <div style={{ marginLeft: "auto", fontFamily: mono, fontSize: 14, letterSpacing: 2, color: D.faint }}>FRI 23:42</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
              {MSGS.map((m, i) => <Bubble key={i} m={m} frame={frame} fps={fps} />)}
              {typingOn && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{ display: "flex", gap: 7, background: D.ink, borderRadius: "24px 24px 6px 24px", padding: "18px 24px" }}>
                    {[0, 1, 2].map((i) => <span key={i} style={{ width: 9, height: 9, borderRadius: 99, background: "#fff", opacity: dot(i) }} />)}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </AbsoluteFill>
      </Sect>

      {/* ══ S3 · RECEIPTS (560–690) ══ */}
      <Sect from={560} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Line at={572} size={62} maxWidth={1500}
            words={[{ t: "This" }, { t: "week's" }, { t: "receipts.", c: D.lime, serif: true }]} />
          <Rise at={604}>
            <Card dark style={{ padding: "36px 54px", width: 980, textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 70, marginBottom: 22 }}>
                {[
                  { n: 41, suf: "", lab: "CLIPS POSTED" },
                  { n: 96400, suf: "", lab: "VERIFIED VIEWS" },
                  { n: 4, suf: "", lab: "PLATFORMS" },
                ].map((s, i) => (
                  <div key={i}>
                    <Count at={614 + i * 8} to={s.n} dur={46} style={{ fontFamily: display, fontWeight: 700, fontSize: 66, color: D.limeBright }} />
                    <div style={{ fontFamily: mono, fontSize: 13.5, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>{s.lab}</div>
                  </div>
                ))}
              </div>
              <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "0 0 18px" }} />
              <div style={{ fontFamily: display, fontWeight: 650, fontSize: 34, color: "#fff" }}>I wrote <span style={{ color: D.limeBright, fontStyle: "italic" }}>none</span> of them.</div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Get", serif: true }, { t: "the", serif: true }, { t: "receipts.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
