/**
 * H4 — "Keep Your Accounts Alive" · Pillar 10 objection-killer (anti-slop).
 * Pre-empts the slop fear: quality-gated, varied, value-first clips that
 * survive the algorithm — plus honest, no-card pricing.
 * Layout: objection → quality gate checklist → clean pricing card → outro.
 * 30s · 900f · 30fps · 16:9 · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

/* a clip passing through the quality gate */
const GateRow: React.FC<{ at: number; label: string; note: string; y: number }> = ({ at, label, note, y }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame: frame - at, fps: 30, config: { damping: 22, stiffness: 140 } });
  const pass = interpolate(frame, [at + 20, at + 30], [0, 1], CL);
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: y, opacity: s,
      transform: `translateX(${(1 - s) * 40}px)`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "20px 28px", borderRadius: 16, background: "#fff",
      border: `1.5px solid ${pass > 0.5 ? D.lime + "44" : D.line}`,
      boxShadow: "0 12px 28px rgba(32,38,28,0.08)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontFamily: display, fontWeight: 600, fontSize: 27, color: D.ink }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: 16, color: D.faint }}>{note}</span>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, opacity: pass,
        fontFamily: mono, fontSize: 18, letterSpacing: 2, color: D.lime,
      }}>
        <span style={{ width: 30, height: 30, borderRadius: 99, background: `${D.limeBright}2c`, border: `1.5px solid ${D.lime}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>✓</span>
        PASS
      </div>
    </div>
  );
};

export const H4AccountsAlive: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · THE OBJECTION (0–140) ══ */}
      <Sect from={0} to={140}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>THE SLOP QUESTION</Tag></Rise>
          <Line at={18} size={96} maxWidth={1500}
            words={[{ t: "“Won’t" }, { t: "this" }, { t: "kill" }, { t: "my" }, { t: "account?”", c: D.lime, serif: true }]} />
          <Rise at={58}>
            <div style={{ fontFamily: geist, fontSize: 30, color: D.sub }}>Fair worry. So we built for it.</div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* ══ S2 · QUALITY GATE (140–470) ══ */}
      <Sect from={140} to={470}>
        <div style={{ position: "absolute", top: 80, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={150}><Tag>EVERY CLIP · QUALITY-GATED</Tag></Rise>
          <Line at={160} size={62} maxWidth={1400}
            words={[{ t: "Value" }, { t: "first." }, { t: "Varied." }, { t: "Account-safe.", c: D.lime }]} />
        </div>
        <div style={{ position: "absolute", left: "50%", top: 300, transform: "translateX(-50%)", width: 980, height: 420 }}>
          <GateRow at={210} label="Varied hooks & formats" note="never the same clip twice" y={0} />
          <GateRow at={260} label="Value-first, not filler" note="something worth watching" y={108} />
          <GateRow at={310} label="Human-in-the-loop approval" note="you ship it, or you don't" y={216} />
          <GateRow at={360} label="Platform-native captions" note="tuned per feed, not mass-blasted" y={324} />
        </div>
      </Sect>

      {/* ══ S3 · CLEAN PRICING (470–690) ══ */}
      <Sect from={470} to={690} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 82%)`}>
        <div style={{ position: "absolute", top: 110, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <Rise at={480}><Tag>AND THE PRICING STAYS HONEST</Tag></Rise>
        </div>
        <Rise at={512} style={{ position: "absolute", top: 300, left: "50%", transform: "translateX(-50%)" }}>
          <Card dark style={{ padding: "44px 60px", width: 900 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 40 }}>
              {[
                { big: "Free", sub: "for 30 days" },
                { big: "No card", sub: "to start" },
                { big: "1 click", sub: "to cancel" },
              ].map((c, i) => {
                const s = spring({ frame: frame - (524 + i * 12), fps, config: { damping: 18, stiffness: 150 } });
                return (
                  <div key={i} style={{ flex: 1, textAlign: "center", opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
                    <div style={{ fontFamily: display, fontWeight: 700, fontSize: 60, color: D.limeBright }}>{c.big}</div>
                    <div style={{ fontFamily: mono, fontSize: 18, color: "rgba(255,255,255,0.65)", letterSpacing: 1, marginTop: 6 }}>{c.sub}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ height: 1.5, background: "rgba(255,255,255,0.14)", margin: "34px 0 24px" }} />
            <div style={{ textAlign: "center", fontFamily: geist, fontSize: 24, color: "rgba(255,255,255,0.9)" }}>
              Then <span style={{ color: D.limeBright, fontWeight: 600 }}>the agent pays its own rent</span> — from what it earns first.
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ OUTRO ══ */}
      <DayOutro at={690} headline={[{ t: "Clean.", serif: true }, { t: "Quality-gated.", serif: true }, { t: "Alive.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
