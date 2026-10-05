/**
 * M2 · "Three Verbs" — Pillar 2 (product walkthrough).
 * The whole job in three sequential full-panels: DESCRIBE (composer w/ real
 * cofounder-bg footage chip) → DEPLOY (persona assembles, live in 15 min) →
 * EARN (dark balance card). Distinct from the 2×2 simultaneous dashboard (L2)
 * and the tab-tour (J2): a clean, verb-by-verb narrative walkthrough.
 */
import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

const StepChip: React.FC<{ n: string; label: string; active: boolean }> = ({ n, label, active }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12, padding: "12px 22px", borderRadius: 999,
    background: active ? `${D.limeBright}26` : D.paper2, border: `1.5px solid ${active ? D.lime + "66" : D.line}`,
    transition: "all 0.3s",
  }}>
    <span style={{ fontFamily: mono, fontSize: 16, color: active ? D.lime : D.faint, letterSpacing: 2 }}>{n}</span>
    <span style={{ fontFamily: display, fontWeight: 700, fontSize: 24, color: active ? D.ink : D.faint }}>{label}</span>
  </div>
);

export const M2ThreeVerbs: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // typewriter for composer
  const typed = "A calm morning-coffee reviewer. Warm, honest, EN/MS.";
  const nChars = Math.floor(interpolate(frame, [180, 300], [0, typed.length], CL));
  const mintClock = Math.max(0, Math.ceil(interpolate(frame, [430, 520], [15, 0], CL)));
  const balance = interpolate(frame, [630, 760], [0, 184.30], { ...CL, easing: (x) => 1 - Math.pow(1 - x, 3) });

  const activeStep = frame < 420 ? 0 : frame < 620 ? 1 : 2;

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–150) */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>PRODUCT · HOW IT WORKS</Tag></Rise>
          <Line at={20} size={116} maxWidth={1560}
            words={[{ t: "Three" }, { t: "verbs.", c: D.lime, serif: true }, { t: "That's" }, { t: "the" }, { t: "job." }]} />
          <Rise at={78}><div style={{ fontFamily: geist, fontSize: 32, color: D.sub }}>Describe. Deploy. Earn.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* persistent step rail across body */}
      <Sect from={150} to={800}>
        <div style={{ position: "absolute", top: 70, width: "100%", display: "flex", justifyContent: "center", gap: 20 }}>
          <StepChip n="01" label="Describe" active={activeStep === 0} />
          <StepChip n="02" label="Deploy" active={activeStep === 1} />
          <StepChip n="03" label="Earn" active={activeStep === 2} />
        </div>
      </Sect>

      {/* S2 · DESCRIBE (150–420) */}
      <Sect from={150} to={420}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={168}>
            <Card style={{ width: 1240, padding: 40 }}>
              <div style={{ display: "flex", gap: 30 }}>
                {/* footage chip */}
                <div style={{ width: 300, height: 300, borderRadius: 20, overflow: "hidden", flexShrink: 0, border: `1.5px solid ${D.line}` }}>
                  <OffthreadVideo src={staticFile("site/cofounder-bg.mp4")} muted startFrom={30} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: D.lime }}>BUILD · DESCRIBE YOUR INFLUENCER</div>
                  <div style={{ marginTop: 18, minHeight: 150, borderRadius: 14, background: D.paper2, border: `1px solid ${D.line}`, padding: "22px 24px", fontFamily: geist, fontSize: 30, color: D.ink, lineHeight: 1.4 }}>
                    {typed.slice(0, nChars)}<span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: D.lime }}>|</span>
                  </div>
                  <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
                    {["name", "niche", "voice", "languages"].map((t) => (
                      <span key={t} style={{ fontFamily: mono, fontSize: 15, color: D.sub, background: D.paper2, border: `1px solid ${D.line}`, borderRadius: 99, padding: "8px 16px" }}>{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S3 · DEPLOY (420–620) */}
      <Sect from={420} to={620}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={432}>
            <Card style={{ width: 880, padding: 44 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: 96, height: 96, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})`, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 44, color: D.ink }}>Kaverro</div>
                  <div style={{ fontFamily: mono, fontSize: 20, color: D.faint }}>@kaverro.coffee · EN / MS</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 17, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "12px 20px", letterSpacing: 1.5 }}>✓ LIVE</span>
              </div>
              <div style={{ marginTop: 30, textAlign: "center", paddingTop: 26, borderTop: `1px solid ${D.line}` }}>
                <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.sub }}>ASSEMBLED & DEPLOYED IN</div>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 96, color: D.ink, lineHeight: 1.05 }}>{String(mintClock).padStart(2, "0")}:00 <span style={{ fontFamily: mono, fontSize: 30, color: D.faint }}>min</span></div>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · EARN (620–800) */}
      <Sect from={620} to={800}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          <Rise at={632}>
            <Card dark style={{ width: 900, padding: 44 }}>
              <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>EARN · PAID PER VERIFIED VIEW</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 92, color: D.limeBright, margin: "8px 0 18px" }}>${balance.toFixed(2)}</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {["Stripe", "PayPal", "USDC"].map((p) => (
                  <span key={p} style={{ fontFamily: mono, fontSize: 16, color: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 99, padding: "9px 18px" }}>{p}</span>
                ))}
                <span style={{ marginLeft: "auto", fontFamily: display, fontWeight: 700, fontSize: 22, color: "#0A0C08", background: D.limeBright, borderRadius: 99, padding: "12px 28px" }}>Withdraw</span>
              </div>
            </Card>
          </Rise>
          <Rise at={700}><div style={{ fontFamily: geist, fontSize: 28, color: D.sub }}>She finds campaigns, clips, and posts — on her own.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* S5 · CTA (800–900) */}
      <Sect from={800} to={900}>
        <EndCard at={808} kicker={[{ t: "Describe." }, { t: "Deploy." }, { t: "Earn.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
