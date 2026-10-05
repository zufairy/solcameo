/**
 * M1 · "Blanket the Feed" — Pillar 6 (swarm / scale spectacle).
 * One brief → a coverage grid of platform tiles lighting up across a day with
 * view-pings, an aggregate verified-views counter flooding the feed. Distinct
 * from the chip-field (D1) and timecode time-lapse (G1): this is a live coverage
 * heatmap — the feed getting saturated, tile by tile.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { D, CL, W, H, display, mono, geist, Rise, Tag, Line, Card, Sect, EndCard, Vignette, useCount, useIn } from "./_kit";

const PLATFORMS = ["TikTok", "Reels", "Shorts", "X"];
const COLS = 16, ROWS = 8;

const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  const cells = COLS * ROWS;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 8, width: 1360, height: 620 }}>
      {Array.from({ length: cells }).map((_, i) => {
        // deterministic "post" order sweeping across the grid
        const order = (i * 37) % cells;
        const litAt = 210 + order * 3.1;
        const s = spring({ frame: frame - litAt, fps: 30, config: { damping: 14, stiffness: 170 } });
        const isHero = order % 9 === 0;
        const bg = s > 0.15 ? (isHero ? D.limeBright : "#DCEFA4") : D.paper2;
        const ping = Math.max(0, 1 - (frame - litAt) / 10);
        return (
          <div key={i} style={{
            borderRadius: 6, background: bg, border: `1px solid ${D.line}`,
            transform: `scale(${0.6 + s * 0.4})`, opacity: 0.35 + s * 0.65,
            boxShadow: ping > 0 ? `0 0 ${ping * 16}px ${D.limeBright}` : "none",
          }} />
        );
      })}
    </div>
  );
};

export const M1BlanketTheFeed: React.FC = () => {
  const frame = useCurrentFrame();
  const views = useCount(210, 470, 1284500);
  const posts = useCount(210, 470, 137);

  return (
    <AbsoluteFill style={{ background: D.paper }}>
      {/* sky wash */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${D.sky}55 0%, ${D.paper} 46%)` }} />

      {/* S1 · HOOK (0–150) */}
      <Sect from={0} to={150}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 30 }}>
          <Rise at={8}><Tag>SCALE · COVERAGE</Tag></Rise>
          <Line at={20} size={112} maxWidth={1560}
            words={[{ t: "One" }, { t: "brief." }, { t: "A" }, { t: "hundred", c: D.lime, serif: true }, { t: "posts." }]} />
          <Rise at={78}><div style={{ fontFamily: geist, fontSize: 32, color: D.sub }}>The feed doesn't get one shot at you. It gets flooded.</div></Rise>
        </AbsoluteFill>
      </Sect>

      {/* S2 · COVERAGE GRID (150–720) */}
      <Sect from={150} to={720}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
          <Rise at={160} style={{ display: "flex", gap: 14 }}>
            {PLATFORMS.map((p, i) => {
              const on = frame > 200 + i * 40;
              return (
                <span key={p} style={{
                  fontFamily: mono, fontSize: 20, letterSpacing: 2, padding: "10px 20px", borderRadius: 999,
                  color: on ? D.ink : D.faint, background: on ? `${D.limeBright}30` : D.paper2,
                  border: `1.5px solid ${on ? D.lime + "55" : D.line}`,
                }}>{p}</span>
              );
            })}
          </Rise>

          <Grid />

          <Rise at={230} style={{ display: "flex", gap: 46, alignItems: "flex-end" }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.faint }}>CLIPS POSTED TODAY</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 74, color: D.ink, lineHeight: 1 }}>{posts}</div>
            </div>
            <div style={{ width: 1.5, height: 78, background: D.line }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: 3, color: D.lime }}>AGGREGATE VERIFIED VIEWS</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 74, color: D.ink, lineHeight: 1 }}>{views.toLocaleString()}</div>
            </div>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S3 · MONEY CARD (720–790) */}
      <Sect from={720} to={790}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Rise at={728}>
            <Card dark style={{ padding: "40px 56px", maxWidth: 1180 }}>
              <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: 3, color: D.limeBright, marginBottom: 12 }}>DISTRIBUTION THAT NEVER SLEEPS</div>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 58, color: "#fff", lineHeight: 1.08 }}>
                Every verified view pays — <span style={{ color: D.limeBright }}>not every post.</span>
              </div>
            </Card>
          </Rise>
        </AbsoluteFill>
      </Sect>

      {/* S4 · CTA (790–900) */}
      <Sect from={790} to={900}>
        <EndCard at={800} kicker={[{ t: "Flood" }, { t: "the" }, { t: "feed.", c: D.lime, serif: true }]} />
      </Sect>

      <Vignette />
    </AbsoluteFill>
  );
};
