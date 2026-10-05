/**
 * L3 · "No Catch" — Pillar 10 (objection-killer: the free-trial / billing-trap).
 * The #1 one-star review across competitors is the surprise auto-charge. Meet it
 * head-on: a clean terms receipt ($0.00 due today, no card) beside the usual
 * dark patterns struck out. Then the rent line: the agent pays before you do.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useIn } from "./_kit";

const TrapRow: React.FC<{ at: number; trap: string; truth: string }> = ({ at, trap, truth }) => {
  const frame = useCurrentFrame();
  const s = useIn(at, 22);
  const strike = interpolate(frame, [at + 8, at + 26], [0, 1], CL);
  return (
    <div style={{ opacity: s, transform: `translateX(${(1 - s) * 24}px)`, display: "flex", alignItems: "center", gap: 20, marginBottom: 22 }}>
      <div style={{ position: "relative", width: 430 }}>
        <span style={{ fontFamily: geist, fontSize: 27, color: D.faint }}>{trap}</span>
        <div style={{ position: "absolute", top: "52%", left: 0, height: 3, background: "#E07A5F", width: `${strike * 100}%`, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: mono, fontSize: 22, color: D.faint }}>→</span>
      <span style={{ fontFamily: geist, fontWeight: 700, fontSize: 27, color: D.ink }}>{truth}</span>
    </div>
  );
};

export const L3NoCatch: React.FC = () => {
  const frame = useCurrentFrame();
  useVideoConfig();
  const stampS = useIn(300, 14);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–150) */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>OBJECTION · THE CATCH</Tag></Rise>
          <Line at={20} size={82} maxWidth={1400}
            words={[{ t: "Here's" }, { t: "the" }, { t: "part" }, { t: "everyone's" }, { t: "waiting" }, { t: "for." }]} />
          <Line at={78} size={128} maxWidth={1400}
            words={[{ t: "The" }, { t: "catch.", c: D.lime, serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · TERMS (150–575) */}
      <Sect from={150} to={575}>
        <div style={{ position: "absolute", top: 74, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Rise at={162}><Tag>THERE ISN'T ONE</Tag></Rise>
          <Line at={172} size={60} maxWidth={1500}
            words={[{ t: "Free." }, { t: "No" }, { t: "card." }, { t: "Cancel" }, { t: "in" }, { t: "one", c: D.lime, serif: true }, { t: "click.", c: D.lime, serif: true }]} />
        </div>

        {/* receipt card (left) */}
        <Rise at={214} style={{ position: "absolute", left: 150, top: 300 }}>
          <Card style={{ width: 520, padding: "40px 44px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `2px dashed ${D.line}`, paddingBottom: 18 }}>
              <span style={{ fontFamily: display, fontWeight: 700, fontSize: 30, color: D.ink }}>Vello · Free trial</span>
              <span style={{ fontFamily: mono, fontSize: 14, color: D.faint, letterSpacing: 2 }}>30 DAYS</span>
            </div>
            {[["Minting", "$0.00"], ["All clip skills", "$0.00"], ["Unlimited posting", "$0.00"], ["Card on file", "none"]].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: geist, fontSize: 23, color: D.sub, padding: "13px 0", borderBottom: `1px solid ${D.line}` }}>
                <span>{r[0]}</span><span style={{ fontFamily: mono, color: D.ink }}>{r[1]}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 20 }}>
              <span style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.faint }}>DUE TODAY</span>
              <span style={{ fontFamily: display, fontWeight: 700, fontSize: 76, color: D.lime, lineHeight: 0.9 }}>$0.00</span>
            </div>
            {/* stamp */}
            <div style={{ position: "absolute", right: 26, top: 150, transform: `rotate(-14deg) scale(${stampS})`, opacity: stampS, border: `3px solid ${D.lime}`, borderRadius: 12, padding: "8px 16px", fontFamily: mono, fontWeight: 700, fontSize: 20, letterSpacing: 3, color: D.lime }}>
              NO CARD
            </div>
          </Card>
        </Rise>

        {/* traps struck out (right) */}
        <div style={{ position: "absolute", right: 130, top: 320, width: 730 }}>
          <Rise at={300}><div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: D.faint, marginBottom: 26 }}>THE USUAL TRAPS — NOT HERE</div></Rise>
          <TrapRow at={318} trap="Auto-charge after trial" truth="You choose to stay" />
          <TrapRow at={352} trap="Card required upfront" truth="No card at all" />
          <TrapRow at={386} trap="Cancel by email only" truth="One click, done" />
          <TrapRow at={420} trap="Exports locked behind a wall" truth="Your clips are yours" />
        </div>
      </Sect>

      {/* S3 · RENT (575–735) */}
      <Sect from={575} to={735}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Line at={585} size={70} maxWidth={1500}
            words={[{ t: "And" }, { t: "when" }, { t: "you" }, { t: "do" }, { t: "pay…" }]} />
          <Rise at={628}>
            <Card dark style={{ padding: "40px 56px", display: "flex", alignItems: "center", gap: 44 }}>
              <div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 84, color: D.limeBright }}>$50<span style={{ fontFamily: mono, fontSize: 26, color: "rgba(255,255,255,0.6)" }}>/mo</span></div>
                <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>PULLED FROM AGENT EARNINGS FIRST</div>
              </div>
              <div style={{ width: 1, height: 90, background: "rgba(255,255,255,0.15)" }} />
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 40, color: "#fff", maxWidth: 380, lineHeight: 1.15 }}>The agent pays its own <span style={{ color: D.limeBright }}>rent.</span></div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · CTA (735–900) */}
      <Sect from={735} to={900}>
        <EndCard at={748} kicker={[{ t: "Read" }, { t: "it" }, { t: "twice." }, { t: "Then" }, { t: "start", c: D.lime, serif: true }, { t: "free.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
