/**
 * V6 — "Meet Vello" · flagship explainer (50s, 16:9).
 * DAYBREAK theme — the website's own daylight world: bone paper, sky blues,
 * ink typography, one lime signal. Completely different from the volt films.
 * Uses real vello.gg footage: pixel-park hero, live agent clip, site UI flows.
 */
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, Loop, staticFile,
  useCurrentFrame, useVideoConfig, spring, interpolate, Easing,
} from "remotion";
import { display, mono, geist, serif } from "../lib/fonts";

/* ── DAYBREAK palette ── */
const D = {
  paper: "#F7F6F1",
  paper2: "#EFEEE6",
  sky: "#BFE3F5",
  skyDeep: "#8EC9E8",
  ink: "#20261C",
  sub: "#6B7263",
  faint: "#9AA091",
  lime: "#65A30D",
  limeBright: "#A3E635",
  card: "#FFFFFF",
  line: "rgba(32,38,28,0.12)",
  dark: "#161B12",
} as const;

const EASE = Easing.bezier(0.32, 0.72, 0, 1);
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* smooth spring-in */
const useIn = (at: number, damping = 26, mass = 1) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, mass, stiffness: 120 } });
};

const Rise: React.FC<{ at: number; children: React.ReactNode; y?: number; style?: React.CSSProperties }> = ({ at, children, y = 40, style }) => {
  const s = useIn(at);
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>{children}</div>;
};

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; dark?: boolean }> = ({ children, style, dark }) => (
  <div style={{
    background: dark ? D.dark : D.card,
    borderRadius: 24,
    border: `1.5px solid ${dark ? "rgba(255,255,255,0.09)" : D.line}`,
    boxShadow: dark ? "0 24px 48px rgba(22,27,18,0.35)" : "0 18px 40px rgba(32,38,28,0.10), 0 2px 6px rgba(32,38,28,0.05)",
    ...style,
  }}>{children}</div>
);

const Tag: React.FC<{ children: React.ReactNode; color?: string; light?: boolean }> = ({ children, color = D.lime, light }) => (
  <div style={{
    display: "inline-flex", alignItems: "center", gap: 10,
    fontFamily: mono, fontSize: 19, letterSpacing: 3.5, textTransform: "uppercase",
    color: light ? "#fff" : color,
    background: light ? "rgba(255,255,255,0.14)" : `${color}14`,
    border: `1.5px solid ${light ? "rgba(255,255,255,0.35)" : `${color}44`}`,
    borderRadius: 999, padding: "10px 20px", backdropFilter: "blur(6px)",
  }}>
    <span style={{ width: 8, height: 8, borderRadius: 99, background: light ? "#fff" : color }} />
    {children}
  </div>
);

/* word-by-word smooth headline */
const Line: React.FC<{ words: { t: string; c?: string; serif?: boolean }[]; at: number; size: number; color?: string; stagger?: number; weight?: number; align?: "center" | "left"; maxWidth?: number }> =
  ({ words, at, size, color = D.ink, stagger = 4, weight = 600, align = "center", maxWidth }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: `${size * 0.08}px ${size * 0.26}px`, justifyContent: align === "center" ? "center" : "flex-start", maxWidth, fontFamily: display, fontSize: size, fontWeight: weight, letterSpacing: -size * 0.028, lineHeight: 1.04, color }}>
      {words.map((w, i) => {
        const s = spring({ frame: frame - (at + i * stagger), fps, config: { damping: 24, stiffness: 130, mass: 0.9 } });
        return (
          <span key={i} style={{
            display: "inline-block", opacity: s,
            transform: `translateY(${(1 - s) * size * 0.45}px)`,
            filter: `blur(${(1 - s) * 6}px)`,
            color: w.c ?? color,
            fontFamily: w.serif ? serif : display,
            fontStyle: w.serif ? "italic" : "normal",
            fontWeight: w.serif ? 500 : weight,
          }}>{w.t}</span>
        );
      })}
    </div>
  );
};

/* floating task chip (like the site hero) */
const TaskChip: React.FC<{ at: number; label: string; status: string; x: number; y: number; drift?: number }> = ({ at, label, status, x, y, drift = 10 }) => {
  const frame = useCurrentFrame();
  const s = useIn(at, 22);
  const bob = Math.sin((frame - at) / 22) * drift;
  return (
    <div style={{
      position: "absolute", left: x, top: y + bob, opacity: s * 0.96,
      transform: `translateY(${(1 - s) * 30}px) scale(${0.92 + s * 0.08})`,
      display: "flex", alignItems: "center", gap: 14,
      background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)",
      borderRadius: 16, padding: "16px 24px",
      boxShadow: "0 12px 30px rgba(32,38,28,0.18)",
      border: `1px solid ${D.line}`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: status === "RUNNING" ? "#F59E0B" : D.limeBright, boxShadow: `0 0 8px ${status === "RUNNING" ? "#F59E0B" : D.limeBright}` }} />
      <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: 2, color: D.faint }}>TASK {status}</span>
      <span style={{ fontFamily: geist, fontSize: 20, fontWeight: 600, color: D.ink }}>{label}</span>
    </div>
  );
};

/* typed chat bubble */
const Bubble: React.FC<{ at: number; text: string; me?: boolean }> = ({ at, text, me }) => {
  const frame = useCurrentFrame();
  const s = useIn(at, 22);
  const chars = Math.floor(interpolate(frame, [at + 2, at + 2 + text.length * 0.7], [0, text.length], CL));
  return (
    <div style={{ display: "flex", justifyContent: me ? "flex-end" : "flex-start", opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>
      <div style={{
        maxWidth: 460, padding: "16px 22px", borderRadius: 20,
        borderBottomRightRadius: me ? 6 : 20, borderBottomLeftRadius: me ? 20 : 6,
        background: me ? D.ink : D.paper2, color: me ? "#F4F6F0" : D.ink,
        fontFamily: geist, fontSize: 22, lineHeight: 1.45,
      }}>{text.slice(0, chars)}<span style={{ opacity: chars < text.length ? 0.6 : 0 }}>▍</span></div>
    </div>
  );
};

const W = 1920, H = 1080;

/* section crossfade helper */
const Sect: React.FC<{ from: number; to: number; children: React.ReactNode; bg?: string }> = ({ from, to, children, bg }) => {
  const frame = useCurrentFrame();
  if (frame < from - 14 || frame > to + 14) return null;
  const o = interpolate(frame, [from - 12, from + 6, to - 6, to + 12], [0, 1, 1, 0], CL);
  return <AbsoluteFill style={{ opacity: o, background: bg }}>{children}</AbsoluteFill>;
};

export const V6Explainer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* hero ken-burns */
  const heroZoom = interpolate(frame, [0, 170], [1.06, 1.16], { ...CL, easing: EASE });
  const heroFade = interpolate(frame, [130, 168], [1, 0], CL);

  /* payout counter */
  const glyphS = useIn(1268, 18);

  return (
    <AbsoluteFill style={{ background: D.paper }}>

      {/* ══ S1 · HERO (0–168) ══ */}
      {frame < 180 && (
        <AbsoluteFill style={{ opacity: heroFade }}>
          <AbsoluteFill style={{ transform: `scale(${heroZoom})` }}>
            <Loop durationInFrames={150} layout="none">
              <OffthreadVideo muted src={staticFile("site/cofounder-bg.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
            </Loop>
          </AbsoluteFill>
          <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(14,28,42,0.62) 0%, rgba(14,28,42,0.28) 42%, rgba(14,28,42,0.0) 65%), linear-gradient(180deg, rgba(24,40,60,0.25) 0%, rgba(24,40,60,0.0) 50%, rgba(247,246,241,0.8) 100%)" }} />
          <TaskChip at={18} label="Post to TikTok" status="COMPLETED" x={1210} y={250} />
          <TaskChip at={34} label="Render daily video" status="RUNNING" x={1150} y={370} drift={14} />
          <TaskChip at={50} label="Payout 240 USDC" status="COMPLETED" x={1250} y={490} drift={8} />
          <div style={{ position: "absolute", left: 120, top: 300, display: "flex", flexDirection: "column", gap: 34 }}>
            <Rise at={6}><Tag light>THE AI INFLUENCER NETWORK</Tag></Rise>
            <Line at={16} size={110} color="#FFFFFF" align="left" maxWidth={1050} weight={600}
              words={[{ t: "Meet" }, { t: "Vello.", c: D.limeBright }]} />
            <Line at={34} size={46} color="rgba(255,255,255,0.92)" align="left" maxWidth={900} weight={500} stagger={3}
              words={[{ t: "Launch" }, { t: "AI" }, { t: "influencers" }, { t: "that" }, { t: "create,", serif: true }, { t: "post,", serif: true }, { t: "and" }, { t: "earn.", serif: true }]} />
          </div>
        </AbsoluteFill>
      )}

      {/* ══ S2 · BUILD (168–430) ══ */}
      <Sect from={168} to={430}>
        <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Rise at={178}><Tag>01 · BUILD</Tag></Rise>
          <Line at={188} size={72} maxWidth={1500}
            words={[{ t: "Describe" }, { t: "the" }, { t: "creator" }, { t: "you" }, { t: "want.", c: D.lime }]} />
        </div>
        {/* flow nodes */}
        <div style={{ position: "absolute", left: 150, top: 400 }}>
          {[
            { at: 220, t: "Your prompt", s: "Coffee influencer", x: 0, y: 90 },
            { at: 262, t: "Persona", s: "Voice & memory", x: 300, y: 0 },
            { at: 304, t: "Face & Voice", s: "Consistent look", x: 300, y: 190 },
          ].map((n, i) => (
            <Rise key={i} at={n.at} style={{ position: "absolute", left: n.x, top: n.y }}>
              <Card style={{ padding: "22px 30px", width: 280 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: `${D.limeBright}33`, border: `1.5px solid ${D.lime}55`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: display, fontWeight: 700, color: D.lime }}>{i + 1}</div>
                  <div>
                    <div style={{ fontFamily: display, fontWeight: 600, fontSize: 24, color: D.ink }}>{n.t}</div>
                    <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, marginTop: 2 }}>{n.s}</div>
                  </div>
                </div>
              </Card>
            </Rise>
          ))}
          {/* connectors */}
          <svg width="640" height="420" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
            <path d="M 280 135 C 320 135, 320 55, 360 55" stroke={D.lime} strokeWidth="2.5" fill="none" strokeDasharray="300" strokeDashoffset={interpolate(frame, [250, 290], [300, 0], CL)} opacity="0.6" />
            <path d="M 280 145 C 320 145, 320 245, 360 245" stroke={D.lime} strokeWidth="2.5" fill="none" strokeDasharray="300" strokeDashoffset={interpolate(frame, [292, 332], [300, 0], CL)} opacity="0.6" />
          </svg>
        </div>
        {/* chat panel */}
        <div style={{ position: "absolute", right: 150, top: 370, width: 560 }}>
          <Card style={{ padding: 34, display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", gap: 22, fontFamily: mono, fontSize: 16, letterSpacing: 2, color: D.faint, borderBottom: `1px solid ${D.line}`, paddingBottom: 14 }}>
              <span style={{ color: D.ink, fontWeight: 700 }}>BUILD</span><span>STUDIO</span><span>CAMPAIGNS</span><span>EARN</span>
            </div>
            <Bubble at={230} me text="Create an AI influencer for my coffee brand." />
            <Bubble at={276} text="Love it. What vibe should Kaverro have?" />
            <Bubble at={322} me text="Cozy and aesthetic. Speaks English and Malay." />
            <Rise at={378}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: D.paper2, borderRadius: 16, padding: "14px 20px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 99, background: `linear-gradient(135deg, ${D.limeBright}, ${D.skyDeep})` }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 21, color: D.ink }}>Kaverro</div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: D.faint }}>@kaverro.coffee</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 15, color: D.lime, background: `${D.limeBright}2c`, borderRadius: 99, padding: "6px 14px", letterSpacing: 1 }}>✓ READY</span>
              </div>
            </Rise>
          </Card>
        </div>
      </Sect>

      {/* ══ S3 · CREATE & POST (430–700) ══ */}
      <Sect from={430} to={700}>
        <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Rise at={440}><Tag>02 · CREATE & POST</Tag></Rise>
          <Line at={450} size={72} maxWidth={1560}
            words={[{ t: "It" }, { t: "films." }, { t: "It" }, { t: "clips." }, { t: "It" }, { t: "posts" }, { t: "daily.", c: D.lime }]} />
        </div>
        {/* real agent clip in phone frame */}
        <Rise at={462} style={{ position: "absolute", left: 320, top: 330 }}>
          <div style={{ width: 300, height: 620, borderRadius: 44, background: D.ink, padding: 12, boxShadow: "0 30px 60px rgba(32,38,28,0.30)" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 34, overflow: "hidden", position: "relative" }}>
              <OffthreadVideo src={staticFile("site/vello_clip3.mp4")} muted startFrom={60} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", bottom: 14, left: 14, fontFamily: mono, fontSize: 13, letterSpacing: 1.5, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 99, padding: "6px 12px" }}>MADE ON VELLO</div>
            </div>
          </div>
        </Rise>
        {/* clipper + posting cards */}
        <div style={{ position: "absolute", left: 720, top: 360, display: "flex", flexDirection: "column", gap: 30, width: 800 }}>
          <Rise at={500}>
            <Card style={{ padding: "30px 38px", display: "flex", alignItems: "center", gap: 30 }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 60, color: D.ink }}>1<span style={{ color: D.faint, fontSize: 40 }}> → </span><span style={{ color: D.lime }}>10</span></div>
              <div>
                <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: D.ink }}>AI Clipper</div>
                <div style={{ fontFamily: geist, fontSize: 20, color: D.sub, marginTop: 4 }}>One long video becomes ten viral clips, captions tuned per platform.</div>
              </div>
            </Card>
          </Rise>
          <Rise at={548}>
            <Card style={{ padding: "30px 38px" }}>
              <div style={{ fontFamily: display, fontWeight: 600, fontSize: 28, color: D.ink, marginBottom: 18 }}>Auto-posting, every platform</div>
              <div style={{ display: "flex", gap: 16 }}>
                {["tiktok", "youtube", "instagram", "x"].map((p, i) => {
                  const ps = spring({ frame: frame - (566 + i * 8), fps, config: { damping: 16, stiffness: 160 } });
                  return (
                    <div key={p} style={{ width: 72, height: 72, borderRadius: 18, background: D.ink, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${ps})`, opacity: ps }}>
                      <Img src={staticFile(`platforms/${p}.svg`)} style={{ width: 34 }} />
                    </div>
                  );
                })}
                <div style={{ alignSelf: "center", marginLeft: 10, fontFamily: mono, fontSize: 18, color: D.lime, letterSpacing: 2 }}>
                  POSTED · {String(Math.floor(interpolate(frame, [590, 660], [0, 38], CL))).padStart(2, "0")} THIS WEEK
                </div>
              </div>
            </Card>
          </Rise>
        </div>
      </Sect>

      {/* ══ S4 · GET PAID (700–960) ══ */}
      <Sect from={700} to={960}>
        <div style={{ position: "absolute", top: 90, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Rise at={710}><Tag>03 · GET PAID</Tag></Rise>
          <Line at={720} size={72} maxWidth={1500}
            words={[{ t: "Verified" }, { t: "views." }, { t: "Real" }, { t: "payouts.", c: D.lime }]} />
        </div>
        {/* bounty cards */}
        <div style={{ position: "absolute", left: 170, top: 380, display: "flex", flexDirection: "column", gap: 26 }}>
          {[{ at: 742, n: "Vello", r: "$3.00" }, { at: 782, n: "Mach City", r: "$3.00" }].map((b, i) => (
            <Rise key={i} at={b.at}>
              <Card style={{ padding: "26px 34px", width: 430, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: D.limeBright }} />
                    <span style={{ fontFamily: display, fontWeight: 700, fontSize: 26, color: D.ink }}>{b.n}</span>
                    <span style={{ fontFamily: mono, fontSize: 13, color: D.lime, letterSpacing: 2 }}>LIVE</span>
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: D.faint, marginTop: 6, letterSpacing: 2 }}>REWARD</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: display, fontWeight: 700, fontSize: 44, color: D.ink }}>{b.r}</div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: D.sub }}>/ 1k views</div>
                </div>
              </Card>
            </Rise>
          ))}
          <Rise at={822}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 17, color: D.sub, letterSpacing: 2, paddingLeft: 8 }}>
              <span style={{ color: D.lime, fontSize: 22 }}>✓</span> ORACLE-VERIFIED BEFORE PAYOUT
            </div>
          </Rise>
        </div>
        {/* wallet card (dark for contrast) */}
        <Rise at={790} style={{ position: "absolute", right: 170, top: 380 }}>
          <Card dark style={{ padding: "40px 48px", width: 560 }}>
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: "rgba(255,255,255,0.55)" }}>LIFETIME EARNED</div>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 96, color: D.limeBright, margin: "10px 0 6px", textShadow: `0 0 40px ${D.limeBright}44` }}>
              ${Math.floor(interpolate(frame, [800, 900], [0, 48210], { ...CL, easing: (t) => 1 - Math.pow(1 - t, 3) })).toLocaleString()}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: mono, fontSize: 17, color: "rgba(255,255,255,0.75)", letterSpacing: 1.5 }}>
              <span style={{ color: "#22D3EE" }}>◎</span> SETTLED ON SOLANA · STRAIGHT TO YOUR WALLET
            </div>
          </Card>
        </Rise>
      </Sect>

      {/* ══ S5 · PROOF (960–1180) ══ */}
      <Sect from={960} to={1180}>
        <div style={{ position: "absolute", top: 100, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Rise at={970}><Tag>CASE STUDIES</Tag></Rise>
          <Line at={980} size={70} maxWidth={1500}
            words={[{ t: "Real" }, { t: "revenue.", serif: true, c: D.lime }, { t: "Real" }, { t: "reach.", serif: true }]} />
        </div>
        <div style={{ position: "absolute", top: 400, width: "100%", display: "flex", justifyContent: "center", gap: 44 }}>
          {[
            { at: 1000, big: "$30K", cap: "monthly revenue — AI clipping agency", sub: "42,000 clips/mo · 0 editors · 3 people" },
            { at: 1040, big: "10,000", cap: "users in 7 days — zero human creators", sub: "60+ posts a day, bounty-driven" },
            { at: 1080, big: "$12K", cap: "her first 30 days on Vello", sub: "one operator, one agent roster" },
          ].map((c, i) => (
            <Rise key={i} at={c.at}>
              <Card style={{ padding: "44px 46px", width: 470, minHeight: 300 }}>
                <div style={{ fontFamily: display, fontWeight: 700, fontSize: 92, color: D.ink, letterSpacing: -4 }}>
                  {c.big}
                </div>
                <div style={{ width: 64, height: 4, background: D.limeBright, borderRadius: 4, margin: "16px 0 18px" }} />
                <div style={{ fontFamily: geist, fontSize: 24, fontWeight: 600, color: D.ink, lineHeight: 1.35 }}>{c.cap}</div>
                <div style={{ fontFamily: mono, fontSize: 16, color: D.faint, marginTop: 12, letterSpacing: 1 }}>{c.sub}</div>
              </Card>
            </Rise>
          ))}
        </div>
      </Sect>

      {/* ══ S6 · MANIFESTO (1180–1310) ══ */}
      <Sect from={1180} to={1310} bg={`linear-gradient(180deg, ${D.sky} 0%, ${D.paper} 85%)`}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Line at={1192} size={84} maxWidth={1500} stagger={5}
            words={[
              { t: "AI" }, { t: "shouldn't" }, { t: "replace" }, { t: "humans." },
            ]} />
          <Line at={1234} size={84} maxWidth={1500} stagger={5}
            words={[
              { t: "It" }, { t: "should" }, { t: "work", c: D.lime, serif: true }, { t: "for", c: D.lime, serif: true }, { t: "them.", c: D.lime, serif: true },
            ]} />
        </AbsoluteFill>
      </Sect>

      {/* ══ S7 · CTA (1310–1500) ══ */}
      <Sect from={1310} to={1520} bg={D.paper}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
          <div style={{
            width: 190, height: 190, borderRadius: 46, overflow: "hidden",
            transform: `scale(${glyphS + (frame > 1330 ? Math.sin((frame - 1330) / 30) * 0.015 : 0)}) rotate(${(1 - glyphS) * -10}deg)`,
            opacity: glyphS,
            boxShadow: `0 30px 70px rgba(32,38,28,0.25), 0 0 90px ${D.limeBright}55`,
          }}>
            <Img src={staticFile("brand/vellosquare.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <Line at={1288} size={76} maxWidth={1500}
            words={[
              { t: "Create.", serif: true }, { t: "Post.", serif: true }, { t: "Earn.", c: D.lime, serif: true },
            ]} />
          <Rise at={1320}>
            <div style={{
              fontFamily: display, fontWeight: 700, fontSize: 42, color: "#0A0C08",
              background: D.limeBright, borderRadius: 999, padding: "22px 54px",
              boxShadow: `0 10px 0 ${D.lime}, 0 30px 60px rgba(101,163,13,0.35)`,
            }}>
              Launch an influencer → vello.gg
            </div>
          </Rise>
          <Rise at={1345}>
            <div style={{ fontFamily: mono, fontSize: 20, letterSpacing: 6, color: D.faint, textTransform: "uppercase" }}>
              vello · the AI influencer network
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* film vignette */}
      <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse 115% 95% at 50% 50%, transparent 70%, rgba(32,38,28,0.10) 100%)" }} />
    </AbsoluteFill>
  );
};
