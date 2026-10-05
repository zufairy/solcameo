/**
 * MasterSwarm — assembles the 9 SWARM scenes into one film.
 * Responsive: renders both VelloSwarm (1920×1080) and VelloSwarmVertical
 * (1080×1920). Joins alternate presentations so no two cuts feel the same.
 *
 * Soundtrack: public/audio/swarm.mp3 (generated, 124bpm volt-electro).
 * Replace the file with a licensed track any time — same filename, no code change.
 */
import React from "react";
import { AbsoluteFill, Audio, staticFile, Easing, useVideoConfig, interpolate } from "remotion";
import {
  TransitionSeries,
  linearTiming,
  springTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";

import { SwHook } from "./scenes/SwHook";
import { SwLogo } from "./scenes/SwLogo";
import { SwBounty } from "./scenes/SwBounty";
import { SwSwarm } from "./scenes/SwSwarm";
import { SwUnique } from "./scenes/SwUnique";
import { SwEcon } from "./scenes/SwEcon";
import { SwEarnInvest } from "./scenes/SwEarnInvest";
import { SwMarket } from "./scenes/SwMarket";
import { SwEnd } from "./scenes/SwEnd";

import { SW_DUR, SW_TRANSITIONS, SW_TOTAL_FRAMES } from "./timeline";
import { SW } from "./theme";

const SWARM_AUDIO = "audio/swarm.mp3";
const HAS_SWARM_AUDIO = true;

export const MasterSwarm: React.FC = () => {
  const { width, height } = useVideoConfig();
  const wipeDir = height > width ? "from-bottom" : "from-left";
  const slideDir = height > width ? "from-bottom" : "from-right";

  return (
    <AbsoluteFill style={{ backgroundColor: SW.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SW_DUR.hook}>
          <SwHook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: SW_TRANSITIONS[0] })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.logo}>
          <SwLogo />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: wipeDir })}
          timing={linearTiming({
            durationInFrames: SW_TRANSITIONS[1],
            easing: Easing.inOut(Easing.cubic),
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.bounty}>
          <SwBounty />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: slideDir })}
          timing={springTiming({
            config: { damping: 200 },
            durationInFrames: SW_TRANSITIONS[2],
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.swarm}>
          <SwSwarm />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={clockWipe({ width, height })}
          timing={linearTiming({
            durationInFrames: SW_TRANSITIONS[3],
            easing: Easing.inOut(Easing.cubic),
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.unique}>
          <SwUnique />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: SW_TRANSITIONS[4] })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.econ}>
          <SwEcon />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: slideDir })}
          timing={springTiming({
            config: { damping: 200 },
            durationInFrames: SW_TRANSITIONS[5],
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.earnInvest}>
          <SwEarnInvest />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={wipe({ direction: wipeDir })}
          timing={linearTiming({
            durationInFrames: SW_TRANSITIONS[6],
            easing: Easing.inOut(Easing.cubic),
          })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.market}>
          <SwMarket />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: SW_TRANSITIONS[7] })}
        />
        <TransitionSeries.Sequence durationInFrames={SW_DUR.end}>
          <SwEnd />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {HAS_SWARM_AUDIO && (
        <Audio
          src={staticFile(SWARM_AUDIO)}
          volume={(f) =>
            interpolate(
              f,
              [0, 20, SW_TOTAL_FRAMES - 70, SW_TOTAL_FRAMES - 6],
              [0, 1, 1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
          }
        />
      )}
    </AbsoluteFill>
  );
};
