/**
 * X5 — "Fair Questions" · Pillar 10 objection-killer.
 * Layout: serif italic questions center-stage, answer cards respond.
 * Three rounds: slop / bans / pricing. 30s · 900 frames · Daybreak Pro.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist, serif } from "./dk";

const Q: React.FC<{ at: number; words: { t: string; c?: string; serif?: boolean }[] }> = ({ at, words }) => (
  <div style={{ position: "absolute", top: 150, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
    <Rise at={at}><Tag>FAIR QUESTION</Tag></Rise>
    <Line at={at + 8} size={84} maxWidth={1500} words={words} />
  </div>
);

export const X5Objections: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* R1 · SLOP (0–250) */}
      <Sect from={0} to={250}>
        <Q at={8} words={[{ t: "“Isn't" }, { t: "this" }, { t: "just" }, { t: "AI" }, { t: "slop?”", serif: true, c: D.lime }]} />
        <div style={{ position: "absolute", top: 460, width: "100%", display: "flex", justifyContent: "center", gap: 36 }}>
          {[
            { at: 90, t: "Own face", s: "No two agents look alike" },
            { at: 116, t: "Own persona", s: "Builder-authored character" },
            { at: 142, t: "Own memory", s: "Learns what worked" },
          ].map((c, i) => (
            <Rise key={i} at={c.at}>
              <Card style={{ padding: "30px 38px", width: 380 }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 34, color: D.ink }}>{c.t}</div>
                <div style={{ fontFamily: geist, fontSize: 21, color: D.sub, marginTop: 6 }}>{c.s}</div>
              </Card>
            </Rise>
          ))}
        </div>
        <Rise at={180} style={{ position: "absolute", bottom: 130, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 34, color: D.ink }}>
            200 videos read as <span style={{ color: D.lime, fontFamily: serif, fontStyle: "italic" }}>200 different creators.</span>
          </div>
        </Rise>
      </Sect>

      {/* R2 · BANS (250–480) */}
      <Sect from={250} to={480}>
        <Q at={258} words={[{ t: "“Won't" }, { t: "my" }, { t: "accounts" }, { t: "get" }, { t: "banned?”", serif: true, c: D.lime }]} />
        <div style={{ position: "absolute", top: 460, width: "100%", display: "flex", justifyContent: "center" }}>
          <Card style={{ padding: "44px 60px", width: 1150 }}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.faint, marginBottom: 24 }}>THE ACCOUNT-SURVIVAL LAYER</div>
            <div style={{ display: "flex", gap: 40 }}>
              {[
                { at: 330, t: "Quality gates", s: "every clip adds value" },
                { at: 354, t: "Staggered schedules", s: "human-paced posting" },
                { at: 378, t: "Per-platform variation", s: "no template repeats" },
              ].map((c, i) => (
                <Rise key={i} at={c.at} style={{ flex: 1 }}>
                  <div style={{ borderLeft: `4px solid ${D.limeBright}`, paddingLeft: 22 }}>
                    <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: D.ink }}>{c.t}</div>
                    <div style={{ fontFamily: geist, fontSize: 20, color: D.sub, marginTop: 4 }}>{c.s}</div>
                  </div>
                </Rise>
              ))}
            </div>
          </Card>
        </div>
        <Rise at={410} style={{ position: "absolute", bottom: 120, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 34, color: D.ink }}>
            We keep your accounts <span style={{ color: D.lime, fontFamily: serif, fontStyle: "italic" }}>alive.</span>
          </div>
        </Rise>
      </Sect>

      {/* R3 · THE CATCH (480–720) */}
      <Sect from={480} to={720}>
        <Q at={488} words={[{ t: "“So" }, { t: "what's" }, { t: "the" }, { t: "catch?”", serif: true, c: D.lime }]} />
        <div style={{ position: "absolute", top: 440, width: "100%", display: "flex", justifyContent: "center", gap: 36 }}>
          <Rise at={560}>
            <Card style={{ padding: "36px 44px", width: 420, textAlign: "center" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: D.ink }}>Free month</div>
              <div style={{ fontFamily: mono, fontSize: 16, color: D.faint, letterSpacing: 2, marginTop: 8 }}>NO CREDIT CARD</div>
            </Card>
          </Rise>
          <Rise at={588}>
            <Card dark style={{ padding: "36px 44px", width: 620, textAlign: "center" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 52, color: "#fff" }}>
                then $50<span style={{ color: "rgba(255,255,255,0.5)", fontSize: 34 }}>/mo</span>
              </div>
              <div style={{ fontFamily: geist, fontSize: 22, color: D.limeBright, marginTop: 10, fontWeight: 600 }}>
                deducted from your agent's earnings first
              </div>
            </Card>
          </Rise>
        </div>
        <Rise at={636} style={{ position: "absolute", bottom: 130, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: display, fontWeight: 600, fontSize: 40, color: D.ink }}>
            Your agent pays <span style={{ color: D.lime, fontFamily: serif, fontStyle: "italic" }}>its own rent.</span>
          </div>
        </Rise>
      </Sect>

      {/* OUTRO (720–900) */}
      <DayOutro at={716} headline={[{ t: "No" }, { t: "catch.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
