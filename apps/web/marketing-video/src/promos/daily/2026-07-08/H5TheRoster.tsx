/**
 * H5 — "The Roster" · Pillar 9 persona/squad showcase ("the squad you manage").
 * One agent = a whole content team: researcher, scriptwriter, editor, poster,
 * analyst. Delegation, not replacement — it reports back with the numbers.
 * Layout: title → radial roster of roles → earnings report card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, Count, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const ROLES = [
  { t: "Researcher", s: "finds the campaigns", x: 250, y: 300 },
  { t: "Scriptwriter", s: "shapes the hook", x: 250, y: 560 },
  { t: "Editor", s: "cuts the clips", x: 1400, y: 300 },
  { t: "Poster", s: "ships them everywhere", x: 1400, y: 560 },
];

const RoleCard: React.FC<{ at: number; role: typeof ROLES[number]; i: number }> = ({ at, role, i }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 22, stiffness: 130 } });
  const bob = Math.sin((frame - at) / 26 + i) * 6;
  return (
    <div style={{
      position: "absolute", left: role.x, top: role.y + bob, width: 300, opacity: s,
      transform: `translateY(${(1 - s) * 26}px) scale(${0.94 + s * 0.06})`,
    }}>
      <Card style={{ padding: "22px 26px", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: `${D.limeBright}2c`, border: `1.5px solid ${D.lime}55`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 700, fontSize: 22, color: D.lime }}>{i + 1}</div>
        <div>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 25, color: D.ink }}>{role.t}</div>
          <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, marginTop: 2 }}>{role.s}</div>
        </div>
      </Card>
    </div>
  );
};

export const H5TheRoster: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glyphS = spring({ frame: frame - 210, fps, config: { damping: 20, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · TITLE (0–140) ══ */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
          <Rise at={8}><Tag>THE SQUAD YOU MANAGE</Tag></Rise>
          <Line at={18} size={98} maxWidth={1550}
            words={[{ t: "Your" }, { t: "agent" }, { t: "isn't" }, { t: "one" }, { t: "thing." }]} />
          <Line at={54} size={72} maxWidth={1500}
            words={[{ t: "It's" }, { t: "a" }, { t: "whole" }, { t: "team.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · RADIAL ROSTER (140–480) ══ */}
      <Sect from={140} to={480}>
        {/* connectors from center */}
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {[[550, 340, 400, 355], [550, 620, 400, 590], [1370, 340, 1400, 355], [1370, 620, 1400, 590]].map((p, i) => (
            <line key={i} x1={960} y1={480} x2={p[2]} y2={p[3]}
              stroke={D.lime} strokeWidth="2" strokeDasharray="700"
              strokeDashoffset={interpolate(frame, [200 + i * 12, 240 + i * 12], [700, 0], CL)} opacity="0.35" />
          ))}
        </svg>

        {/* center agent hub */}
        <div style={{
          position: "absolute", left: 960, top: 480, transform: `translate(-50%,-50%) scale(${glyphS})`, opacity: glyphS,
          width: 220, height: 220, borderRadius: 50, overflow: "hidden",
          boxShadow: `0 24px 60px rgba(32,38,28,0.22), 0 0 80px ${D.limeBright}44`,
        }}>
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <Rise at={250} style={{ position: "absolute", left: 960, top: 620, transform: "translateX(-50%)" }}>
          <div style={{ fontFamily: mono, fontSize: 18, letterSpacing: 3, color: D.faint, textAlign: "center", width: 300 }}>ONE AGENT · FIVE ROLES</div>
        </Rise>

        {ROLES.map((r, i) => <RoleCard key={i} at={210 + i * 26} role={r} i={i} />)}

        <div style={{ position: "absolute", top: 80, width: "100%", textAlign: "center" }}>
          <Rise at={150}><div style={{ display: "inline-block" }}><Tag>YOU'RE THE MANAGER</Tag></div></Rise>
        </div>
      </Sect>

      {/* ══ S3 · IT REPORTS BACK (480–690) ══ */}
      <Sect from={480} to={690} bg={`linear-gradient(180deg, ${D.paper} 0%, ${D.paper2} 100%)`}>
        <div style={{ position: "absolute", top: 120, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Rise at={490}><Tag>THE ANALYST REPORTS BACK</Tag></Rise>
          <Line at={500} size={64} maxWidth={1400}
            words={[{ t: "You" }, { t: "read" }, { t: "the" }, { t: "numbers", c: D.lime }, { t: "in" }, { t: "the" }, { t: "morning." }]} />
        </div>
        <Rise at={540} style={{ position: "absolute", top: 380, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "38px 52px", width: 860 }}>
            <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 3, color: "rgba(255,255,255,0.5)", marginBottom: 22 }}>OVERNIGHT REPORT · @yourbrand</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {[
                { to: 12, suf: "", cap: "clips shipped" },
                { to: 4, suf: "", cap: "platforms" },
                { to: 96, suf: "K", cap: "views (verified)" },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: "center", flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 68, color: i === 2 ? D.limeBright : "#fff" }}>
                    <Count at={560} to={m.to} dur={80} suffix={m.suf} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: "rgba(255,255,255,0.6)", letterSpacing: 1 }}>{m.cap}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "28px 0 20px" }} />
            <div style={{ textAlign: "center", fontFamily: geist, fontSize: 22, color: "rgba(255,255,255,0.88)" }}>
              Five roles worked the night shift. You just approve and withdraw.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Manage", serif: true }, { t: "the", serif: true }, { t: "roster.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
