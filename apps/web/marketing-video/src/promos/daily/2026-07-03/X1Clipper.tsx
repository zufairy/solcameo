/**
 * X1 — "The Clipper" · Pillar 3 feature deep-dive (AI Clipper).
 * Layout: left phone with real agent footage, right pipeline cascade.
 * 30s · 900 frames @ 30fps · Daybreak Pro.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate,
} from "remotion";
import { D, CL, Rise, Card, Tag, Line, Sect, DayOutro, Vignette, display, mono, geist } from "./dk";

const Phone: React.FC<{ at: number; x: number; y: number; w?: number }> = ({ at, x, y, w = 290 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 24, stiffness: 110 } });
  const h = w * 2.06;
  return (
    <div style={{
      position: "absolute", left: x, top: y + (1 - s) * 60, opacity: s,
      width: w, height: h, borderRadius: 44, background: D.ink, padding: 12,
      boxShadow: "0 30px 60px rgba(32,38,28,0.30)",
      transform: `rotate(${-2 + s * 2}deg)`,
    }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
        <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={30} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>MADE ON VELLO</div>
      </div>
    </div>
  );
};

export const X1Clipper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const steps = [
    { at: 250, n: "01", t: "Ingest", s: "One long video in" },
    { at: 286, n: "02", t: "Transcribe", s: "Every word mapped" },
    { at: 322, n: "03", t: "Moment-select", s: "Hooks found for you" },
    { at: 358, n: "04", t: "Reframe + caption", s: "Tuned per platform" },
  ];

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* S1 · HOOK (0–210) */}
      <Sect from={0} to={210}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36 }}>
          <Rise at={8}><Tag>FEATURE · AI CLIPPER</Tag></Rise>
          <Line at={20} size={104} maxWidth={1500}
            words={[{ t: "One" }, { t: "video" }, { t: "in." }, { t: "Ten" }, { t: "clips" }, { t: "out.", c: D.lime, serif: true }]} />
          <Line at={70} size={38} color={D.sub} maxWidth={1200} weight={500} stagger={3}
            words={[{ t: "Manual" }, { t: "clippers" }, { t: "grind" }, { t: "3–4" }, { t: "an" }, { t: "hour." }, { t: "You're" }, { t: "competing" }, { t: "against" }, { t: "software", serif: true }, { t: "now.", serif: true }]} />
        </AbsoluteFill>
      </Sect>

      {/* S2 · PIPELINE (210–480) */}
      <Sect from={210} to={480}>
        <div style={{ position: "absolute", top: 84, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={220}><Tag>THE PIPELINE</Tag></Rise>
          <Line at={230} size={66} maxWidth={1500}
            words={[{ t: "It" }, { t: "clips." }, { t: "It" }, { t: "captions." }, { t: "It" }, { t: "reframes.", c: D.lime }]} />
        </div>
        <Phone at={244} x={200} y={330} />
        <div style={{ position: "absolute", left: 620, top: 348, display: "flex", flexDirection: "column", gap: 22, width: 700 }}>
          {steps.map((st, i) => (
            <Rise key={i} at={st.at}>
              <Card style={{ padding: "20px 30px", display: "flex", alignItems: "center", gap: 22 }}>
                <div style={{ fontFamily: mono, fontSize: 20, color: D.lime, letterSpacing: 2 }}>{st.n}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 600, fontSize: 30, color: D.ink }}>{st.t}</div>
                  <div style={{ fontFamily: geist, fontSize: 19, color: D.sub, marginTop: 2 }}>{st.s}</div>
                </div>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: D.limeBright, boxShadow: `0 0 10px ${D.limeBright}` }} />
              </Card>
            </Rise>
          ))}
        </div>
        {/* 1 → 10 money moment */}
        <Rise at={400} style={{ position: "absolute", left: 1400, top: 420 }}>
          <Card dark style={{ padding: "34px 40px", width: 360 }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 84, color: "#fff", letterSpacing: -3 }}>
              1 <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 52 }}>→</span> <span style={{ color: D.limeBright }}>10</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: 2.5, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
              CLIPS PER SOURCE VIDEO
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* S3 · POST + SUBMIT (480–710) */}
      <Sect from={480} to={710}>
        <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
          <Rise at={490}><Tag>THEN IT SHIPS</Tag></Rise>
          <Line at={500} size={66} maxWidth={1560}
            words={[{ t: "Posted" }, { t: "everywhere." }, { t: "Submitted" }, { t: "on" }, { t: "time.", c: D.lime, serif: true }]} />
        </div>
        <div style={{ position: "absolute", top: 380, width: "100%", display: "flex", justifyContent: "center", gap: 40 }}>
          <Rise at={530}>
            <Card style={{ padding: "34px 42px", width: 620 }}>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: D.ink, marginBottom: 20 }}>Auto-posting, staggered</div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {["tiktok", "youtube", "instagram", "x"].map((p, i) => {
                  const ps = spring({ frame: frame - (548 + i * 8), fps, config: { damping: 16, stiffness: 160 } });
                  return (
                    <div key={p} style={{ width: 68, height: 68, borderRadius: 18, background: D.ink, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${ps})`, opacity: ps }}>
                      <Img src={staticFile(`platforms/${p}.svg`)} style={{ width: 32 }} />
                    </div>
                  );
                })}
                <div style={{ marginLeft: 12, fontFamily: mono, fontSize: 17, color: D.lime, letterSpacing: 2 }}>
                  POSTED · {String(Math.floor(interpolate(frame, [575, 660], [0, 47], CL))).padStart(2, "0")} THIS WEEK
                </div>
              </div>
            </Card>
          </Rise>
          <Rise at={572}>
            <Card style={{ padding: "34px 42px", width: 560 }}>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: D.ink }}>Submission windows</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 62, color: D.lime, margin: "12px 0 6px", letterSpacing: -2 }}>never missed</div>
              <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, letterSpacing: 1.5 }}>
                QUALITY-GATED · STAGGERED · ACCOUNTS ALIVE
              </div>
            </Card>
          </Rise>
        </div>
        <Rise at={620} style={{ position: "absolute", bottom: 120, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: geist, fontSize: 26, color: D.sub }}>
            One dashboard number: <span style={{ fontFamily: display, fontWeight: 700, color: D.ink }}>what it earned.</span>
          </div>
        </Rise>
      </Sect>

      {/* S4 · OUTRO (700–900) */}
      <DayOutro at={706} headline={[{ t: "Stop" }, { t: "clipping" }, { t: "manually.", c: D.lime, serif: true }]} />

      <Vignette />
    </AbsoluteFill>
  );
};
