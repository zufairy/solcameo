/**
 * W1 — "ONE COMMAND" · CRT terminal ops film (~27s).
 * Design: green phosphor terminal, scanlines, type-on, glitch cuts.
 */
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate, random } from "remotion";
import { mono, display } from "../lib/fonts";

const BG = "#050805", PH = "#B8FF5C", PH_D = "#5C8A2E", WHITE = "#E8F5DC";
const CL = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Scanlines: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0 2px, transparent 2px 5px)" }} />
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: ((frame * 7) % 1300) - 100, height: 90, background: "linear-gradient(180deg, transparent, rgba(184,255,92,0.05), transparent)" }} />
    </AbsoluteFill>
  );
};

/* type-on text */
const Type: React.FC<{ at: number; text: string; size?: number; color?: string; x: number; y: number; speed?: number; bold?: boolean }> =
  ({ at, text, size = 34, color = PH, x, y, speed = 1.4, bold }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const n = Math.min(text.length, Math.floor((frame - at) * speed));
  return (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: mono, fontSize: size, fontWeight: bold ? 700 : 400, color, textShadow: `0 0 12px ${color}88`, whiteSpace: "pre" }}>
      {text.slice(0, n)}{n < text.length && <span style={{ opacity: Math.floor(frame / 4) % 2 ? 1 : 0 }}>▊</span>}
    </div>
  );
};

/* big glitch slam */
const GSlam: React.FC<{ at: number; out: number; text: string; size?: number; y?: number }> = ({ at, out, text, size = 170, y = 430 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at || frame > out) return null;
  const s = spring({ frame: frame - at, fps, config: { damping: 13, stiffness: 220, mass: 0.6 } });
  const gl = frame < at + 7 ? (random(`g${frame}`) - 0.5) * 22 : 0;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: y, textAlign: "center" }}>
      <div style={{ position: "relative", display: "inline-block", fontFamily: display, fontWeight: 700, fontSize: size, letterSpacing: -size * 0.03, textTransform: "uppercase", transform: `scale(${1.25 - 0.25 * s})`, opacity: s }}>
        <span style={{ position: "absolute", left: gl, top: 0, color: "#FF3E6C", opacity: 0.55 }}>{text}</span>
        <span style={{ position: "absolute", left: -gl, top: 0, color: "#3EC8FF", opacity: 0.55 }}>{text}</span>
        <span style={{ position: "relative", color: WHITE, textShadow: `0 0 60px ${PH}66` }}>{text}</span>
      </div>
    </div>
  );
};

const LOGS = [
  "[00:14] scanning bounty boards … 3 live",
  "[00:15] target: gaming · $3.00 / 1k verified",
  "[00:19] downloading source … done (2.1 GB)",
  "[00:41] moments ranked · cutting 41 clips",
  "[01:12] captions tuned · tiktok reels shorts x",
  "[01:30] posting · staggered · human-paced",
  "[02:44] submissions: 41/41 before deadline",
  "[05:02] verified views: 57,204 ✓",
  "[05:02] payout routed → wallet · $114.20",
];

export const W1Terminal: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: BG }}>
      {/* window chrome */}
      <div style={{ position: "absolute", inset: 60, border: `1.5px solid ${PH_D}55`, borderRadius: 14 }}>
        <div style={{ height: 52, borderBottom: `1.5px solid ${PH_D}44`, display: "flex", alignItems: "center", gap: 10, padding: "0 22px" }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <span key={c} style={{ width: 14, height: 14, borderRadius: 99, background: c, opacity: 0.85 }} />)}
          <span style={{ fontFamily: mono, fontSize: 18, color: PH_D, marginLeft: 16 }}>operator@vello — swarm-01</span>
        </div>
      </div>

      <Type at={5} x={130} y={170} size={44} bold text="$ vello deploy --agent clipper --mode overnight" speed={1.7} />
      <Type at={48} x={130} y={240} size={30} color={PH_D} text="booting agent · persona locked · memory mounted" />

      {LOGS.map((l, i) => (
        <Type key={i} at={95 + i * 26} x={130} y={310 + i * 48} size={28} color={i >= 7 ? PH : PH_D} speed={2.6} text={l} bold={i >= 7} />
      ))}

      {/* glitch slams over the stream */}
      <GSlam at={370} out={450} text="No office." size={140} />
      <GSlam at={455} out={535} text="No editors." size={140} />
      <GSlam at={540} out={625} text="No mercy." size={160} />

      {/* final */}
      {frame >= 640 && (
        <AbsoluteFill style={{ background: BG, alignItems: "center", justifyContent: "center", gap: 40 }}>
          <Img src={staticFile("brand/vello-glyph.png")} style={{ width: 220, filter: `drop-shadow(0 0 45px ${PH}66)`, opacity: interpolate(frame, [640, 655], [0, 1], CL), transform: `scale(${interpolate(frame, [640, 660], [1.3, 1], CL)})` }} />
          <Type at={660} x={760} y={730} size={52} bold text="$ one command. vello" speed={1.2} />
          <Type at={725} x={760} y={800} size={30} color={PH_D} text="deploy yours → vello.gg" />
        </AbsoluteFill>
      )}
      <Scanlines />
    </AbsoluteFill>
  );
};
